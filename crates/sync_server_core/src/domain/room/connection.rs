//! Connection and metadata policy shared by Worker callbacks and native replay.
use super::{PortName, Room, RoomError};
use crate::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::SourceState,
    operation_log::OperationLog,
    permissions::{AuthToken, WriteAccess},
    ports::*,
    socket::WebSocketId,
    types::{InteractionReason, SessionKey},
};
use bebop::{Record, SliceWrapper};
use macro_sync_service_jwt::session::SessionKind;
use sync_protocol::{FromRemote, framing};

/// Runtime socket handle, kept outside room memory.
pub type SocketOf<P> = <<P as RoomPorts>::Connections as Connections>::Socket;
/// Transport response selected by connection policy.
pub enum ConnectOutcome<S> {
    /// Socket has been accepted and may be returned to the client.
    Accepted {
        /// Accepted runtime handle.
        socket: S,
    },
    /// The socket remains accepted but its surface grant was rejected.
    Forbidden,
}
/// Session kind encoded in the persisted key.
pub fn session_kind(key: &str) -> SessionKind {
    if key.starts_with("surface:") {
        SessionKind::Surface
    } else {
        SessionKind::Document
    }
}
impl<P: RoomPorts> Room<P> {
    /// Restore the room identity lazily after hibernation.
    pub async fn try_session_key(&mut self) -> Result<Option<SessionKey>, RoomError> {
        if self.memory.session_key.is_none() {
            self.memory.session_key = self
                .ports
                .storage()
                .session_key()
                .await
                .map_err(|e| RoomError::port(PortName::Storage, e))?;
        }
        Ok(self.memory.session_key.clone())
    }
    /// Require the persisted room identity.
    pub async fn session_key(&mut self) -> Result<SessionKey, RoomError> {
        self.try_session_key().await?.ok_or(RoomError::NoSession)
    }
    /// Persist an identity only when this activation has none cached.
    pub async fn maybe_set_session_key(&mut self, key: &SessionKey) -> Result<bool, RoomError> {
        if self.memory.session_key.is_some() {
            return Ok(false);
        }
        self.ports
            .storage()
            .put_session_key(key)
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        self.memory.session_key = Some(key.clone());
        Ok(true)
    }
    /// Restore metadata on a cache miss, preserving the tag lookup before the read.
    pub async fn connection_metadata(
        &mut self,
        socket: &SocketOf<P>,
    ) -> Result<&ConnectionMetadata, RoomError> {
        let id = self.ports.connections().socket_id(socket)?;
        self.connection_metadata_by_id(&id).await
    }
    /// Restore metadata when a callback already resolved the hibernation tag.
    pub async fn connection_metadata_by_id(
        &mut self,
        id: &WebSocketId,
    ) -> Result<&ConnectionMetadata, RoomError> {
        if !self.memory.connections.contains_key(id) {
            let metadata = self
                .ports
                .storage()
                .connection(id)
                .await
                .map_err(|e| RoomError::port(PortName::Storage, e))?
                .ok_or_else(|| RoomError::MissingConnectionMetadata(id.clone()))?;
            self.memory.connections.insert(id.clone(), metadata);
        }
        Ok(self.memory.connections.get(id).expect("metadata restored"))
    }
    /// Read registered peers, including the legacy and signed agent filtering.
    pub async fn connection_peers(
        &mut self,
        socket: &SocketOf<P>,
        include_ai: bool,
    ) -> Result<Vec<u64>, RoomError> {
        Ok(self
            .connection_metadata(socket)
            .await?
            .active_peer_ids(include_ai))
    }
    /// Resolve the signed edit attribution associated with a socket.
    pub async fn connection_attribution(
        &mut self,
        socket: &SocketOf<P>,
    ) -> Result<Option<DocumentAttribution>, RoomError> {
        let meta = self.connection_metadata(socket).await?;
        DocumentAttribution::from_session_claims(
            meta.actor.clone(),
            meta.user_id.clone(),
            meta.agent_correlation_id,
        )
        .map_err(|e| RoomError::port(PortName::Storage, e))
    }
    /// Resolve writes only after restoring metadata, using a fresh expiry clock.
    pub async fn connection_write_access(
        &mut self,
        socket: &SocketOf<P>,
    ) -> Result<WriteAccess, RoomError> {
        let meta = self.connection_metadata(socket).await?.clone();
        Ok(meta.write_access(self.now_seconds()))
    }
    pub(super) fn now_seconds(&self) -> u64 {
        // Preserve wasm32's original usize truncation before widening.
        (self.ports.clock().unix_time_for(WallClock::SurfaceExpiry).0 / 1000) as u32 as u64
    }
    /// Restore the cached lifecycle without overwriting an in-memory transition.
    pub async fn surface_lifecycle(&mut self) -> Result<SurfaceLifecycle, RoomError> {
        if let Some(value) = self.memory.surface_lifecycle {
            return Ok(value);
        }
        let value = self
            .ports
            .storage()
            .surface_lifecycle()
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?
            .unwrap_or_default();
        Ok(*self.memory.surface_lifecycle.get_or_insert(value))
    }
    /// Whether source migration prevents document activity.
    pub async fn source_blocked(&mut self) -> Result<bool, RoomError> {
        if self.memory.source_migration.is_none() {
            self.memory.source_migration = Some(
                self.ports
                    .storage()
                    .source_migration()
                    .await
                    .map_err(|e| RoomError::port(PortName::Storage, e))?
                    .unwrap_or_default(),
            );
        }
        Ok(!matches!(
            self.memory.source_migration.as_ref(),
            Some(SourceState::Live | SourceState::Thawed(_))
        ))
    }
    /// Select sockets authorized by the currently cached session and grants.
    pub fn active_sockets(&self) -> Vec<SocketOf<P>> {
        let Some(key) = &self.memory.session_key else {
            return Vec::new();
        };
        if session_kind(key.as_str()) == SessionKind::Document {
            return self.ports.connections().all();
        }
        if self.memory.surface_lifecycle != Some(SurfaceLifecycle::Ready) {
            return Vec::new();
        }
        let now = self.now_seconds();
        self.ports
            .connections()
            .all()
            .into_iter()
            .filter(|socket| {
                self.ports
                    .connections()
                    .socket_id(socket)
                    .ok()
                    .and_then(|id| self.memory.connections.get(&id))
                    .is_some_and(|meta| meta.grant_active(SessionKind::Surface, now))
            })
            .collect()
    }
    /// Revalidate every surface socket and then the sender after awaited restores.
    pub async fn validate_surface_sockets(
        &mut self,
        sender: Option<&SocketOf<P>>,
    ) -> Result<bool, RoomError> {
        let key = self.session_key().await?;
        if session_kind(key.as_str()) == SessionKind::Document {
            return Ok(true);
        }
        let ready = self.surface_lifecycle().await? == SurfaceLifecycle::Ready;
        let now = self.now_seconds();
        for socket in self.ports.connections().all() {
            let meta = self.connection_metadata(&socket).await?;
            let active = ready && meta.grant_active(SessionKind::Surface, now);
            if !active {
                self.ports
                    .connections()
                    .close(&socket, CloseReason::SurfaceGrantExpiredOrRevoked)
                    .map_err(|e| RoomError::port(PortName::Connections, e))?;
            }
        }
        Ok(self.surface_lifecycle().await? == SurfaceLifecycle::Ready
            && sender.is_none_or(|sender| self.active_sockets().contains(sender)))
    }
    /// Load the imported document and operation log once per activation.
    pub async fn load_document(&mut self) -> Result<(), RoomError> {
        if self.memory.document.is_some() {
            return Ok(());
        }
        if self.memory.operation_log.is_none() {
            let key = self.session_key().await?;
            self.ports
                .snapshots()
                .prepare(&key)
                .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
            self.memory.operation_log =
                Some(OperationLog::new(key.clone(), session_kind(key.as_str())));
        }
        let state = self
            .memory
            .operation_log
            .as_mut()
            .expect("log initialized")
            .load_document_state(
                self.ports.storage(),
                self.ports.snapshots(),
                self.config.create_default_state,
            )
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
        self.memory.document = Some(state);
        Ok(())
    }
    /// Serialize and frame a server message using the frozen codec.
    pub fn send<'a>(&self, socket: &SocketOf<P>, message: FromRemote<'a>) -> Result<(), RoomError> {
        let mut bytes = Vec::new();
        message
            .serialize(&mut bytes)
            .map_err(|e| RoomError::port(PortName::Connections, e))?;
        for frame in framing::into_frames(&bytes, framing::MAX_CHUNK_SIZE) {
            self.ports
                .connections()
                .send_binary(socket, &frame)
                .map_err(|e| RoomError::port(PortName::Connections, e))?;
        }
        Ok(())
    }
    /// Schedule the legacy alarm only when no future alarm is already present.
    pub async fn bump_alarm(&self) -> Result<(), RoomError> {
        let current = self
            .ports
            .alarm()
            .scheduled()
            .await
            .map_err(|e| RoomError::port(PortName::Alarm, e))?;
        if current.is_some_and(|time| {
            time.0 > self.ports.clock().unix_time_for(WallClock::AlarmCompare).0
        }) {
            return Ok(());
        }
        self.ports
            .alarm()
            .schedule_in(self.config.alarm_delay)
            .await
            .map_err(|e| RoomError::port(PortName::Alarm, e))
    }
    /// Accept, persist metadata and send initial synchronization in the original order.
    pub async fn connect(
        &mut self,
        grant: AuthToken,
        key: SessionKey,
    ) -> Result<ConnectOutcome<SocketOf<P>>, RoomError> {
        self.maybe_set_session_key(&key).await?;
        let first = self.ports.connections().all().is_empty();
        let id = WebSocketId::from_tags(&[format!("ws_id{}", self.ports.entropy().socket_uuid())])?;
        let socket = self
            .ports
            .connections()
            .accept(&id)
            .map_err(|e| RoomError::port(PortName::Connections, e))?;
        let kind = grant.session_kind;
        let metadata = ConnectionMetadata {
            agent_correlation_id: grant.agent_correlation_id,
            user_id: grant.user_id,
            access_level: grant.access_level,
            actor: grant.actor,
            peer_ids: Default::default(),
            session_kind: kind,
            expires_at: grant.expires_at,
        };
        self.ports
            .storage()
            .put_connection(&id, &metadata)
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        self.memory.connections.insert(id, metadata);
        if kind == SessionKind::Surface && !self.validate_surface_sockets(Some(&socket)).await? {
            return Ok(ConnectOutcome::Forbidden);
        }
        let snapshot = match self.load_document().await {
            Ok(()) => self
                .memory
                .document
                .as_ref()
                .expect("document loaded")
                .export_shallow_snapshot()
                .map_err(RoomError::from),
            Err(e) => Err(e),
        };
        if let Ok(snapshot) = snapshot {
            tracing::Span::current().record("snapshot.bytes", snapshot.len());
            self.send(
                &socket,
                FromRemote::RemoteInitialSync {
                    snapshot: SliceWrapper::Raw(&snapshot),
                    awareness: SliceWrapper::Raw(&self.memory.awareness.encode_all()),
                },
            )?;
        } else {
            tracing::debug!(
                document_id = key.as_str(),
                "snapshot not yet available; deferring initial sync until /initialize"
            );
        }
        if first {
            self.ports.background().publish(match key.document() {
                Some(document) => DocumentPublication::Interaction {
                    document,
                    reason: InteractionReason::FirstJoin,
                },
                None => DocumentPublication::Noop,
            });
        }
        if kind == SessionKind::Surface {
            self.bump_alarm().await?;
        }
        Ok(ConnectOutcome::Accepted { socket })
    }
    /// Send the unframed heartbeat, retaining the original ignored send error.
    pub fn heartbeat(&self, socket: &SocketOf<P>) {
        self.ports
            .connections()
            .send_text(socket, sync_protocol::PONG)
            .ok();
    }
    async fn forget_connection(&mut self, socket: &SocketOf<P>) {
        let Ok(id) = self.ports.connections().socket_id(socket) else {
            return;
        };
        self.memory.inbound.remove(&id);
        self.memory.connections.remove(&id);
        if let Err(error) = self.ports.storage().delete_connection(&id).await {
            tracing::warn!(error = ?error, ws_id = id.as_str(), "failed to delete websocket metadata");
        }
    }
    /// Remove presence and publish LastLeave while the runtime still lists the closing socket.
    pub async fn on_close(&mut self, socket: &SocketOf<P>) -> Result<(), RoomError> {
        if self.source_blocked().await? {
            self.forget_connection(socket).await;
            return Ok(());
        }
        if self.try_session_key().await?.is_none() {
            self.forget_connection(socket).await;
            return Ok(());
        }
        self.validate_surface_sockets(None).await?;
        for peer in self.connection_peers(socket, true).await? {
            self.memory.awareness.delete(&peer.to_string());
            let awareness = self.memory.awareness.encode(&peer.to_string());
            for target in self.active_sockets() {
                if &target == socket {
                    continue;
                }
                if let Err(error) = self.send(
                    &target,
                    FromRemote::RemoteAwareness {
                        awareness: SliceWrapper::Raw(&awareness),
                    },
                ) {
                    tracing::warn!(error = ?error, "failed to send awareness to a peer; continuing");
                }
            }
        }
        if self.ports.connections().all().len() == 1
            && self.load_document().await.is_ok()
            && let Ok(key) = self.session_key().await
            && let Ok(snapshot) = self
                .memory
                .document
                .as_ref()
                .expect("document loaded")
                .export_shallow_snapshot()
        {
            let editors = std::mem::take(&mut self.memory.pending_editors)
                .into_iter()
                .collect();
            self.ports.background().publish(match key.document() {
                Some(document) => DocumentPublication::Snapshot {
                    document,
                    snapshot,
                    editors,
                    interaction: Some(InteractionReason::LastLeave),
                },
                None => DocumentPublication::Noop,
            });
        }
        self.forget_connection(socket).await;
        Ok(())
    }
}
