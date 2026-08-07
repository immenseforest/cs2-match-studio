"""Parse a CS2 demo into compact, Shiny-friendly CSV/JSON cache files."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import pandas as pd
import zstandard as zstd
from demoparser2 import DemoParser


TICK_PROPS = [
    "X", "Y", "Z", "yaw", "health", "armor_value", "is_alive",
    "team_num", "team_name", "active_weapon_name", "balance",
    "current_equip_value", "total_rounds_played", "is_freeze_period",
]

EVENTS = [
    "player_death", "player_hurt", "weapon_fire", "bomb_planted",
    "bomb_defused", "bomb_exploded", "bomb_dropped", "bomb_pickup",
    "hegrenade_detonate", "flashbang_detonate", "smokegrenade_detonate",
    "decoy_detonate", "inferno_startburn", "player_blind",
]


def materialize(source: Path, cache_dir: Path) -> Path:
    if source.suffix.lower() != ".zst":
        return source
    out = cache_dir / "source.dem"
    if not out.exists() or out.stat().st_mtime < source.stat().st_mtime:
        with source.open("rb") as src, out.open("wb") as dst:
            zstd.ZstdDecompressor().copy_stream(src, dst)
    return out


def safe_event(parser: DemoParser, name: str) -> pd.DataFrame:
    try:
        frame = parser.parse_event(
            name,
            player=["X", "Y", "Z", "health", "team_name"],
            other=["total_rounds_played"],
        )
        frame["event_name"] = name
        return frame
    except Exception as exc:
        print(f"warning: could not parse {name}: {exc}")
        return pd.DataFrame()


def round_table(parser: DemoParser) -> pd.DataFrame:
    ends = parser.parse_event("round_end", other=["total_rounds_played"]).copy()
    ends = ends[pd.to_numeric(ends.get("round"), errors="coerce").fillna(0) > 0]
    ends = ends.sort_values("tick").reset_index(drop=True)
    freezes = parser.parse_event("round_freeze_end", other=["total_rounds_played"])
    freezes = sorted(pd.to_numeric(freezes["tick"], errors="coerce").dropna().astype(int))
    starts = parser.parse_event("round_start", other=["total_rounds_played"])
    start_ticks = sorted(pd.to_numeric(starts["tick"], errors="coerce").dropna().astype(int))
    rows, previous_end = [], -1
    for _, end in ends.iterrows():
        end_tick = int(end["tick"])
        candidates = [x for x in freezes if previous_end < x < end_tick]
        if not candidates:
            candidates = [x for x in start_ticks if previous_end < x < end_tick]
        start_tick = max(candidates) if candidates else previous_end + 1
        rows.append({
            "round_id": int(end["round"]), "start_tick": start_tick,
            "end_tick": end_tick, "winner": end.get("winner", ""),
            "reason": end.get("reason", ""),
            "duration_seconds": round((end_tick - start_tick) / 64.0, 1),
        })
        previous_end = end_tick
    return pd.DataFrame(rows)


def assign_round(ticks: pd.Series, rounds: pd.DataFrame) -> pd.Series:
    result = pd.Series(pd.NA, index=ticks.index, dtype="Int64")
    numeric = pd.to_numeric(ticks, errors="coerce")
    for row in rounds.itertuples():
        result.loc[(numeric >= row.start_tick) & (numeric <= row.end_tick)] = row.round_id
    return result


def first_present(frame: pd.DataFrame, names: list[str], default="") -> pd.Series:
    for name in names:
        if name in frame.columns:
            return frame[name]
    return pd.Series(default, index=frame.index)


def normalize_events(frames: list[pd.DataFrame], rounds: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for f in frames:
        if f.empty or "tick" not in f:
            continue
        out = pd.DataFrame(index=f.index)
        out["event_name"] = f["event_name"]
        out["tick"] = pd.to_numeric(f["tick"], errors="coerce").astype("Int64")
        out["round_id"] = assign_round(out["tick"], rounds)
        out["actor"] = first_present(f, ["attacker_name", "user_name", "player_name"]).astype("string")
        out["target"] = first_present(f, ["user_name", "victim_name"]).astype("string")
        out["weapon"] = first_present(f, ["weapon", "weapon_name"]).astype("string")
        out["x"] = pd.to_numeric(first_present(f, ["attacker_X", "user_X", "player_X", "X"], math.nan), errors="coerce")
        out["y"] = pd.to_numeric(first_present(f, ["attacker_Y", "user_Y", "player_Y", "Y"], math.nan), errors="coerce")
        out["damage"] = pd.to_numeric(first_present(f, ["dmg_health"], math.nan), errors="coerce")
        out["headshot"] = first_present(f, ["headshot"], False).fillna(False).astype(bool)
        out["label"] = out["event_name"].str.replace("_", " ")
        death = out["event_name"].eq("player_death")
        out.loc[death, "label"] = out.loc[death, "actor"].fillna("?") + " eliminated " + out.loc[death, "target"].fillna("?")
        rows.append(out)
    if not rows:
        return pd.DataFrame(columns=["event_name", "tick", "round_id", "actor", "target", "weapon", "x", "y", "damage", "headshot", "label"])
    return pd.concat(rows, ignore_index=True).dropna(subset=["round_id"]).sort_values("tick")


def player_summary(events: pd.DataFrame, ticks: pd.DataFrame) -> pd.DataFrame:
    players = ticks[["steamid", "name", "team_name"]].dropna(subset=["name"]).drop_duplicates("name")
    deaths = events[events.event_name.eq("player_death")]
    kills = deaths.groupby("actor").size().rename("kills")
    died = deaths.groupby("target").size().rename("deaths")
    hs = deaths[deaths.headshot].groupby("actor").size().rename("headshots")
    damage = events[events.event_name.eq("player_hurt")].groupby("actor")["damage"].sum().rename("damage")
    out = players.set_index("name").join([kills, died, hs, damage]).fillna(0).reset_index()
    for col in ["kills", "deaths", "headshots", "damage"]:
        out[col] = out[col].astype(int)
    out["kd"] = (out.kills / out.deaths.clip(lower=1)).round(2)
    out["hs_pct"] = (100 * out.headshots / out.kills.clip(lower=1)).round(1)
    return out.sort_values(["kills", "damage"], ascending=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("demo")
    ap.add_argument("output")
    ap.add_argument("--fps", type=int, default=8)
    args = ap.parse_args()
    source, output = Path(args.demo).resolve(), Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    demo = materialize(source, output)
    parser = DemoParser(str(demo))
    header = parser.parse_header()
    rounds = round_table(parser)
    raw_ticks = parser.parse_ticks(TICK_PROPS)
    raw_ticks["round_id"] = assign_round(raw_ticks["tick"], rounds)
    raw_ticks = raw_ticks.dropna(subset=["round_id", "X", "Y", "name"])
    raw_ticks["round_id"] = raw_ticks["round_id"].astype(int)
    stride = max(1, round(64 / max(1, args.fps)))
    raw_ticks = raw_ticks[(raw_ticks["tick"] % stride == 0) | raw_ticks["tick"].isin(rounds.start_tick)]
    raw_ticks = raw_ticks.sort_values(["round_id", "tick", "name"])
    frames = [safe_event(parser, event) for event in EVENTS]
    events = normalize_events(frames, rounds)
    players = player_summary(events, raw_ticks)
    bounds = {
        "xmin": float(raw_ticks.X.quantile(0.005)), "xmax": float(raw_ticks.X.quantile(0.995)),
        "ymin": float(raw_ticks.Y.quantile(0.005)), "ymax": float(raw_ticks.Y.quantile(0.995)),
    }
    metadata = {
        **header, "source_file": source.name, "source_bytes": source.stat().st_size,
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "visual_fps": args.fps,
        "tick_rate": 64, "round_count": int(len(rounds)), "bounds": bounds,
    }
    rounds.to_csv(output / "rounds.csv", index=False)
    raw_ticks.to_csv(output / "ticks.csv", index=False)
    events.to_csv(output / "events.csv", index=False)
    players.to_csv(output / "players.csv", index=False)
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"status": "ok", "output": str(output), "rows": len(raw_ticks), "events": len(events), "rounds": len(rounds)}))


if __name__ == "__main__":
    main()
