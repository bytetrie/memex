#!/usr/bin/env bash
# Converts the TeX Gyre Heros OTF sources in font/texgyre/ to WOFF2 with
# woff2_compress (Debian package `woff2`, installed by scripts/sync-env.sh from
# infra/apt-packages.txt). Output is committed so the app build
# does not need the tool:
#   web/public/fonts/<name>.woff2   (referenced by web/src/fonts.css)
# usage: pnpm fonts
set -euo pipefail

src=font/texgyre
out=web/public/fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$out"
for f in "$src"/*.otf; do
  # woff2_compress writes <name>.woff2 next to its input, so work on a copy.
  cp "$f" "$tmp/"
  woff2_compress "$tmp/$(basename "$f")" >/dev/null
  mv "$tmp/$(basename "$f" .otf).woff2" "$out/"
done
ls -l "$out"/texgyre*.woff2
