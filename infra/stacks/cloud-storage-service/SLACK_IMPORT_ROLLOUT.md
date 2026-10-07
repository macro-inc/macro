# Slack archive worker deployment

The cloud-storage-service stack owns the queues and a **separate**
`slack-import-worker` ECS service, image, task role and execution role. It is not
part of the DSS process and has no listener, ingress rule or load balancer.
CI registers `slack_import_worker` under the existing `document-storage-service`
stack entry (like email's pubsub worker); do not register a second concurrent
Pulumi deployment for the same stack.

## Operator prerequisites (before deploying the worker)

The worker is **not provisioned by default**. The stack's
`deploy_slack_import_worker` Pulumi config defaults to `false`, so initial
previews/deployments can create the queues and DSS upload policy without looking
up a not-yet-provisioned worker Doppler secret. This is a deployment gate, separate
from the runtime `SLACK_IMPORT_ENABLED` intake flag.

1. Apply the Slack import schema migrations and deploy the scoped search backfill
   API/index changes first. The stack reads `searchProcessingServiceUrl` from
   `macro-inc/search-processing-service/<env>`. This is the **processing** API at
   `/search-processing`, not the search query service used by `SearchServiceClient`.
2. Register the `slack-import-worker` Doppler project/configs for dev and prod and
   configure the existing ECS sync convention to AWS Secrets Manager:
   `/doppler-sync/slack-import-worker/<env>/doppler`.
3. Register these exact keys in each sync's JSON, with raw configuration values
   (not names of other Secrets Manager secrets):

   | Key | Initial value |
   | --- | --- |
   | `DATABASE_URL` | Environment's MacroDB proxy URL with the worker's database access |
   | `INTERNAL_API_KEY` | Same raw internal auth credential accepted by search-processing's backfill API |
   | `SLACK_IMPORT_ENABLED` | `false` |
   | `SLACK_IMPORT_CONCURRENCY` | `1` |

   ECS selects these JSON keys individually using the shared Doppler execution
   role. It intentionally does **not** inject `APP_SECRETS_JSON`: MacroConfig
   prioritizes that JSON over plain env vars and would shadow infrastructure
   wiring. Updating Doppler alone does not update a running task's environment;
   restart/deploy the worker to pick up changes.
4. Infrastructure supplies `ENVIRONMENT`, `UPLOAD_STAGING_BUCKET` (bulk-upload's
   bucket output), `OVERRIDE_SLACK_IMPORT_QUEUE`, `OVERRIDE_SLACK_IMPORT_DLQ`,
   `OVERRIDE_CONNECTION_GATEWAY_URL`, `OVERRIDE_SEARCH_PROCESSING_SERVICE_URL`,
   `DD_SERVICE`, `DD_ENV`, and `SLACK_IMPORT_JOIN_EMAIL_ENABLED`.
   `SLACK_IMPORT_JOIN_EMAIL_ENABLED` comes from the stack config key
   `slack_import_join_email_enabled`, which defaults to false. Leave that key
   out of the Doppler sync. A missing Doppler key fails task start. The task
   definition sets the value from stack config. Document/register the
   infrastructure-supplied names in Doppler's service configuration inventory,
   but do not add competing overrides. There is no `SEARCH_SERVICE_URL`
   dependency. No Slack OAuth/bot credentials are needed.
5. Ensure private-subnet egress can reach MacroDB, AWS endpoints and the gateway.
   The task role receives the `SlackImportQueue` worker policy only. That policy
   allows reading Slack staging objects, operating the import main queue and DLQ,
   and `sqs:SendMessage` on the notification ingress queue. The task role does
   not inherit DSS's permissions. The execution role reads the worker's Doppler
   sync, not the task role.

No remote secrets are created by the source change itself. After completing the
above prerequisites, opt in from `infra/stacks/cloud-storage-service/`:

```sh
pulumi config set deploy_slack_import_worker true --stack <dev-or-prod>
pulumi preview --stack <dev-or-prod>
```

Deploy the reviewed change through the normal deployment workflow. Once the
worker is deployed, keep this gate enabled: setting it to false removes its ECS
service and associated resources. Pause intake with `SLACK_IMPORT_ENABLED=false`
instead, so maintenance and DLQ reconciliation continue.

## Rollout values and checks

- When provisioned, desired count: **1**; concurrency: **1** (runtime rejects values above 2).
- Task: **1024 CPU units / 2048 MiB**. Worker hard limit: 1536 MiB; log router:
  128 MiB; Datadog: 384 MiB. Do not allocate the full task budget to the worker.
- Worker stop timeout: **120 seconds**. SIGTERM stops intake and drains work.
- Main queue: `slack-import-queue-<env>`; visibility: **900 seconds**; redrive
  after **5 receives** to `slack-import-dlq-<env>`; DLQ retention: **14 days**.
  These match `macro_queues::SlackImportQueue` / `SlackImportDlq`.
- Keep UI/import admission gated while verifying permissions, search publication,
  a small synthetic import, cancellation, worker restart and DLQ reconciliation.
  Then set `SLACK_IMPORT_ENABLED=true` and redeploy the worker before opening
  admission. This flag pauses claims/outbox sends, **not** maintenance/DLQ
  reconciliation; even paused tasks require working DB/queue/search configuration.
- Colleague join email stays off until you set
  `slack_import_join_email_enabled`. From `infra/stacks/cloud-storage-service/`,
  set the stack config, then deploy that stack through the normal deployment
  workflow:

  ```sh
  pulumi config set cloud-storage-service:slack_import_join_email_enabled true --stack <dev-or-prod>
  ```

  The `sqs:SendMessage` grant on the notification ingress queue is already on
  the worker policy. The config key only changes `SLACK_IMPORT_JOIN_EMAIL_ENABLED`
  in the task definition.
- Monitor ECS deployment failure alarms, task OOM/restarts, queue age, the existing
  DLQ alarm, import leases and search receipts. Pause admission and set the worker
  flag false to stop new imports; do not purge queues or delete imported data.

## Local execution (explicit opt-in)

Start a local stack using [the local guide](../../../docs/RUNNING_LOCALLY.md),
never `run_dev` or a shared-dev environment. The inventory deliberately excludes
this worker from default builds/startup. Local provisioning creates both queues
and reapplies visibility/redrive/retention settings after all queues exist.
Existing queues do not need to be deleted. There is no staging S3 event trigger.

For the default `macro` instance, put `SLACK_IMPORT_ENABLED=true` and
`SLACK_IMPORT_CONCURRENCY=1` in an untracked env file, then start with
`just run_local --no-doppler --env-file <file>`. Once that stack is ready, run
from the repository root in another terminal:

```sh
export MACRO_ENV_FILE="$PWD/infra/local/generated/macro/local.generated.env"
docker compose --project-directory . -p macro \
  -f docker/docker-compose.yml \
  -f infra/local/generated/macro/docker-compose.override.yml \
  --env-file "$MACRO_ENV_FILE" --profile slack-import \
  up -d --build --no-deps slack_import_worker
```

The opt-in image builds `slack_import_worker` using the shared Dockerfile. For a
named instance use its generated directory and Compose project name
`macro-<instance>` instead. The already-running local stack supplies Postgres,
LocalStack, connection-gateway and search-processing; `--no-deps` avoids rebuilding
or restarting them. Stop this worker before stopping the rest of the stack.

Local env wiring uses `bulk-upload-staging`, full LocalStack queue URL overrides,
`http://connection-gateway:8080`, and
`http://search-processing-service:8080`. The local `INTERNAL_API_KEY` matches
search-processing's internal auth key. The default worker flag is false unless
explicitly overridden. `SLACK_IMPORT_JOIN_EMAIL_ENABLED` also defaults to false
unless the env file sets it to `true`. Do not inject a deployed
`APP_SECRETS_JSON` locally.
