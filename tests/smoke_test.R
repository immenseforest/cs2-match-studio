app_env <- new.env(parent = globalenv())
source("app.R", local = app_env)
stopifnot(inherits(app_env$ui, "shiny.tag.list") || inherits(app_env$ui, "shiny.tag"))
html <- htmltools::renderTags(app_env$ui)$html
stopifnot(grepl("CS2 Match Studio", html, fixed = TRUE))
stopifnot(grepl("Player performance", html, fixed = TRUE))
stopifnot(grepl("kill_survival_scatter", html, fixed = TRUE))
cache_dirs <- list.dirs(file.path(getwd(), "cache"), recursive = FALSE, full.names = TRUE)
cache_dir <- cache_dirs[file.exists(file.path(cache_dirs, "metadata.json"))][1]
stopifnot(!is.na(cache_dir))
cache <- app_env$read_cache(cache_dir)
stopifnot(nrow(cache$rounds) == 13L, nrow(cache$ticks) > 1000L, nrow(cache$events) > 100L)

app_env$initial_demo <- NA_character_
shiny::testServer(app_env$server, {
  rv$data <- cache
  metrics <- player_round_metrics()
  averages <- player_aggregate_metrics()
  stopifnot(
    nrow(metrics) == nrow(cache$rounds) * nrow(cache$players),
    all(metrics$alive_seconds >= 0),
    all(metrics$alive_seconds <= metrics$duration_seconds + 1e-9),
    nrow(averages) == nrow(cache$players)
  )
  session$setInputs(
    compare_players=cache$players$name,
    performance_player=cache$players$name[1],
    player_metric="damage"
  )
  stopifnot(nchar(output$kill_survival_scatter) > 100)
  stopifnot(nchar(output$player_round_profile) > 100)
})

cat("Shiny UI, player metrics, and parsed-cache smoke test passed.\n")
