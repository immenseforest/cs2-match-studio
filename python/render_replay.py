"""Render a cached round replay to a readable, shareable GIF or MP4."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict, deque
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

BG, GRID, TEXT, MUTED = "#050505", "#353535", "#f7f7f7", "#bdbdbd"
TEAM = {2: "#ffc857", 3: "#4cc9ff"}


def font(size=18, bold=False):
    candidates = ["C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def clean_weapon(value) -> str:
    raw = str(value or "").replace("weapon_", "", 1).replace("_", " ")
    names = {"hegrenade": "HE grenade", "flashbang": "flashbang", "smokegrenade": "smoke", "incgrenade": "incendiary"}
    return names.get(raw, raw or "weapon")


def action_meta(event) -> dict:
    name, weapon = str(event.event_name), clean_weapon(getattr(event, "weapon", ""))
    actor_value, target_value = getattr(event, "actor", ""), getattr(event, "target", "")
    actor = "Player" if pd.isna(actor_value) or not str(actor_value) else str(actor_value)
    target = "player" if pd.isna(target_value) or not str(target_value) else str(target_value)
    if name == "weapon_fire":
        if any(word in weapon for word in ("grenade", "flashbang", "molotov", "incendiary", "decoy")):
            return {"tag": "THROW", "color": "#c4a7ff", "duration": 56, "actor": actor, "verb": f"threw {weapon}"}
        melee = "knife" in weapon or "bayonet" in weapon
        return {"tag": "SWING" if melee else "SHOT", "color": "#fff176", "duration": 24, "actor": actor, "verb": f"{'swung' if melee else 'fired'} {weapon}"}
    styles = {
        "hegrenade_detonate": ("HE", "#ff8a65", 96, "HE grenade exploded"),
        "flashbang_detonate": ("FLASH", "#fff7b2", 72, "flashbang popped"),
        "smokegrenade_detonate": ("SMOKE", "#b8c4d1", 112, "smoke deployed"),
        "inferno_startburn": ("FIRE", "#ff9f43", 112, "fire started"),
        "player_blind": ("BLIND", "#fff7b2", 64, f"flashed {target}"),
        "bomb_planted": ("PLANT", "#ffb74d", 128, "planted the bomb"),
        "bomb_defused": ("DEFUSE", "#5ee7b2", 128, "defused the bomb"),
        "bomb_exploded": ("BOOM", "#ff6b45", 160, "bomb exploded"),
        "bomb_dropped": ("DROP", "#ffb74d", 72, "dropped the bomb"),
        "bomb_pickup": ("BOMB", "#ffb74d", 56, "picked up the bomb"),
    }
    if name == "player_hurt":
        damage = getattr(event, "damage", 0)
        damage = int(damage) if pd.notna(damage) else 0
        return {"tag": "HIT", "color": "#ff7b88", "duration": 40, "actor": actor, "verb": f"hit {target} for {damage}"}
    if name == "player_death":
        headshot = bool(getattr(event, "headshot", False))
        return {"tag": "HS" if headshot else "KILL", "color": "#ff5265", "duration": 104, "actor": actor, "verb": f"eliminated {target}"}
    tag, color, duration, verb = styles.get(name, ("ACT", MUTED, 48, name.replace("_", " ")))
    return {"tag": tag, "color": color, "duration": duration, "actor": actor, "verb": verb}


def overlap_area(a, b) -> float:
    width = max(0, min(a[0]+a[2], b[0]+b[2]) - max(a[0], b[0]))
    height = max(0, min(a[1]+a[3], b[1]+b[3]) - max(a[1], b[1]))
    return width * height


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

    width, height, panel = 960, 720, 270
    plot_w, plot_h, pad = width - panel, height, 42
    bounds = meta["bounds"]
    maps_dir = Path(__file__).resolve().parents[1] / "www" / "maps"
    map_name = str(meta.get("map_name", ""))
    map_catalog_path = maps_dir / "map-data.json"
    map_catalog = json.loads(map_catalog_path.read_text(encoding="utf-8")) if map_catalog_path.exists() else {}
    radar_meta = map_catalog.get(map_name)
    radar_size = min(plot_w, plot_h) - 20
    radar_x, radar_y = (plot_w - radar_size) / 2, (plot_h - radar_size) / 2

    def load_radar(path):
        if not radar_meta or not path.exists():
            return None
        image = Image.open(path).convert("RGB").resize((radar_size, radar_size), Image.Resampling.LANCZOS)
        return Image.blend(image, Image.new("RGB", image.size, BG), 0.14)

    radar = load_radar(maps_dir / f"{map_name}.png")
    lower_radar = load_radar(maps_dir / f"{map_name}_lower.png")
    dx, dy = max(1, bounds["xmax"]-bounds["xmin"]), max(1, bounds["ymax"]-bounds["ymin"])
    fallback_scale = min((plot_w-2*pad)/dx, (plot_h-2*pad)/dy)
    ox = pad + ((plot_w-2*pad)-dx*fallback_scale)/2
    oy = pad + ((plot_h-2*pad)-dy*fallback_scale)/2

    def xy(x, y):
        if radar_meta:
            px = (float(x)-float(radar_meta["pos_x"]))/float(radar_meta["scale"])
            py = (float(radar_meta["pos_y"])-float(y))/float(radar_meta["scale"])
            return radar_x+px*radar_size/1024, radar_y+py*radar_size/1024
        return ox+(x-bounds["xmin"])*fallback_scale, height-oy-(y-bounds["ymin"])*fallback_scale

    grouped = {int(t): group for t, group in ticks.groupby("tick")}
    trails = defaultdict(lambda: deque(maxlen=max(2, args.fps*2)))
    writer_args = {"mode": "I", "fps": args.fps/max(args.speed, .1)}
    if output.suffix.lower() == ".mp4":
        writer_args.update({"codec": "libx264", "quality": 8, "pixelformat": "yuv420p"})
    output.parent.mkdir(parents=True, exist_ok=True)

    with imageio.get_writer(output, **writer_args) as writer:
        for tick in frame_ticks:
            im = Image.new("RGB", (width, height), BG)
            current = grouped[tick]
            chosen_radar, level_label = radar, ""
            if lower_radar is not None and "Z" in current:
                alive = current[current.is_alive.fillna(False)]
                threshold = float(radar_meta.get("lower_level_max_units", -1000000))
                if len(alive) and pd.to_numeric(alive.Z, errors="coerce").le(threshold).sum() > len(alive)/2:
                    chosen_radar, level_label = lower_radar, " - LOWER"
                else:
                    level_label = " - UPPER"
            if chosen_radar is not None:
                im.paste(chosen_radar, (int(radar_x), int(radar_y)))
            draw = ImageDraw.Draw(im)
            if chosen_radar is None:
                for i in range(1, 8):
                    x, y = int(i*plot_w/8), int(i*height/8)
                    draw.line((x,0,x,height), fill=GRID, width=1); draw.line((0,y,plot_w,y), fill=GRID, width=1)
            else:
                draw.rectangle((radar_x,radar_y,radar_x+radar_size,radar_y+radar_size), outline="#616161", width=2)
                draw.rounded_rectangle((16,16,190,44), radius=13, fill=BG, outline="#777777")
                draw.text((27,22), f"{map_name}{level_label}".upper(), fill=TEXT, font=font(12,True))
            draw.rectangle((plot_w,0,width,height), fill="#111111")

            player_points = {}
            for player in current.itertuples():
                key, pos = str(player.name), xy(player.X, player.Y)
                player_points[key] = (pos, player)
                trails[key].append(pos)
                if len(trails[key]) > 1:
                    draw.line(list(trails[key]), fill=TEAM.get(int(player.team_num), MUTED), width=2)

            active_events = []
            for event in events[(events.tick <= tick) & (events.tick >= tick-160)].itertuples():
                info = action_meta(event)
                age = tick-int(event.tick)
                if age <= info["duration"]:
                    active_events.append((event,info,age))
            priority = {"BOOM":9,"PLANT":9,"DEFUSE":9,"KILL":8,"HS":8,"HE":7,"FLASH":7,"SMOKE":7,"FIRE":7,"THROW":6,"SHOT":5,"HIT":4,"SWING":1}
            has_impact = any(info["tag"] in ("HIT","KILL","HS") for _,info,_ in active_events)
            active_events.sort(key=lambda item:(-priority.get(item[1]["tag"],2),item[2]))
            marker_offsets = defaultdict(int)
            seen_markers = set()
            for event, info, age in active_events:
                if info["tag"] == "SWING" and has_impact:
                    continue
                signature = (info["actor"],info["tag"])
                if signature in seen_markers:
                    continue
                seen_markers.add(signature)
                target_first = event.event_name in ("player_hurt","player_death","player_blind")
                player_name = str(getattr(event,"target" if target_first else "actor", ""))
                point = player_points.get(player_name, (None,None))[0]
                if point is None and pd.notna(getattr(event,"x", math.nan)) and pd.notna(getattr(event,"y", math.nan)):
                    point = xy(event.x,event.y)
                if point is None:
                    continue
                radius = 13 + int(18*age/max(1,info["duration"]))
                draw.ellipse((point[0]-radius,point[1]-radius,point[0]+radius,point[1]+radius), outline=info["color"], width=3)
                key = (round(point[0]/24),round(point[1]/24)); offset = marker_offsets[key]; marker_offsets[key] += 1
                tag_font = font(10,True); box = draw.textbbox((0,0),info["tag"],font=tag_font); tag_w = box[2]-box[0]+12
                tag_x, tag_y = point[0]-tag_w/2, point[1]+14+offset*20
                draw.rounded_rectangle((tag_x,tag_y,tag_x+tag_w,tag_y+17), radius=5, fill="#050505", outline=info["color"])
                draw.text((tag_x+6,tag_y+2),info["tag"],fill=info["color"],font=tag_font)

            alive_labels = []
            for player in current.itertuples():
                pos = player_points[str(player.name)][0]
                alive = bool(player.is_alive) and float(player.health or 0) > 0
                color = TEAM.get(int(player.team_num), MUTED) if alive else "#555555"
                radius = 9 if alive else 6
                draw.ellipse((pos[0]-radius,pos[1]-radius,pos[0]+radius,pos[1]+radius), fill=color, outline="white" if alive else "#8a8a8a", width=2)
                if alive:
                    alive_labels.append((player,pos,color))
                else:
                    draw.line((pos[0]-3,pos[1]-3,pos[0]+3,pos[1]+3),fill="#cbd5e1",width=1)
                    draw.line((pos[0]+3,pos[1]-3,pos[0]-3,pos[1]+3),fill="#cbd5e1",width=1)

            placed = []
            for player, pos, color in sorted(alive_labels,key=lambda item:item[1][1]):
                name = str(player.name); name = name if len(name)<=13 else name[:12]+"…"
                hp = str(max(0,int(float(player.health or 0))))
                name_font, hp_font = font(11,True), font(10,True)
                name_w = draw.textbbox((0,0),name,font=name_font)[2]
                hp_w = draw.textbbox((0,0),hp,font=hp_font)[2]
                box_w, box_h = name_w+hp_w+27, 21
                sides = (14,-box_w-14) if int(player.team_num)==3 else (-box_w-14,14)
                candidates = [(pos[0]+side,pos[1]+dy,box_w,box_h) for dy in (-30,-7,16,-53,39) for side in sides]
                best, best_cost = None, float("inf")
                for candidate in candidates:
                    clamped = (max(4,min(plot_w-box_w-4,candidate[0])),max(4,min(height-box_h-4,candidate[1])),box_w,box_h)
                    cost = sum(overlap_area(clamped,other) for other in placed)*1000 + math.hypot(clamped[0]-pos[0],clamped[1]-pos[1])
                    if cost < best_cost:
                        best,best_cost = clamped,cost
                placed.append(best)
                anchor_x = best[0] if best[0]>pos[0] else best[0]+best[2]
                anchor_y = max(best[1]+4,min(best[1]+best[3]-4,pos[1]))
                draw.line((pos[0],pos[1],anchor_x,anchor_y),fill="#a0a0a0",width=1)
                draw.rounded_rectangle((best[0],best[1],best[0]+best[2],best[1]+best[3]),radius=6,fill="#050505",outline=color,width=1)
                draw.rectangle((best[0]+5,best[1]+5,best[0]+8,best[1]+box_h-5),fill=color)
                draw.text((best[0]+12,best[1]+4),name,fill=TEXT,font=name_font)
                draw.text((best[0]+box_w-hp_w-7,best[1]+5),hp,fill="#5ee7b2" if int(hp)>40 else "#ff7b88",font=hp_font)

            elapsed = max(0,(tick-int(row.start_tick))/64)
            draw.text((plot_w+18,22),f"ROUND {args.round}",fill=TEXT,font=font(25,True))
            draw.text((plot_w+18,58),f"{elapsed:05.1f}s",fill="#5ee7b2",font=font(22,True))
            draw.text((plot_w+18,96),"CT",fill=TEAM[3],font=font(17,True)); draw.text((plot_w+72,96),"T",fill=TEAM[2],font=font(17,True))
            recent = list(events[(events.tick<=tick)&(events.tick>=tick-384)].itertuples())[::-1]
            selected, seen = [], {}
            has_impact = any(action_meta(event)["tag"] in ("HIT","KILL","HS") for event in recent)
            for event in recent:
                event_info = action_meta(event)
                if event_info["tag"] == "SWING" and has_impact:
                    continue
                key = (event.event_name,str(getattr(event,"actor","")),str(getattr(event,"weapon","")))
                if event.event_name in ("weapon_fire","player_hurt") and key in seen and seen[key]-event.tick<32:
                    continue
                seen[key]=event.tick; selected.append((event,event_info))
                if len(selected)>=7: break
            feed_y = 134
            for event, info in selected:
                draw.rounded_rectangle((plot_w+18,feed_y,plot_w+68,feed_y+19),radius=5,fill=BG,outline=info["color"])
                tag_width=draw.textbbox((0,0),info["tag"],font=font(9,True))[2]
                draw.text((plot_w+43-tag_width/2,feed_y+4),info["tag"],fill=info["color"],font=font(9,True))
                draw.text((plot_w+76,feed_y),info["actor"][:20],fill=TEXT,font=font(11,True))
                draw.text((plot_w+76,feed_y+15),info["verb"][:27],fill=MUTED,font=font(10))
                feed_y += 47
            draw.text((plot_w+18,height-56),map_name,fill=MUTED,font=font(14))
            draw.text((plot_w+18,height-34),"CS2 Match Studio",fill=MUTED,font=font(14,True))
            writer.append_data(np.asarray(im))
    print(json.dumps({"status":"ok","file":str(output),"frames":len(frame_ticks)}))


if __name__ == "__main__":
    main()
