set positional-arguments

# Freeze Docker Compose resources across checkouts/worktrees. Local setup is
# single-instance by design; do not derive resource names from the directory.
export COMPOSE_PROJECT_NAME := "macro"

compose := "docker compose --project-directory . -f docker/docker-compose.yml"
database_compose := "docker compose -f docker/docker-compose-databases.yml"

# Creates global networks that are shared across docker-compose files
create_networks:
  docker network create databases 2>/dev/null || true -- db network
  docker network create auth 2>/dev/null || true -- fusionauth network
  docker volume create macro_postgres_data 2>/dev/null || true
  docker volume create macro_redis_data 2>/dev/null || true
  docker volume create macro_opensearch_data 2>/dev/null || true
  docker volume create macro_kafka_data 2>/dev/null || true
  docker volume create fusionauth_db_data 2>/dev/null || true
  docker volume create fusionauth_config 2>/dev/null || true
  echo "docker networks and volumes created"

get_environment CONFIG="lcl":
  #!/usr/bin/env bash
  set -euo pipefail
  DOPPLER_CONFIG={{ quote(CONFIG + "_personal") }}
  # Use JSON + jq so multiline secrets become single dotenv entries with escaped newlines.
  doppler secrets download --project local --config "$DOPPLER_CONFIG" --format json --no-file \
    | jq -r '
      def trim_surrounding_newlines:
        sub("^[\r\n]+"; "") | sub("[\r\n]+$"; "");
      to_entries
        | sort_by(.key)[]
        | "\(.key)=\(.value | tostring | trim_surrounding_newlines | @json)"
    ' > .env

# Creates the docker networks then runs the databases
# This is used when initializing your databases
run_dbs *ARGS:
  just create_networks
  {{ database_compose }} up postgres redis --wait {{ ARGS }}

# Spins up main docker-compose
docker_up *ARGS:
  echo "startup docker compose"
  {{ compose }} up {{ ARGS }}

# Reset and seed deterministic data used by local E2E tests.
local-e2e-seed:
  just run_dbs -d
  -just crates/macro_db_client/drop_db -y -f
  just initialize_dbs
  just tooling/seed_cli/local-e2e-smoke

# Email rendering snapshots (Playwright HTML fixtures, not inbox e2e).
# Add a fixture under apps/web/src/lib/core/email/tests/fixtures, then
# `just test-email-rendering-update`.
test-email-rendering:
  just apps/web/test-email-rendering

test-email-rendering-update:
  just apps/web/test-email-rendering-update

# Apply a seed scenario (teams/perms/entities) to the local stack, e.g.
# `just seed-scenario apply --file seed/scenarios/team-perms.json`.
# Add --force to drop and re-migrate the local database first (pristine world).
# `just seed-scenario status` reports what's applied and re-prints login links.
# Pass `--instance <name>` before the scenario subcommand to target a named
# `run_local` stack. Omitting it targets the default `macro` instance.
[positional-arguments]
seed-scenario *ARGS:
  @{{ xtask }} seed-scenario "$@"

# Start only the services needed by the local E2E suites. Avoid unrelated
# local services with extra env/dependency requirements blocking E2E.
local-e2e-services := "authentication-service connection_gateway contacts_service document_storage_service email_service notification_service static_file_service static_file_cdn sync_service websocket_service"

# Update the fixed-output js node_modules hash after bun.lock changes.
update-node-modules-hash:
  tooling/scripts/update-node-modules-hash.sh

# Verify the fixed-output js node_modules derivation matches bun.lock.
check-node-modules-nix:
  nix build .#js-node-modules --no-link
  nix build .#js-node-modules --no-link --rebuild

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
      {{ compose }} stop fusionauth
    fi
  }
  trap cleanup EXIT

  if ! curl -s http://localhost:9011/api/status 2>/dev/null | grep -q '"Ok"'; then
    echo "Starting FusionAuth temporarily to read config..."
    NEEDS_STOP=true
    {{ compose }} up fusionauth -d --wait
  fi
  just infra/stacks/fusionauth-instance/insert_local_fusionauth_variables

# Stop all local services (default project; legacy alias).
stop-local:
  {{ compose }} down

stop-databases:
  {{ database_compose }} down

# Import LocalStack recipes
import 'tooling/just/local_stack.just'
import 'tooling/just/xtask.just'
import 'tooling/just/check.just'
import 'tooling/just/rust.just'

# Sets up local database
setup_local_dbs:
  # run dbs detached
  just run_dbs -d
  just crates/macro_db_client/create_db
  just crates/macro_db_client/migrate_db
  @echo "Local databases initialized"
  {{ database_compose }} stop

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
  just build_dev_service_images
  @echo "Setup complete."

destroy:
  just infra/stacks/fusionauth-instance/destroy
  {{ compose }} down -v
