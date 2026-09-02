use bebop::{Record, SliceWrapper};
use loro::{VersionVector, awareness::EphemeralStore};
use tracing::trace;

use crate::{
    domain::{document_id::DocumentId, ports::SyncServiceError, state::DocumentState},
    error::ResultExt,
    generated::schema::{FromPeer, FromRemote},
    inbound::{
        socket::RemoteSocket,
        sync_service::{SyncServiceImpl, Wsm},
    },
    outbound::storage::SessionStorage,
};

/// Decodes an inbound WebSocket payload once, before its trace span is created.
pub fn deserialize_message(message: &[u8]) -> worker::Result<FromPeer<'_>> {
    if message.len() > MAX_MESSAGE_SIZE {
        tracing::warn!("received message might be too large {}", message.len());
    }
    FromPeer::deserialize(message).context(format!(
        "failed to deserialize message, message length {}",
        message.len()
    ))
}

/// Returns the protocol-level type of an inbound WebSocket message.
pub fn message_type(message: &FromPeer<'_>) -> &'static str {
    match message {
        FromPeer::PeerRegisterId { .. } => "register_id",
        FromPeer::PeerUpdate { .. } => "update",
        FromPeer::PeerAwareness { .. } => "awareness",
        FromPeer::PeerRequestSince { .. } => "request_since",
        FromPeer::PeerRequestSnapshot { .. } => "request_snapshot",
        FromPeer::Unknown => "unknown",
    }
}

/// Diagnostic fields collected while handling an inbound WebSocket message.
pub struct InboundMessageTelemetry {
    document_id: Option<String>,
    ws_id: Option<String>,
    message_type: &'static str,
    message_bytes: usize,
    error_stage: &'static str,
    op_id: Option<String>,
    peer_id: Option<u64>,
    update_bytes: Option<usize>,
    response_bytes: Option<usize>,
    broadcast_targets: Option<usize>,
}

impl InboundMessageTelemetry {
    /// Start collecting diagnostics without creating a span.
    pub fn new(message_bytes: usize) -> Self {
        Self {
            document_id: None,
            ws_id: None,
            message_type: "unknown",
            message_bytes,
            error_stage: "unknown",
            op_id: None,
            peer_id: None,
            update_bytes: None,
            response_bytes: None,
            broadcast_targets: None,
        }
    }

    /// Record identifiers available from the Durable Object callback.
    pub fn record_context(&mut self, document_id: &str, ws_id: Option<String>) {
        self.document_id = Some(document_id.to_string());
        self.ws_id = ws_id;
    }

    /// Record the decoded protocol message type.
    pub fn record_message_type(&mut self, message_type: &'static str) {
        self.message_type = message_type;
    }

    /// Record which stage of message handling failed.
    pub fn record_error_stage(&mut self, error_stage: &'static str) {
        self.error_stage = error_stage;
    }

    /// Create the only span emitted for this message, after handling fails.
    pub fn error_span(&self) -> tracing::Span {
        let span = tracing::error_span!(
            "ws.message.error",
            document.id = tracing::field::Empty,
            ws.id = tracing::field::Empty,
            message.type = self.message_type,
            message.bytes = self.message_bytes,
            error.stage = self.error_stage,
            op.id = tracing::field::Empty,
            peer.id = tracing::field::Empty,
            update.bytes = tracing::field::Empty,
            response.bytes = tracing::field::Empty,
            broadcast.targets = tracing::field::Empty,
        );

        if let Some(document_id) = &self.document_id {
            span.record("document.id", document_id.as_str());
        }
        if let Some(ws_id) = &self.ws_id {
            span.record("ws.id", ws_id.as_str());
        }
        if let Some(op_id) = &self.op_id {
            span.record("op.id", op_id.as_str());
        }
        if let Some(peer_id) = self.peer_id {
            span.record("peer.id", peer_id);
        }
        if let Some(update_bytes) = self.update_bytes {
            span.record("update.bytes", update_bytes);
        }
        if let Some(response_bytes) = self.response_bytes {
            span.record("response.bytes", response_bytes);
        }
        if let Some(broadcast_targets) = self.broadcast_targets {
            span.record("broadcast.targets", broadcast_targets);
        }

        span
    }
}

/// Sends the initial sync message to the client over the websocket
/// The initial sync message contains the snapshot of the current state of the document
pub fn send_initial_sync(
    socket: &RemoteSocket,
    snapshot: &[u8],
    awareness: &[u8],
) -> Result<(), SyncServiceError> {
    socket.send(FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::Raw(snapshot),
        awareness: SliceWrapper::Raw(awareness),
    })
}

pub fn broadcast_awareness(
    from: &RemoteSocket,
    sockets: &[RemoteSocket],
    awareness: &[u8],
) -> Result<(), SyncServiceError> {
    for s in sockets.iter().filter(|s| s.id() != from.id()) {
        // A dead peer socket must not abort delivery to the remaining peers.
        if let Err(e) = s.send(FromRemote::RemoteAwareness {
            awareness: SliceWrapper::Raw(awareness),
        }) {
            tracing::warn!(error = ?e, "failed to send awareness to a peer; continuing");
        }
    }

    Ok(())
}

// Max receiving websocket message is 1Mb
const MAX_MESSAGE_SIZE: usize = 1000 * 1000;

