suppressPackageStartupMessages({
  library(shiny)
  library(bslib)
  library(data.table)
  library(jsonlite)
  library(plotly)
  library(DT)
})

options(shiny.maxRequestSize = 1024^3)
root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
cache_version <- 2L
map_data_file <- file.path(root, "www", "maps", "map-data.json")
map_data <- if (file.exists(map_data_file)) fromJSON(map_data_file, simplifyVector = FALSE) else list()
dir.create(file.path(root, "cache", "sass"), recursive = TRUE, showWarnings = FALSE)
sass_cache <- sass::sass_file_cache(file.path(root, "cache", "sass"))
sass::sass_cache_set_dir(file.path(root, "cache", "sass"), sass_cache)
python_candidates <- c(
  Sys.getenv("CS2_PYTHON", unset = ""),
  Sys.getenv("RETICULATE_PYTHON", unset = ""),
  "C:/Users/liaml/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
  Sys.which("python")
)
python_bin <- python_candidates[nzchar(python_candidates) & file.exists(python_candidates)][1]

read_cache <- function(path) {
  list(
    path = normalizePath(path, winslash = "/"),
    metadata = fromJSON(file.path(path, "metadata.json"), simplifyVector = FALSE),
    rounds = fread(file.path(path, "rounds.csv")),
    ticks = fread(file.path(path, "ticks.csv")),
    events = fread(file.path(path, "events.csv"), na.strings = c("", "NA")),
    players = fread(file.path(path, "players.csv"))
  )
}

cache_path_for <- function(source, fps) {
  key <- unname(tools::md5sum(source))
  file.path(root, "cache", sprintf("%s-f%s-v%s", key, as.integer(fps), cache_version))
}

initial_demo <- list.files(root, pattern = "\\.dem(\\.zst)?$", full.names = TRUE, ignore.case = TRUE)[1]

ui <- fluidPage(
  theme = bs_theme(version = 5, bg = "#08111f", fg = "#f7f9fc", primary = "#5ee7b2"),
  tags$head(tags$link(rel = "stylesheet", href = "styles.css"), tags$script(src = "replay.js")),
  div(class = "app-header",
      div(tags$div(class="eyebrow", "TACTICAL REPLAY & MATCH ANALYSIS"),
          tags$h1(class="app-title", "CS2 Match Studio"),
          tags$p(class="app-subtitle", textOutput("match_subtitle", inline = TRUE))),
      div(class="team-legend", tags$span(tags$i(class="dot ct"), "Counter-Terrorists"), tags$span(tags$i(class="dot t"), "Terrorists"))),
  fluidRow(
    column(3, div(class="card control-card",
      fileInput("demo", "Demo file", accept = c(".dem", ".zst", ".dem.zst")),
      sliderInput("parse_fps", "Replay detail (frames/sec)", 4, 16, 8, 2),
      actionButton("parse", "Parse demo", class="btn-primary w-100"),
      uiOutput("parse_progress"),
      tags$hr(), selectInput("round", "Round", choices = NULL),
      tags$div(class="d-grid gap-2", downloadButton("download_gif", "Export round GIF", class="btn-secondary"), downloadButton("download_mp4", "Export round MP4", class="btn-secondary")),
      tags$small(class="text-muted d-block mt-3", "Parsing is cached by file hash. Exports use the same replay state shown here."),
      tags$div(class="mt-3", textOutput("status"))
    )),
    column(9,
      uiOutput("kpis"),
      navs_tab(
        id="main_tab",
        nav("Replay", div(class="card replay-layout",
          div(class="replay-stage", tags$canvas(id="replay-canvas", `aria-label`="Tactical map replay"),
            div(id="replay-map-badge", class="map-badge", "Waiting for demo"),
            div(class="replay-toolbar",
              tags$button(id="replay-prev", type="button", `aria-label`="Previous frame", "◀"), tags$button(id="replay-play", type="button", "Play"), tags$button(id="replay-next", type="button", `aria-label`="Next frame", "▶"),
              tags$input(id="replay-seek", type="range", min="0", max="0", value="0"),
              tags$select(id="replay-level", `aria-label`="Map level", tags$option(value="auto", "Auto level"), tags$option(value="upper", "Upper"), tags$option(value="lower", "Lower")),
              tags$select(id="replay-speed", `aria-label`="Playback speed", tags$option(value="0.5", "0.5×"), tags$option(value="1", selected=NA, "1×"), tags$option(value="2", "2×"), tags$option(value="4", "4×")),
              tags$span(id="replay-time", "0.0s")
            )),
          div(class="event-panel", tags$h4("Live action feed"), tags$p(class="event-help", "Map badges mark shots, throws, utility, damage, and objective actions."), tags$div(id="event-feed", class="empty-feed", "Load a round to begin"))
        )),
        nav("Scoreboard", div(class="card", div(class="card-header", "Player performance"), div(class="p-3", DTOutput("scoreboard")))),
        nav("Round analysis", fluidRow(column(6, div(class="card", plotlyOutput("round_chart", height="430px"))), column(6, div(class="card", plotlyOutput("event_chart", height="430px"))))),
        nav("Event log", div(class="card", div(class="p-3", DTOutput("events_table"))))
      )
    )
  )
)

