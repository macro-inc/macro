//! Document initialization and reads. CS-60: deferred body futures may be local
//! to the Worker; they are polled only after the original storage preconditions.
use super::{PortName, Room, RoomError};
use crate::domain::{
    document::writing_peers,
    models::{BlameRow, DocumentMetadata, GetSnapshotRequest},
    operation_log::OperationLog,
    ports::*,
    types::*,
};
use bebop::{Record, SliceWrapper};
use loro::{ExportMode, Frontiers, ID};
use macro_sync_service_jwt::session::SessionKind;
use std::{
    borrow::Cow,
    collections::BTreeSet,
    convert::Infallible,
    error::Error,
    future::{Future, ready},
};
use sync_protocol::{FromRemote, InitializeFromSnapshotRequest};

/// Initializer's successful transport outcomes.
#[derive(Debug, PartialEq, Eq)]
pub enum InitializeOutcome {
    /// Snapshot was stored; response is empty 200.
    Initialized,
    /// Existing snapshot: 409 with `snapshot already exists`.
    AlreadyInitialized,
}
/// Snapshot read's successful transport outcomes.
pub enum SnapshotOutcome {
    /// No durable snapshot exists.
    NotFound,
    /// Invalid peer or negative operation counter.
    BadRequest,
    /// Requested snapshot bytes.
    Snapshot(Vec<u8>),
}
/// Route classification performed by the HTTP adapter.
pub enum RouteClass {
    /// Any non-surface route other than source migration.
    Document,
    /// An isolated surface route.
    Surface,
    /// A source-migration control route.
    Migration,
}
/// Source migration's request gate result.
#[derive(Debug, PartialEq, Eq)]
pub enum RequestGate {
    /// Route may proceed to its ordinary authentication and handler.
    Allowed,
    /// Legacy route is blocked: empty 403.
    SourceBlocked,
}

