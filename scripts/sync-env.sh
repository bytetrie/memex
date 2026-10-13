#!/usr/bin/env bash
# Brings the container up to date with the project's dependencies. Safe to run
# any time; run it after pulling changes. Steps:
#   1. apt packages listed in infra/apt-packages.txt that are not installed yet,
#      through `sudo devstack-sync packages` (the dev user's only root command)
#   2. npm packages from pnpm-lock.yaml (pnpm install --frozen-lockfile)
#   3. the yt-dlp release pinned in infra/yt-dlp.lock, into vendor/ (pnpm yt-dlp install)
# It never removes packages. Then build as usual (pnpm build, restart the API).
# usage: ./scripts/sync-env.sh   (or pnpm sync-env once node_modules exists)
set -euo pipefail
cd "$(dirname "$0")/.."

list=infra/apt-packages.txt
wanted=$(sed -e 's/#.*//' "$list" | tr -s ' \t' '\n' | sed '/^$/d')

missing=()
for pkg in $wanted; do
  status=$(dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null || true)
  [[ $status == "install ok installed" ]] || missing+=("$pkg")
done

if ((${#missing[@]})); then
  echo "apt: installing ${missing[*]}"
  sudo devstack-sync packages < "$list"
else
  echo "apt: all packages from $list installed"
fi

echo "pnpm: installing from pnpm-lock.yaml"
pnpm install --frozen-lockfile

echo "yt-dlp: installing the version pinned in infra/yt-dlp.lock"
node scripts/yt-dlp.ts install
