#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/lib/stage-ui.sh"
stage_ui_init

do_build=false
build_processors=false
filtered_args=()
compose_cmd=()
local_aws_env=(
  env
  "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-test}"
  "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-test}"
  "AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}"
)

parse_args() {
  local expecting_profile_name=false

  for arg in "$@"; do
    if [ "$expecting_profile_name" = true ]; then
      if [ "$arg" = "processors" ]; then
        build_processors=true
      fi
      expecting_profile_name=false
      filtered_args+=("$arg")
      continue
    fi

    case "$arg" in
      --build)
        do_build=true
        ;;
      --profile)
        expecting_profile_name=true
        filtered_args+=("$arg")
        ;;
      search_processing_service)
        build_processors=true
        filtered_args+=("$arg")
        ;;
      *)
        filtered_args+=("$arg")
        ;;
    esac
  done
}

run_local_setup() {
  stage_section "Running local setup"
  stage_note "Set MACRO_LOCAL_VERBOSE=1 to show setup command output."
  if stage_is_dry_run; then
    stage_note "Dry run: stages will be shown but not executed."
  fi
  printf "\n"

  stage_run "Preparing Docker networks" just create_networks
  stage_run "Starting LocalStack" "${local_aws_env[@]}" just start_localstack
  stage_run "Ensuring SQS queues" "${local_aws_env[@]}" just create_local_queues
  stage_run "Ensuring DynamoDB tables" "${local_aws_env[@]}" just create_local_tables
  stage_run "Ensuring S3 buckets" "${local_aws_env[@]}" just create_local_buckets
  stage_run "Configuring S3 notifications" "${local_aws_env[@]}" just configure_document_upload_finalizer_notifications
  stage_run "Patching FusionAuth env" just patch_local_fusionauth_env
}

run_builds() {
  stage_run "Building Rust services image" docker compose build rust_services_image

  if [ "$do_build" != true ]; then
    return
  fi

  stage_run "Building app services" docker compose build websocket_service sync_service lexical_service

  if [ "$build_processors" = true ]; then
    stage_run "Building search processor" docker compose build search_processing_service
  fi
}

compose_command() {
  compose_cmd=(docker compose up)
  if [ "${#filtered_args[@]}" -gt 0 ]; then
    compose_cmd+=("${filtered_args[@]}")
  fi
}

start_compose() {
  printf "\n"
  stage_section "Starting Docker Compose"

  if stage_is_dry_run; then
    stage_print_command "Command:" "${compose_cmd[@]}"
    return
  fi

  exec "${compose_cmd[@]}"
}

parse_args "$@"
run_local_setup
run_builds
compose_command
start_compose
