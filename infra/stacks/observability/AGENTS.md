# observability

## What it is

The Ohio (us-east-2) Grafana host: Grafana, Loki, Tempo, Prometheus, Alloy and
the GoAlert on-call pager on one NixOS EC2 instance, separate from production in
us-east-1. `README.md` is the full operations guide.

## Start here

- `nixos/host.nix`: boot order, retained volume, stable uids, service hardening.
- `nixos/services.nix`, `nixos/goalert.nix`: the systemd services and credentials.
- `index.ts`: VPC, ALB, certificate, DNS, alarms and EC2 user data.

## Recipes

- Change a Grafana prod alert rule: edit its entry in `nixos/prod-alerts.nix`
  (rules and the `Prod alerts` dashboard panel both read it), and its Datadog
  copy in `infra/stacks/monitoring/monitors/` by hand. A new entry takes the next
  free `panelId`; never renumber one, since sent notifications link to it.
- Add a runtime setting: `settings.ts` → `render.ts` (bump the schema version) →
  `nixos/read-user-data.py` (keys, pattern, version) → the consuming `.nix` file.
- Add a secret: `assets/refresh-secrets.py` (validation) → `LoadCredential` in
  the unit → README secret list. Add the unit to `secretConsumers` in `host.nix`.
- Upgrade GoAlert: bump `version` and the hashes in `nixos/goalert/package.nix`.

## Checks

From this directory:
- `nix build --dry-run .#nixosConfigurations.observability.config.system.build.toplevel`
- `nix fmt -- <changed .nix files>`; `python3 -m py_compile` on changed Python.

From `infra/`: `bun run check`, then Biome on changed `.ts`.

## Gotchas

- Changes ship only as a new AMI plus an approved deploy; never `pulumi up` or
  publish an image without explicit permission.
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
