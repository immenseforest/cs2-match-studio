app_env <- new.env(parent = globalenv())
source("app.R", local = app_env)
stopifnot(inherits(app_env$ui, "shiny.tag.list") || inherits(app_env$ui, "shiny.tag"))
html <- htmltools::renderTags(app_env$ui)$html
stopifnot(grepl("CS2 Match Studio", html, fixed = TRUE))
cache_dirs <- list.dirs(file.path(getwd(), "cache"), recursive = FALSE, full.names = TRUE)
cache_dir <- cache_dirs[file.exists(file.path(cache_dirs, "metadata.json"))][1]
stopifnot(!is.na(cache_dir))
cache <- app_env$read_cache(cache_dir)
stopifnot(nrow(cache$rounds) == 13L, nrow(cache$ticks) > 1000L, nrow(cache$events) > 100L)
cat("Shiny UI and parsed-cache smoke test passed.\n")
