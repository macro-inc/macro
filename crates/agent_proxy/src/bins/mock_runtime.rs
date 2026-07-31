//! A mock agent runtime for testing the agent proxy end-to-end.
//!
//! Plays the container side of the agent runtime protocol: it dials the
//! proxy's shared runtime WebSocket endpoint, announces itself, spools up
//! Claude Code (Zed's ACP adapter, via `npx`) as the agent process, and
//! bridges the agent's ACP traffic over the runtime connection.
//!
//! `agent_runtime_protocol` hosts exactly one agent execution per connection
//! and carries no session identifier on the wire, so this bin dials the
//! shared runtime endpoint with `?id=<agent_id>` appended - that query
//! parameter is what tells the proxy which session this connection belongs
//! to.
//!
//! Prerequisites:
//!
//! - Node.js and `npx` installed;
//! - `ANTHROPIC_API_KEY` available to this process (the crate `.env` is
//!   loaded automatically);
//! - a running `agent_proxy_service`. This bin dials the local stack's
//!   shared runtime endpoint (`ws://127.0.0.1:8091` by default); pass
//!   `--proxy-url` to point elsewhere.
//!
//! Test recipe (ports assume the crate `.env`: HTTP 8091):
//!
//! ```text
//! # 1. start the proxy (run from crates/agent_proxy so it picks up the .env)
//! cargo run -p agent_proxy_service
//!
//! # 2. create an external agent chat and note the returned id
//! curl -X POST localhost:8091/agents -H 'content-type: application/json' \
//!   -H 'x-internal-auth-key: local' -H 'x-internal-macro-user-id: macro|you@macro.com' \
//!   -d '{"name": "test coding agent", "kind": "External"}'
//!
//! # 3. hand that id to this runtime; it dials the proxy's shared runtime
//! #    endpoint and starts Claude Code for the session
//! cargo run -p agent_proxy --bin mock_runtime -- --agent-id <id>
//!
//! # 4. prompt the session through the proxy (safe before step 3 too: the
//! #    proxy queues the prompt until the runtime's ACP session is ready,
//! #    and stamps the live ACP session id onto the empty placeholder)
//! curl -X POST localhost:8091/sessions/<id>/acp -H 'content-type: application/json' \
//!   -H 'x-internal-auth-key: local' -H 'x-internal-macro-user-id: macro|you@macro.com' \
//!   -d '{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"","prompt":[{"type":"text","text":"say hi"}]}}'
//! ```
//!
//! Agent responses stream back to clients through the connection gateway;
//! this process logs the runtime-protocol lifecycle to stderr.

use agent_client_protocol::{AcpAgent, Client, ConnectTo};
use agent_proxy::domain::models::AgentId;
use agent_runtime_protocol::domain::connection::RuntimeConnection;
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::connect_runtime;
use anyhow::{Context, Result};
use clap::Parser;

/// The local stack's shared runtime WebSocket endpoint on the agent proxy.
const LOCAL_STACK_WS_URL: &str = "ws://127.0.0.1:8091";

/// Zed's Claude Code ACP adapter, pinned to match the protocol crate's
/// `mock_container` example.
const ZED_CLAUDE_CODE_ACP: &str = "@zed-industries/claude-code-acp@0.16.2";

/// Claude Code session variables blanked in the agent process's environment.
/// When this bin is launched from inside a Claude Code session these leak
/// down to the spawned Claude Code CLI, which then refuses to start
/// ("Claude Code cannot be launched inside another Claude Code session") —
/// surfacing through the adapter only as "Query closed before response
/// received". Blank (empty) values read as unset to the CLI's guard.
const CLAUDE_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_PID",
];

/// Mock agent runtime: dials the agent proxy's shared runtime endpoint and
/// runs Claude Code as the agent for one session.
#[derive(Debug, Parser)]
struct Args {
    /// Base `ws://` URL of the agent proxy; the runtime dials
    /// `{proxy_url}/runtime?id=<agent_id>`. Defaults to the local stack.
    #[arg(long, default_value = LOCAL_STACK_WS_URL)]
    proxy_url: String,

    /// The agent (chat entity) UUID this runtime hosts. Must be an existing
    /// chat created with kind `External`.
    #[arg(long)]
    agent_id: AgentId,

