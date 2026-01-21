run_dbs:
  docker-compose up macrodb redis-node-0 redis-node-1 redis-node-2 redis-node-3 redis-node-4 redis-node-5 macrocache

create_networks:
  docker network create databases 2>/dev/null || true
  echo "docker networks created"

docker_up *ARGS:
  echo "startup docker compose"
  docker compose up {{ ARGS }}

# Run all services locally using docker-compose
# Requires .env file with dev environment variables
run_local *ARGS:
  just create_networks
  just docker_up {{ ARGS }}


run_local_build:
  just docker_up --build

# Run all services in detached mode
run_local_detached:
  just docker_up --build -d

# Stop all local services
stop-local:
  docker compose down
