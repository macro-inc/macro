# Consolidate agent services

`agent_harness_service` is the sole agent process and ECS service. It hosts the
existing session API, cognition APIs, public workspace MCP and OAuth, routine
scheduling, preview control/public HTTP/SSH, and projection refresh sweeps.
Connection gateway remains the app-wide realtime service.

The browser API prefixes stay `/agent-harness`, `/cognition`,
`/scheduled-action`, `/preview`, and `/mcp`. Session egress keeps its separate
listener and `/agent-harness-egress` prefix. Preview public HTTP (8111) and SSH
(2222) are listeners in the same process, preserving the isolated preview
browser domain. The main API port is 8101 in ECS and 8080 inside local Compose.

Deploy two tasks in both environments, with overlapping rolling replacements.
Preview ownership, replica heartbeats, and credential hashes are stored in
Postgres. The task accepting SSH owns that tunnel; browser HTTP/WebSocket
requests arriving on another task stream directly to the owner's private HTTP
endpoint. Keep security-group self-ingress on TCP 8111. Live SSH tunnels remain
local to their owner; replacing that owner can close its active previews.

## Configuration

Configure encrypted `doppler:dopplerToken` in the harness Pulumi stack for the
chosen environment before previewing or deploying it. The preview stack's
provider credential does not transfer automatically between stacks.

Every config is loaded at startup from the harness's `APP_SECRETS_JSON`.
The harness Doppler validation binary validates the harness, cognition,
scheduling, and preview config structs against the same project.

Merge the old projects without logging their values:

```sh
python tooling/scripts/consolidate-agent-config.py --config dev
python tooling/scripts/consolidate-agent-config.py --config dev --apply
```

The same script accepts `--config prd` for an explicitly authorized production
cutover. It keeps existing harness keys, including explicit empty values, fills missing integration values,
and preserves the original public MCP and integration callback origins.
It restores the existing Pipedream webhook URL from the cognition config, including
its secret query parameter. Public URLs do not change when the process moves.
Preserve the preview SSH host key and MCP credential encryption key; replacing
them breaks pinned clients and stored credentials.
The cognition CloudFront signer setting must retain its Secrets Manager
reference, replacing any obsolete inline harness value under that name. The
AI tool context uses the separate `_SECRET_NAME` setting for the same key.

Stable public origins now come from `macro_service_urls`: `McpPublicUrl` is the
original `https://mcp-server[-dev].macro.com` server base and `CognitionPublicUrl`
is the original `https://document-cognition[-dev].macro.com` integration callback
base. Keep these distinct from internal gateway API routes. The shared gateway
forwards MCP paths unchanged and prepends `/cognition` for the cognition host;
registered OAuth redirects and browser URLs are unchanged.

`AppServiceUrl` supplies browser links and preview form origins. Preview control
uses the host of `PreviewGatewayUrl`; local instances also accept their app and
loopback hosts. Local instance generation supplies process-level
`OVERRIDE_MCP_PUBLIC_URL`, `OVERRIDE_COGNITION_PUBLIC_URL`, and
`OVERRIDE_APP_SERVICE_URL`. `PREVIEW_DOMAIN` and `PREVIEW_SSH_HOST` remain in
Doppler because infrastructure generates them.

The Pulumi stack temporarily retains the old `MCP_PUBLIC_URL`,
`MCP_CLIENT_PUBLIC_URL`, `PREVIEW_APP_ORIGIN`, and `PREVIEW_CONTROL_HOSTS`
resources with frozen values and `retainOnDelete`. This allows automatic ECS
rollback to the previous image, which still requires these keys. New binaries
ignore them. After the new version is the rollback baseline in both environments,
remove those compatibility resource declarations; do not delete the retained
Doppler values while historical-image rollback is still needed. `APP_BASE_URL`
is also ignored by the new harness; other services may still consume it.

`POSTHOG_API_KEY` and `POSTHOG_HOST` are already typed harness fields. They
drive feature flags and the public MCP and integration analytics; when the key
is unset, analytics are off.

## Prepare preview stack outputs

Harness previews require the preview network IDs to be published first. The
replicated preview deployment publishes these outputs during its normal deploy.
If the existing deployment does not have them yet, prepare an update that adds
only these exports, retaining its current compute and networking:

