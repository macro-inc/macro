#!/usr/bin/env bash
# Brings search-processing back after stop-old-tasks.sh: at least its minimum
# task count, then autoscaling resumed, then a wait until the tasks run. Safe
# to run again on its own: a service already running keeps its task count.
#
# It refuses while the service still runs a task definition without the fence
# tag: raising the count then would start old tasks that write without
# versions, and the stop does not run again on a retried deploy. Rerunning the
# deploy moves the service to the fenced task definition first.
#
# Environment: CLUSTER (cluster ARN or name), SERVICE (the service's name),
# MIN_TASKS, EMAIL_FENCE_TAG and EMAIL_FENCE_EPOCH (the tag fenced task
# definitions carry and its value), AWS_REGION.
set -euo pipefail
: "${CLUSTER:?}" "${SERVICE:?}" "${MIN_TASKS:?}" "${EMAIL_FENCE_TAG:?}" "${EMAIL_FENCE_EPOCH:?}" "${AWS_REGION:?}"
cluster_name=${CLUSTER##*/}

task_definition=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text)
fence=$(aws ecs describe-task-definition --task-definition "$task_definition" --include TAGS \
  --query "tags[?key=='${EMAIL_FENCE_TAG}'].value | [0]" --output text)
if [ "$fence" != "$EMAIL_FENCE_EPOCH" ]; then
  echo "${SERVICE} runs ${task_definition}, which does not fence email writes;" \
    "not starting tasks. Rerun the deploy." >&2
  exit 1
fi

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
