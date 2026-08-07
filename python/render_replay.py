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

BG, GRID, TEXT, MUTED = "#07101b", "#29445f", "#f7f9fc", "#bdcad9"
TEAM = {2: "#ffc857", 3: "#4cc9ff"}


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
    maps_dir = Path(__file__).resolve().parents[1] / "www" / "maps"
    map_name = str(meta.get("map_name", ""))
    map_catalog_path = maps_dir / "map-data.json"
    map_catalog = json.loads(map_catalog_path.read_text(encoding="utf-8")) if map_catalog_path.exists() else {}
    radar_meta = map_catalog.get(map_name)
    radar_path = maps_dir / f"{map_name}.png"
    lower_path = maps_dir / f"{map_name}_lower.png"
    radar_size = min(plot_w, plot_h) - 20
    radar_x, radar_y = (plot_w - radar_size) / 2, (plot_h - radar_size) / 2
    radar = Image.open(radar_path).convert("RGB").resize((radar_size, radar_size), Image.Resampling.LANCZOS) if radar_meta and radar_path.exists() else None
    lower_radar = Image.open(lower_path).convert("RGB").resize((radar_size, radar_size), Image.Resampling.LANCZOS) if radar_meta and lower_path.exists() else None
    if radar:
        radar = Image.blend(radar, Image.new("RGB", radar.size, BG), 0.14)
    if lower_radar:
        lower_radar = Image.blend(lower_radar, Image.new("RGB", lower_radar.size, BG), 0.14)

    dx, dy = max(1, b["xmax"] - b["xmin"]), max(1, b["ymax"] - b["ymin"])
    fallback_scale = min((plot_w - 2 * pad) / dx, (plot_h - 2 * pad) / dy)
    ox = pad + ((plot_w - 2 * pad) - dx * fallback_scale) / 2
    oy = pad + ((plot_h - 2 * pad) - dy * fallback_scale) / 2

    def xy(x, y):
        if radar_meta:
            px = (float(x) - float(radar_meta["pos_x"])) / float(radar_meta["scale"])
            py = (float(radar_meta["pos_y"]) - float(y)) / float(radar_meta["scale"])
            return (radar_x + px * radar_size / 1024, radar_y + py * radar_size / 1024)
        return (ox + (x - b["xmin"]) * fallback_scale, height - oy - (y - b["ymin"]) * fallback_scale)

    grouped = {int(t): g for t, g in ticks.groupby("tick")}
    trails = defaultdict(lambda: deque(maxlen=max(2, args.fps * 2)))
    writer_args = {"mode": "I", "fps": args.fps / max(args.speed, .1)}
    if output.suffix.lower() == ".mp4":
        writer_args.update({"codec": "libx264", "quality": 8, "pixelformat": "yuv420p"})
    output.parent.mkdir(parents=True, exist_ok=True)
    with imageio.get_writer(output, **writer_args) as writer:
        for tick in frame_ticks:
            im = Image.new("RGB", (width, height), BG)
            current = grouped[tick]
            chosen_radar = radar
            level_label = ""
            if lower_radar is not None and "Z" in current:
                alive = current[current.is_alive.fillna(False)]
                threshold = float(radar_meta.get("lower_level_max_units", -1000000))
                lower_count = pd.to_numeric(alive.Z, errors="coerce").le(threshold).sum()
                if len(alive) and lower_count > len(alive) / 2:
                    chosen_radar, level_label = lower_radar, " · LOWER"
                else:
                    level_label = " · UPPER"
            if chosen_radar is not None:
                im.paste(chosen_radar, (int(radar_x), int(radar_y)))
            draw = ImageDraw.Draw(im)
            if chosen_radar is None:
                for i in range(1, 8):
                    x = int(i * plot_w / 8); y = int(i * height / 8)
                    draw.line((x, 0, x, height), fill=GRID, width=1)
                    draw.line((0, y, plot_w, y), fill=GRID, width=1)
            else:
                draw.rectangle((radar_x, radar_y, radar_x + radar_size, radar_y + radar_size), outline="#4d6c8d", width=2)
                draw.rounded_rectangle((16, 16, 170, 44), radius=13, fill="#07101b", outline="#728aa3")
                draw.text((27, 22), f"{map_name}{level_label}".upper(), fill=TEXT, font=font(12, True))
            draw.rectangle((plot_w, 0, width, height), fill="#111f31")
            for p in current.itertuples():
                key, pos = str(p.name), xy(p.X, p.Y)
                trails[key].append(pos)
                if len(trails[key]) > 1:
                    draw.line(list(trails[key]), fill=TEAM.get(int(p.team_num), MUTED), width=2)
                alive = bool(p.is_alive) and float(p.health or 0) > 0
                color = TEAM.get(int(p.team_num), MUTED) if alive else "#536273"
                r = 9 if alive else 6
                draw.ellipse((pos[0]-r, pos[1]-r, pos[0]+r, pos[1]+r), fill=color, outline="white", width=2)
                label = str(p.name)
                label_font = font(13, True)
                box = draw.textbbox((pos[0]+11, pos[1]-11), label, font=label_font)
                draw.rectangle((box[0]-4, box[1]-2, box[2]+4, box[3]+2), fill="#07101b")
                draw.text((pos[0]+11, pos[1]-11), label, fill=TEXT, font=label_font)
            elapsed = max(0, (tick - int(row.start_tick)) / 64)
            draw.text((plot_w + 20, 22), f"ROUND {args.round}", fill=TEXT, font=font(25, True))
            draw.text((plot_w + 20, 58), f"{elapsed:05.1f}s", fill="#5ee7b2", font=font(22, True))
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
