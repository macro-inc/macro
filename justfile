set positional-arguments

# Freeze Docker Compose resources across checkouts/worktrees. Local setup is
# single-instance by design; do not derive resource names from the directory.
export COMPOSE_PROJECT_NAME := "macro"

# Creates global networks that are shared across docker-compose files
create_networks:
  docker network create databases 2>/dev/null || true -- db network
  docker network create auth 2>/dev/null || true -- fusionauth network
  docker volume create macro_postgres_data 2>/dev/null || true
  docker volume create macro_redis_data 2>/dev/null || true
  docker volume create macro_opensearch_data 2>/dev/null || true
  docker volume create fusionauth_db_data 2>/dev/null || true
  docker volume create fusionauth_config 2>/dev/null || true
  echo "docker networks and volumes created"

fix_environment *ARGS:
  # Decrypt ignoring mac error
  sops --input-type dotenv --output-type dotenv --ignore-mac -d .env-local{{ ARGS }}.enc > .env-local{{ ARGS }}.dec
  # Encrypt the file
  sops --input-type dotenv --output-type dotenv -e .env-local{{ ARGS}}.dec > .env-local{{ ARGS }}.enc
  # Remove the decrypted file
  rm -rf .env-local{{ ARGS }}.dec

get_environment *ARGS:
  #!/usr/bin/env bash
  set -euo pipefail
  sops --input-type dotenv --output-type dotenv -d ".env-local{{ ARGS }}.enc" > .env
  if [ -n "{{ ARGS }}" ] && [ -f ~/.aws/credentials ]; then
    AWS_KEY=$(awk -F'=' '/\[default\]/{found=1} found && /aws_access_key_id/{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}' ~/.aws/credentials)
    AWS_SECRET=$(awk -F'=' '/\[default\]/{found=1} found && /aws_secret_access_key/{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}' ~/.aws/credentials)
    if [ -n "$AWS_KEY" ] && [ -n "$AWS_SECRET" ]; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=\"$AWS_KEY\"|" .env
        sed -i '' "s|^AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=\"$AWS_SECRET\"|" .env
      else
        sed -i "s|^AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=\"$AWS_KEY\"|" .env
        sed -i "s|^AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=\"$AWS_SECRET\"|" .env
      fi
      echo "Replaced AWS credentials from ~/.aws/credentials [default] profile"
    else
      echo "Warning: Could not read AWS credentials from ~/.aws/credentials [default] profile"
    fi
  fi

edit_environment *ARGS:
  sops --input-type dotenv --output-type dotenv .env-local{{ ARGS}}.enc

# Creates the docker networks then runs the databases
# This is used when initializing your databases
run_dbs *ARGS:
  just create_networks
  docker compose -f docker-compose-databases.yml up postgres redis --wait {{ ARGS }}

# Spins up main docker-compose
docker_up *ARGS:
  echo "startup docker compose"
  docker compose up {{ ARGS }}

# Run all services locally using docker-compose
# Requires .env file (from `just get_environment`) and FusionAuth setup (from `just setup`).
# Automatically patches .env with local FusionAuth values before starting services.
run_local *ARGS:
  #!/usr/bin/env bash
  set -euo pipefail

  just create_networks
  just patch_local_fusionauth_env

  do_build=false
  build_processors=false
  filtered_args=()
  expecting_profile_name=false
  for arg in "$@"; do
    if [ "$expecting_profile_name" = true ]; then
      if [ "$arg" = "processors" ]; then
        build_processors=true
      fi
      expecting_profile_name=false
      filtered_args+=("$arg")
      continue
    fi

    if [ "$arg" = "--build" ]; then
      do_build=true
    elif [ "$arg" = "--profile" ]; then
      expecting_profile_name=true
      filtered_args+=("$arg")
    elif [ "$arg" = "search_processing_service" ]; then
      build_processors=true
      filtered_args+=("$arg")
    else
      filtered_args+=("$arg")
    fi
  done

  docker compose build rust_services_image

  if [ "$do_build" = true ]; then
    docker compose build websocket_service sync_service lexical_service
    if [ "$build_processors" = true ]; then
      docker compose build search_processing_service
    fi
  fi

  echo "startup docker compose"
  if [ "${#filtered_args[@]}" -gt 0 ]; then
    docker compose up "${filtered_args[@]}"
  else
    docker compose up
  fi

# Reset and seed deterministic data used by local E2E tests.
local-e2e-seed:
  just run_dbs -d
  -just rust/cloud-storage/macro_db_client/drop_db -y -f
  just rust/cloud-storage/initialize_dbs
  just rust/cloud-storage/seed_cli/local-e2e-smoke

# Start only the services needed by the local E2E suites. Avoid unrelated
# local services with extra env/dependency requirements blocking E2E.
local-e2e-services := "authentication-service connection_gateway contacts_service document_storage_service email_service static_file_service static_file_cdn sync_service websocket_service"