```ts
export const previewTaskSecurityGroupId = taskSg.id;
export const previewControlTargetGroupArn = control.target_group.arn;
export const previewHttpTargetGroupArn = httpTarget.arn;
export const previewSshTargetGroupArn = sshTarget.arn;
```

Preview an update targeting only the preview stack's root Stack resource and
save its plan. Verify that every resource operation is unchanged before applying
that exact plan with the same target. This publishes stack metadata and still
requires explicit deployment approval. Apply the network-only program during
the coordinated cutover below.

## Deployment cutover

This code does not stop or remove currently deployed resources by itself.
Perform the following only as an explicitly authorized deployment, in a
maintenance window:

1. Merge and validate the destination Doppler configuration for the chosen
   environment. Wait for the Doppler Secrets Manager sync to include the new
   keys in `APP_SECRETS_JSON`; writing Doppler is not proof that its sync has
   completed. Preserve the existing public MCP and integration callback origins.
   Slack and FusionAuth keep their existing redirect URLs; this cutover does not
   require editing their allowlists. Confirm the shared gateway listener uses
   the existing wildcard certificate for the original hostnames.
   Apply additive migration `20261021205701_agent_preview_replication.sql`
   before starting the combined process.
2. Pause deployments for the chosen environment, cancel queued deployments,
   and wait for running deployments to finish. Disabling future triggers does
   not clear queued runs. In dev, every main push deploys all enabled services;
   workflow concurrency does not
   serialize manual Pulumi updates. An older deployment can restore retired
   services or overwrite the combined harness. Keep deployments paused until
   the deployed resources and merged source agree.
3. Prepare an isolated staging checkout of this change. Temporarily omit the
   harness's three `sharedApiRules` and their `dependsOn` entries, and omit
   its preview control/HTTP/SSH target-group attachments. Keep the existing
   API/egress attachments, preview security group, two replicas, and rolling
   replacements. Preview and apply this staged harness while the old feature
   services remain live. Explicitly wait for two healthy combined tasks:
   `continueBeforeSteadyState` means Pulumi completion alone is insufficient.
   After an ECS rollback, verify and restore the full service configuration,
   including both security groups and all intended target attachments; retrying
   only the task definition can leave preview ingress blocked.
4. In that checkout, restore the three feature rules with their final logical
   resource names, temporarily using verified unused priorities numerically
   lower than the old rules. Keep preview target attachments omitted. Preview
   and apply this routing update only after the combined tasks are healthy.
   The new rules transfer gateway traffic to those tasks while the old rules
   and services still exist. Verify authenticated requests through each prefix.
5. Before retiring any old public endpoint, test both original hostnames against
   the gateway with `curl --connect-to`, preserving their Host header and TLS SNI.
   Verify cognition callbacks preserve query parameters and MCP discovery still
   advertises the original issuer. Make a separate DNS-handoff checkout from
   the currently deployed pre-retirement source. In each old service component,
   change only the existing Route53 alias destination from its ALB to
   `gatewayLoadBalancer.albDnsName` / `gatewayLoadBalancer.albZoneId`. Keep every
   old resource declaration, parent and name. Supply any old Lambda build
   artifacts needed for evaluation from the deployed version; do not invoke or
   update those functions. Target only that existing record
   and its existing `gateway-stack` StackReference. Save and inspect these
   plans: each DNS record must update in place, and no old compute or ALB may be
   changed or deleted. Do not use the final retirement program for this targeted
   step: omitted resources can cause Pulumi to demand their deletion. Apply
   those exact DNS-only plans, wait at least two observed DNS TTLs, and verify
   the original URLs through normal DNS before applying the retirement programs.
6. In the old-source cognition checkout, preview a targeted
   `pulumi destroy --target <refresh-lambda-urn> --target-dependents --preview-only`.
   Verify
   that it deletes only the refresh function, its invocation permissions and
   EventBridge targets, and its alarms. Keep the execution role, EC2 cleanup
   permissions, and Lambda security group. Repeat without `--preview-only`,
   then wait for its VPC network interfaces to disappear before removing the
   role or security group. Do not run the old program again after this deletion:
   it would recreate the function. See [AWS VPC cleanup guidance](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).
   Apply the retired MCP, scheduler, and cognition stack programs, retaining
   the projection queue and DLQ. The temporary harness rules continue serving
   traffic. Do not destroy the shared gateway or database.
