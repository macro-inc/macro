//! Inbound frame policy and the unchanged message-error telemetry.
use super::{PortName, Room, RoomError, SocketOf};
use crate::domain::{
    document::{DocumentAttribution, writing_peers},
    permissions::WriteAccess,
    ports::*,
    state::{DocumentState, ImportedUpdate},
    types::{PeerId, SessionKey},
};
use bebop::{Record, SliceWrapper};
use loro::VersionVector;
use sync_protocol::{FromPeer, FromRemote};
use tracing::{Instrument, trace};
type Result<T> = std::result::Result<T, RoomError>;

/// Transport-neutral inbound websocket frame.
pub enum InboundFrame {
    /// Unframed text (including heartbeat).
    Text(String),
    /// Binary frame with its chunk envelope intact.
    Binary(Vec<u8>),
}
/// Returns the protocol-level type of an inbound WebSocket message.
fn message_type(message: &FromPeer<'_>) -> &'static str {
    match message {
        FromPeer::PeerRegisterId { .. } => "register_id",
        FromPeer::PeerUpdate { .. } => "update",
        FromPeer::PeerCommentUpdate { .. } => "comment_update",
        FromPeer::PeerAwareness { .. } => "awareness",
        FromPeer::PeerRequestSince { .. } => "request_since",
        FromPeer::PeerRequestSnapshot { .. } => "request_snapshot",
        FromPeer::Unknown => "unknown",
    }
}

/// Diagnostic fields collected while handling an inbound WebSocket message.
struct InboundMessageTelemetry {
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
    fn new(message_bytes: usize) -> Self {
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
    fn record_context(&mut self, document_id: &str, ws_id: Option<String>) {
        self.document_id = Some(document_id.to_string());
        self.ws_id = ws_id;
    }

    /// Record the decoded protocol message type.
    fn record_message_type(&mut self, message_type: &'static str) {
        self.message_type = message_type;
    }

    /// Record which stage of message handling failed.
    fn record_error_stage(&mut self, error_stage: &'static str) {
        self.error_stage = error_stage;
    }

    /// Create the only span emitted for this message, after handling fails.
    fn error_span(&self) -> tracing::Span {
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

impl<P: RoomPorts> Room<P> {
    /// Handle a complete callback, preserving validation, import, persistence and delivery order.
    pub async fn on_frame(&mut self, socket: &SocketOf<P>, frame: InboundFrame) -> Result<()> {
        if self.source_blocked().await? {
            self.ports
                .connections()
                .close(socket, CloseReason::SessionFrozenOrRetired)
                .map_err(RoomError::runtime_connections)?;
            return Ok(());
        }
        if !self.validate_surface_sockets(Some(socket)).await? {
            return Ok(());
        }
        let bytes = match frame {
            InboundFrame::Text(text) => {
                if text == sync_protocol::PING {
                    self.heartbeat(socket);
                } else {
                    tracing::warn!("Received unknown 'String' message: {text:?}");
                }
                return Ok(());
            }
            InboundFrame::Binary(bytes) => bytes,
        };
        let id = self.ports.connections().socket_id(socket)?;
        let Some(bytes) = self
            .memory
            .inbound
            .entry(id.clone())
            .or_default()
            .push(&bytes)?
        else {
            return Ok(());
        };
        self.memory.inbound.remove(&id);
        let mut telemetry = InboundMessageTelemetry::new(bytes.len());
        let result: Result<()> = async {
            let key = self
                .session_key()
                .await
                .inspect_err(|_| telemetry.record_error_stage("document_context"))?;
            let id = self
                .ports
                .connections()
                .socket_id(socket)
                .ok()
                .map(|id| id.as_str().to_owned());
            telemetry.record_context(key.as_str(), id);
            if bytes.len() > self.config.oversized_message_warning {
                tracing::warn!("received message might be too large {}", bytes.len());
            }
            let message = FromPeer::deserialize(&bytes).map_err(|error| {
                telemetry.record_message_type("invalid");
                telemetry.record_error_stage("deserialize");
                RoomError::Decode {
                    length: bytes.len(),
                    error,
                }
            })?;
            telemetry.record_message_type(message_type(&message));
            self.load_document().await?;
            let document = self.memory.document.as_ref().expect("document loaded");
            let view = DocumentState {
                loro_doc: document.loro_doc.clone(),
                last_update: document.last_update,
                last_export: document.last_export,
            };
            process_message(socket, key.as_str(), &view, message, self, &mut telemetry)
                .await
                .inspect_err(|_| telemetry.record_error_stage("process"))?;
            self.bump_alarm()
                .await
                .inspect_err(|_| telemetry.record_error_stage("alarm"))?;
            Ok(())
        }
        .await;
        if let Err(error) = &result {
            let span = telemetry.error_span();
            let _entered = span.enter();
            tracing::error!(error = ?error, "failed to handle websocket message");
        }
        result
    }
    /// Import and durably store one update with its optional signed attribution.
    pub async fn apply_update(
        &mut self,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> Result<ImportedUpdate> {
        self.load_document().await?;
        let result = self
            .memory
            .operation_log
            .as_mut()
            .expect("log initialized")
            .apply(
                self.ports.storage(),
                self.memory.document.as_mut().expect("document loaded"),
                update,
                attribution,
                self.ports.clock(),
            )
            .await;
        if result.is_err() {
            // Import mutates Loro before persistence can fail. Future snapshots
            // and updates must reload only durable history, or they can expose
            // missing causal parents to later acknowledged edits. Keep log IDs
            // and persisted keys so a partial batch remains safely replayable.
            self.memory.document = None;
        }
        result.map_err(|e| RoomError::port(PortName::Storage, e))
    }
    async fn register_peer(
        &mut self,
        socket: &SocketOf<P>,
        peer: u64,
        document_id: &str,
    ) -> Result<()> {
        let id = self.ports.connections().socket_id(socket)?;
        self.connection_metadata_by_id(&id).await?;
        let meta = self
            .memory
            .connections
            .get_mut(&id)
            .expect("metadata restored");
        if !meta.peer_ids.insert(peer) {
            return Ok(());
        }
        let meta = meta.clone();
        self.ports
            .storage()
            .put_connection(&id, &meta)
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        if let Some(user) = &meta.user_id {
            self.ports
                .peers()
                .claim_peer(
                    &SessionKey::new(document_id.to_owned()),
                    user,
                    meta.actor.as_deref(),
                    PeerId(peer),
                )
                .instrument(tracing::info_span!(
                    "peer.register",
                    document.id = document_id,
                    peer.id = peer
                ))
                .await
                .map_err(|e| RoomError::port(PortName::Peers, e))?;
        }
        Ok(())
    }
    async fn map_writing_peers(
        &mut self,
        socket: &SocketOf<P>,
        peers: &[u64],
        document_id: &str,
    ) -> Result<()> {
        let meta = self.connection_metadata(socket).await?.clone();
        let Some(user) = meta.user_id else {
            return Ok(());
        };
        let peers: Vec<_> = peers
            .iter()
            .copied()
            .map(PeerId)
            .filter(|peer| !self.memory.mapped_writing_peers.contains(peer))
            .collect();
        if peers.is_empty() {
            return Ok(());
        }
        self.ports
            .peers()
            .map_unowned_peers(
                &SessionKey::new(document_id.to_owned()),
                &user,
                meta.actor.as_deref(),
                &peers,
            )
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))?;
        self.memory.mapped_writing_peers.extend(peers);
        Ok(())
    }
    fn broadcast_awareness(&self, sender: &SocketOf<P>, awareness: &[u8]) {
        for socket in self.active_sockets() {
            if &socket == sender {
                continue;
            }
            if let Err(error) = self.send(
                &socket,
                FromRemote::RemoteAwareness {
                    awareness: SliceWrapper::Raw(awareness),
                },
            ) {
                tracing::warn!(error = ?error, "failed to send awareness to a peer; continuing");
            }
        }
    }
}
async fn process_message<P: RoomPorts>(
    sender: &SocketOf<P>,
    document_id: &str,
    document_state: &DocumentState,
    message: FromPeer<'_>,
    dss: &mut Room<P>,
    telemetry: &mut InboundMessageTelemetry,
) -> Result<()> {
    // Loading the document after hibernation can yield to a revocation. Check
    // the surface grant again immediately before handling any protocol message.
    if !dss.validate_surface_sockets(Some(sender)).await? {
        return Ok(());
    }
    trace!(
        message = tracing::field::display(&message),
        "process websocket message"
    );
    let comment_only = matches!(message, FromPeer::PeerCommentUpdate { .. });
    match message {
        // Handle peer id registration
        // This registers a peer id to the owner of the current websocket
        FromPeer::PeerRegisterId { peerid } => {
            telemetry.peer_id = Some(peerid);
            dss.register_peer(sender, peerid, document_id).await?;
        }
        // Handle an incoming update from a peer
        // Should extract binary update and broadcast it to all other connected peers
        // Should also store the update in the operation log to be applied to the remote doc
        FromPeer::PeerUpdate { updates, id } | FromPeer::PeerCommentUpdate { updates, id } => {
            telemetry.op_id = Some(id.to_string());
            telemetry.update_bytes = Some(updates.iter().map(|u| u.len()).sum());
            match dss.connection_write_access(sender).await? {
                WriteAccess::None => {
                    tracing::warn!("received update from peer without edit permission");
                    return Ok(());
                }
                WriteAccess::CommentMarks => {
                    if !changes_only_comment_marks(dss, document_state, &updates, document_id, id)
                        .await
                    {
                        return Ok(());
                    }
                }
                WriteAccess::Full => {
                    if comment_only
                        && !changes_only_comment_marks(
                            dss,
                            document_state,
                            &updates,
                            document_id,
                            id,
                        )
                        .await
                    {
                        return Ok(());
                    }
                }
            }

            let attribution = match dss.connection_attribution(sender).await {
                Ok(attribution) => attribution,
                Err(error) => {
                    tracing::warn!(error = ?error, "failed to resolve optional edit attribution");
                    None
                }
            };
            let peer_ids = dss.connection_peers(sender, true).await.unwrap_or_default();
            let peer_id = peer_ids.first().copied();
            telemetry.peer_id = peer_id;
            let now_ms = dss.ports.clock().unix_time_for(WallClock::Blame).0;
            for update in &updates {
                let imported = dss.apply_update(update, None).await?;
                if imported.changed
                    && let Some(attribution) = &attribution
                {
                    dss.memory.pending_editors.insert(attribution.clone());
                }
                if !imported.touched_nodes.is_empty()
                    && let Some(peer_id) = peer_id
                {
                    dss.memory.pending_blame.extend(
                        imported
                            .touched_nodes
                            .into_iter()
                            .map(|node_id| crate::domain::types::BlameEvent {
                                document_id: document_id.to_string(),
                                node_id,
                                peer_id,
                                timestamp_ms: now_ms,
                            })
                            .collect::<Vec<_>>(),
                    );
                }
            }

            // Map every peer the update was written with, not only the one the
            // client registered, so history can name its author. Before the
            // ack: a failure here makes the client resend and retry it.
            let mut writers = Vec::new();
            for update in &updates {
                writers.extend(writing_peers(update)?);
            }
            dss.map_writing_peers(sender, &writers, document_id).await?;

            // ACK only after the update is durably stored.
            dss.send(sender, FromRemote::RemoteUpdateAck { id })
                .inspect_err(|error| {
                    tracing::error!(error = ?error, op.id = %id, "failed to send update ack");
                })?;

            let sockets = dss.active_sockets();
            let targets: Vec<&SocketOf<P>> =
                sockets.iter().filter(|socket| *socket != sender).collect();
            telemetry.broadcast_targets = Some(targets.len());
            for update in &updates {
                for socket in &targets {
                    if let Err(error) = dss.send(
                        socket,
                        FromRemote::RemoteUpdate {
                            update: SliceWrapper::Raw(update),
                        },
                    ) {
                        tracing::warn!(error = ?error, "failed to send update to a peer; continuing");
                    }
                }
            }
        }
        // Handle an incoming awareness update from a peer
        // Should apply the update to the local epehemeral awareness strore
        FromPeer::PeerAwareness {
            awareness: awareness_update,
        } => {
            if let Err(e) = dss
                .memory
                .awareness
                .apply(*awareness_update, dss.ports.clock().unix_time())
            {
                tracing::warn!(error = ?e, "failed to apply awareness update; ignoring it");
                return Ok(());
            }
            let encodede = dss
                .memory
                .awareness
                .encode_all(dss.ports.clock().unix_time());
            let sockets = dss.active_sockets();
            telemetry.broadcast_targets =
                Some(sockets.iter().filter(|socket| *socket != sender).count());
            dss.broadcast_awareness(sender, &encodede);
        }
        // Handle a peer requesting a specific set of updates from the document.
        // The client sends a version vector (not frontiers) so unknown peers
        // — e.g. a peer that made offline edits the server hasn't seen yet —
        // don't cause a panic in `frontiersToVV` lookup.
        FromPeer::PeerRequestSince { vv } => {
            let decoded = VersionVector::decode(*vv).map_err(RoomError::VersionVector)?;

            let update = document_state.export_updates_since(&decoded)?;
            // Server end of the client's `doc.sync.catchup` span.
            telemetry.response_bytes = Some(update.len());

            // Echo the client's *original* vv bytes back, not a re-encoded copy.
            // The client correlates the response by byte-exact match on the vv it
            // sent; `decode(vv).encode()` is not guaranteed to reproduce the same
            // bytes for a multi-peer version vector, which would make the client
            // discard a perfectly good response and time out.
            dss.send(
                sender,
                FromRemote::RemoteUpdateSince {
                    update: SliceWrapper::Raw(&update),
                    vv,
                },
            )?;
        }
        // Peer is requesting a snapshot from the remote
        FromPeer::PeerRequestSnapshot {} => {
            let snapshot = document_state.export_shallow_snapshot()?;
            telemetry.response_bytes = Some(snapshot.len());

            dss.send(
                sender,
                FromRemote::RemoteSnapshot {
                    snapshot: SliceWrapper::Raw(&snapshot),
                },
            )?;
        }
        FromPeer::Unknown => {
            return Err(RoomError::UnknownMessage);
        }
    };

    Ok(())
}

/// A commenter's updates are accepted only when they change nothing but
/// comment marks. Anything that cannot be checked is refused.
#[tracing::instrument(skip_all, fields(document.id = %document_id, op.id = %op_id))]
async fn changes_only_comment_marks<P: RoomPorts>(
    dss: &Room<P>,
    document_state: &DocumentState,
    updates: &[SliceWrapper<'_, u8>],
    document_id: &str,
    op_id: &str,
) -> bool {
    let updates: Vec<&[u8]> = updates.iter().map(|update| &update[..]).collect();
    let change = match document_state.root_change(&updates) {
        Ok(Some(change)) => change,
        Ok(None) => {
            tracing::warn!("refused commenter update outside the document body or its history");
            return false;
        }
        Err(error) => {
            tracing::warn!(error = ?error, "refused commenter update that failed to import");
            return false;
        }
    };
    let span = tracing::info_span!(
        "comment_gate.check",
        document.id = document_id,
        op.id = op_id,
        outcome = tracing::field::Empty,
        error.kind = tracing::field::Empty,
        ms = tracing::field::Empty
    );
    let result = dss
        .ports
        .comment_gate()
        .is_comment_only_change(&change)
        .instrument(span.clone())
        .await;
    match &result {
        Ok(true) => {
            span.record("outcome", "allowed");
        }
        Ok(false) => {
            span.record("outcome", "refused");
        }
        Err(_) => {
            span.record("outcome", "error");
            span.record("error.kind", "upstream");
        }
    }
    match result {
        Ok(true) => true,
        Ok(false) => {
            tracing::warn!("refused commenter update that changes more than comment marks");
            false
        }
        Err(error) => {
            tracing::error!(error = ?error, "refused commenter update: comment check failed");
            false
        }
    }
}
