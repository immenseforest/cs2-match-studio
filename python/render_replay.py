"""Render a cached round replay to a shareable GIF or MP4."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict, deque
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

BG, GRID, TEXT, MUTED = "#07111f", "#16263a", "#f4f7fb", "#8da2b8"
TEAM = {2: "#f5b942", 3: "#4eb7ff"}


def font(size=18, bold=False):
    candidates = ["C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cache")
    ap.add_argument("round", type=int)
    ap.add_argument("output")
    ap.add_argument("--fps", type=int, default=8)
    ap.add_argument("--speed", type=float, default=1.0)
    args = ap.parse_args()
    cache, output = Path(args.cache), Path(args.output)
    meta = json.loads((cache / "metadata.json").read_text(encoding="utf-8"))
    ticks = pd.read_csv(cache / "ticks.csv")
    ticks = ticks[ticks.round_id.eq(args.round)].sort_values("tick")
    events = pd.read_csv(cache / "events.csv")
    events = events[events.round_id.eq(args.round)].sort_values("tick")
    rounds = pd.read_csv(cache / "rounds.csv").set_index("round_id")
    row = rounds.loc[args.round]
    frame_ticks = sorted(ticks.tick.unique())
    if not frame_ticks:
        raise SystemExit(f"No movement data for round {args.round}")
    width, height, panel = 960, 720, 250
    plot_w, plot_h, pad = width - panel, height, 42
    b = meta["bounds"]
    dx, dy = max(1, b["xmax"] - b["xmin"]), max(1, b["ymax"] - b["ymin"])
    scale = min((plot_w - 2 * pad) / dx, (plot_h - 2 * pad) / dy)
    ox = pad + ((plot_w - 2 * pad) - dx * scale) / 2
    oy = pad + ((plot_h - 2 * pad) - dy * scale) / 2

    def xy(x, y):
        return (ox + (x - b["xmin"]) * scale, height - oy - (y - b["ymin"]) * scale)

    grouped = {int(t): g for t, g in ticks.groupby("tick")}
    trails = defaultdict(lambda: deque(maxlen=max(2, args.fps * 2)))
    writer_args = {"mode": "I", "fps": args.fps / max(args.speed, .1)}
    if output.suffix.lower() == ".mp4":
        writer_args.update({"codec": "libx264", "quality": 8, "pixelformat": "yuv420p"})
    output.parent.mkdir(parents=True, exist_ok=True)
    with imageio.get_writer(output, **writer_args) as writer:
        for tick in frame_ticks:
            im = Image.new("RGB", (width, height), BG)
            draw = ImageDraw.Draw(im)
            for i in range(1, 8):
                x = int(i * plot_w / 8); y = int(i * height / 8)
                draw.line((x, 0, x, height), fill=GRID, width=1)
                draw.line((0, y, plot_w, y), fill=GRID, width=1)
            draw.rectangle((plot_w, 0, width, height), fill="#0c1828")
            current = grouped[tick]
            for p in current.itertuples():
                key, pos = str(p.name), xy(p.X, p.Y)
                trails[key].append(pos)
                if len(trails[key]) > 1:
                    draw.line(list(trails[key]), fill=TEAM.get(int(p.team_num), MUTED), width=2)
                alive = bool(p.is_alive) and float(p.health or 0) > 0
                color = TEAM.get(int(p.team_num), MUTED) if alive else "#536273"
                r = 9 if alive else 6
                draw.ellipse((pos[0]-r, pos[1]-r, pos[0]+r, pos[1]+r), fill=color, outline="white", width=2)
                draw.text((pos[0]+11, pos[1]-10), str(p.name), fill=TEXT, font=font(13, True))
            elapsed = max(0, (tick - int(row.start_tick)) / 64)
            draw.text((plot_w + 20, 22), f"ROUND {args.round}", fill=TEXT, font=font(25, True))
            draw.text((plot_w + 20, 58), f"{elapsed:05.1f}s", fill="#6ce5b1", font=font(22, True))
            draw.text((plot_w + 20, 96), "CT", fill=TEAM[3], font=font(17, True))
            draw.text((plot_w + 75, 96), "T", fill=TEAM[2], font=font(17, True))
            recent = events[(events.tick <= tick) & (events.tick >= tick - 64 * 5)].tail(9)
            y = 140
            for ev in recent.itertuples():
                label = str(ev.label)[:30]
                draw.text((plot_w + 20, y), label, fill=TEXT, font=font(13, ev.event_name == "player_death"))
                y += 27
            draw.text((plot_w + 20, height - 56), str(meta.get("map_name", "CS2")), fill=MUTED, font=font(14))
            draw.text((plot_w + 20, height - 34), "CS2 Match Studio", fill=MUTED, font=font(14, True))
            writer.append_data(np.asarray(im))
    print(json.dumps({"status": "ok", "file": str(output), "frames": len(frame_ticks)}))


if __name__ == "__main__":
    main()
