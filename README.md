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

4. Run the local launcher, which opens the app in your browser:

   `Rscript run_local.R`

The bundled `.dem.zst` file is loaded automatically. You can upload a `.dem` or `.dem.zst` file up to 1 GB. The first parse creates a versioned cache for that file and replay frame rate; reopening the same demo uses the cached results.

## Local GIF and MP4 export

1. Run `Rscript run_local.R`, then parse or load a demo.
2. Choose a round in the left sidebar.
3. Click **Prepare round GIF** or **Prepare round MP4**. Rendering continues in a background process, with frame-by-frame progress in the sidebar.
4. When validation reaches 100%, click the new download button. The download itself is immediate because the media file has already been prepared.

MP4 is normally much faster and smaller than GIF. Both formats contain the same radar, player movement, labels, trails, and action feed. Closing the Shiny session removes its temporary prepared exports; downloaded files are not affected.

For a direct command-line export from an existing cache, run:

`python python/render_replay.py "cache/<cache-folder>" 1 "round-1.mp4" --fps 8`

Change the round number, output extension, or FPS as needed. The command returns a non-zero exit code if the media cannot be generated or validated.

## Features

- Match score, headshot rate, eliminations, map, and round outcomes
- Player scoreboard with K/D, total damage, and headshot percentage
- Searchable event log and action-frequency chart
- Collision-aware player labels with movement trails, view direction, and compact health values
- Enlarged replay with button/wheel zoom, reset, and drag-to-pan navigation
- On-map action badges for shots, grenade throws/detonations, fire, hits, kills, flashes, and bomb actions
- Frame-synchronized team economy showing health, armour, cash, active weapon, and equipment value
- Asynchronous parsing with stage-by-stage progress and a visible percentage bar
- Round selection, scrubbing, playback speed, and exact event overlays
- Background GIF and H.264 MP4 preparation with live progress, validation, and immediate download

## Notes

- The parser currently assumes a 64 Hz CS2 demo clock for replay timing.
- Some new CS2 patches or unusual POV/community-server demos can temporarily expose upstream parser incompatibilities. The original demo is never modified.
- Bundled calibrated radar layouts cover the standard CS2 maps; unsupported maps use the coordinate fallback.

## Posit Connect Cloud

The repository contains both `manifest.json` for the R environment and
`requirements.txt` for the Python parser/export environment. In Connect Cloud,
publish `app.R` from the `main` branch and select Python 3.12 when prompted.
The large source demos and local parse cache are deliberately excluded from Git;
users upload their own `.dem` or `.dem.zst` file through the app.
The tactical replay uses calibrated CS2 radar layouts from Awpy, supports
automatic upper/lower-floor switching on multi-level maps, and keeps a
high-contrast coordinate fallback for maps without a bundled radar.