7. Apply network-only `preview-gateway`, removing its ECS task while retaining
   the domain, certificates, HTTPS/SSH load balancers, security group, and target
   groups. Preserve the control target group's default port to avoid replacing
   it. Wait for the old preview service and its target registrations to drain
   before attaching those target groups to the harness. Preview downtime is
   expected during this handoff.
8. Preview and apply the final source, restoring the harness rules' intended
   priorities and attaching all three existing preview target groups. ECS
   registers preview control targets on API port 8101 using an explicit port
   override; health checks use that port. Verify the saved plan updates the
   existing rules and target groups without replacing them. Wait for two
   healthy harness tasks and all five target groups to be healthy.
9. Check OAuth discovery and authentication, chat/completions, routine
   dispatch, and a complete preview SSH/browser handoff. Verify tracing across
   the shared HTTP boundaries and confirm no retired agent ECS service or
   refresh Lambda remains. Merge the final source and resume deployments.
   For dev, re-enable `Deploy on Push` and dispatch `Deploy All Services` on
   merged `main` with `environment=dev`; pushes made while paused are not replayed.

Retain the final logical rule names throughout staging so temporary priorities
update in place. ALB priorities are unique: do not apply the final priorities
until the old rules are removed. Preserve resource-only stacks rather than
recreating durable queues or preview DNS/certificates in another stack.

The original cognition and MCP DNS records remain in their resource-only stacks
and point at the shared gateway. Their old ALBs, tasks, and task definitions are
retired after DNS drains. No public client URL or OAuth allowlist change is needed.

Automatic deployment of the consolidated service requires this one-time
cutover first. Do not merge and rely on an unordered parallel deployment to
retire old rules while creating their replacements.

## Rollback during the cutover

Save the deployed source revisions, task definitions, listener rules, and an
encrypted export of each affected Pulumi stack before applying changes.
Copy each running service image by digest into the existing harness ECR
repository under a unique rollback tag, including the previous harness image,
and verify each destination digest. Old repositories use `forceDelete`, so
their tags are not a rollback backup. Save the deployed refresh Lambda ZIP and
archive non-empty CloudWatch log groups or retain them in AWS before retirement.
For retention, set `retainOnDelete` on all six existing log-group resources
after the DNS handoff and verify it in fresh stack exports immediately before
retirement. An intervening update from the old source can reset that metadata.
Verify the groups remain after retirement; their existing retention periods apply.

For the hostname handoff, restore the saved DNS aliases to the old ALBs while
those endpoints are still healthy, and wait for DNS caches to expire before
removing the gateway host rules. After old ALB retirement, restore its saved
stack before pointing DNS back.

If the staged harness cannot become healthy, leave the old feature routes and
services in place and restore the previous harness revision. If a feature route
fails after the temporary rules take precedence, remove those temporary rules
while the old services are still healthy; their original rules resume serving.
Do not retire old compute until the routed checks pass.

After retiring a service, move the harness rules back to verified unused
temporary priorities if their final priorities have already been applied. Restore
the pre-cutover stack revision, copying preserved images back into recreated
repositories first. Import retained CloudWatch log groups into the restored stack
instead of attempting to create them again. Recreate task definition revisions from the saved definitions
rather than assuming deregistered revisions remain usable. Wait for healthy targets before removing the
temporary harness rules to return traffic.

For previews, first detach the three preview target groups from the harness and
restore their saved health-check configuration, then restore the saved
pre-cutover preview deployment. Live SSH connections that were already closed
must reconnect. Keep automatic deployments paused throughout recovery, and resume
only when the deployed source and the intended routing agree.

## Local verification

The Compose inventory builds only `agent_harness_service` for these agent
features. The proxy forwards the preserved feature prefixes to that container;
preview HTTP and SSH ports are published by it. SDK local port maps and the
web app's direct local URLs use the shared host port with each feature prefix.

Use an isolated, migrated test database and run the affected packages:

```sh
cargo test -p agent_harness_service -p scheduled_action -p mcp_auth_proxy
cargo test -p macro_service_urls -p xtask_local
just check
bun run --cwd infra check
```

The feature implementations and SQL remain in their existing domain/adapters;
only composition, hosting, readiness, and shutdown ownership change. Authorization
continues through each feature's original services and typed access receipts.
