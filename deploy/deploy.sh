#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/forbell/familyDinner}"
SERVICE_NAME="${SERVICE_NAME:-family-dinner}"
DEFAULT_REMOTE="${DEPLOY_REMOTE:-origin}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [<ref>]
  $(basename "$0") [<remote> <branch>]

Examples:
  $(basename "$0")
  $(basename "$0") origin/main
  $(basename "$0") feat/subpath-support
  $(basename "$0") origin feat/subpath-support
EOF
}

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Expected a git checkout at $APP_DIR" >&2
  exit 1
fi

case "$#" in
  0)
    FETCH_REMOTE="$DEFAULT_REMOTE"
    TARGET_REF="refs/remotes/$DEFAULT_REMOTE/main"
    DISPLAY_TARGET="$DEFAULT_REMOTE/main"
    ;;
  1)
    ARG="$1"
    FETCH_REMOTE="$DEFAULT_REMOTE"
    TARGET_REF=""
    DISPLAY_TARGET="$ARG"
    ;;
  2)
    FETCH_REMOTE="$1"
    TARGET_REF="refs/remotes/$FETCH_REMOTE/$2"
    DISPLAY_TARGET="$FETCH_REMOTE/$2"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

echo "Deploying $DISPLAY_TARGET in $APP_DIR"

cd "$APP_DIR"

git fetch "$FETCH_REMOTE" --prune

if [[ "$FORCE_DEPLOY" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy over local changes in $APP_DIR" >&2
  echo "Commit, stash, or rerun with FORCE_DEPLOY=1 if you really want to replace them." >&2
  exit 1
fi

if [[ -z "${TARGET_REF:-}" ]]; then
  if git rev-parse --verify --quiet "refs/remotes/$ARG" >/dev/null; then
    TARGET_REF="refs/remotes/$ARG"
  elif git rev-parse --verify --quiet "refs/remotes/$DEFAULT_REMOTE/$ARG" >/dev/null; then
    TARGET_REF="refs/remotes/$DEFAULT_REMOTE/$ARG"
    DISPLAY_TARGET="$DEFAULT_REMOTE/$ARG"
  elif git rev-parse --verify --quiet "$ARG" >/dev/null; then
    TARGET_REF="$ARG"
  else
    echo "Could not resolve deployment target '$ARG'." >&2
    echo "Tried remote branch '$DEFAULT_REMOTE/$ARG' and local ref '$ARG'." >&2
    exit 1
  fi
elif ! git rev-parse --verify --quiet "$TARGET_REF" >/dev/null; then
  echo "Could not resolve deployment target '$DISPLAY_TARGET'." >&2
  exit 1
fi

git switch --detach "$TARGET_REF"

echo "Deploying commit $(git rev-parse --short HEAD) from $DISPLAY_TARGET"
npm ci --omit=dev
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
