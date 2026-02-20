# Creates global networks that are shared across docker-compose files
create_networks:
  docker network create databases 2>/dev/null || true -- db network
  docker network create auth 2>/dev/null || true -- fusionauth network
  echo "docker networks created"

fix_environment *ARGS:
  # Decrypt ignoring mac error
  sops --input-type dotenv --output-type dotenv --ignore-mac -d .env-local{{ ARGS }}.enc > .env-local{{ ARGS }}.dec
  # Encrypt the file
  sops --input-type dotenv --output-type dotenv -e .env-local{{ ARGS}}.dec > .env-local{{ ARGS }}.enc
  # Remove the decrypted file
  rm -rf .env-local{{ ARGS }}.dec

get_environment *ARGS:
  sops --input-type dotenv --output-type dotenv -d .env-local{{ ARGS }}.enc > .env

edit_environment *ARGS:
  sops --input-type dotenv --output-type dotenv .env-local{{ ARGS}}.enc

# Creates the docker networks then runs the databases
# This is used when initializing your databases
run_dbs *ARGS:
  just create_networks
  docker-compose -f docker-compose-databases.yml up postgres redis --wait {{ ARGS }}

# Spins up main docker-compose
docker_up *ARGS:
  echo "startup docker compose"
  docker compose up {{ ARGS }}

# Run all services locally using docker-compose
# Requires .env file with dev environment variables
run_local *ARGS:
  just create_networks
  just docker_up {{ ARGS }}

# Stop all local services
stop-local:
  docker compose down

stop-databases:
  docker-compose -f docker-compose-databases.yml down

# Import LocalStack recipes
import 'local_stack.just'

# Sets up local database
setup_local_dbs:
  # run dbs detached
  just run_dbs -d
  just rust/cloud-storage/macro_db_client/create_db
  just rust/cloud-storage/macro_db_client/migrate_db
  @echo "Local databases initialized"
  docker-compose -f docker-compose-databases.yml stop

# Setup FusionAuth: start containers, wait for healthy, run Pulumi config
# stop container
setup_fusionauth:
  just create_networks
  just infra/stacks/fusionauth-instance/setup_fusionauth

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
