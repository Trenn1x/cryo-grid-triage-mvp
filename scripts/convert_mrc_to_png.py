#!/usr/bin/env python3
"""Convert MRC/MRCS image data to 8-bit grayscale PNG files.

This script intentionally avoids third-party dependencies for MRC/MRCS input.
It supports common MRC modes: int8, int16, uint16, and float32.
"""

from __future__ import annotations

import argparse
import binascii
import os
import struct
import sys
import zlib
from array import array
from pathlib import Path


MRC_MODES = {
    0: ("b", 1),
    1: ("h", 2),
    2: ("f", 4),
    6: ("H", 2),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert MRC/MRCS files to PNG.")
    parser.add_argument("input", type=Path, help="Input .mrc/.mrcs file or directory")
    parser.add_argument("--out", type=Path, default=Path("converted_png"), help="Output directory")
    parser.add_argument("--max-slices", type=int, default=64, help="Maximum slices per stack")
    parser.add_argument("--force", action="store_true", help="Overwrite existing PNG files")
    args = parser.parse_args()

    files = collect_inputs(args.input)
    if not files:
        print("No .mrc or .mrcs files found.", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    converted = 0
    for path in files:
        converted += convert_mrc(path, args.out, args.max_slices, args.force)

    print(f"Converted {converted} PNG file(s) into {args.out}")
    return 0


def collect_inputs(path: Path) -> list[Path]:
    if path.is_file() and path.suffix.lower() in {".mrc", ".mrcs"}:
        return [path]
    if path.is_dir():
        return sorted(
            item
            for item in path.rglob("*")
            if item.is_file() and item.suffix.lower() in {".mrc", ".mrcs"}
        )
    return []


def convert_mrc(path: Path, out_dir: Path, max_slices: int, force: bool) -> int:
    with path.open("rb") as fh:
        header = fh.read(1024)
        if len(header) != 1024:
            raise ValueError(f"{path} is too small to be an MRC file")

        endian = detect_endian(header)
        nx, ny, nz, mode = struct.unpack(f"{endian}4i", header[:16])
        nsymbt = struct.unpack(f"{endian}i", header[92:96])[0]
        if mode not in MRC_MODES:
            raise ValueError(f"{path} uses unsupported MRC mode {mode}")
        if nx <= 0 or ny <= 0 or nz <= 0:
            raise ValueError(f"{path} has invalid dimensions {nx}x{ny}x{nz}")

        typecode, byte_count = MRC_MODES[mode]
        slice_bytes = nx * ny * byte_count
        fh.seek(1024 + max(0, nsymbt))
        count = 0

        for z_index in range(min(nz, max_slices)):
            raw = fh.read(slice_bytes)
            if len(raw) != slice_bytes:
                break

            values = array(typecode)
            values.frombytes(raw)
            if needs_byteswap(endian):
                values.byteswap()

            image = normalize_to_u8(values)
            suffix = f"_z{z_index + 1:03d}" if nz > 1 else ""
            out_path = out_dir / f"{path.stem}{suffix}.png"
            if out_path.exists() and not force:
                continue
            write_png_gray8(out_path, nx, ny, image)
            count += 1

    return count


def detect_endian(header: bytes) -> str:
    little = struct.unpack("<4i", header[:16])
    if is_plausible_header(little):
        return "<"
    big = struct.unpack(">4i", header[:16])
    if is_plausible_header(big):
        return ">"
    raise ValueError("Could not detect MRC endianness")


def is_plausible_header(values: tuple[int, int, int, int]) -> bool:
    nx, ny, nz, mode = values
    return 0 < nx < 100_000 and 0 < ny < 100_000 and 0 < nz < 100_000 and mode in MRC_MODES


def needs_byteswap(endian: str) -> bool:
    return (sys.byteorder == "little" and endian == ">") or (sys.byteorder == "big" and endian == "<")


def normalize_to_u8(values: array) -> bytes:
    if not values:
        return b""

    finite = [float(value) for value in values]
    lower, upper = percentile_bounds(finite)
    if upper <= lower:
        upper = lower + 1.0

    scale = 255.0 / (upper - lower)
    return bytes(max(0, min(255, int((value - lower) * scale + 0.5))) for value in finite)


def percentile_bounds(values: list[float]) -> tuple[float, float]:
    sorted_values = sorted(values)
    last = len(sorted_values) - 1
    low_index = max(0, min(last, int(last * 0.01)))
    high_index = max(0, min(last, int(last * 0.99)))
    return sorted_values[low_index], sorted_values[high_index]


def write_png_gray8(path: Path, width: int, height: int, pixels: bytes) -> None:
    rows = []
    row_bytes = width
    for y in range(height):
        start = y * row_bytes
        rows.append(b"\x00" + pixels[start : start + row_bytes])

    raw = b"".join(rows)
    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)),
            png_chunk(b"IDAT", zlib.compress(raw, level=6)),
            png_chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(png)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    checksum = binascii.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)


if __name__ == "__main__":
    raise SystemExit(main())
