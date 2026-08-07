# CS2 Match Studio

An R Shiny application that parses Counter-Strike 2 demo files, presents match and player analysis, replays every player's movement and actions round-by-round, and exports the replay as a GIF or MP4.

## Why this architecture

Shiny owns the interface, analysis, tables, and charts. The Source 2 binary parsing is delegated to `demoparser2`, whose Rust core is far faster and more robust than implementing packet decoding in R. Parsed data is cached by demo hash. Event ticks remain exact; movement is sampled at a configurable visual frame rate to keep browser playback and exports responsive.

## Setup

1. Install R dependencies:

   `Rscript install.R`

2. Install Python dependencies:

   `python -m pip install -r requirements.txt`

3. If needed, point the app at that Python executable:

   `Sys.setenv(CS2_PYTHON = "C:/path/to/python.exe")`

4. Run:

   `shiny::runApp()`

The bundled `.dem.zst` file is loaded automatically. You can upload a `.dem` or `.dem.zst` file up to 1 GB. The first parse creates a `cache/<file-hash>/` directory; reopening the same demo uses the cached results.

## Features

- Match score, headshot rate, eliminations, map, and round outcomes
- Player scoreboard with K/D, total damage, and headshot percentage
- Searchable event log and action-frequency chart
- Canvas-based replay with movement trails, view direction, health, weapons, and a live action feed
- Round selection, scrubbing, playback speed, and exact event overlays
- One-click GIF and H.264 MP4 export

## Notes

- The parser currently assumes a 64 Hz CS2 demo clock for replay timing.
- Some new CS2 patches or unusual POV/community-server demos can temporarily expose upstream parser incompatibilities. The original demo is never modified.
- A radar-image layer can be added later; the current coordinate view is map-agnostic and works without external map assets.

## Posit Connect Cloud

The repository contains both `manifest.json` for the R environment and
`requirements.txt` for the Python parser/export environment. In Connect Cloud,
publish `app.R` from the `main` branch and select Python 3.12 when prompted.
The large source demos and local parse cache are deliberately excluded from Git;
users upload their own `.dem` or `.dem.zst` file through the app.
