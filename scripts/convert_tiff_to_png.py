#!/usr/bin/env python3
"""Convert TIFF files to PNG files using Pillow.

Install dependency when needed:
  python3 -m pip install pillow
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    try:
        from PIL import Image, ImageOps
    except ImportError:
        print("Pillow is required for TIFF conversion: python3 -m pip install pillow", file=sys.stderr)
        return 1

    parser = argparse.ArgumentParser(description="Convert TIFF/TIF files to PNG.")
    parser.add_argument("input", type=Path, help="Input .tif/.tiff file or directory")
    parser.add_argument("--out", type=Path, default=Path("converted_png"), help="Output directory")
    parser.add_argument("--force", action="store_true", help="Overwrite existing PNG files")
    args = parser.parse_args()

    files = collect_inputs(args.input)
    if not files:
        print("No .tif or .tiff files found.", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    converted = 0
    for path in files:
        with Image.open(path) as image:
            for frame_index in range(getattr(image, "n_frames", 1)):
                image.seek(frame_index)
                frame = ImageOps.autocontrast(image.convert("L"))
                suffix = f"_z{frame_index + 1:03d}" if getattr(image, "n_frames", 1) > 1 else ""
                out_path = args.out / f"{path.stem}{suffix}.png"
                if out_path.exists() and not args.force:
                    continue
                frame.save(out_path)
                converted += 1

    print(f"Converted {converted} PNG file(s) into {args.out}")
    return 0


def collect_inputs(path: Path) -> list[Path]:
    suffixes = {".tif", ".tiff"}
    if path.is_file() and path.suffix.lower() in suffixes:
        return [path]
    if path.is_dir():
        return sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in suffixes)
    return []


if __name__ == "__main__":
    raise SystemExit(main())
