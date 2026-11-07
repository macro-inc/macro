//! Worker callback adapter. CS-61: the single-threaded DO uses a futures mutex
//! as its whole-callback barrier; runtime handles never enter RoomMemory.
use super::cors::{cors, is_origin_allowed};
use crate::outbound::room_ports::WorkerPorts;
use std::{borrow::Cow, collections::BTreeSet, rc::Rc, sync::Arc};
use sync_protocol::InitializeFromSnapshotRequest;
use sync_protocol::time::WallDuration;
use sync_server_core::domain::{
    operation_log::OperationLog,
    ports::RoomPorts,
    room::{Room, RoomConfig, RoomMemory},
    types::SessionKey,
};

use bebop::Record;
use loro::ExportMode;
use macro_sync_service_jwt::session::SessionKind;
use tracing::{Instrument, debug, error, instrument, trace, warn};
use worker::{
    DurableObject, Env, Error, Method, Request, Response, ResponseBody, ResponseBuilder, Result,
    State, WebSocket, WebSocketIncomingMessage, durable_object,
};

use crate::{
    auth::AuthToken,
    constants::{SYSTEM_AUTHOR_ID, USER_PEER_D1_BINDING},
    d1::{get_user_id_from_peer_id, insert_missing_user_mappings},
    domain::document::{DocumentAttribution, writing_peers},
    error::ResultExt,
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    socket::{Socket, protocol},
    state::DocumentState,
    storage::{SessionStorage, get_snapshot_storage, snapshot::SnapshotStorage},
    tags::get_ws_id_from_tags,
};

fn room_error(error: sync_server_core::domain::room::RoomError) -> Error {
    Error::from(error.to_string())
}

pub const NO_SUCH_VALUE_ERR_STR: &str = "No such value in storage.";

pub mod status_codes {
    pub const OK: u16 = 200;
    pub const NOT_FOUND: u16 = 404;
    pub const UNAUTH: u16 = 401;
    pub const FORBIDDEN: u16 = 403;
}

const DOCUMENT_ID_KEY: &str = "DOCUMENT_ID";

mod callbacks;
pub(crate) mod document_api;
mod document_delete;
mod document_effects;
mod surface_api;
pub(crate) mod surface_migration;

use document_effects::report_new_doc_state;
use surface_api::session_kind_from_storage_key;

pub fn response(status_code: u16) -> Response {
    Response::builder().with_status(status_code).empty()
}

#[macro_export]
macro_rules! maybe_404 {
    ($res:expr) => {
        match $res {
            Ok(x) => Ok(x),
            Err(Error::JsError(s)) => {
                if s.contains(NO_SUCH_VALUE_ERR_STR) {
                    return Ok(ResponseBuilder::new()
                        .with_status(status_codes::NOT_FOUND)
                        .empty());
                } else {
                    Err(Error::JsError(s))
                }
            }
            Err(e) => Err(e),
        }
    };
}

/// A callback-local adapter borrowing the single locked room.
pub struct SyncSession<'room> {
    room: &'room mut Room<WorkerPorts>,
    state: Rc<State>,
    env: Env,
}
impl<'room> SyncSession<'room> {
    pub(super) fn new(room: &'room mut Room<WorkerPorts>, state: Rc<State>, env: Env) -> Self {
        Self { room, state, env }
    }
}
impl std::ops::Deref for SyncSession<'_> {
    type Target = RoomMemory;
    fn deref(&self) -> &Self::Target {
        self.room.memory_view()
    }
}
impl std::ops::DerefMut for SyncSession<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.room.memory_mut()
    }
}

pub struct Wsm<'a, 'room> {
    dss: &'a mut SyncSession<'room>,
    ws: &'a WebSocket,
}
impl<'a, 'room> Wsm<'a, 'room> {
    pub fn new(dss: &'a mut SyncSession<'room>, ws: &'a WebSocket) -> Self {
        Self { dss, ws }
    }
    pub async fn get_peer_ids(&mut self, include_ai: bool) -> Result<Vec<u64>> {
        self.dss
            .room
            .connection_peers(self.ws, include_ai)
            .await
            .map_err(room_error)
    }
}
pub fn get_ws_id(state: &State, ws: &WebSocket) -> Result<String> {
    let tags = state.get_tags(ws);
    get_ws_id_from_tags(&tags)
}

fn take_editors(editors: &mut BTreeSet<DocumentAttribution>) -> Vec<DocumentAttribution> {
    std::mem::take(editors).into_iter().collect()
}