# Start the local stack, seed deterministic data, and run the Playwright smoke suite.
local-e2e *ARGS:
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 just setup_localstack
  COMPOSE_FILE=docker-compose.yml:docker-compose.local-e2e.yml just run_local -d --wait {{ local-e2e-services }}
  just local-e2e-seed
  cd js/app && LOCAL_E2E=true bunx playwright test {{ ARGS }}

# Start the local stack, seed deterministic data, and run ignored Rust local E2E integration tests.
local-e2e-rust *ARGS:
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 just setup_localstack
  COMPOSE_FILE=docker-compose.yml:docker-compose.local-e2e.yml just run_local -d --wait {{ local-e2e-services }}
  just local-e2e-seed
  cd rust/cloud-storage && SQLX_OFFLINE=true cargo test -p local_e2e_integration_tests -- --ignored --nocapture {{ ARGS }}

# Start the local stack once, seed deterministic data, and run Rust + Playwright local E2E tests.
local-e2e-all *ARGS:
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 just setup_localstack
  COMPOSE_FILE=docker-compose.yml:docker-compose.local-e2e.yml just run_local -d --wait {{ local-e2e-services }}
  just local-e2e-seed
  cd rust/cloud-storage && SQLX_OFFLINE=true cargo test -p local_e2e_integration_tests -- --ignored --nocapture
  cd js/app && LOCAL_E2E=true bunx playwright test {{ ARGS }}

# Start the local stack, seed deterministic data, and open Playwright UI mode.
local-e2e-ui *ARGS:
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 just setup_localstack
  COMPOSE_FILE=docker-compose.yml:docker-compose.local-e2e.yml just run_local -d --wait {{ local-e2e-services }}
  just local-e2e-seed
  cd js/app && LOCAL_E2E=true bunx playwright test --ui {{ ARGS }}

# Patches .env with local FusionAuth values if the Pulumi stack exists.
# Requires FusionAuth to be running — starts it temporarily if needed.
patch_local_fusionauth_env:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ ! -f .env ]; then
    echo "Error: .env not found. Run 'just get_environment' first."
    exit 1
  fi
  if ! pulumi stack output macroApplicationClientId -s local -C infra/stacks/fusionauth-instance &>/dev/null; then
    echo "Warning: Pulumi local stack not found — skipping FusionAuth env patching."
    echo "         Run 'just setup' if this is a fresh checkout."
    exit 0
  fi
  if [ ! -f infra/stacks/fusionauth-instance/.env ]; then
    echo "FusionAuth docker env not found; downloading it..."
    just infra/stacks/fusionauth-instance/get_fusionauth_env
  fi
  # FusionAuth must be running to read the client secret
  NEEDS_STOP=false
  cleanup() {
    if [ "$NEEDS_STOP" = true ]; then
      echo "Stopping temporary FusionAuth..."
      docker compose stop fusionauth
    fi
  }
  trap cleanup EXIT

  if ! curl -s http://localhost:9011/api/status 2>/dev/null | grep -q '"Ok"'; then
    echo "Starting FusionAuth temporarily to read config..."
    NEEDS_STOP=true
    docker compose up fusionauth -d --wait
  fi
  just infra/stacks/fusionauth-instance/insert_local_fusionauth_variables

# Stop all local services
stop-local:
  docker compose down

stop-databases:
  docker compose -f docker-compose-databases.yml down

# Import LocalStack recipes
import 'local_stack.just'

# Sets up local database
setup_local_dbs:
  # run dbs detached
  just run_dbs -d
  just rust/cloud-storage/macro_db_client/create_db
  just rust/cloud-storage/macro_db_client/migrate_db
  @echo "Local databases initialized"
  docker compose -f docker-compose-databases.yml stop

# Setup FusionAuth: start containers, wait for healthy, run Pulumi config
# stop container
setup_fusionauth:
  just create_networks
  just infra/stacks/fusionauth-instance/setup

# Stop FusionAuth containers
stop_fusionauth:
  docker compose -f infra/stacks/fusionauth-instance/docker-compose.yml down

# Clear all BuildKit build cache (full cold rebuild next time)
docker_cache_clear:
  docker builder prune --all -f

# Clear only the Rust target caches (keeps downloaded crates, forces recompilation)
docker_cache_clear_targets:
  docker builder prune --filter type=exec.cachemount --filter id=rust-target-dev-debug -f
  docker builder prune --filter type=exec.cachemount --filter id=rust-target-dev-release -f

# Show BuildKit cache disk usage
docker_cache_usage:
  docker builder du --verbose

setup:
  just get_environment
  just create_networks
  just setup_localstack
  just setup_local_dbs
  just infra/stacks/fusionauth-instance/setup
  just rust/cloud-storage/build_dev_service_images
  @echo "Setup complete."

destroy:
  just infra/stacks/fusionauth-instance/destroy
  docker compose down -v
