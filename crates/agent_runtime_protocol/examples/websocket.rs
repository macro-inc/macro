//! Run the logical protocol over a runtime-initiated plain WebSocket.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_runtime_protocol --example websocket
//! ```

use std::sync::Arc;

use agent_runtime_protocol::domain::connection::{RuntimeConnection, ServerConnection};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::{ServerTransport, connect_runtime};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let transport: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = Arc::clone(&transport).into_router();
    let server_handle = tokio::spawn(async move { axum::serve(listener, app).await });

    // The runtime initiates the WebSocket and can start sending messages
    // immediately - there is no subscribe handshake to complete first.
    let (stream, _response) = tokio_tungstenite::connect_async(format!("ws://{address}")).await?;
    let runtime_channel = connect_runtime::<ToServerMessage, ToRuntimeMessage, _>(stream);
    let service_channel = transport
        .accept()
        .await
        .ok_or("runtime disconnected before acceptance")?;

    let (service, _service_acp) = ServerConnection::connect(service_channel, ());
    let (runtime, _runtime_acp) = RuntimeConnection::connect(runtime_channel);
    println!("runtime and service connected over WebSocket");

    drop(runtime);
    drop(service);
    server_handle.abort();
    Ok(())
}
