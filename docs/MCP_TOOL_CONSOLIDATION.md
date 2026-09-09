# Macro MCP consolidation

The main inmem agent consumes Macro product tools through `/mcp-macro`, the same
authenticated egress path used by sandbox harnesses. Macro MCP is required at
session creation and resume. Optional integrations may fail independently. The
catalog is discovered on connect and loaded on demand through `SearchTools` and
`LoadTools`; tools have only their `mcp__macro__<name>` names. There is no native
product-tool fallback. Memory and harness-local utilities stay in process.

MCP uses the stable 2025-11-25 server-to-client form elicitation flow. No
`mcp_2026_07_28` feature or MRTR protocol is required. URL elicitation is outside
this migration. The older channel bot keeps its current tool access.

## Stateful sessions across replicas

- Redis stores session → verified user, process incarnation, private IP/port.
  Entries expire after two hours without HTTP activity. Process heartbeats run
  every 15 seconds with a 60-second lease.
- The request is authenticated before routing. Different users receive 403.
  A request reaching another replica is streamed over the private service port
  to the recorded owner, with bearer authentication repeated there. Forwarding
  cannot loop or redirect and never retries a request.
- ECS supplies the container's private IP via `ECS_CONTAINER_METADATA_URI_V4`.
  Standalone replicas can set `MCP_REPLICA_ADDRESS=IP:port`; otherwise a local
  server uses `127.0.0.1:<port>`. These optional runtime variables are declared
  with `macro_env_var`; ECS supplies its own metadata variable. No new Doppler
  secret is needed. Redis continues using the existing `REDIS_URL`.
- The service security group permits TCP from its own security group on the
  application port. Autoscaling remains enabled; no ALB affinity is required.
- Reviews expire after one hour. The MCP transport closes idle workers after
  61 minutes and removes their handles; routing rejects expired sessions before
  dispatch. Sessionless POSTs must be initialization requests before a worker is
  allocated. SSE heartbeats keep intermediaries alive while users answer.
- On shutdown, the process stops its heartbeat and removes its liveness entry
  before stopping the listener, then cancels outstanding MCP streams. Pending
  reviews are cancelled and sessions expire. Abrupt process loss instead expires
  after the 60-second lease (transport failures can return 503 sooner). No pending
  mutation is restored on another process. Reconnect/resume initializes fresh MCP
  sessions; inspect an uncertain action's outcome before requesting it again.

## Deployment order

1. Deploy the MCP server and replica network rule. Verify a form review works
   through two replicas, including a response landing on the other replica.
2. Deploy inmem and web. Inmem requires Macro MCP's reviewed email/calendar
   catalog before allowing a production session to run.
3. Roll back in reverse order: revert the inmem consumer before reverting MCP.
   Existing external clients without form support can still use other tools;
   reviewed actions return an explicit unsupported error without executing.

## Verification

Run crate tests separately for `mcp_service`, `agent_inmem`, `agent`, `ai_tools`,
`mcp_toolset`, `agent_egress`, and `agent_fold`, with `SQLX_OFFLINE` unset and a
local database migrated to this branch. The HTTP regression test drives real
MCP requests across two listening replicas with a deterministic directory,
covering edited acceptance, decline, cancel, invalid content, missing capability,
wrong-user responses, and expired ownership. Domain routing tests cover a new
process at the previous process's address. Inmem tests cover the actual rmcp
form bridge, metadata trust, concurrent forms, waiting beyond five minutes,
and historical tool names.

For a manual harness probe, configure a legacy Streamable HTTP MCP endpoint with
form capability enabled in the client and call a reviewed tool. Confirm the form
appears in normal and unrestricted execution modes, that editing changes what is
sent, and that decline/cancel performs no action. Harness approval settings are
separate from the server's requirement for an accepted elicitation response.
