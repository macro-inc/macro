# db-migrator runner

The in-VPC self-hosted GitHub Actions runner behind the `db-migrator` label
(`runners::DB_MIGRATOR`), in the organization's `monorepo` runner group. It is
the only runner that reaches the databases, so it runs:

- "Run Database Migrations" in every dev deploy (`deploy_on_push.yml`) and
  every prod release (`release-production.yml`), both through
  `deploy_all_services.yml`;
- `migrate-macro-db.yml`;
- the roll-out jobs of `firecracker-image-rollout.yml` and
  `agent-runtime-rollout.yml`.

While it is down, nothing deploys: every deploy's migration waits for it.

It is one EC2 instance in a private subnet of the shared VPC, defined in
[`infra/stacks/github-runners`](../../infra/stacks/github-runners/AGENTS.md)
(stack `macro-inc/dev` only; it serves dev and prod), with two runner
processes, `db-migrator-runner` and `db-migrator-runner-2`, so a long rollout
cannot hold the only slot.

## Why it is built this way

On 2026-11-25 the previous runner, a hand-made 1 GiB instance, ran out of
memory while a rollout job compiled Rust on it and stopped answering. Every
dev deploy after that waited for a runner that never came, until the hourly
`cancel_stuck_cloud_storage_deploys.yml` cancelled it, until the instance was
rebooted on 2026-11-27. The instance now:

- has 4 GiB (`t3.medium`), and runs both runners in `github-runner.slice`,
  capped at all memory but 768 MiB. A job that outgrows it is killed and its
  step fails; the machine keeps answering.
- compiles nothing. It has no Rust toolchain or Nix: jobs use `sqlx`, `aws`,
  `jq` and `git`. Its `cargo` forwards only `cargo sqlx`, which deploys of
  commits from before the switch to `sqlx` call, and fails anything else with
  a pointer here. A job that needs a Rust tool builds it on Namespace and
  hands the binary over as an artifact, as the Firecracker image rollout does.
- restarts a runner process that exits (`Restart=always`).
- is rebooted by EC2 after 3 minutes of failed instance status checks, and
  recovered onto new hardware after 2 minutes of failed system status checks
  (CloudWatch alarms `github-runners-db-migrator-dev-instance-check` and
  `-system-check`). Both keep the disk, so the runners keep their
  registration.
- has no SSH and no public address: open a shell with Session Manager.

Every deploy also runs "Wait for the migration runner" beside the migration
(`scripts/migration_runner_watchdog.ts`). When no runner has taken the
migration after 20 minutes, it lets any other job of the run that has started
or is about to start end (a prod release's website deploy, say), then cancels
the run and fails with the error **Migration runner unavailable**. No service
has deployed by then: services deploy only after the migration. If those jobs
are still running 30 minutes later, it fails with the same error without
cancelling anything.

## When a deploy says "Migration runner unavailable"

The runner is offline, hung, or busy with two other jobs.

1. See what the runners are doing: organization settings → Actions → Runner
   groups → `monorepo` (needs an organization admin), or
   `gh api orgs/macro-inc/actions/runners --jq '.runners[] | select(.labels[].name == "db-migrator") | [.name, .status, .busy] | @tsv'`
   with the `admin:org` scope. Two busy runners: wait, or cancel the job
   holding one.
2. Check the instance. Its id is the stack output `dbMigratorInstanceId`
   (`pulumi stack output dbMigratorInstanceId --stack macro-inc/dev` in
   `infra/stacks/github-runners`):

   ```sh
   aws ec2 describe-instance-status --include-all-instances --instance-ids "$id"
   ```

3. Open a shell and read the runners' and the kernel's logs:

   ```sh
   aws ssm start-session --target "$id"
   systemctl status 'actions.runner.*' github-runner.slice
   journalctl -u 'actions.runner.*' -n 200
   journalctl -k | grep -i -E 'oom|killed process'
   ```

4. Restart the runners (`sudo systemctl restart 'actions.runner.*'`), or,
   with approval, reboot the instance (`aws ec2 reboot-instances
   --instance-ids "$id"`). A runner whose registration was removed (offline
   for 14 days) does not come back by itself: rebuild the instance.
5. Re-run the cancelled deploy's failed jobs, or push again.

## Rebuild the instance

The runners register once, at first boot, with a registration token that
lasts an hour. Setting a new token changes the instance's user data, which
replaces the instance. An organization admin, from
`infra/stacks/github-runners`, with approval for the deploy:

```sh
token=$(gh api -X POST orgs/macro-inc/actions/runners/registration-token --jq .token)
pulumi config set --secret github-runners:runnerToken "$token" --stack macro-inc/dev
pulumi up --stack macro-inc/dev
```

Do it while no deploy runs: a job on the old instance is lost. The new
instance takes over the runner names (`config.sh --replace`) about ten
minutes later, once it has built `sqlx-cli`; follow it in
`/var/log/cloud-init-output.log` over Session Manager, which ends with
`>>> db-migrator runner bootstrap complete`. A bootstrap that fails registers
no runner; fix it and rebuild with a fresh token.

## Replacing the hand-made runner

Once, after this stack's first `pulumi up` (above): when
`db-migrator-runner` and `db-migrator-runner-2` show as idle in the
`monorepo` group, stop the old instance (`i-0244e64231131a8c9`, in a public
subnet) and terminate it, with its IAM role and instance profile, a few days
later. Its runner registration is the new instance's now. Migrations call
`sqlx` rather than `cargo sqlx` since this change; if one fails on the old
instance before the cutover with `sqlx: command not found`, finish the cutover
and re-run it.
