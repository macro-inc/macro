//! Exchange a system event in memory.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_runtime_protocol --example events
//! ```

use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::{
    RuntimeConnection, ServerConnection, SystemEventHandler,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use tokio::sync::mpsc;

struct ServiceEvents(mpsc::UnboundedSender<SystemEvent>);

impl SystemEventHandler for ServiceEvents {
    async fn handle(&self, event: SystemEvent) {
        let _ = self.0.send(event);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (service_channel, runtime_channel) = Channel::duplex();
    let (event_sender, mut events) = mpsc::unbounded_channel();

    let (_service, _service_acp) =
        ServerConnection::connect(service_channel, ServiceEvents(event_sender));
    let (runtime, _runtime_acp) = RuntimeConnection::connect(runtime_channel);

    runtime.system_event(SystemEvent::Unknown("example/connected".to_owned()))?;
    let event = events.recv().await.ok_or("event stream closed")?;
    let SystemEvent::Unknown(name) = &event else {
        unreachable!("SystemEvent has only one variant today");
    };
    println!("service received event: {name}");

    Ok(())
}
