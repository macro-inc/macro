# Infrastructure

Macro's AWS infrastructure is Pulumi in TypeScript under `infra/`, run with Bun,
in `us-east-1`; the observability pilot (`infra/stacks/observability`) runs in
`us-east-2`. Cloudflare Workers deploy with `wrangler`, not Pulumi. This
guide covers how the code is laid out, the patterns to copy, how deploys happen,
and the traps. To add a whole service, follow the
[new service guide](../guides/new-service.md).

> **Agents never deploy.** Do not run `pulumi up`, `pulumi destroy`,
> `wrangler deploy`, `wrangler secret put`, or a deploy workflow dispatch unless the
> user explicitly asks for that deploy in this conversation. Preparing a change,
> "wiring it up", or bootstrapping is not permission. `pulumi preview` is fine.

## Layout

| Path | Contents |
| --- | --- |
| `infra/stacks/<name>/` | One Pulumi project per directory. `Pulumi.yaml` plus `Pulumi.dev.yaml` / `Pulumi.prod.yaml`. |
| `infra/packages/shared` | Constants, config singletons, typed stack references, gateway priorities, Doppler, service URLs. |
| `infra/packages/resources` | Reusable components: ALB, target group, queue, RDS, Redis, DynamoDB, Kafka, buckets, Datadog sidecars, alarms. |
| `infra/packages/service` | `EcrImage`, least-privilege DynamoDB, cluster stack reference. |
| `infra/packages/lambda` | `Lambda` component and `WorkerTrigger`. |
| `infra/packages/vpc` | IDs of the one VPC everything runs in (`get_coparse_api_vpc()`). |

Stacks are `macro-inc/dev` and `macro-inc/prod`; a few are prod-only
(`monitoring`, `doppler-projects`) or dev-only (`github-runners`,
`web-app-preview`). The project name is usually the directory name. It matters:
Doppler, `services-config.json`, and the nix `serviceName` all key on it.

### Stack references

Stacks read each other's outputs as `macro-inc/<project>/${stack}`, so dev only
ever reads dev. Use the typed helpers in `packages/shared` rather than a raw
`StackReference`:

- `getGatewayAlb()` for the shared gateway ALB and HTTPS listener.
- `document-storage` outputs the shared ECS cluster (`cloudStorageClusterArn`);
  `packages/service/src/cluster.ts` wraps it.
- `getKafkaClusterPolicy()`, `getMacroNotify()`, `getSearchEventQueue()`,
  `getAiToolsInfra()`, and similar for other shared resources.

The first argument to `StackReference` is a logical name that must be unique in
the program; prefix it when a helper and its caller reference the same stack.
References imply deploy order, so a new reference can create a bootstrap cycle.

## The current ECS service pattern

Copy `infra/stacks/calendar-service/` or `infra/stacks/lexical-service/`. There is
no generic service component; each stack defines a small `ComponentResource` that
composes these pieces:

1. **Task role** with only the policies the service needs: `GetSecretValue` on the
   specific secret ARNs, SQS on specific queues, `getKafkaClusterPolicy()`.
2. **Image** with `EcrImage` (`docker/Dockerfile`, build arg `SERVICE_NAME`). CI
   swaps in the prebuilt Dockerfile that copies nix-built binaries; a new
   Dockerfile must be added to that map in `packages/service/src/ecr.ts`.
3. **Gateway routing** with `ServiceTargetGroup({ service: GatewayService.X,
   pathPatterns: ['/<prefix>', '/<prefix>/*'] })` on `getGatewayAlb()`.
4. **Secrets** with `DopplerEcsEnvironment(pulumi.getProject())`: an execution role
   plus one container secret, `APP_SECRETS_JSON`.
5. **Service** with `awsx.ecs.FargateService`: private subnets, the deployment
   circuit breaker with rollback, `continueBeforeSteadyState:
   DEFAULT_CONTINUE_BEFORE_STEADY_STATE`, containers `log_router`
   (`fargateLogRouterSidecarContainer`), `datadog_agent`
   (`datadogAgentContainer`), and the service, and `dependsOn` the target group's
   listener rule (ECS rejects a target group not yet attached to a listener).
