//! Wiring a container onto a session's runtime connection.
//!
//! This is the harness's half of the runtime protocol, and the reason
//! delegation does not reduce to "hand over a socket". There are two layers:
//!
//! - **ACP**, which is what the container actually speaks - raw JSON-RPC over
//!   the sidecar
//! - **the runtime protocol**, which wraps ACP in a tagged envelope alongside
//!   system events
//!
//! `agent_runtime_protocol` has two roles for that: the harness holds the
//! *runtime* end ([`RuntimeConnection`]) and whatever manages sessions holds the
//! *server* end. Bridging the container's raw ACP into the runtime end is
//! nobody else's job, so [`splice`] stays here no matter how much of the session
//! itself agent_proxy owns.
//!
//! In-process there is no socket between the two ends: [`Channel::duplex`]
//! makes the pair directly, one half goes to [`RuntimeAttachments::attach`], and
//! the other stays here.

use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::RuntimeConnection;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use futures::StreamExt;
use macro_uuid::Uuid;

use crate::domain::ports::{AcpFrames, RuntimeAttachments};

/// Bridge a connected container to its session, and relay until either end
/// closes.
///
/// Ordering is policy, not plumbing. The connection is attached *before*
/// `AcpReady` is announced, because the session manager begins
/// `initialize`/`session/new` the moment it sees that event - so the frame
/// stream has to be live first or the handshake is sent into a void.
#[tracing::instrument(err, skip(frames, attachments))]
pub async fn bridge<Attach: RuntimeAttachments>(
    session_id: Uuid,
    frames: AcpFrames,
    attachments: &Attach,
) -> anyhow::Result<()> {
    let (server_side, runtime_side) = Channel::duplex();
    attachments.attach(session_id, server_side)?;

    let (upstream, acp) = RuntimeConnection::connect(runtime_side);
    upstream.system_event(SystemEvent::AcpReady)?;

    splice(frames, acp).await;

    // Best effort: the counterpart may already be gone, which is not a failure
    // of the run.
    let _ = upstream.system_event(SystemEvent::Unknown("shutting_down".to_owned()));
    Ok(())
}

/// Relay frames both ways until either side closes.
///
/// Verbatim in both directions - the harness never inspects or rewrites a
/// frame, which is what lets the session manager own every ACP decision.
async fn splice(frames: AcpFrames, mut acp: agent_client_protocol::Channel) {
    let AcpFrames { tx, mut rx } = frames;
    loop {
        tokio::select! {
            // Container -> session.
            frame = rx.recv() => {
                let Some(frame) = frame else { break };
                if acp.tx.unbounded_send(Ok(frame)).is_err() {
                    break;
                }
            }
            // Session -> container.
            frame = acp.rx.next() => {
                match frame {
                    Some(Ok(frame)) => {
                        if tx.send(frame).is_err() {
                            break;
                        }
                    }
                    // A protocol-level error on one frame is not a reason to
                    // drop the run; the counterpart keeps talking.
                    Some(Err(error)) => tracing::error!(?error, "acp channel error"),
                    None => break,
                }
            }
        }
    }
    tracing::debug!("splice finished");
}
