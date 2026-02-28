#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/forbell/familyDinner}"
SERVICE_NAME="${SERVICE_NAME:-family-dinner}"
TARGET="${1:-origin/main}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Expected a git checkout at $APP_DIR" >&2
  exit 1
fi

echo "Deploying $TARGET in $APP_DIR"

cd "$APP_DIR"

git fetch origin

if [[ "$FORCE_DEPLOY" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy over local changes in $APP_DIR" >&2
  echo "Commit, stash, or rerun with FORCE_DEPLOY=1 if you really want to replace them." >&2
  exit 1
fi

git checkout "$TARGET"

if git rev-parse --verify --quiet "origin/${TARGET#origin/}" >/dev/null; then
  git reset --hard "origin/${TARGET#origin/}"
fi

npm ci --omit=dev
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
