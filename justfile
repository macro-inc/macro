# Creates global networks that are shared across docker-compose files
create_networks:
  docker network create databases 2>/dev/null || true
  echo "docker networks created"

get_environment:
  doppler secrets download --no-file --format env > .env

# Creates the docker networks then runs the databases 
# This is used when initializing your databases
run_dbs *ARGS:
  just create_networks
  docker-compose -f docker-compose-databases.yml up postgres redis {{ ARGS }}

# Spins up main docker-compose
docker_up *ARGS:
  echo "startup docker compose"
  docker compose up {{ ARGS }}

# Run all services locally using docker-compose
# Requires .env file with dev environment variables
run_local *ARGS:
  just create_networks
  just docker_up {{ ARGS }}

# Builds the main docker images for the services and runs the docker-compose
# after
build_run_local *ARGS:
  just rust/cloud-storage/build_dev_service_images
  just run_local {{ ARGS }} 

# Stop all local services
stop-local:
  docker compose down
