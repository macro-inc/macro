# Creates global networks that are shared across docker-compose files
create_networks:
  docker network create databases 2>/dev/null || true -- db network
  docker network create auth 2>/dev/null || true -- fusionauth network
  echo "docker networks created"

get_environment *ARGS:
  sops --input-type dotenv --output-type dotenv -d .env-local{{ ARGS }}.enc > .env

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

# Builds the main docker images for the services and runs the docker-compose
# after
build_run_local *ARGS:
  just rust/cloud-storage/build_dev_service_images
  just run_local {{ ARGS }} 

# Stop all local services
stop-local:
  docker compose down

# Start LocalStack for local AWS emulation
start_localstack:
  docker run -d --name localstack \
    --network databases \
    -p 4566:4566 \
    -e SERVICES=sqs \
    localstack/localstack 2>/dev/null || true
  echo "LocalStack started"

# Create SQS queues in LocalStack
create_local_queues:
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name notification-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name push-delivery-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-backfill-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name delete-chat-handler-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name contacts-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name convert-service-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name delete-document-handler-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name document-text-extractor-lambda-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-scheduled-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-inbox-sync-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-inbox-retry-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-refresh-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name search-event-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-sfs-delete-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-sfs-mapper-queue || true
  echo "SQS queues created"

# Full LocalStack setup
setup_localstack:
  just start_localstack
  sleep 2
  just create_local_queues

# Sets up local database
# Assumes postgres is running locally via `just run_dbs`
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
