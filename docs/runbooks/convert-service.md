# convert-service

convert-service converts Office files with LibreOfficeKit, from the convert
queue and from `/internal/convert`. Every conversion writes to the task's
20 GiB Fargate ephemeral disk, about 5 GiB of which is the image.

Each attempt works in its own folder under `/tmp/convert_service/jobs`. The
folder is removed when the attempt ends, however it ends, and a starting task
empties `/tmp/convert_service`. Below 2 GiB or 50,000 inodes free
(`services/convert_service/src/disk.rs`) the task:

- returns 503 from `/health`, so ECS replaces it with a task on an empty disk;
- stops receiving from the convert queue, so messages wait for the new task
  instead of failing twice and being dead-lettered;
- returns 503 from `/internal/convert`.

The monitor in `infra/stacks/monitoring/monitors/convert-service.ts` warns at
60% and alerts at 80% of a task's disk.

| Signal | Where |
| --- | --- |
| Disk per task | Metrics: `ecs.fargate.ephemeral_storage.utilized` / `.reserved`, `ecs_cluster:cloud-storage-cluster-prod`, `ecs_service:convert-service*`, by `task_arn` |
| Low disk | Logs: `service:convert-service` `health check failed`, `pausing the convert queue: low disk space`, `refusing conversion: low disk space` |
| Leaked files | Logs: `service:convert-service` `unable to remove job folder` |
| Failed conversions | Logs: `service:convert-service` `error processing message`. The error is `conversion failed: <cause>`, or `conversion timed out` or `conversion crashed` for a LibreOffice that was killed |
| Waiting jobs | Metrics: `aws.sqs.approximate_age_of_oldest_message`, `queuename:convert-service-queue-prod` |

## Disk filling

A task's disk passed 80%. A healthy task stays near its image size: nothing a
conversion writes outlives it.

1. Check whether the task is being replaced. ECS service events show a task
   stopped for failing its health check, and the new task's disk starts near
   25%. Conversions recover on their own; go to step 3.
2. A task that sits near 100% and is not replaced runs a build without the
   disk check, and fails every conversion with `No space left on device`.
   Lever: stop the task so ECS starts a new one. Deploys of this service are
   off in `.github/services-config.json`, so compare the running image's age
   with the fix you expect before assuming it is live.
3. Find what leaks. `unable to remove job folder` names a folder that could
   not be deleted. Otherwise something is writing outside the job folder:
   run the ignored tests in `services/convert_service/src/process/test.rs`
   against the LibreOffice build in the image
   (`docker/Dockerfile.convert_service`) and look for files left in `/tmp`,
   the home directory and the LibreOffice install directory. A rise in
   `conversion timed out` or `conversion crashed` just before the disk grew
   points at files a killed LibreOffice left behind.
4. Messages that failed twice while the disk was full are in the convert
   dead-letter queue. Redrive it once conversions succeed again
   ([Dead letters](queues.md#dead-letters)).
