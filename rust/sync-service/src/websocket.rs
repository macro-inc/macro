use std::{fmt::Display, sync::Arc};

use bebop::{Record, SliceWrapper};
use loro::{Frontiers, awareness::EphemeralStore};
use tracing::trace;
use worker::{Result, WebSocket};

use crate::{
    durable_object::{DocumentSyncSession, Wsm},
    error::ResultExt,
    generated::schema::{FromPeer, FromRemote},
    mutex::Mutex,
    state::DocumentState,
    storage::SessionStorage,
};

fn serialize<'a, T: bebop::Record<'a>>(
    obj: T,
    msg_buf: &mut Vec<u8>,
) -> std::result::Result<&[u8], bebop::SerializeError> {
    msg_buf.clear();
    obj.serialize(msg_buf)?;
    Ok(msg_buf)
}

/// Sends the initial sync message to the client over the websocket
/// The initial sync message contains the snapshot of the current state of the document
pub fn send_initial_sync(
    ws: &WebSocket,
    snapshot: &[u8],
    awareness: &[u8],
    buf: Arc<Mutex<Vec<u8>>>,
) -> Result<()> {
    let message = FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::Raw(snapshot),
        awareness: SliceWrapper::Raw(awareness),
    };

    let mut buf = buf.lock("serialize RemoteInitialSync in send_initial_sync");
    let serialized = serialize(message, &mut buf).context("Failed serializing snapshot")?;
    ws.send_with_bytes(serialized)
        .context("failed to send initial sync message")?;
    Ok(())
}

// Broadcasts a shallow snapshot of the document state to all connected clients
pub fn broadcast_snapshot(
    sockets: &[WebSocket],
    snapshot: &[u8],
    buf: Arc<Mutex<Vec<u8>>>,
) -> Result<()> {
    let message = FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::Raw(snapshot),
    };

    let mut buf = buf.lock("serialize RemoteSnapshot in broadcast_snapshot");
    let serialized = serialize(message, &mut buf).context("Failed serializing snapshot")?;
    for ws in sockets {
        ws.send_with_bytes(serialized)
            .context("failed to send update message")?;
    }
    Ok(())
}

pub fn broadcast_awareness(
    from_socket: &WebSocket,
    sockets: &[WebSocket],
    awareness: &[u8],
    buf: Arc<Mutex<Vec<u8>>>,
) -> Result<()> {
    let message = FromRemote::RemoteAwareness {
        awareness: SliceWrapper::Raw(awareness),
    };

    let mut buf = buf.lock("serialize RemoteAwareness in broadcast_awareness");
    let serialized = serialize(message, &mut buf).context("TODO")?;

    for w in sockets.iter().filter(|w| w != &from_socket) {
        w.send_with_bytes(serialized).context("failed to send")?;
    }

    Ok(())
}

impl Display for FromPeer<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let m = match self {
            FromPeer::Unknown => "Unknown",
            FromPeer::PeerUpdate { .. } => "PeerUpdate",
            FromPeer::PeerAwareness { .. } => "PeerAwareness",
            FromPeer::PeerRequestSince { .. } => "PeerRequestSince",
            FromPeer::PeerRequestSnapshot {} => "PeerRequestSnapshot",
            FromPeer::PeerRegisterId { .. } => "PeerRegisterId",
        };
        write!(f, "{m}")
    }
}

// Max receiving websocket message is 1Mb
const MAX_MESSAGE_SIZE: usize = 1000 * 1000;

