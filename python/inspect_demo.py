"""Small diagnostic used by the installer and for parser compatibility checks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import zstandard as zstd
from demoparser2 import DemoParser


def materialize(source: Path, target: Path) -> Path:
    if source.suffix.lower() != ".zst":
        return source
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        with source.open("rb") as src, target.open("wb") as dst:
            zstd.ZstdDecompressor().copy_stream(src, dst)
    return target


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("demo")
    ap.add_argument("--cache", default="cache/source.dem")
    args = ap.parse_args()
    path = materialize(Path(args.demo), Path(args.cache))
    parser = DemoParser(str(path))
    print(json.dumps(parser.parse_header(), indent=2, default=str))
    for event in ("round_start", "round_freeze_end", "round_end", "player_death", "weapon_fire"):
        try:
            frame = parser.parse_event(event, player=["X", "Y"], other=["total_rounds_played"])
            print(f"\n{event}: {frame.shape}\n{list(frame.columns)}")
            print(frame.head(2).to_string(index=False))
        except Exception as exc:
            print(f"\n{event}: ERROR {exc}")


if __name__ == "__main__":
    main()
