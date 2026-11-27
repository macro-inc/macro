# github-runners stack

## What it is

The self-hosted GitHub Actions runner the deploys depend on: one EC2 instance
in a private subnet of the shared VPC behind the `db-migrator` label
(`runners::DB_MIGRATOR` in `xtask_workflows`), which runs every MacroDB
migration, dev and prod, and the rollout jobs that need the databases. Its
operation, recovery and rebuild are in the
[runbook](../../../docs/runbooks/db-migrator-runner.md).

## Start here

- `runner.ts`: `DbMigratorRunner`, the instance, its role (Session Manager and
  the two database URL secrets), an outbound-only security group, and the
  status-check alarms that reboot or recover it.
- `user-data.sh`: the first boot. Installs the AWS CLI, `sqlx-cli` (built with
  a toolchain it then deletes) and two runner processes in a memory-capped
  systemd slice that restarts them.
- `Pulumi.dev.yaml`: the instance type. The registration token is the secret
  `github-runners:runnerToken`, set just before a `pulumi up`.

## Checks

From `infra/`: `bun run check`, `./node_modules/.bin/biome check stacks/github-runners`.
`shellcheck user-data.sh`. Preview, from this directory, with a placeholder
token, which `-c` writes into the stack's config file:

```sh
pulumi preview --stack macro-inc/dev --diff -c github-runners:runnerToken=preview-only
git checkout Pulumi.dev.yaml
```

## Gotchas

- Deploys are manual and need explicit approval; the stack exists only in
  `dev` and is deliberately not in `services-config.json`.
- Any change to `user-data.sh` or the token replaces the instance, and the
  replacement needs a fresh token: the old one has expired. A newer Ubuntu
  image does not (`ignoreChanges: ['ami']`).
- Jobs on this runner must not build anything: there is no cargo, rustup or
  Nix on it, and the slice kills a job that needs more memory than it has.
