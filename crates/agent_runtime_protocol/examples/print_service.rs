//! Standalone Agent Runtime Protocol "service" that prints everything a runtime
//! sends. It binds a fixed port, accepts a runtime-initiated WebSocket + its
//! message subscription, and prints the connection id plus every system event.
//!
//! This is a development fixture for building a *runtime* (e.g. the TS worker)
//! against a real jsonrpsee peer — the Rust side does the handshake, you drive
//! the runtime side and watch what lands here.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_runtime_protocol --example print_service      # ws://127.0.0.1:9100
//! PORT=9200 cargo run -p agent_runtime_protocol --example print_service
//! ```

use std::future::Future;

use agent_runtime_protocol::connection::{ServerConnection, SystemEventHandler};
use agent_runtime_protocol::schema::v0::SystemEvent;
use agent_runtime_protocol::transport::jsonrpsee::ServerTransport;
use jsonrpsee::server::Server;

/// Prints each system event the runtime notifies, as compact wire JSON.
struct PrintEvents;

impl SystemEventHandler for PrintEvents {
    fn handle(
        &self,
        event: SystemEvent,
    ) -> impl Future<Output = Result<(), agent_client_protocol::Error>> + Send {
        println!(
            "  [system_event] {}",
            serde_json::to_string(&event).unwrap_or_else(|error| format!("<unserializable: {error}>"))
        );
        std::future::ready(Ok(()))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port: u16 = std::env::var("PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(9100);

    let transport = ServerTransport::new();
    let websocket = Server::builder().build(format!("127.0.0.1:{port}")).await?;
    let address = websocket.local_addr()?;
    let handle = websocket.start(transport.rpc_module()?);
    println!("service listening on ws://{address} — waiting for a runtime to dial in");

    // Hold every accepted connection alive; dropping a ServerConnection tears
    // down its driver task and closes the logical channel.
    let mut connections = Vec::new();
    while let Some(incoming) = transport.accept().await {
        println!("[accepted] connectionId={}", incoming.connection_id());
        connections.push(ServerConnection::connect(incoming.into_channel(), PrintEvents));
    }

    handle.stop()?;
    handle.stopped().await;
    Ok(())
}
