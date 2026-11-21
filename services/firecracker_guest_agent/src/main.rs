//! Runs programs in a Firecracker computer for its host agent, over vsock
//! (protocol: `firecracker_host_api::exec`). Runs as root in the guest; only
//! the host can reach a guest's vsock, so a connection is the host agent.

mod session;

use firecracker_host_api::exec::GUEST_AGENT_PORT;
use tokio_util::task::TaskTracker;
use tokio_vsock::{VMADDR_CID_ANY, VsockAddr, VsockListener};

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::io::Result<()> {
    // journald keeps stderr; it stamps time itself.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .without_time()
        .init();
    let listener = VsockListener::bind(VsockAddr::new(VMADDR_CID_ANY, GUEST_AGENT_PORT))?;
    tracing::info!(port = GUEST_AGENT_PORT, "listening on vsock");
    let sessions = TaskTracker::new();
    loop {
        let (stream, _) = listener.accept().await?;
        sessions.spawn(async move {
            if let Err(error) = session::serve(stream).await {
                tracing::warn!(error = %error, "session failed");
            }
        });
    }
}
