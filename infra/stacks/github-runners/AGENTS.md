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
- `user-data.sh`: the first boot. Installs the AWS CLI (with the region set
  for the runner user), `sqlx-cli` (built with a toolchain it then deletes),
  a `cargo` that only forwards `cargo sqlx`, two runner processes and a
  memory-capped systemd slice for them, and `register-db-migrator-runners`,
  which an admin runs over Session Manager to register and start them.
- `Pulumi.dev.yaml`: the instance type and the organization URL. The stack has
  no secret: the registration token never passes through Pulumi or the user
  data, where any job on the box could read it.

## Checks

From `infra/`: `bun run check`, `./node_modules/.bin/biome check stacks/github-runners`.
`shellcheck user-data.sh`. Preview, from this directory:
`pulumi preview --stack macro-inc/dev --diff`.

## Gotchas

- Deploys are manual and need explicit approval; the stack exists only in
  `dev` and is deliberately not in `services-config.json`.
- Any change to `user-data.sh` replaces the instance, and the new one serves
  no job until an admin registers it (runbook). A newer Ubuntu image does not
  replace it (`ignoreChanges: ['ami']`).
- Jobs on this runner must not build anything: there is no Rust toolchain or
  Nix on it, its `cargo` refuses everything but `cargo sqlx` (which deploys of
  older commits call), and the slice kills a job that needs more memory than
  it has.
