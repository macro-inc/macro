# observability

## What it is

The Ohio (us-east-2) GoAlert host: GoAlert with its Postgres, nginx for
`oncall.macro-internal.com`, the Macro Alerts relay, and Alloy and the
CloudWatch agent for its own health, on one NixOS EC2 instance separate from
production in us-east-1. It also owns the ALB, certificate, DNS and the two
buckets the observability cluster (`infra/k8s/observability`) runs Grafana,
Loki, Tempo, Mimir and OTLP ingest behind. `README.md` is the full operations
guide.

## Start here

- `nixos/host.nix`: boot order, retained volume, stable uids, service hardening.
- `nixos/goalert.nix`, `nixos/proxy.nix`, `nixos/host-telemetry.nix`: the
  systemd services and their credentials.
- `nixos/grafana-provisioning/`: every dashboard, alert rule, contact point and
  datasource as plain Nix data (`default.nix`). Only the cluster's Grafana
  imports it, with `nixos/grafana.nix`, `nixos/backend-config.nix` and
  `nixos/ingest.alloy`; the host's image reads none of them.
- `index.ts`: VPC, ALB, certificate, DNS, alarms, the host role and EC2 user data.
- `deploy/`: the Deploy Observability workflow's steps (`release.ts`), the image
  source key, AMI publishing, the smoke boot and the plan check. README
  "Deploying" describes them.

## Recipes

Paths below `grafana-provisioning/` are under `nixos/`.

- Change a Grafana prod alert rule: edit its entry in
  `grafana-provisioning/prod-alerts.nix` (rules and the `Prod alerts` dashboard
  panel both read it), and its Datadog copy in
  `infra/stacks/monitoring/monitors/` by hand. A new entry takes the next free
  `panelId`; never renumber one, since sent notifications link to it.
- Change the Macro computers fleet dashboard
  (`grafana-provisioning/computers-dashboard.nix`) or the Firecracker hosts:
  capacity one (`grafana-provisioning/firecracker-capacity-dashboard.nix`).
  Their series come from Alloy on each Firecracker host
  (`nix/hosts/_nixos/firecracker-host.alloy`); rename a label there and in both
  together.
- Change an Email Focus rollout check: edit `grafana-provisioning/email-focus.nix`;
  its rules and the `Email Focus rollout` dashboard both read it. No Datadog copy.
- Change a CI percentile, queue or CI hours query: edit
  `grafana-provisioning/ci-report.json`; the `Macro CI` dashboard's Loki panels
  and `scripts/ci-report.ts` both read it.
- Change a run_local query: edit `grafana-provisioning/local-report.json`, read
  by the `Macro run_local` dashboard and `scripts/ci-report.ts --spec local`.
  Both dashboards share their Loki panel builders in
  `grafana-provisioning/loki-report-panels.nix`.
- Add a dashboard: a file in `grafana-provisioning/` taking `{ lib }` and
  returning the dashboard JSON, listed in `dashboards` in its `default.nix`.
- Anything Grafana provisions that depends on where Grafana runs (an address, a
  URL) is a parameter of `grafana-provisioning/default.nix`, passed by the
  cluster's Grafana module; never a value written into the data.
- A Grafana change ships with the cluster, not the host: it needs no AMI and no
  Deploy Observability run (`NOT_IMAGE_INPUTS` in `deploy/image-key.ts`).
- Add a runtime setting: `settings.ts` → `render.ts` (bump the schema version) →
  `nixos/read-user-data.py` (keys, pattern, version) → the consuming `.nix` file.
- Add a host secret: `assets/refresh-secrets.py` (validation) → `LoadCredential`
  in the unit → README secret list, and `smokeSecret` in `deploy/smoke.ts`. Add
  the unit to `secretConsumers` in `host.nix`. Keys only the cluster reads stay
  in the secret but out of `refresh-secrets.py`.
- Upgrade GoAlert: bump `version` and the hashes in `nixos/goalert/package.nix`.
- Ship a host change: merge it, then run **Deploy Observability** from `main`, a
  dry run first. Pulumi picks the AMI by the source-hash tag; there is no `amiId`.
- A new file the image reads must sit under `flake.nix`, `flake.lock`, `nixos/`
  or `assets/`, outside `NOT_IMAGE_INPUTS` (`deploy/image-key.ts`); the key test
  fails otherwise.
- A new host unit goes in `UNITS` (`deploy/smoke.ts`) and the README's
  `systemctl status` line; `deploy/deploy.test.ts` checks both against
  `host.nix` `services`.
- A new kind of smoke resource needs its delete in `cleanupSmoke` (`deploy/smoke.ts`);
  `deploy/deploy.test.ts` fails on a create without one.

## Checks

From this directory:
- `nix build --dry-run .#nixosConfigurations.observability.config.system.build.toplevel`
- `nix fmt -- <changed .nix files>`; `python3 -m py_compile` on changed Python.
- `python3 -m unittest test_macro_alerts_relay` from `nixos/goalert/` when the
  relay's channel post format changes.

From `infra/`: `bun run check` (includes `bun test stacks/observability/deploy`),
then Biome on changed `.ts`.

## Gotchas

- Changes ship only through the Deploy Observability workflow, which replaces the
  host and takes GoAlert down for several minutes. Never run it, `pulumi up` or
  publish an image without explicit permission.
- `nixos/backend-config.nix` also sets the EKS cluster's Loki, Tempo and Mimir
  (`infra/k8s/observability/cluster/modules/backends/`). After changing it, run
  `nix run .#render` in `infra/k8s/observability/cluster` and commit the result too.
- A plan that changes anything besides the instance, its attachments and its
  alarms, such as the host role's policy, is refused by the workflow and needs a
  reviewed, targeted manual `pulumi up` (README, "Deploying").
- Never deploy an image from before the GoAlert-only change while the cluster's
  Loki and Tempo write the host's buckets: it starts its own on them. README,
  "Going back to the full host".
- `pulumi preview` fails until an AMI is tagged for this checkout's image source;
  a dry run of the workflow builds and tags one.
- The host reads secrets from the stack's own Secrets Manager secret in
  us-east-2, so it never depends on production to boot. Doppler
  `observability/prd` holds the values; copy changes into the secret. The
  cluster reads the same secret for its own keys.
- A service listed in `host.nix` `services` gets `ProtectSystem=strict`, metadata
  blocking and the bootstrap dependency; one that needs the instance role must be
  in the `IPAddressDeny` exception list or run as its own unit.
- `host.nix` `dataUsers` uids own data on the retained volume; never reuse a
  removed service's uid.
- GoAlert's application config lives in its database; `goalert/apply-config.py`
  overwrites it on every start from `goalert.nix`. `set-config` accepts invalid
  values silently, so check the journal for `validate config`.
- Grafana keeps a provisioned contact point removed from
  `grafana-provisioning/alerting.nix`; list its uid in `deleteContactPoints` to
  delete it.
- Grafana provisioning expands `$VAR` in contact point settings, but not in rule
  queries or annotations, so `$B` and `$values` work there and secrets must come
  in through Grafana's environment.
- The cluster renders from `nixos/grafana.nix`, `nixos/grafana-provisioning/`
  and `nixos/ingest.alloy`: after changing them, run `nix run .#render` in
  `infra/k8s/observability/cluster` and commit its manifests, or its CI fails.
- Host Alloy's metrics carry `job="integrations/unix"` and `integrations/self`,
  not the scrapes' `job_name`: Alloy's exporters set `job` on their targets.
