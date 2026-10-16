# preview_gateway

## What it is

Serves agent sessions: lets people view a coding agent's running dev-server
preview from the browser. A composition root exposing coding-agent dev-server
previews over SSH tunnels and short-lived browser tickets, on its own
`macro-agent-gateway.com` domain.

## Start here

- `README.md`: the full design — SSH tunnel protocol, ticket/cookie flow,
  limits, Pulumi deployment, and local-stack verification. Read it before
  changing this service; this file only points at it.
- `src/adapters.rs`: wires `agent_preview`'s ports (`Authority`, `Events`) to
  real session/permission/realtime services — the actual preview logic lives
  in `crates/agent_preview`, not here.
- `src/main.rs`: router, SSH server, and sweeper startup.

## Scope

- Owns: composing `agent_preview`'s domain with Macro's session, entity
  access, and connection-gateway services; the Pulumi deployment at
  `infra/stacks/preview-gateway`.
- Not here: the preview/SSH/ticket domain logic itself → `crates/agent_preview`;
  the SSH transport primitives → `crates/agent_egress`.

## Checks

- From the repo root, `SQLX_OFFLINE` unset:
  `cargo test -p agent_preview && cargo test -p preview_gateway && cargo test -p agent_egress`.

## Gotchas

- Runs as a single Fargate replica with no autoscaling — SSH, HTTP, and
  control requests share one in-memory lease/ticket registry (see README
  "Deployment"). Scaling requires explicit cross-replica routing first.
- Never deploy (`pulumi up`) without explicit approval; see root guardrails.

## Related

- Skill: `run-app` (`--with-cf-tunnel` for external runtimes) · Docs:
  `this directory's README.md`