    /// Override the agent command (defaults to running Zed's Claude Code ACP
    /// adapter with npx).
    #[arg(long = "agent-command", num_args = 1.., allow_hyphen_values = true)]
    agent_command: Option<Vec<String>>,
}

/// Interpose on an ACP channel, logging every message in both directions
/// before forwarding it unchanged. Returns the channel to hand to the agent.
fn tap_acp(service: agent_client_protocol::Channel) -> agent_client_protocol::Channel {
    use futures::StreamExt;

    let (agent_side, relay) = agent_client_protocol::Channel::duplex();
    let agent_client_protocol::Channel {
        rx: mut service_rx,
        tx: service_tx,
    } = service;
    let agent_client_protocol::Channel {
        rx: mut relay_rx,
        tx: relay_tx,
    } = relay;

    tokio::spawn(async move {
        loop {
            tokio::select! {
                message = service_rx.next() => {
                    let Some(message) = message else { break };
                    if let Ok(inner) = &message {
                        let json = serde_json::to_string(inner).unwrap_or_default();
                        tracing::info!("acp service -> agent: {json}");
                    }
                    if relay_tx.unbounded_send(message).is_err() {
                        break;
                    }
                }
                message = relay_rx.next() => {
                    let Some(message) = message else { break };
                    if let Ok(inner) = &message {
                        let json = serde_json::to_string(inner).unwrap_or_default();
                        tracing::info!("acp agent -> service: {json}");
                    }
                    if service_tx.unbounded_send(message).is_err() {
                        break;
                    }
                }
            }
        }
        tracing::debug!("acp tap closed");
    });

    agent_side
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load the crate .env (so ANTHROPIC_API_KEY reaches the agent process)
    // regardless of the working directory; already-set vars and the
    // crate-local file take precedence over an ancestor .env.
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env"));
    macro_entrypoint::MacroEntrypoint::default().init();

    let args = Args::parse();
    let agent_id = args.agent_id.to_string();
    let agent_command = args.agent_command.unwrap_or_else(|| {
        vec![
            "npx".to_string(),
            "-y".to_string(),
            ZED_CLAUDE_CODE_ACP.to_string(),
        ]
    });
    // Leading NAME= args are parsed by AcpAgent::from_args as environment
    // variables for the agent process.
    let agent_command: Vec<String> = CLAUDE_SESSION_VARS
        .iter()
        .map(|var| format!("{var}="))
        .chain(agent_command)
        .collect();

    // The shared runtime endpoint is the same for every session; the query
    // parameter is what tells agent_proxy which one this connection is.
    let url = format!("{}/runtime?id={}", args.proxy_url, args.agent_id);

    tracing::info!(%url, "connecting to agent proxy");
    let (stream, _response) = tokio_tungstenite::connect_async(&url)
        .await
        .with_context(|| format!("failed to open runtime websocket at {url}"))?;
    let channel = connect_runtime::<ToServerMessage, ToRuntimeMessage, _>(stream);
    let (runtime, acp) = RuntimeConnection::connect(channel);

    runtime
        .system_event(SystemEvent::Unknown("runtime/ready".to_string()))
        .context("failed to emit runtime/ready")?;

    // Tap the ACP channel so every message crossing the wire is printed
    // (e.g. to grab the session/new response's sessionId).
    let acp = tap_acp(acp);

    tracing::info!(agent_id, command = ?agent_command, "starting agent");
    let claude_code = AcpAgent::from_args(agent_command.iter().map(String::as_str))
        .context("failed to spawn agent process")?;
    runtime
        .system_event(SystemEvent::AcpReady)
        .context("failed to emit acp_ready")?;

    let agent = ConnectTo::<Client>::connect_to(claude_code, acp);
    tokio::pin!(agent);

    let result: Result<()> = tokio::select! {
        result = &mut agent => result.map_err(Into::into),
        signal = tokio::signal::ctrl_c() => {
            signal.context("failed to listen for ctrl-c")?;
            tracing::info!("interrupted; shutting down agent");
            Ok(())
        }
    };

    let _ = runtime
        .system_event(SystemEvent::Unknown("agent/stopped".to_string()))
        .inspect_err(|e| tracing::warn!(error=?e, "failed to emit agent/stopped"));

    drop(runtime);
    result
}
