#!/usr/bin/env bash
# Brings search-processing back after stop-old-tasks.sh: at least its minimum
# task count, then autoscaling resumed, then a wait until the tasks run. Safe
# to run again on its own: a service already running keeps its task count.
#
# Environment: CLUSTER (cluster ARN or name), SERVICE (the service's name),
# MIN_TASKS, AWS_REGION.
set -euo pipefail
: "${CLUSTER:?}" "${SERVICE:?}" "${MIN_TASKS:?}" "${AWS_REGION:?}"
cluster_name=${CLUSTER##*/}

current=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].desiredCount' --output text)
desired=$((current > MIN_TASKS ? current : MIN_TASKS))
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count "$desired" > /dev/null

aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id "service/${cluster_name}/${SERVICE}" \
  --suspended-state DynamicScalingInSuspended=false,DynamicScalingOutSuspended=false,ScheduledScalingSuspended=false

echo "Set ${SERVICE} to ${desired} tasks and resumed autoscaling; waiting for them to run."
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
echo "${SERVICE} is running ${desired} tasks."