impl<P: RoomPorts> Room<P> {
    /// Gate legacy requests while exempting surface and migration routes.
    pub async fn gate_request(&mut self, route: RouteClass) -> Result<RequestGate, RoomError> {
        if matches!(route, RouteClass::Document) && self.source_blocked().await? {
            Ok(RequestGate::SourceBlocked)
        } else {
            Ok(RequestGate::Allowed)
        }
    }
    /// Check durable content and preserve H9's unconditional operation-log reset.
    pub async fn exists(&mut self, key: &SessionKey) -> Result<bool, RoomError> {
        self.ports
            .snapshots()
            .prepare(key)
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
        if !self
            .ports
            .snapshots()
            .has(key)
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?
        {
            return Ok(false);
        }
        self.maybe_set_session_key(key).await?;
        self.memory.operation_log = Some(OperationLog::new(key.clone(), key.kind()));
        Ok(true)
    }
    /// Initialize from an already available wire request.
    pub async fn initialize(
        &mut self,
        key: SessionKey,
        request: &[u8],
    ) -> Result<InitializeOutcome, RoomError> {
        self.initialize_with_body(key, ready(Ok::<_, Infallible>(request)))
            .await
    }
    /// Initialize while retaining the legacy has-snapshot-before-body-read order.
    pub async fn initialize_with_body<F, B, E>(
        &mut self,
        key: SessionKey,
        body: F,
    ) -> Result<InitializeOutcome, RoomError>
    where
        F: Future<Output = Result<B, E>>,
        B: AsRef<[u8]>,
        E: Error + 'static,
    {
        self.ports
            .snapshots()
            .prepare(&key)
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
        if self
            .ports
            .snapshots()
            .has(&key)
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?
        {
            return Ok(InitializeOutcome::AlreadyInitialized);
        }
        let body = body
            .await
            .map_err(|e| RoomError::port(PortName::RequestBody, e))?;
        let request =
            InitializeFromSnapshotRequest::deserialize(body.as_ref()).map_err(|error| {
                RoomError::InitializeDecode {
                    key: key.as_str().to_owned(),
                    error,
                }
            })?;
        let writers: Vec<_> = writing_peers(&request.snapshot)?
            .into_iter()
            .map(PeerId)
            .collect();
        self.ports
            .peers()
            .map_unowned_peers(&key, SYSTEM_AUTHOR_ID, None, &writers)
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))?;
        self.ports
            .snapshots()
            .put(&key, &request.snapshot)
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
        self.memory.session_key = Some(key.clone());
        self.ports
            .storage()
            .put_session_key(&key)
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        self.memory.operation_log = Some(OperationLog::new(key.clone(), SessionKind::Document));
        // Do not clear a previously cached document: initialization retained it.
        if self.load_document().await.is_ok()
            && let Ok(snapshot) = self
                .memory
                .document
                .as_ref()
                .expect("document loaded")
                .export_shallow_snapshot()
        {
            let awareness = self
                .memory
                .awareness
                .encode_all(self.ports.clock().unix_time());
            for socket in self.ports.connections().all() {
                if let Err(error) = self.send(
                    &socket,
                    FromRemote::RemoteInitialSync {
                        snapshot: SliceWrapper::Raw(&snapshot),
                        awareness: SliceWrapper::Raw(&awareness),
                    },
                ) {
                    tracing::warn!(error = ?error, "failed to send delayed initial sync to a waiting peer");
                }
            }
            self.ports.background().publish(match key.document() {
                Some(document) => DocumentPublication::Snapshot {
                    document,
                    snapshot,
                    editors: Vec::new(),
                    interaction: None,
                },
                None => DocumentPublication::Noop,
            });
        }
        Ok(InitializeOutcome::Initialized)
    }
    /// Return the full JSON state, retaining 500 on failed loads (R2 quirk).
    pub async fn raw_json(&mut self, key: &SessionKey) -> Result<Option<String>, RoomError> {
        if !self.exists(key).await? {
            return Ok(None);
        }
        self.load_document().await?;
        Ok(Some(
            self.memory
                .document
                .as_ref()
                .expect("document loaded")
                .get_json(),
        ))
    }
    /// Read a snapshot from an already parsed request.
    pub async fn snapshot(
        &mut self,
        key: &SessionKey,
        request: Option<GetSnapshotRequest>,
    ) -> Result<SnapshotOutcome, RoomError> {
        self.snapshot_with_body(key, ready(Ok::<_, Infallible>(request)))
            .await
    }
    /// Keep exists before body parsing and frontier validation before state loading.
    pub async fn snapshot_with_body<F, E>(
        &mut self,
        key: &SessionKey,
        request: F,
    ) -> Result<SnapshotOutcome, RoomError>
    where
        F: Future<Output = Result<Option<GetSnapshotRequest>, E>>,
        E: Error + 'static,
    {
        if !self.exists(key).await? {
            return Ok(SnapshotOutcome::NotFound);
        }
        let request = request
            .await
            .map_err(|e| RoomError::port(PortName::RequestBody, e))?;
        let mode = match request.and_then(|request| request.version_id) {
            Some(version) => {
                let Ok(peer) = version.peer.parse::<u64>() else {
                    return Ok(SnapshotOutcome::BadRequest);
                };
                if version.counter < 0 {
                    return Ok(SnapshotOutcome::BadRequest);
                }
                Some(ExportMode::StateOnly(Some(Cow::Owned(Frontiers::ID(
                    ID::new(peer, version.counter),
                )))))
            }
            None => None,
        };
        self.load_document().await?;
        Ok(SnapshotOutcome::Snapshot(
            self.memory
                .document
                .as_ref()
                .expect("document loaded")
                .export_snapshot(mode)?,
        ))
    }
    /// Union active peers in numeric order, preserving anonymous and agent filtering.
    pub async fn active_peers(&mut self, include_ai: bool) -> Result<Vec<PeerId>, RoomError> {
        if !self.ports.connections().all().is_empty() {
            self.validate_surface_sockets(None).await?;
        }
        let mut peers = BTreeSet::new();
        for socket in self.active_sockets() {
            peers.extend(
                self.connection_peers(&socket, include_ai)
                    .await?
                    .into_iter()
                    .map(PeerId),
            );
        }
        Ok(peers.into_iter().collect())
    }
    /// Read a peer's user, retaining the missing-user error rather than returning 404.
    pub async fn peer_user(&self, key: &SessionKey, peer: PeerId) -> Result<String, RoomError> {
        self.ports
            .peers()
            .user_for_peer(key, peer)
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))?
            .ok_or(RoomError::MissingPeer)
    }
    /// Return peer attribution and the current frontier-derived version identifier.
    pub async fn metadata(
        &mut self,
        key: &SessionKey,
    ) -> Result<Option<DocumentMetadata>, RoomError> {
        if !self.exists(key).await? {
            return Ok(None);
        }
        let peers = self
            .ports
            .peers()
            .peers(key)
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))?;
        self.load_document().await?;
        let version_id = self
            .memory
            .document
            .as_ref()
            .expect("document loaded")
            .version_id();
        Ok(Some(DocumentMetadata {
            id: key.as_str().to_owned(),
            peers,
            version_id,
        }))
    }
    /// Read last-edit attribution for the session's node.
    pub async fn blame(&mut self, node: &str) -> Result<Option<BlameRow>, RoomError> {
        let key = self.session_key().await?;
        self.ports
            .peers()
            .blame_for_node(&key, node)
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))
    }
    /// Warm durable state. The adapter owns the JS timer and its previous-ID response.
    pub async fn warm_up(&mut self, key: &SessionKey) -> Result<(), RoomError> {
        if self.exists(key).await? {
            self.load_document().await?;
        }
        Ok(())
    }
}
