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