#[allow(
    clippy::too_many_arguments,
    reason = "lots of args lets us avoid having multiple mutable refs to same object"
)]
pub async fn process_message(
    sender: &RemoteSocket,
    sockets: &[RemoteSocket],
    document_id: &DocumentId,
    document_state: &DocumentState,
    session_storage: &SessionStorage,
    awareness: &EphemeralStore,
    message: FromPeer<'_>,
    dss: &SyncServiceImpl,
    telemetry: &mut InboundMessageTelemetry,
) -> Result<(), SyncServiceError> {
    trace!(
        message = tracing::field::display(&message),
        "process websocket message"
    );
    match message {
        // Handle peer id registration
        // This registers a peer id to the owner of the current websocket
        FromPeer::PeerRegisterId { peerid } => {
            telemetry.peer_id = Some(peerid);
            Wsm::new(dss, sender.id().to_string())
                .add_new_peerid(peerid, document_id)
                .await?;
        }
        // Handle an incoming update from a peer
        // Should extract binary update and broadcast it to all other connected peers
        // Should also store the update in the operation log to be applied to the remote doc
        FromPeer::PeerUpdate { updates, id } => {
            telemetry.op_id = Some(id.to_string());
            telemetry.update_bytes = Some(updates.iter().map(|u| u.len()).sum());
            if !Wsm::new(dss, sender.id().to_string()).can_edit().await? {
                tracing::warn!("received update from peer without edit permission");
                return Ok(());
            }

            let peer_ids = Wsm::new(dss, sender.id().to_string())
                .get_peer_ids()
                .await
                .unwrap_or_default();
            let peer_id = peer_ids.first().copied();
            telemetry.peer_id = peer_id;
            let now_ms = web_time::SystemTime::now()
                .duration_since(web_time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            for update in &updates {
                let touched_nodes = session_storage
                    .append_pending_operation(update, document_state)
                    .await?;
                if !touched_nodes.is_empty()
                    && let Some(peer_id) = peer_id
                {
                    dss.push_blame_events(
                        touched_nodes
                            .into_iter()
                            .map(|node_id| crate::outbound::d1::BlameEvent {
                                document_id: document_id.to_string(),
                                node_id,
                                peer_id,
                                timestamp_ms: now_ms,
                            })
                            .collect(),
                    );
                }
            }

            // ACK the sender before broadcasting: the batch is durably
            // stored at this point, and a failed broadcast to some other
            // peer must not block the ack.
            sender
                .send(FromRemote::RemoteUpdateAck { id })
                .inspect_err(|error| {
                    tracing::error!(error = ?error, op.id = %id, "failed to send update ack");
                })?;

            // Peers receiving the rebroadcast (everyone but the sender). The
            // count is the key Teo/Hutch diagnostic: if it excludes a peer the
            // DO thinks isn't connected, that's the dropped-update bug.
            telemetry.broadcast_targets =
                Some(sockets.iter().filter(|s| s.id() != sender.id()).count());
            for update in &updates {
                // broadcast each update to other peers
                for s in sockets.iter().filter(|s| s.id() != sender.id()) {
                    // A dead peer socket must not abort delivery to the
                    // remaining peers.
                    if let Err(e) = s.send(FromRemote::RemoteUpdate {
                        update: SliceWrapper::Raw(update),
                    }) {
                        tracing::warn!(error = ?e, "failed to send update to a peer; continuing");
                    }
                }
            }
        }
        // Handle an incoming awareness update from a peer
        // Should apply the update to the local epehemeral awareness strore
        FromPeer::PeerAwareness {
            awareness: awareness_update,
        } => {
            if let Err(e) = awareness.apply(*awareness_update) {
                tracing::warn!(error = ?e, "failed to apply awareness update; ignoring it");
                return Ok(());
            }
            let encodede = awareness.encode_all();
            telemetry.broadcast_targets =
                Some(sockets.iter().filter(|s| s.id() != sender.id()).count());
            broadcast_awareness(sender, sockets, &encodede)
                .context("failed to broadcast awareness")?;
        }
        // Handle a peer requesting a specific set of updates from the document.
        // The client sends a version vector (not frontiers) so unknown peers
        // — e.g. a peer that made offline edits the server hasn't seen yet —
        // don't cause a panic in `frontiersToVV` lookup.
        FromPeer::PeerRequestSince { vv } => {
            let decoded = VersionVector::decode(*vv).context("failed to decode version vector")?;

            let update = document_state
                .export_updates_since(&decoded)
                .context("failed to export updates")?;
            // Server end of the client's `doc.sync.catchup` span.
            telemetry.response_bytes = Some(update.len());

            // Echo the client's *original* vv bytes back, not a re-encoded copy.
            // The client correlates the response by byte-exact match on the vv it
            // sent; `decode(vv).encode()` is not guaranteed to reproduce the same
            // bytes for a multi-peer version vector, which would make the client
            // discard a perfectly good response and time out.
            sender.send(FromRemote::RemoteUpdateSince {
                update: SliceWrapper::Raw(&update),
                vv,
            })?;
        }
        // Peer is requesting a snapshot from the remote
        FromPeer::PeerRequestSnapshot {} => {
            let snapshot = document_state.export_shallow_snapshot()?;
            telemetry.response_bytes = Some(snapshot.len());

            sender.send(FromRemote::RemoteSnapshot {
                snapshot: SliceWrapper::Raw(&snapshot),
            })?;
        }
        FromPeer::Unknown => {
            return Err(worker::Error::from("unknown message type").into());
        }
    };

    Ok(())
}
