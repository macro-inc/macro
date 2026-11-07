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
use tracing::{Instrument, debug, error, info, instrument, trace, warn};
use worker::{
    Date, DurableObject, Env, Error, Method, Request, Response, ResponseBody, ResponseBuilder,
    Result, ScheduledTime, State, WebSocket, WebSocketIncomingMessage, WebSocketPair,
    durable_object,
};

use crate::{
    auth::{AuthToken, WriteAccess},
    constants::{SYSTEM_AUTHOR_ID, USER_PEER_D1_BINDING},
    d1::{get_user_id_from_peer_id, insert_missing_user_mappings, insert_user_mapping},
    domain::document::{DocumentAttribution, writing_peers},
    dss_internal::InteractionReason,
    error::ResultExt,
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    socket::{Socket, protocol},
    state::DocumentState,
    storage::{SessionStorage, get_snapshot_storage, snapshot::SnapshotStorage},
    tags::{get_ws_id_from_tags, new_ws_id},
    timeit,
};

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
mod peer_ids;
mod surface_api;
pub(crate) mod surface_migration;

use document_effects::{report_interaction, report_new_doc_state};
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

pub use sync_server_core::domain::connection::ConnectionMetadata as WebSocketMetadata;

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
    ws_id: Option<String>,
}
impl<'a, 'room> Wsm<'a, 'room> {
    pub fn new(dss: &'a mut SyncSession<'room>, ws: &'a WebSocket) -> Self {
        Self {
            dss,
            ws,
            ws_id: None,
        }
    }
    fn get_ws_id(&mut self) -> Result<&str> {
        if self.ws_id.is_none() {
            let tags = self.dss.state.get_tags(self.ws);
            let ws_id = get_ws_id_from_tags(&tags)?;
            self.ws_id = Some(ws_id);
        }
        Ok(self.ws_id.as_ref().unwrap())
    }
    async fn maybe_update_ws_meta_map(&mut self) -> Result<()> {
        let ws_id = self.get_ws_id()?.to_string();
        if !self.dss.connections.contains_key(&ws_id) {
            let wsm: WebSocketMetadata = self
                .dss
                .state
                .storage()
                .get(&ws_id)
                .await?
                .ok_or(Error::from("WebSocketMetadata not found in storage"))?;
            self.dss.connections.insert(
                sync_server_core::domain::socket::WebSocketId::from_tags(&[ws_id])
                    .map_err(|error| Error::from(error.to_string()))?,
                wsm,
            );
        }
        Ok(())
    }
    pub async fn get_peer_ids(&mut self, include_ai: bool) -> Result<Vec<u64>> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        Ok(self
            .dss
            .connections
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .active_peer_ids(include_ai))
    }

    pub async fn edit_attribution(&mut self) -> Result<Option<DocumentAttribution>> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        let map = &self.dss.connections;
        let meta = map.get(&ws_id).context("missing ws metadata")?;
        DocumentAttribution::from_session_claims(
            meta.actor.clone(),
            meta.user_id.clone(),
            meta.agent_correlation_id,
        )
        .context("invalid signed websocket attribution")
    }

    pub async fn write_access(&mut self) -> Result<WriteAccess> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        Ok(self
            .dss
            .connections
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .write_access(surface_api::now_seconds()))
    }

    pub async fn add_new_peerid(&mut self, peerid: u64, document_id: &str) -> Result<()> {
        self.maybe_update_ws_meta_map().await?;

        let ws_id = self.get_ws_id()?.to_string();

        let new_peer = {
            let wmm = &mut self.dss.connections;
            let meta = wmm
                .get_mut(&ws_id)
                .ok_or(Error::from("missing ws metadata"))?;

            if meta.peer_ids.insert(peerid) {
                Some(meta.clone())
            } else {
                None
            }
        };
        if let Some(meta) = new_peer {
            self.dss.state.storage().put(&ws_id, &meta).await?;
            // if user is not-anon
            if let Some(user_id) = meta.user_id {
                let db = self.dss.env.d1(USER_PEER_D1_BINDING)?;
                let span = tracing::info_span!(
                    "peer.register",
                    document.id = document_id,
                    peer.id = peerid
                );
                insert_user_mapping(db, &user_id, meta.actor.as_deref(), peerid, document_id)
                    .instrument(span)
                    .await?;
            }
        }
        Ok(())
    }
}
pub fn get_ws_id(state: &State, ws: &WebSocket) -> Result<String> {
    let tags = state.get_tags(ws);
    get_ws_id_from_tags(&tags)
}