impl SyncSession<'_> {
    pub(crate) fn socket_for(&self, ws: &WebSocket) -> Socket {
        Socket::new(ws.clone())
    }

    pub(crate) fn get_sockets(&self) -> Vec<Socket> {
        self.active_websockets()
            .into_iter()
            .map(|ws| self.socket_for(&ws))
            .collect()
    }

    pub fn get_websockets(&self) -> Vec<WebSocket> {
        self.active_websockets()
    }

    pub(crate) fn record_editor(&mut self, attribution: Option<&DocumentAttribution>) {
        if let Some(attribution) = attribution {
            self.pending_editors.insert(attribution.clone());
        }
    }

    pub(super) async fn debug_get(&mut self, key: &str) -> Result<Response> {
        Response::from_json(&self.session_storage().await?.debug_do_kv_get(key).await?)
    }

    pub(super) async fn debug_list(&mut self, prefix: &str) -> Result<Response> {
        let values: Vec<(String, Vec<u8>)> = self
            .session_storage()
            .await?
            .debug_list_do_kv(prefix)
            .await?
            .into_iter()
            .filter_map(Result::ok)
            .collect();
        Response::from_json(&values)
    }

    async fn gate_request(&mut self, req: &Request) -> Result<Option<Response>> {
        let url = req.url()?;
        let segments: Vec<_> = url.path().split('/').collect();
        if let ["", "document", id, ..] = segments.as_slice() {
            tracing::Span::current().record("document.id", *id);
        }
        let migration = matches!(segments.as_slice(), ["", "document", _, "migration", _]);
        if !url.path().starts_with("/surface/") && !migration && self.source_blocked().await? {
            return Ok(Some(response(status_codes::FORBIDDEN)));
        }
        Ok(None)
    }

    pub(in crate::inbound) async fn initialize_handler(
        &mut self,
        mut req: Request,
        document_id: &str,
    ) -> Result<Response> {
        // NB: we expect SyncSession to not be initialized. If it is initialized, it's an error.
        let storage = get_snapshot_storage(&self.env, &self.state, document_id.to_string())?;

        if storage.has_snapshot().await? {
            return Response::error("snapshot already exists", 409);
        } else {
            debug!(document_id = document_id, "Initializing snapshot");
            let body_raw = req.bytes().await?;
            let body = InitializeFromSnapshotRequest::deserialize(&body_raw).with_context(|| format!("Failed to deserialize InitializeFromSnapshotRequest with document_id: [{document_id}]"))?;
            // Services initialize documents (imports, uploads, copies), so the
            // snapshot's peers belong to the system author unless already mapped.
            // Mapped before storing: a failed store is retried, a stored one is not.
            let writers = writing_peers(&body.snapshot)
                .map_err(|error| Error::from(format!("invalid initial snapshot: {error}")))?;
            let db = self.env.d1(USER_PEER_D1_BINDING)?;
            insert_missing_user_mappings(&db, document_id, SYSTEM_AUTHOR_ID, None, &writers)
                .await?;
            storage.store_snapshot(&body.snapshot).await?;
            self.session_key = Some(SessionKey::new(document_id.to_string()));
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id.to_string())
                .await?;
            self.reset_session_storage(storage, document_id, SessionKind::Document);
        }

        // Broadcast initial sync to any sockets that connected before init landed.
        if let Ok(state) = self.document_state().await
            && let Ok(snapshot) = state.export_shallow_snapshot()
        {
            let awareness = self.awareness.encode_all();
            for ws in &self.state.get_websockets() {
                if let Err(e) = protocol::send_initial_sync(
                    &self.socket_for(ws),
                    snapshot.as_slice(),
                    awareness.as_slice(),
                ) {
                    warn!(
                        error =? e,
                        "failed to send delayed initial sync to a waiting peer"
                    );
                }
            }
            let document_id_owned = document_id.to_string();
            let env = self.env.clone();
            self.state.wait_until(crate::background(async move {
                report_new_doc_state(&document_id_owned, &snapshot, &env, Vec::new()).await;
            }));
        }

        Response::empty()
    }

    /// Active peer ids. With `include_ai = false`, AI editors (peer ids from the
    /// reserved AI block or signed agent actors) are filtered out.
    pub(in crate::inbound) async fn active_peer_ids_handler(
        &mut self,
        include_ai: bool,
    ) -> Result<Response> {
        if !self.state.get_websockets().is_empty() {
            self.validate_surface_sockets(None).await?;
        }
        let mut peer_ids: BTreeSet<u64> = BTreeSet::new();
        for ws in self.get_websockets() {
            peer_ids.extend(Wsm::new(self, &ws).get_peer_ids(include_ai).await?);
        }
        let str_ids = peer_ids
            .into_iter()
            .map(|p| p.to_string())
            .collect::<Vec<String>>();

        let result = serde_json::to_vec(&str_ids).context("Failed to serialize ids")?;
        Ok(ResponseBuilder::new().body(ResponseBody::Body(result)))
    }

    pub(in crate::inbound) async fn exists_handler(&mut self, id: &str) -> Result<Response> {
        Ok(response(if self.exists(id).await? {
            status_codes::OK
        } else {
            status_codes::NOT_FOUND
        }))
    }

    pub(in crate::inbound) async fn raw_handler(&mut self, document_id: &str) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }
        let out = maybe_404!(self.document_state().await)?.get_json();
        Ok(ResponseBuilder::new().body(ResponseBody::Body(out.into_bytes())))
    }

    pub(in crate::inbound) async fn snapshot_handler(
        &mut self,
        mut req: Request,
        document_id: &str,
    ) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }

        let bytes = req.bytes().await?;
        let body: Option<GetSnapshotRequest> = if bytes.is_empty() {
            None
        } else {
            Some(serde_json::from_slice(&bytes)?)
        };

        let frontiers = match body.and_then(|request| request.version_id) {
            Some(version) => {
                let Ok(peer) = version.peer.parse::<u64>() else {
                    return Ok(response(400));
                };
                if version.counter < 0 {
                    return Ok(response(400));
                }
                Some(ExportMode::StateOnly(Some(Cow::Owned(
                    loro::Frontiers::ID(loro::ID::new(peer, version.counter)),
                ))))
            }
            None => None,
        };

        let out = maybe_404!(self.document_state().await)?
            .export_snapshot(frontiers)
            .context("Couldn't export snapshot")?;
        Ok(ResponseBuilder::new().body(ResponseBody::Body(out)))
    }

    pub(in crate::inbound) async fn dump_operations(
        &mut self,
        document_id: &str,
    ) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }
        let pending_ops = self
            .session_storage()
            .await?
            .get_pending_operations()
            .await?;

        let n_pending_ops = pending_ops.len();
        trace!(
            pending_ops_len = n_pending_ops,
            "Applying [{}] pending ops", n_pending_ops
        );

        let mut ers = vec![];
        let mut key_ops = vec![];
        for res_op in pending_ops {
            match res_op {
                Ok((k, o)) => key_ops.push((k, o)),
                Err(e) => ers.push(e),
            }
        }
        if !ers.is_empty() {
            error!(errors =? ers, "DO KV operations got [{}] errors", ers.len());
        }

        ResponseBuilder::new().from_json(&key_ops)
    }

    pub(in crate::inbound) async fn peer_handler(
        &mut self,
        document_id: &str,
        peer_id: Option<&str>,
    ) -> Result<Response> {
        let (user_id, peer_id) = if let Some(p) = peer_id {
            let p64: u64 = p
                .parse()
                .with_context(|| format!("Couldn't parse peer_id: '{p}' into u64"))?;
            let db = self.env.d1(USER_PEER_D1_BINDING)?;
            let user_id = get_user_id_from_peer_id(db, document_id, &p64).await?;
            (user_id, p.to_string())
        } else {
            return Err(Error::from("missing `peer_id` in path"));
        };
        ResponseBuilder::new().from_json(&PeerResponse { peer_id, user_id })
    }

    pub(in crate::inbound) async fn wakeup(&mut self, document_id: &str) -> Result<Response> {
        let _ = self.warmup(document_id).await.inspect_err(
            |error| warn!(document_id = document_id, error = ?error, "failed to warm up document"),
        );

        let out = keepalive(DEFAULT_TIME_TO_LIVE);
        ResponseBuilder::new().from_json(&out)
    }

    async fn warmup(&mut self, document_id: &str) -> Result<()> {
        if !self.exists(document_id).await? {
            return Ok(());
        }

        self.session_storage().await?;
        self.document_state().await?;
        Ok(())
    }

    pub(in crate::inbound) async fn metadata_handler(
        &mut self,
        document_id: &str,
    ) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }
        let db = self.env.d1(USER_PEER_D1_BINDING)?;
        let peers = crate::d1::get_peers_for_document_id(db, document_id).await?;
        let version_id = self.document_state().await?.version_id();
        ResponseBuilder::new().from_json(&DocumentMetadata {
            peers,
            version_id: version_id.to_string(),
            id: document_id.to_string(),
        })
    }

    pub(in crate::inbound) async fn blame_handler(
        &mut self,
        node_id: Option<&str>,
    ) -> Result<Response> {
        let node_id = node_id.ok_or_else(|| Error::from("missing node_id"))?;
        let document_id = self.document_id().await?.to_string();
        let db = self.env.d1(USER_PEER_D1_BINDING)?;
        match crate::d1::get_blame_for_node(db, &document_id, node_id).await? {
            Some(row) => ResponseBuilder::new().from_json(&row),
            None => Ok(response(status_codes::NOT_FOUND)),
        }
    }

    pub(in crate::inbound) async fn connect(
        &mut self,
        claims: AuthToken,
        document_id: &str,
    ) -> Result<Response> {
        use sync_server_core::domain::room::ConnectOutcome;
        match self
            .room
            .connect(claims, SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)?
        {
            ConnectOutcome::Forbidden => Ok(response(status_codes::FORBIDDEN)),
            ConnectOutcome::Accepted { .. } => Response::from_websocket(
                self.room
                    .ports()
                    .connections()
                    .take_accepted_client()
                    .context("missing accepted websocket")?,
            )
            .context("failed to create websocket response"),
        }
    }

    async fn maybe_set_document_id(&mut self, document_id: &str) -> Result<bool> {
        self.room
            .maybe_set_session_key(&SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)
    }

    /// A connected room identity does not imply initialized collaborative content.
    async fn exists(&mut self, document_id: &str) -> Result<bool> {
        let snapshot_storage =
            get_snapshot_storage(&self.env, &self.state, document_id.to_string())?;

        if snapshot_storage.has_snapshot().await? {
            self.maybe_set_document_id(document_id).await?;
            // set up session storage
            self.reset_session_storage(
                snapshot_storage,
                document_id,
                session_kind_from_storage_key(document_id),
            );
            return Ok(true);
        }
        Ok(false)
    }

    #[instrument(skip_all, err)]
    /// Get the `document_id`. First try checking self.session_key, if not there get from DOKV.
    async fn document_id(&mut self) -> Result<String> {
        self.try_document_id()
            .await?
            .ok_or(Error::from("DOCUMENT_ID not found in storage"))
    }

    /// Like [`Self::document_id`], but `None` instead of an error when this
    /// object holds no session.
    async fn try_document_id(&mut self) -> Result<Option<String>> {
        self.room
            .try_session_key()
            .await
            .map(|key| key.map(|key| key.as_str().to_owned()))
            .map_err(room_error)
    }

    fn reset_session_storage(
        &mut self,
        snapshot: crate::storage::backends::Storage,
        id: &str,
        kind: SessionKind,
    ) {
        let snapshot = Rc::new(snapshot);
        self.room
            .ports()
            .snapshots()
            .adopt(SessionKey::new(id.to_owned()), snapshot.clone());
        let storage = SessionStorage::new(
            snapshot,
            self.room.ports().storage().clone(),
            id.to_owned(),
            self.state.clone(),
        );
        self.room.ports_mut().session_storage = Some(Rc::new(storage));
        self.operation_log = Some(OperationLog::new(SessionKey::new(id.to_owned()), kind));
    }
    async fn session_storage(&mut self) -> Result<Rc<SessionStorage>> {
        if let Some(storage) = &self.room.ports().session_storage {
            return Ok(storage.clone());
        }
        let id = self.document_id().await?;
        let key = SessionKey::new(id.clone());
        let snapshot = self.room.ports().snapshots().backend(&key)?;
        let storage = Rc::new(SessionStorage::new(
            snapshot,
            self.room.ports().storage().clone(),
            id,
            self.state.clone(),
        ));
        self.room.ports_mut().session_storage = Some(storage.clone());
        if self.operation_log.is_none() {
            self.operation_log = Some(OperationLog::new(key.clone(), key.kind()));
        }
        Ok(storage)
    }

    /// Read-only handle; mutations target the owned Room document below.
    async fn document_state(&mut self) -> Result<DocumentState> {
        self.room.load_document().await.map_err(room_error)?;
        Ok(DocumentState::view(
            self.document.as_ref().expect("document loaded"),
        ))
    }
    pub(crate) async fn apply_update(
        &mut self,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> Result<crate::state::ImportedUpdate> {
        let storage = self.session_storage().await?;
        self.document_state().await?;
        let memory = self.room.memory_mut();
        storage
            .apply_with_attribution(
                memory.operation_log.as_mut().expect("log initialized"),
                memory.document.as_mut().expect("document loaded"),
                update,
                attribution,
            )
            .await
    }
}

pub use crate::domain::models::{
    CopyDocumentRequest, DocumentMetadata, GetSnapshotRequest, PeerResponse,
};

/// Cloudflare callback adapter. One owned guard is the callback barrier.
#[durable_object]
pub struct DocumentSyncSession {
    state: Rc<State>,
    env: Env,
    room: Arc<futures::lock::Mutex<Room<WorkerPorts>>>,
}