#[allow(
    clippy::too_many_arguments,
    reason = "lots of args lets us avoid having multiple mutable refs to same object"
)]
pub async fn process_message(
    ws: &WebSocket,
    document_id: &str,
    document_state: &DocumentState,
    session_storage: &SessionStorage,
    awareness: &EphemeralStore,
    message: Vec<u8>,
    buf: Arc<Mutex<Vec<u8>>>,
    dss: &DocumentSyncSession,
) -> Result<()> {
    if message.len() > MAX_MESSAGE_SIZE {
        tracing::warn!("received message might be too large {}", message.len());
    }

    let message: FromPeer = FromPeer::deserialize(message.as_slice()).context(format!(
        "failed to deserialize message, message length {}",
        message.len()
    ))?;

    trace!(
        message = tracing::field::display(&message),
        "process websocket message"
    );
    match message {
        // Handle peer id registration
        // This registers a peer id to the owner of the current websocket
        FromPeer::PeerRegisterId { peerid } => {
            Wsm::new(dss, ws)
                .add_new_peerid(peerid, document_id)
                .await?;
        }
        // Handle an incoming update from a peer
        // Should extract binary update and broadcast it to all other connected peers
        // Should also store the update in the operation log to be applied to the remote doc
        FromPeer::PeerUpdate { update } => {
            if !Wsm::new(dss, ws).can_edit().await? {
                tracing::warn!("received update from peer without edit permission");
                return Ok(());
            }
            session_storage
                .append_pending_operation(&update, document_state)
                .await?;

            {
                // send update to peers
                let message = FromRemote::RemoteUpdate {
                    update: SliceWrapper::Raw(&update),
                };

                let mut buf = buf.lock("serialize RemoteUpdate in PeerUpdate handler");
                let serialized =
                    serialize(message, &mut buf).context("Failed serializing update")?;
                for w in dss.get_websockets().iter().filter(|w| w != &ws) {
                    w.send_with_bytes(serialized).context("failed to send")?;
                }
            }

            {
                // send ACK
                let message = FromRemote::RemoteUpdateAck {
                    update: SliceWrapper::Raw(&update),
                };
                let mut buf = buf.lock("serialize RemoteUpdateAck in PeerUpdate handler");
                let serialized =
                    serialize(message, &mut buf).context("Failed serializing update")?;
                ws.send_with_bytes(serialized).context("failed to send")?;
            }
        }
        // Handle an incoming awareness update from a peer
        // Should apply the update to the local epehemeral awareness strore
        FromPeer::PeerAwareness {
            awareness: awareness_update,
        } => {
            awareness.apply(*awareness_update);
            let encodede = awareness.encode_all();
            broadcast_awareness(ws, &dss.get_websockets(), &encodede, buf)
                .context("failed to broadcast awareness")?;
        }
        // Handle a peer requesting a specific set of updates from the document
        FromPeer::PeerRequestSince { frontiers } => {
            let frontiers = Frontiers::decode(*frontiers).context("failed to decode frontiers")?;

            let update = document_state
                .export_updates_since(&frontiers)
                .context("failed to export updates")?;

            let encoded_frontiers = frontiers.encode();

            let message = FromRemote::RemoteUpdateSince {
                update: SliceWrapper::Raw(&update),
                frontiers: SliceWrapper::Raw(&encoded_frontiers),
            };

            let mut buf = buf.lock("serialize RemoteUpdate in PeerRequestSince handler");
            let serialized =
                serialize(message, &mut buf).context("failed serializing PeerRequestSince")?;
            ws.send_with_bytes(serialized)
                .context("failed to send update")?;
        }
        // Peer is requesting a snapshot from the remote
        FromPeer::PeerRequestSnapshot {} => {
            let snapshot = document_state.export_shallow_snapshot()?;

            let message = FromRemote::RemoteSnapshot {
                snapshot: SliceWrapper::Raw(&snapshot),
            };
            let mut buf = buf.lock("serialize RemoteSnapshot in PeerRequestSnapshot handler");
            let serialized =
                serialize(message, &mut buf).context("failed serializing PeerRequestSnapshot")?;
            ws.send_with_bytes(serialized)
                .context("failed to send update")?;
        }
        FromPeer::Unknown => {
            return Err(worker::Error::from("unknown message type"));
        }
    };

    Ok(())
}