/// Schedule an alarm 5 seconds from now.
async fn bump_alarm(state: &State) -> Result<()> {
    let current_alarm = state.storage().get_alarm().await?;

    if let Some(current_alarm) = current_alarm
        && current_alarm as f64 > {
            let now = Date::now().as_millis();
            #[cfg(feature = "transcript")]
            crate::transcript::clock("alarm_compare_ms", now);
            now as f64
        }
    {
        return Ok(());
    }

    #[cfg(feature = "transcript")]
    let scheduled = {
        let now = Date::now().as_millis();
        crate::transcript::clock("alarm_set_ms", now);
        ScheduledTime::new(worker::js_sys::Date::new(&((now + 5000) as f64).into()))
    };
    #[cfg(not(feature = "transcript"))]
    let scheduled = ScheduledTime::from(5000);
    state.storage().set_alarm(scheduled).await?;

    Ok(())
}

fn take_editors(editors: &mut BTreeSet<DocumentAttribution>) -> Vec<DocumentAttribution> {
    std::mem::take(editors).into_iter().collect()
}

impl SyncSession<'_> {
    pub(crate) fn env(&self) -> &Env {
        &self.env
    }

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

    async fn forget_websocket_metadata(&mut self, ws: &WebSocket) {
        let Ok(ws_id) = get_ws_id(&self.state, ws) else {
            return;
        };
        self.inbound.remove(&ws_id);
        self.connections.remove(&ws_id);
        if let Err(err) = self.state.storage().delete(&ws_id).await {
            warn!(error=?err, ws_id, "failed to delete websocket metadata");
        }
    }

    pub fn push_blame_events(&mut self, events: Vec<crate::d1::BlameEvent>) {
        if events.is_empty() {
            return;
        }
        self.pending_blame.extend(events);
    }

    /// Drain the pending blame buffer and write all events via a single D1
    /// batch in the background. Returns immediately; the actual write runs
    /// inside `wait_until` so the alarm handler doesn't block on D1.
    fn flush_pending_blame(&mut self) {
        let pending: Vec<crate::d1::BlameEvent> = std::mem::take(&mut self.pending_blame);
        if pending.is_empty() {
            return;
        }
        let env = self.env.clone();
        self.state.wait_until(crate::background(async move {
            if let Err(e) = crate::d1::insert_blame_many(&env, &pending).await {
                warn!(error = ?e, "failed to flush pending blame");
            }
        }));
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
        let (res, elap) = timeit!({
            if self.maybe_set_document_id(document_id).await? {
                trace!("init document_id={document_id}");
            } else {
                trace!("document_id={document_id} already set");
            }

            //  Below is websocket stuff only i.e connect
            let pair = WebSocketPair::new().context("failed to create websocket pair")?;

            // Whether this peer is the first to join the session (used to
            // decide whether to report a `FirstJoin` interaction below).
            let is_first_join = self.state.get_websockets().is_empty();

            // create tag for ws and store it
            let ws_id = new_ws_id();
            trace!(ws_id = ws_id, "websocket connect");

            self.state
                .accept_websocket_with_tags(&pair.server, &[&ws_id]);

            let ws_meta = WebSocketMetadata {
                agent_correlation_id: claims.agent_correlation_id,
                user_id: claims.user_id,
                access_level: claims.access_level,
                actor: claims.actor,
                peer_ids: Default::default(),
                session_kind: claims.session_kind,
                expires_at: claims.expires_at,
            };

            self.state.storage().put(&ws_id, &ws_meta).await?;
            self.connections.insert(
                sync_server_core::domain::socket::WebSocketId::from_tags(&[ws_id])
                    .map_err(|error| Error::from(error.to_string()))?,
                ws_meta,
            );

            // A surface may have been revoked while socket metadata was being
            // persisted. Recheck before sending any initial content.
            if claims.session_kind == SessionKind::Surface
                && !self.validate_surface_sockets(Some(&pair.server)).await?
            {
                return Ok(response(status_codes::FORBIDDEN));
            }

            // If the snapshot is already in storage, send the initial sync now.
            // Otherwise accept the WS without sending — initialize_handler will
            // broadcast initial sync to this socket once /initialize lands.
            let snapshot = self
                .document_state()
                .await
                .and_then(|state| state.export_shallow_snapshot());

            if let Ok(snapshot) = snapshot {
                // Size of the initial sync this connect sent — the server end
                // of the client's `doc.sync.initial-sync` span.
                tracing::Span::current().record("snapshot.bytes", snapshot.len());
                protocol::send_initial_sync(
                    &self.socket_for(&pair.server),
                    snapshot.as_slice(),
                    self.awareness.encode_all().as_slice(),
                )
                .context("failed to send initial sync message")?;
            } else {
                debug!(
                    document_id = document_id,
                    "snapshot not yet available; deferring initial sync until /initialize"
                );
            }

            // This is the single source of truth for `FirstJoin`: whenever
            // the peer count genuinely transitions 0 -> 1, regardless of
            // whether the document already has content.
            if is_first_join {
                let document_id_owned = document_id.to_string();
                let env = self.env.clone();
                self.state.wait_until(crate::background(async move {
                    report_interaction(&document_id_owned, &env, InteractionReason::FirstJoin)
                        .await;
                }));
            }

            if claims.session_kind == SessionKind::Surface {
                bump_alarm(&self.state).await?;
            }
            Response::from_websocket(pair.client).context("failed to create websocket response")?
        });

        trace!(
            document_id = document_id,
            duration_ms = elap.as_millis(),
            "DO::connect"
        );
        Ok(res)
    }

    async fn maybe_set_document_id(&mut self, document_id: &str) -> Result<bool> {
        if !self.document_id_is_some() {
            debug!("Setting DO::kv({DOCUMENT_ID_KEY}, {document_id})");
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id)
                .await?;
            self.session_key = Some(SessionKey::new(document_id.to_string()));
            Ok(true)
        } else {
            Ok(false)
        }
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

    fn document_id_is_some(&self) -> bool {
        self.session_key.is_some()
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
        if let Some(id) = self.session_key.as_ref().cloned() {
            return Ok(Some(id.to_string()));
        }
        let Some(id) = self
            .state
            .storage()
            .get::<String>(DOCUMENT_ID_KEY)
            .await
            .with_context(|| {
                format!(
                    "Could not get document_id via DOCUMENT_ID_KEY = [{}] from DO storage",
                    DOCUMENT_ID_KEY
                )
            })?
        else {
            return Ok(None);
        };
        let key = SessionKey::new(id.clone());
        self.session_key = Some(key);
        Ok(Some(id))
    }

    fn reset_session_storage(
        &mut self,
        snapshot: crate::storage::backends::Storage,
        id: &str,
        kind: SessionKind,
    ) {
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
        let snapshot = get_snapshot_storage(&self.env, &self.state, id.clone())?;
        self.reset_session_storage(snapshot, &id, session_kind_from_storage_key(&id));
        Ok(self
            .room
            .ports()
            .session_storage
            .as_ref()
            .expect("storage initialized")
            .clone())
    }

    /// Read-only handle; mutations target the owned Room document below.
    async fn document_state(&mut self) -> Result<DocumentState> {
        if self.document.is_none() {
            let storage = self.session_storage().await?;
            let document = storage
                .load_document_state(self.operation_log.as_mut().expect("log initialized"))
                .await?;
            self.document = Some(document);
        }
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
