# Local Hire review

The Cargo example accepts JSON lines on a private pipe. The signed app
bridge supplies the authenticated actor and current team. The helper
rechecks that the actor owns or administers its sole team in the private
database, and that the team is unpaid and has no subscription.

Use a disposable PostgreSQL 18 cluster with pgvector and the MacroDB
migrations. Keep the `bots_hire_review` database on a Unix socket in a
private `/tmp/macro-hire-local.*` directory with TCP disabled. Apply
[`seed.sql`](seed.sql) only to that database.

```sh
SQLX_OFFLINE=true cargo build --offline -p team_agents --example local_hire --features outbound
unshare -Urn -- target/debug/examples/local_hire <socket-directory> <role> <team-id> <synthetic-macro-user-id>
```

The helper issues two-minute no-charge offers using the normal size catalog
and current host allocation. Confirmation binds the actor, team, key, and
original request in a local receipt before dispatch. Lost receipt evidence
leaves the outcome unknown.

The normal services persist the agent account, included team membership,
and comped computer UUID. The local operator starts an inert child
process through the normal Create effect. That transition reaches Booting.
The example provisions no guest OS or running agent. Real readiness
requires Macrod enrollment and the agent's authenticated online report.

The executable has no billing client or TCP listener. The browser receives
only the team-scoped roster projection and opaque computer UUID.
