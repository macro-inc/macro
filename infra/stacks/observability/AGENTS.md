# observability

## What it is

The Ohio (us-east-2) Grafana host: Grafana, Loki, Tempo, Prometheus, Alloy and
the GoAlert on-call pager on one NixOS EC2 instance, separate from production in
us-east-1. `README.md` is the full operations guide.

## Start here

- `nixos/host.nix`: boot order, retained volume, stable uids, service hardening.
- `nixos/services.nix`, `nixos/goalert.nix`: the systemd services and credentials.
- `index.ts`: VPC, ALB, certificate, DNS, alarms and EC2 user data.
- `deploy/`: the Deploy Observability workflow's steps (`release.ts`), the image
  source key, AMI publishing, the smoke boot and the plan check. README
  "Deploying" describes them.

## Recipes

- Change a Grafana prod alert rule: edit its entry in `nixos/prod-alerts.nix`
  (rules and the `Prod alerts` dashboard panel both read it), and its Datadog
  copy in `infra/stacks/monitoring/monitors/` by hand. A new entry takes the next
  free `panelId`; never renumber one, since sent notifications link to it.
- Change a CI percentile, queue or CI hours query: edit `nixos/ci-report.json`;
  the `Macro CI` dashboard's Loki panels and `scripts/ci-report.ts` both read it.
- Change a run_local query: edit `nixos/local-report.json`, read by the
  `Macro run_local` dashboard and `scripts/ci-report.ts --spec local`. Both
  dashboards share their Loki panel builders in `nixos/loki-report-panels.nix`.
- Add a runtime setting: `settings.ts` → `render.ts` (bump the schema version) →
  `nixos/read-user-data.py` (keys, pattern, version) → the consuming `.nix` file.
- Add a secret: `assets/refresh-secrets.py` (validation) → `LoadCredential` in
  the unit → README secret list. Add the unit to `secretConsumers` in `host.nix`.
- Upgrade GoAlert: bump `version` and the hashes in `nixos/goalert/package.nix`.
- Ship a host change: merge it, then run **Deploy Observability** from `main`, a
  dry run first. Pulumi picks the AMI by the source-hash tag; there is no `amiId`.
- A new file the image reads must sit under `flake.nix`, `flake.lock`, `nixos/`
  or `assets/` (`deploy/image-key.ts`); the key test fails otherwise.
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
  host and takes Grafana, Loki, Tempo and GoAlert down for several minutes. Never
  run it, `pulumi up` or publish an image without explicit permission.
- A plan that changes anything besides the instance, its attachments and its
  alarms is refused by the workflow and needs a reviewed manual `pulumi up`.
- `pulumi preview` fails until an AMI is tagged for this checkout's image source;
  a dry run of the workflow builds and tags one.
- The host reads secrets from the stack's own Secrets Manager secret in
  us-east-2, so it never depends on production to boot. Doppler
  `observability/prd` holds the values; copy changes into the secret.
- A service listed in `host.nix` `services` gets `ProtectSystem=strict`, metadata
  blocking and the bootstrap dependency; one that needs the instance role must be
  in the `IPAddressDeny` exception list or run as its own unit.
- GoAlert's application config lives in its database; `goalert/apply-config.py`
  overwrites it on every start from `goalert.nix`. `set-config` accepts invalid
  values silently, so check the journal for `validate config`.
- Grafana keeps a provisioned contact point removed from `alerting.nix`; list
  its uid in `deleteContactPoints` to delete it.
- Grafana provisioning expands `$VAR` in contact point settings, but not in rule
  queries or annotations, so `$B` and `$values` work there and secrets must come
  in through the Grafana unit's environment.