server <- function(input, output, session) {
  rv <- reactiveValues(data = NULL, status = "Ready", parse_proc = NULL, parse_out = NULL, parse_progress = NULL)

  finish_source <- function(path) {
    data <- read_cache(path)
    rv$data <- data
    updateSelectInput(session, "round", choices = setNames(data$rounds$round_id, paste("Round", data$rounds$round_id)), selected = data$rounds$round_id[1])
    rv$status <- sprintf("Cached %s movement samples and %s events", format(nrow(data$ticks), big.mark=","), format(nrow(data$events), big.mark=","))
    rv$parse_progress <- list(value=100L, stage="Replay ready", complete=TRUE)
  }

  start_source <- function(path, fps) {
    if (is.na(python_bin) || !nzchar(python_bin)) stop("Python is not available on this server")
    out <- cache_path_for(path, fps)
    if (file.exists(file.path(out, "metadata.json"))) {
      finish_source(out)
      return(invisible(NULL))
    }
    if (!is.null(rv$parse_proc) && rv$parse_proc$is_alive()) stop("A demo is already being parsed")
    dir.create(out, recursive = TRUE, showWarnings = FALSE)
    unlink(file.path(out, "progress.json"), force=TRUE)
    rv$parse_out <- out
    rv$parse_progress <- list(value=1L, stage="Starting parser", complete=FALSE)
    rv$status <- "Starting parser (1%)"
    session$sendCustomMessage("parsingState", list(active=TRUE))
    rv$parse_proc <- tryCatch(
      processx::process$new(
        python_bin,
        args=c(file.path(root, "python", "parse_demo.py"), path, out, "--fps", as.character(as.integer(fps))),
        stdout=file.path(out, "parser.stdout.log"), stderr=file.path(out, "parser.stderr.log"),
        cleanup=TRUE, windows_hide_window=TRUE
      ),
      error=function(e) {
        session$sendCustomMessage("parsingState", list(active=FALSE))
        rv$parse_progress <- list(value=0L, stage="Unable to start parser", complete=FALSE, failed=TRUE)
        stop(e)
      }
    )
  }

  observeEvent(TRUE, {
    if (!is.na(initial_demo) && length(initial_demo) && !is.na(python_bin)) {
      tryCatch(start_source(initial_demo, 8L), error=function(e) rv$status <- paste("Startup parse failed:", conditionMessage(e)))
    } else rv$status <- "Choose a demo file to begin"
  }, once=TRUE)

  observeEvent(input$parse, {
    req(input$demo$datapath)
    tryCatch(start_source(input$demo$datapath, input$parse_fps), error=function(e) rv$status <- paste("Parse failed:", conditionMessage(e)))
  })

  observe({
    invalidateLater(300, session)
    proc <- rv$parse_proc
    if (is.null(proc)) return()
    progress_file <- file.path(rv$parse_out, "progress.json")
    if (file.exists(progress_file)) {
      progress <- tryCatch(fromJSON(progress_file, simplifyVector=TRUE), error=function(e) NULL)
      if (!is.null(progress)) {
        rv$parse_progress <- list(value=as.integer(progress$value), stage=progress$stage, complete=FALSE)
        rv$status <- sprintf("%s (%s%%)", progress$stage, as.integer(progress$value))
      }
    }
    if (proc$is_alive()) return()
    exit_status <- proc$get_exit_status()
    out <- rv$parse_out
    rv$parse_proc <- NULL
    session$sendCustomMessage("parsingState", list(active=FALSE))
    if (identical(exit_status, 0L) && file.exists(file.path(out, "metadata.json"))) {
      tryCatch(finish_source(out), error=function(e) rv$status <- paste("Cache load failed:", conditionMessage(e)))
    } else {
      error_file <- file.path(out, "parser.stderr.log")
      detail <- if (file.exists(error_file)) paste(tail(readLines(error_file, warn=FALSE), 8), collapse=" ") else "Parser stopped unexpectedly"
      rv$parse_progress <- list(value=0L, stage="Parsing failed", complete=FALSE, failed=TRUE)
      rv$status <- paste("Parse failed:", detail)
    }
  })

  output$status <- renderText(rv$status)
  output$parse_progress <- renderUI({
    p <- rv$parse_progress
    if (is.null(p)) return(NULL)
    value <- max(0L, min(100L, as.integer(p$value)))
    div(class=paste("parse-progress", if (isTRUE(p$complete)) "complete" else "", if (isTRUE(p$failed)) "failed" else ""),
      div(class="parse-progress-copy", tags$span(p$stage), tags$strong(sprintf("%s%%", value))),
      div(class="progress-track", role="progressbar", `aria-valuemin`="0", `aria-valuemax`="100", `aria-valuenow`=value,
        div(class="progress-fill", style=sprintf("width:%s%%", value)))
    )
  })
  output$match_subtitle <- renderText({
    if (is.null(rv$data)) return("Drop in a .dem or .dem.zst file to begin")
    m <- rv$data$metadata
    paste(m$map_name, "•", m$server_name, "•", rv$data$rounds[, .N], "rounds")
  })

  output$kpis <- renderUI({
    req(rv$data); d <- rv$data
    deaths <- d$events[event_name == "player_death"]
    ct <- d$rounds[winner == "CT", .N]; tt <- d$rounds[winner == "T", .N]
    div(class="kpis",
      div(class="kpi", tags$span("Score"), tags$strong(sprintf("CT %s — %s T", ct, tt))),
      div(class="kpi", tags$span("Eliminations"), tags$strong(nrow(deaths))),
      div(class="kpi", tags$span("Headshot rate"), tags$strong(sprintf("%.0f%%", 100*mean(deaths$headshot %in% TRUE)))),
      div(class="kpi", tags$span("Map"), tags$strong(sub("^de_", "", d$metadata$map_name)))
    )
  })

  replay_payload <- reactive({
    req(rv$data, input$round)
    selected_round <- as.integer(input$round); d <- rv$data
    # Explicit column qualification avoids matching the local round_id variable.
    ticks <- d$ticks[d$ticks$round_id == selected_round]
    r <- d$rounds[d$rounds$round_id == selected_round][1]
    split_ticks <- base::split.data.frame(as.data.frame(ticks), f = ticks$tick)
    frames <- unname(lapply(split_ticks, function(x) list(
      tick=as.integer(x$tick[1]), time=(as.integer(x$tick[1])-r$start_tick)/64,
      players=lapply(seq_len(nrow(x)), function(i) list(name=x$name[i], X=x$X[i], Y=x$Y[i], Z=x$Z[i], yaw=x$yaw[i], health=x$health[i], is_alive=isTRUE(x$is_alive[i]), team_num=x$team_num[i], weapon=x$active_weapon_name[i]))
    )))
    ev <- d$events[d$events$round_id == selected_round]
    events <- lapply(seq_len(nrow(ev)), function(i) list(
      tick=ev$tick[i], event_name=ev$event_name[i], label=ev$label[i], actor=ev$actor[i], target=ev$target[i],
      weapon=ev$weapon[i], x=ev$x[i], y=ev$y[i], damage=ev$damage[i], headshot=isTRUE(ev$headshot[i])
    ))
    map_name <- d$metadata$map_name
    radar <- map_data[[map_name]]
    has_radar <- !is.null(radar) && file.exists(file.path(root, "www", "maps", paste0(map_name, ".png")))
    map <- if (has_radar) c(radar, list(
      name=map_name,
      image=paste0("maps/", map_name, ".png"),
      lower_image=if (file.exists(file.path(root, "www", "maps", paste0(map_name, "_lower.png")))) paste0("maps/", map_name, "_lower.png") else NULL
    )) else list(name=map_name)
    list(round=selected_round, fps=d$metadata$visual_fps, bounds=d$metadata$bounds, map=map, frames=frames, events=events)
  })

  observeEvent(replay_payload(), session$sendCustomMessage("loadReplay", replay_payload()), ignoreInit=FALSE)

  output$scoreboard <- renderDT({
    req(rv$data)
    datatable(rv$data$players[, .(Player=name, Team=team_name, K=kills, D=deaths, `K/D`=kd, Damage=damage, `HS %`=hs_pct)], rownames=FALSE,
      options=list(pageLength=12, dom="tip", order=list(list(2,"desc"))), class="compact stripe")
  })

  output$round_chart <- renderPlotly({
    req(rv$data); d <- rv$data$rounds
    plot_ly(d, x=~round_id, y=~duration_seconds, type="bar", color=~winner, colors=c(CT="#4eb7ff",T="#f5b942"), text=~paste("Winner:",winner,"<br>Reason:",reason), hoverinfo="text") %>%
      layout(title="Round duration & winner", xaxis=list(title="Round"), yaxis=list(title="Seconds"), paper_bgcolor="#0c1828", plot_bgcolor="#0c1828", font=list(color="#f4f7fb"), legend=list(orientation="h"))
  })

  output$event_chart <- renderPlotly({
    req(rv$data); e <- rv$data$events[, .N, by=event_name][order(N)]
    plot_ly(e, x=~N, y=~reorder(event_name,N), type="bar", orientation="h", marker=list(color="#6ce5b1"), hovertemplate="%{y}: %{x}<extra></extra>") %>%
      layout(title="Recorded actions", xaxis=list(title="Events"), yaxis=list(title=""), paper_bgcolor="#0c1828", plot_bgcolor="#0c1828", font=list(color="#f4f7fb"))
  })

  output$events_table <- renderDT({
    req(rv$data); e <- rv$data$events[, .(Round=round_id, Tick=tick, Action=event_name, Actor=actor, Target=target, Weapon=weapon, Damage=damage)]
    datatable(e, rownames=FALSE, filter="top", options=list(pageLength=20, scrollX=TRUE), class="compact stripe")
  })

  export_round <- function(file, ext) {
    req(rv$data, input$round)
    out <- paste0(file, ext)
    result <- system2(python_bin, c(shQuote(file.path(root,"python","render_replay.py")), shQuote(rv$data$path), as.integer(input$round), shQuote(out), "--fps", 8), stdout=TRUE, stderr=TRUE)
    if (!file.exists(out)) stop(paste(result, collapse="\n"))
    file.copy(out, file, overwrite=TRUE)
  }
  output$download_gif <- downloadHandler(filename=function() sprintf("%s-round-%s.gif", rv$data$metadata$map_name,input$round), content=function(file) export_round(file,".gif"))
  output$download_mp4 <- downloadHandler(filename=function() sprintf("%s-round-%s.mp4", rv$data$metadata$map_name,input$round), content=function(file) export_round(file,".mp4"))
}

shinyApp(ui, server)
