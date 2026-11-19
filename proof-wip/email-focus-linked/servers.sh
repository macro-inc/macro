#!/usr/bin/env bash
# Redis, ElasticMQ and Kafka of this worktree's email e2e runs, each on a free port.
# Usage: servers.sh start | stop | env
set -euo pipefail
S=$(dirname "$0")
STATE=$S/servers.env
free_port() {
  while :; do
    local port=$(( (RANDOM % 15000) + 45000 ))
    ss -ltnH "sport = :$port" | grep -q . || { echo "$port"; return; }
  done
}
case "$1" in
start)
  redis=$(free_port); sqs=$(free_port); kafka=$(free_port); ctl=$(free_port)
  docker run -d --name focuslinked-e2e-redis -p 127.0.0.1:$redis:6379 redis:7 >/dev/null
  docker run -d --name focuslinked-e2e-sqs -p 127.0.0.1:$sqs:9324 softwaremill/elasticmq-native:1.7.1 >/dev/null
  docker run -d --name focuslinked-e2e-kafka --network host \
    -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller \
    -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@127.0.0.1:$ctl \
    -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
    -e KAFKA_LISTENERS=PLAINTEXT://127.0.0.1:$kafka,CONTROLLER://127.0.0.1:$ctl \
    -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:$kafka \
    -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
    -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
    -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_OFFSETS_TOPIC_NUM_PARTITIONS=1 \
    -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
    -e KAFKA_AUTO_CREATE_TOPICS_ENABLE=true apache/kafka:3.9.1 >/dev/null
  cat > "$STATE" <<VARS
export EMAIL_E2E_REDIS_URL=redis://127.0.0.1:$redis
export EMAIL_E2E_SQS_URL=http://127.0.0.1:$sqs
export EMAIL_E2E_KAFKA_BROKERS=127.0.0.1:$kafka
export EMAIL_E2E_DATABASE_URL=$("$S/pg.sh" url)/macrodb
VARS
  cat "$STATE"
  ;;
stop)
  docker rm -f focuslinked-e2e-redis focuslinked-e2e-sqs focuslinked-e2e-kafka
  ;;
env)
  cat "$STATE"
  ;;
esac