6. **Autoscaling** on ALB requests per target, CPU, and memory.
7. **Alarms**: `EcsDeploymentFailureAlarm` plus CPU, memory, and target 5xx,
   routed to `CLOUD_TRAIL_SNS_TOPIC_ARN`.

Health checks, deregistration delay, and steady-state behaviour come from
`packages/resources/src/resources/ecs_deployment_defaults.ts`. The container
listens on `8080` and serves `GET /health`.

A worker with no port (SQS or Kafka consumer) follows
`infra/stacks/cloud-storage-service/slack-import-worker.ts`: no target group, an
egress-only security group, explicit CPU and memory, and a longer `stopTimeout`.

## Gateway routing

`gateway.macro.com` (`dev-gateway.macro.com` in dev) is one ALB owned by the
`gateway` stack. Services attach to its HTTPS listener with path rules.

- Rule priorities live only in `GATEWAY_PRIORITIES`
  (`packages/shared/src/gateway_priorities.ts`). Add a `GatewayService` member and
  a unique priority there; duplicates throw at load time.
- The ALB matches the lowest priority number first. A broad prefix with a lower
  number shadows yours: calendar's `/calendar` was swallowed by email-service
  until its priority was fixed.
- The ALB forwards the path unchanged, so the Rust router must also mount under
  `/<prefix>` (see `services/calendar_service/src/api.rs`).
- ALB and target group names are capped at 32 characters, including the `-tg`
  suffix.

## Secrets and configuration

How values reach code is covered by the
[config rule](../../.agents/rules/config-and-service-urls.md). For infrastructure
specifically:

- **Doppler is the source.** `infra/stacks/doppler-projects` creates one project per
  service with `lcl`, `dev`, and `prd` environments, synced to Secrets Manager at
  `/doppler-sync/<project>/<dev|prod>`. Add the service to `SERVICE_NAMES`, using
  the Pulumi project name.
- **`MacroConfig` reads only `APP_SECRETS_JSON` in ECS.** A plain container
  `environment:` entry is invisible to it. Put values that infra produces (ARNs,
  endpoints) into Doppler with a Pulumi `doppler.Secret`, as
  `infra/stacks/preview-gateway` does. Plain `environment:` is for `ENVIRONMENT`,
  `DD_*`, and values read through `macro_env_var` or `OVERRIDE_*`.
- **Secrets go in Doppler, not Secrets Manager.** Add the value to the service's
  Doppler project; it reaches the task through `DopplerEcsEnvironment` and the
  `/doppler-sync/` sync. Creating standalone Secrets Manager secrets, putting their
  names in Pulumi config, and resolving them with
  `aws.secretsmanager.getSecretVersionOutput(...)` is the old pattern; older stacks
  still do it, don't copy them. Use `secure:` config only for the few values that
  must live in Pulumi itself.
- Never resolve `secretString` into a plaintext env var.

## Embedded build assets

Deployment builds use the filtered source in `nix/cloud-storage.nix`, rather than
an entire checkout. Include any new `include_str!` or `include_bytes!` assets in
its source filter. The `code-execution-assets` Nix check verifies that the Deno
bootstrap, SDK and Handlebars bundles survive both the workspace filter and the
pruned agent-harness deployment source; Rust CI runs this check before clippy.
Run it locally with `nix build --no-link .#checks.x86_64-linux.code-execution-assets`.

## Other resources

| Need | Use | Example |
| --- | --- | --- |
| SQS queue + DLQ + alarms | `Queue` (`packages/resources`) named to match the `macro_queues` constant | `calendar-service/index.ts` |
| Kafka topic | Add to `crates/macro_event_topics`, run `cargo x kafka-topics`; never hand-edit `.github/kafka-cluster-topics.json` | `kafka-cluster/topics.ts` |
| Kafka access | `getKafkaClusterPolicy()` on the task role, brokers from `bootstrapBrokersSaslIam` | `calendar-service/service.ts` |
| Lambda | `Lambda` (`packages/lambda`), binary listed under `deploy_lambdas` | `deleted-item-poller/lambda.ts` |
| Redis | `Redis` (`packages/resources`) | `calendar-service/index.ts` |
| DynamoDB | `ServiceDynamoDBTable` (least privilege), not `DynamoDBTable` (`dynamodb:*`) | `packages/service/src/dynamodb.ts` |
| Bucket | `createBucketV2` | `packages/resources/src/resources/bucket.ts` |
| Datadog monitor | `infra/stacks/monitoring` (prod only, manual deploy) | `monitoring/monitors/ai-editing.ts` |

