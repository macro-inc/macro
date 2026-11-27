#!/usr/bin/env bash
# Stops every search-processing task before the release that fences email
# index writes starts its first task: an old task writing without a version
# beside a fenced one could undo the fenced writes or bring back a deleted
# message. Autoscaling is suspended first, so it cannot start old tasks again;
# resume-after-fence.sh restores the task count and resumes it.
#
# Environment: CLUSTER (cluster ARN or name), SERVICE_PREFIX (the service's
# name before Pulumi's suffix, e.g. "search-processing-"), AWS_REGION.
set -euo pipefail
: "${CLUSTER:?}" "${SERVICE_PREFIX:?}" "${AWS_REGION:?}"

# The service's name is an output of the resource this step must run before,
# so it is found by its prefix: Pulumi names it the prefix and 7 hex digits.
services=$(aws ecs list-services --cluster "$CLUSTER" --query 'serviceArns' --output text \
  | tr '\t' '\n' | grep -E "/${SERVICE_PREFIX}[0-9a-f]{7}$" || true)
count=$(printf '%s' "$services" | grep -c . || true)
if [ "$count" -eq 0 ]; then
  echo "No ${SERVICE_PREFIX}* service yet; nothing to stop."
  exit 0
fi
if [ "$count" -ne 1 ]; then
  echo "Expected one ${SERVICE_PREFIX}* service in ${CLUSTER}, found:" >&2
  printf '%s\n' "$services" >&2
  exit 1
fi
service=${services##*/}
cluster_name=${CLUSTER##*/}

aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id "service/${cluster_name}/${service}" \
  --suspended-state DynamicScalingInSuspended=true,DynamicScalingOutSuspended=true,ScheduledScalingSuspended=true

tasks=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$service" \
  --desired-status RUNNING --query 'taskArns' --output text)
aws ecs update-service --cluster "$CLUSTER" --service "$service" --desired-count 0 > /dev/null
echo "Set ${service} to 0 tasks; waiting for its tasks to stop."

# A stopping task can still write while it drains, so wait until every task
# that was running has stopped, not only until the service reports none.
if [ -n "$tasks" ] && [ "$tasks" != "None" ]; then
  # shellcheck disable=SC2086 # one argument per task ARN
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks $tasks
fi
aws ecs wait services-stable --cluster "$CLUSTER" --services "$service"
echo "Every ${service} task has stopped."
