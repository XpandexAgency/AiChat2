#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
TESTING_BRANCH="testing"
MAIN_BRANCH="main"

cmd="${1:-}"
arg="${2:-}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/git-flow.sh status
  bash scripts/git-flow.sh start-feature <nombre>
  bash scripts/git-flow.sh finish-feature [feature/nombre]
  bash scripts/git-flow.sh promote-main

Examples:
  npm run flow:status
  npm run feature:start -- webhook-form-improvements
  npm run feature:finish
  npm run feature:finish -- feature/webhook-form-improvements
  npm run main:promote
EOF
}

current_branch() {
  git -C "$ROOT_DIR" branch --show-current
}

ensure_clean_tree() {
  if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
    echo "Error: tienes cambios sin commit. Haz commit/stash antes de continuar."
    exit 1
  fi
}

run_status() {
  echo "Current branch: $(current_branch)"
  git -C "$ROOT_DIR" status --short --branch
}

start_feature() {
  if [[ -z "$arg" ]]; then
    echo "Error: debes indicar nombre de feature. Ejemplo: webhook-form-improvements"
    exit 1
  fi

  ensure_clean_tree

  local feature_branch="feature/$arg"
  git -C "$ROOT_DIR" switch "$TESTING_BRANCH"
  git -C "$ROOT_DIR" switch -c "$feature_branch"

  echo "OK: rama creada -> $feature_branch"
  echo "Trabaja normal, luego haz:"
  echo "  git add ."
  echo "  git commit -m \"...\""
  echo "  git push -u origin $feature_branch"
}

finish_feature() {
  ensure_clean_tree

  local feature_branch
  if [[ -n "$arg" ]]; then
    feature_branch="$arg"
  else
    feature_branch="$(current_branch)"
  fi

  if [[ "$feature_branch" != feature/* ]]; then
    echo "Error: finish-feature espera una rama feature/*"
    echo "Pasa la rama explícita: npm run feature:finish -- feature/mi-rama"
    exit 1
  fi

  git -C "$ROOT_DIR" switch "$TESTING_BRANCH"
  git -C "$ROOT_DIR" merge --no-ff "$feature_branch" -m "Merge $feature_branch into $TESTING_BRANCH"
  git -C "$ROOT_DIR" branch -d "$feature_branch" || true

  echo "OK: $feature_branch integrado en $TESTING_BRANCH"
  echo "Siguientes pasos:"
  echo "  git push origin $TESTING_BRANCH"
}

promote_main() {
  ensure_clean_tree

  git -C "$ROOT_DIR" switch "$MAIN_BRANCH"
  git -C "$ROOT_DIR" merge --no-ff "$TESTING_BRANCH" -m "Merge $TESTING_BRANCH into $MAIN_BRANCH"

  echo "OK: $TESTING_BRANCH integrado en $MAIN_BRANCH"
  echo "Siguientes pasos:"
  echo "  git push origin $MAIN_BRANCH"
}

case "$cmd" in
  status)
    run_status
    ;;
  start-feature)
    start_feature
    ;;
  finish-feature)
    finish_feature
    ;;
  promote-main)
    promote_main
    ;;
  *)
    usage
    exit 1
    ;;
esac

