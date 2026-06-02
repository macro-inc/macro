#!/usr/bin/env bash

stage_ui_verbose="${MACRO_LOCAL_VERBOSE:-0}"
stage_ui_dry_run="${MACRO_LOCAL_DRY_RUN:-0}"
stage_ui_is_tty=false
stage_ui_current_pid=""
stage_ui_width=48

if [ -t 1 ]; then
  stage_ui_is_tty=true
fi

if [ "$stage_ui_is_tty" = true ] && [ -z "${NO_COLOR:-}" ]; then
  stage_ui_bold="$(printf '\033[1m')"
  stage_ui_dim="$(printf '\033[2m')"
  stage_ui_green="$(printf '\033[32m')"
  stage_ui_red="$(printf '\033[31m')"
  stage_ui_cyan="$(printf '\033[36m')"
  stage_ui_reset="$(printf '\033[0m')"
else
  stage_ui_bold=""
  stage_ui_dim=""
  stage_ui_green=""
  stage_ui_red=""
  stage_ui_cyan=""
  stage_ui_reset=""
fi

stage_ui_cleanup_child() {
  if [ -n "$stage_ui_current_pid" ]; then
    kill "$stage_ui_current_pid" 2>/dev/null || true
  fi
}

stage_ui_init() {
  trap 'stage_ui_cleanup_child; exit 130' INT
  trap 'stage_ui_cleanup_child; exit 143' TERM
}

stage_is_dry_run() {
  [ "$stage_ui_dry_run" = "1" ]
}

stage_elapsed() {
  local start="$1"
  local seconds=$((SECONDS - start))
  if [ "$seconds" -lt 60 ]; then
    printf "%ss" "$seconds"
  else
    printf "%sm%ss" "$((seconds / 60))" "$((seconds % 60))"
  fi
}

stage_section() {
  local label="$1"
  printf "%b[+]%b %s\n" "$stage_ui_green" "$stage_ui_reset" "$label"
}

stage_note() {
  printf "%b%s%b\n" "$stage_ui_dim" "$1" "$stage_ui_reset"
}

stage_print_line() {
  local marker="$1"
  local label="$2"
  local status="$3"
  local marker_color="$4"
  local status_color="$5"

  if [ "$stage_ui_is_tty" = true ]; then
    printf "\r\033[K"
  fi

  printf " %b%s%b %-*s %b%s%b\n" \
    "$marker_color" "$marker" "$stage_ui_reset" \
    "$stage_ui_width" "$label" \
    "$status_color" "$status" "$stage_ui_reset"
}

stage_print_running() {
  local label="$1"
  local marker="$2"

  if [ "$stage_ui_is_tty" = true ]; then
    printf "\r\033[K %b%s%b %-*s %bRunning%b" \
      "$stage_ui_cyan" "$marker" "$stage_ui_reset" \
      "$stage_ui_width" "$label" \
      "$stage_ui_cyan" "$stage_ui_reset"
  else
    stage_print_line "$marker" "$label" "Running" "$stage_ui_cyan" "$stage_ui_cyan"
  fi
}

stage_print_command() {
  local label="$1"
  shift

  printf "%b%s%b" "$stage_ui_bold" "$label" "$stage_ui_reset"
  printf " %q" "$@"
  printf "\n"
}

stage_run() {
  local label="$1"
  shift
  local start="$SECONDS"

  if stage_is_dry_run; then
    stage_print_line "•" "$label" "Dry run" "$stage_ui_dim" "$stage_ui_dim"
    return
  fi

  if [ "$stage_ui_verbose" = "1" ]; then
    stage_print_line "-" "$label" "Running" "$stage_ui_cyan" "$stage_ui_cyan"
    if "$@"; then
      stage_print_line "✓" "$label" "Done $(stage_elapsed "$start")" "$stage_ui_green" "$stage_ui_green"
      return
    fi

    local status=$?
    stage_print_line "✗" "$label" "Failed $(stage_elapsed "$start")" "$stage_ui_red" "$stage_ui_red" >&2
    exit "$status"
  fi

  local log_file
  log_file="$(mktemp "${TMPDIR:-/tmp}/macro-run-local.XXXXXX")"

  "$@" >"$log_file" 2>&1 &
  stage_ui_current_pid="$!"

  local spinner=('-' '\' '|' '/')
  local frame=0
  if [ "$stage_ui_is_tty" = true ]; then
    while kill -0 "$stage_ui_current_pid" 2>/dev/null; do
      stage_print_running "$label" "${spinner[$frame]}"
      frame=$(((frame + 1) % ${#spinner[@]}))
      sleep 0.12
    done
  else
    stage_print_running "$label" "-"
  fi

  set +e
  wait "$stage_ui_current_pid"
  local status=$?
  set -e
  stage_ui_current_pid=""

  if [ "$status" -eq 0 ]; then
    stage_print_line "✓" "$label" "Done $(stage_elapsed "$start")" "$stage_ui_green" "$stage_ui_green"
    rm -f "$log_file"
    return
  fi

  stage_print_line "✗" "$label" "Failed $(stage_elapsed "$start")" "$stage_ui_red" "$stage_ui_red" >&2
  stage_print_command "Command failed:" "$@" >&2

  if [ -s "$log_file" ]; then
    printf "%bOutput:%b\n" "$stage_ui_bold" "$stage_ui_reset" >&2
    sed 's/^/  /' "$log_file" >&2
  fi

  rm -f "$log_file"
  exit "$status"
}