When you add a prod queue or bucket, also add it to the local catalog in
`tooling/xtask/crates/xtask_local/src/local/resources.rs`; Pulumi does not create
local resources.

## Conventions

- Name resources `${BASE_NAME}-<thing>-${stack}` with `BASE_NAME =
  pulumi.getProject()`. Component type tokens are `my:components:<Name>`.
- Pass the stack's `tags` object (`environment`, `tech_lead`, `project`) to every
  resource; there are no default tags.
- Inside components, pass `{ parent: this }`.
- `protect` stateful or adopted resources (MacroDB, KMS keys, WAF, Kafka in prod).
  Turning off a `deploy_*` config gate destroys what it guarded.
- Remove `import:` options after adopting a resource, or the next run replaces it.
- Format with Biome; `infra/biome.jsonc` excludes files uploaded verbatim.

## Deploys

| Trigger | What runs |
| --- | --- |
| Push to `main` | `deploy_on_push.yml`: builds nix binaries and Lambdas, runs migrations on the in-VPC runner, then `pulumi up` on dev for every service in `.github/services-config.json` |
| Published GitHub release | `release-production.yml`: the same flow against prod, then workers, website, and web app |
| Pull request touching a mapped stack | `pulumi_preview_pr.yml` previews against dev and comments; `code_check_infra.yml` runs Biome and `tsc` |
| Manual | `deploy-pulumi-stack.yml`, `deploy-service-generic.yml`, `migrate-macro-db.yml` |

- Only stacks listed in `services-config.json` deploy automatically. `gateway`,
  `macrodb`, `doppler-projects`, `monitoring`, and a few others are manual.
- Services marked `bootstrap_pending` or `deploy_enabled: false` are skipped.
- **Migrations deploy before services** and must work with the code already
  running ([database guide](database.md)).
- `continueBeforeSteadyState` means a green deploy job does not prove old tasks
  stopped. The circuit breaker rolls back failed deployments; otherwise roll
  forward or redeploy an older ref.

## Legacy patterns not to copy

- Per-service ALBs via `serviceLoadBalancer()` (auth, document cognition, MCP,
  static files). New HTTP services go on the gateway.
- Raw `aws.sqs.Queue` instead of `Queue`; `createImage`; `createServiceRole`
  (grants `dynamodb:*`).
- Lambda env vars holding resolved secret values.
- `web-app` and `website` pin `@pulumi/aws` v6. `bun run check` checks the
  web-app in its separate TypeScript project, then runs the backend-free
  web-delivery regressions in separate Bun processes.

For web bundle publication order, asset/error cache policies, and backend-free
checks, see [web-app delivery](../../infra/stacks/web-app/README.md) and
[the website CDN](../../infra/stacks/website/README.md#app-cache-policy).

Stale docs to treat with suspicion: `SLACK_IMPORT_ROLLOUT.md` (the worker is on
and receives `APP_SECRETS_JSON` now), `fusion-auth/README.md`.

## Agent backend

`agent-harness-service` is the only ECS agent service. Its process also owns
chat/completions, workspace MCP/OAuth, preview SSH/HTTP/control, routine cron
and event workers, and projection refresh sweeps. `preview-gateway` retains
only networking, and `document-cognition` retains the projection queue and
public DNS record. `mcp-server` retains its public DNS record. Both hostnames
point at the shared gateway, preserving public URLs and OAuth callbacks. The
retired MCP and schedule stack programs contain no compute resources. Follow
[the cutover guide](../guides/consolidate-agent-services.md) before deployment;
old listener rules must be retired before the harness claims their priorities.
