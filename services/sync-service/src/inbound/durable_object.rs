use super::cors::{cors, is_origin_allowed};
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet, HashMap},
    rc::Rc,
    sync::Arc,
};

use bebop::Record;
use loro::{ExportMode, awareness::EphemeralStore};
use macro_sync_service_jwt::session::SessionKind;
use serde::{Deserialize, Serialize};
use tracing::{Instrument, debug, error, info, instrument, trace, warn};
use worker::{
    Date, DurableObject, Env, Error, Method, Request, Response, ResponseBody, ResponseBuilder,
    Result, ScheduledTime, State, WebSocket, WebSocketIncomingMessage, WebSocketPair,
    durable_object,
};

use crate::{
    auth::{AccessLevel, AuthToken, WriteAccess},
    constants::{SYSTEM_AUTHOR_ID, USER_PEER_D1_BINDING},
    d1::{get_user_id_from_peer_id, insert_missing_user_mappings, insert_user_mapping},
    domain::document::{DocumentAttribution, writing_peers},
    dss_internal::InteractionReason,
    error::ResultExt,
    generated::schema::InitializeFromSnapshotRequest,
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    mutex::Mutex,
    socket::{InboundBuffers, Socket, protocol},
    state::DocumentState,
    storage::{
        SessionStorage, backends::durable_kv::DurableKVStorage, get_snapshot_storage,
        snapshot::SnapshotStorage,
    },
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
use surface_api::{SurfaceLifecycle, session_kind_from_storage_key};

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebSocketMetadata {
    pub user_id: Option<String>,
    pub access_level: AccessLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(with = "u64_serde_strings")]
    pub peer_ids: BTreeSet<u64>,
    #[serde(default = "surface_api::document_kind")]
    pub session_kind: SessionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<usize>,
}

pub type WsMetaMap = BTreeMap<String, WebSocketMetadata>;

pub struct SyncSession {
    state: State,
    env: Env,
    /// id of the document, comes from URL path
    document_id: Mutex<Option<Arc<String>>>,
    /// Current document state
    document_state: Mutex<Option<Arc<DocumentState>>>,
    /// Access to document related IO
    session_storage: Mutex<Option<Rc<SessionStorage>>>,
    awareness: EphemeralStore,
    /// a map from websocket's ID's to websocket metadata
    ws_meta_map: Arc<Mutex<WsMetaMap>>,
    /// Partial inbound messages, isolated by connection.
    inbound: InboundBuffers,
    /// Buffered blame events. Flushed via D1 batch on each alarm tick.
    pending_blame: Arc<Mutex<Vec<crate::d1::BlameEvent>>>,
    /// Distinct editors since the last snapshot notification.
    pending_editors: Arc<Mutex<BTreeSet<DocumentAttribution>>>,
    /// Writing peers already recorded in D1 since this object woke, so
    /// updates skip remapping them.
    mapped_writing_peers: Mutex<BTreeSet<u64>>,
    surface_lifecycle: Mutex<Option<SurfaceLifecycle>>,
    source_migration: Mutex<Option<surface_migration::SourceState>>,
    // Serialize whole callbacks, including persistence awaits. A freeze must
    // drain every in-flight mutation before it exports or closes writers.
    mutation_barrier: futures::lock::Mutex<()>,
}

mod u64_serde_strings;

pub struct Wsm<'a> {
    dss: &'a SyncSession,
    ws: &'a WebSocket,
    ws_id: Option<String>,
}
impl<'a> Wsm<'a> {
    pub fn new(dss: &'a SyncSession, ws: &'a WebSocket) -> Self {
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
        if !self
            .dss
            .ws_meta_map
            .lock("Wsm::maybe_update_ws_meta_map contains_key")
            .contains_key(&ws_id)
        {
            let wsm: WebSocketMetadata = self
                .dss
                .state
                .storage()
                .get(&ws_id)
                .await?
                .ok_or(Error::from("WebSocketMetadata not found in storage"))?;
            self.dss
                .ws_meta_map
                .lock("Wsm::maybe_update_ws_meta_map insert")
                .insert(ws_id, wsm);
        }
        Ok(())
    }
    pub async fn get_peer_ids(&mut self, include_ai: bool) -> Result<Vec<u64>> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        Ok(self
            .dss
            .ws_meta_map
            .lock("Wsm::get_peer_ids get")
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .active_peer_ids(include_ai))
    }

    pub async fn edit_attribution(&mut self) -> Result<Option<DocumentAttribution>> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        let map = self.dss.ws_meta_map.lock("Wsm::edit_attribution");
        let meta = map.get(&ws_id).context("missing ws metadata")?;
        DocumentAttribution::from_session_claims(meta.actor.clone(), meta.user_id.clone())
            .context("invalid signed websocket attribution")
    }

    pub async fn write_access(&mut self) -> Result<WriteAccess> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        Ok(self
            .dss
            .ws_meta_map
            .lock("Wsm::write_access get")
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .write_access())
    }

    pub async fn add_new_peerid(&mut self, peerid: u64, document_id: &str) -> Result<()> {
        self.maybe_update_ws_meta_map().await?;

        let ws_id = self.get_ws_id()?.to_string();

        let new_peer = {
            let mut wmm = self.dss.ws_meta_map.lock("Wsm::add_new_peerid get_mut");
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
        && current_alarm as f64 > Date::now().as_millis() as f64
    {
        return Ok(());
    }

    state.storage().set_alarm(ScheduledTime::from(5000)).await?;

    Ok(())
}

fn take_editors(editors: &Mutex<BTreeSet<DocumentAttribution>>) -> Vec<DocumentAttribution> {
    std::mem::take(&mut *editors.lock("take document editors"))
        .into_iter()
        .collect()
}

impl SyncSession {
    pub(crate) fn env(&self) -> &Env {
        &self.env
    }

    pub(crate) fn socket_for(&self, ws: &WebSocket) -> Socket {
        Socket::new(ws.clone(), self.inbound.clone())
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

    pub(crate) fn record_editor(&self, attribution: Option<&DocumentAttribution>) {
        if let Some(attribution) = attribution {
            self.pending_editors
                .lock("record document editor")
                .insert(attribution.clone());
        }
    }

    async fn forget_websocket_metadata(&self, ws: &WebSocket) {
        let Ok(ws_id) = get_ws_id(&self.state, ws) else {
            return;
        };
        self.socket_for(ws).forget(&ws_id);
        self.ws_meta_map
            .lock("SyncSession::forget_websocket_metadata")
            .remove(&ws_id);
        if let Err(err) = self.state.storage().delete(&ws_id).await {
            warn!(error=?err, ws_id, "failed to delete websocket metadata");
        }
    }

    pub fn push_blame_events(&self, events: Vec<crate::d1::BlameEvent>) {
        if events.is_empty() {
            return;
        }
        self.pending_blame
            .lock("SyncSession::push_blame_events")
            .extend(events);
    }

    /// Drain the pending blame buffer and write all events via a single D1
    /// batch in the background. Returns immediately; the actual write runs
    /// inside `wait_until` so the alarm handler doesn't block on D1.
    fn flush_pending_blame(&self) {
        let pending: Vec<crate::d1::BlameEvent> =
            std::mem::take(&mut *self.pending_blame.lock("SyncSession::flush_pending_blame"));
        if pending.is_empty() {
            return;
        }
        let env = self.env.clone();
        self.state.wait_until(async move {
            if let Err(e) = crate::d1::insert_blame_many(&env, &pending).await {
                warn!(error = ?e, "failed to flush pending blame");
            }
        });
    }
    pub(super) fn secrets(&self) -> crate::secrets::Secrets {
        crate::secrets::Secrets::from(&self.env)
    }

    pub(super) async fn debug_get(&self, key: &str) -> Result<Response> {
        Response::from_json(&self.session_storage().await?.debug_do_kv_get(key).await?)
    }

    pub(super) async fn debug_list(&self, prefix: &str) -> Result<Response> {
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

    async fn inner_fetch(self: &Rc<Self>, req: Request) -> Result<Response> {
        let url = req.url()?;
        let segments: Vec<_> = url.path().split('/').collect();
        if let ["", "document", id, ..] = segments.as_slice() {
            tracing::Span::current().record("document.id", *id);
        }
        let migration = matches!(segments.as_slice(), ["", "document", _, "migration", _]);
        if !url.path().starts_with("/surface/") && !migration && self.source_blocked().await? {
            return Ok(response(status_codes::FORBIDDEN));
        }
        use tower_service::Service;
        let mut router = super::router::document_router(self.clone());
        let response = router.call(worker::HttpRequest::try_from(req)?).await;
        let response = response.unwrap_or_else(|error: std::convert::Infallible| match error {});
        Response::try_from(response)
    }

    pub(in crate::inbound) async fn initialize_handler(
        &self,
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
            *self
                .document_id
                .lock("SyncSession::document_id set within initialize_handler") =
                Some(Arc::new(document_id.to_string()));
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id.to_string())
                .await?;
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let session_storage = Rc::new(SessionStorage::new(
                storage,
                dkv_storage,
                SessionKind::Document,
            ));
            *self
                .session_storage
                .lock("SyncSession::session_storage set within initialize_handler") =
                Some(session_storage);
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
            self.state.wait_until(async move {
                report_new_doc_state(&document_id_owned, &snapshot, &env, Vec::new()).await;
            });
        }

        Response::empty()
    }

    /// Active peer ids. With `include_ai = false`, AI editors (peer ids from the
    /// reserved AI block or signed agent actors) are filtered out.
    pub(in crate::inbound) async fn active_peer_ids_handler(
        &self,
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

    pub(in crate::inbound) async fn exists_handler(&self, id: &str) -> Result<Response> {
        Ok(response(if self.exists(id).await? {
            status_codes::OK
        } else {
            status_codes::NOT_FOUND
        }))
    }

    pub(in crate::inbound) async fn raw_handler(&self, document_id: &str) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }
        let out = maybe_404!(self.document_state().await)?.get_json();
        Ok(ResponseBuilder::new().body(ResponseBody::Body(out.into_bytes())))
    }

    pub(in crate::inbound) async fn snapshot_handler(
        &self,
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

    pub(in crate::inbound) async fn dump_operations(&self, document_id: &str) -> Result<Response> {
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
        &self,
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

    pub(in crate::inbound) async fn wakeup(&self, document_id: &str) -> Result<Response> {
        let _ = self.warmup(document_id).await.inspect_err(
            |error| warn!(document_id = document_id, error = ?error, "failed to warm up document"),
        );

        let out = keepalive(DEFAULT_TIME_TO_LIVE);
        ResponseBuilder::new().from_json(&out)
    }

    async fn warmup(&self, document_id: &str) -> Result<()> {
        if !self.exists(document_id).await? {
            return Ok(());
        }

        self.session_storage().await?;
        self.document_state().await?;
        Ok(())
    }

    pub(in crate::inbound) async fn metadata_handler(&self, document_id: &str) -> Result<Response> {
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
        &self,
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
        &self,
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
                user_id: claims.user_id,
                access_level: claims.access_level,
                actor: claims.actor,
                peer_ids: Default::default(),
                session_kind: claims.session_kind,
                expires_at: claims.expires_at,
            };

            self.state.storage().put(&ws_id, &ws_meta).await?;
            self.ws_meta_map
                .lock("SyncSession::ws_meta_map insert in connect_handler")
                .insert(ws_id, ws_meta);

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
                self.state.wait_until(async move {
                    report_interaction(&document_id_owned, &env, InteractionReason::FirstJoin)
                        .await;
                });
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

    async fn maybe_set_document_id(&self, document_id: &str) -> Result<bool> {
        if !self.document_id_is_some() {
            debug!("Setting DO::kv({DOCUMENT_ID_KEY}, {document_id})");
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id)
                .await?;
            *self
                .document_id
                .lock("SyncSession::document_id set within maybe_set_document_id") =
                Some(Arc::new(document_id.to_string()));
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// A connected room identity does not imply initialized collaborative content.
    async fn exists(&self, document_id: &str) -> Result<bool> {
        let snapshot_storage =
            get_snapshot_storage(&self.env, &self.state, document_id.to_string())?;

        if snapshot_storage.has_snapshot().await? {
            self.maybe_set_document_id(document_id).await?;
            // set up session storage
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let session_storage = Rc::new(SessionStorage::new(
                snapshot_storage,
                dkv_storage,
                session_kind_from_storage_key(document_id),
            ));
            *self
                .session_storage
                .lock("SyncSession::session_storage set within exists") = Some(session_storage);
            return Ok(true);
        }
        Ok(false)
    }

    fn document_id_is_some(&self) -> bool {
        self.document_id
            .lock("SyncSession::document_id check is_some()")
            .is_some()
    }

    #[instrument(skip_all, err)]
    /// Get the `document_id`. First try checking self.document_id, if not there get from DOKV.
    async fn document_id(&self) -> Result<Arc<String>> {
        self.try_document_id()
            .await?
            .ok_or(Error::from("DOCUMENT_ID not found in storage"))
    }

    /// Like [`Self::document_id`], but `None` instead of an error when this
    /// object holds no session.
    async fn try_document_id(&self) -> Result<Option<Arc<String>>> {
        if let Some(id) = self
            .document_id
            .lock("SyncSession::document_id get within main document_id fn")
            .as_ref()
            .cloned()
        {
            return Ok(Some(id));
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
        let id = Arc::new(id);
        *self
            .document_id
            .lock("SyncSession::document_id set within main document_id fn") = Some(id.clone());
        Ok(Some(id))
    }

    async fn session_storage(&self) -> Result<Rc<SessionStorage>> {
        if let Some(ss) = self
            .session_storage
            .lock("session_storage get within main session_storage fn")
            .as_ref()
        {
            Ok(ss.clone())
        } else {
            let id = self.document_id().await?.to_string();
            let snapshot_storage = get_snapshot_storage(&self.env, &self.state, id.clone())?;
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let ss = Rc::new(SessionStorage::new(
                snapshot_storage,
                dkv_storage,
                session_kind_from_storage_key(&id),
            ));
            *self
                .session_storage
                .lock("SyncSession::session_storage set within main session_storage fn") =
                Some(ss.clone());
            Ok(ss)
        }
    }

    /// Gets DocumentState, loading it if needed
    async fn document_state(&self) -> Result<Arc<DocumentState>> {
        let Some(x) = self
            .document_state
            .lock("SyncSession::document_state get within main document_state fn")
            .as_ref()
            .cloned()
        else {
            let ss = Arc::new(self.session_storage().await?.load_document_state().await?);
            *self
                .document_state
                .lock("SyncSession::document_state set within main document_state fn") =
                Some(ss.clone());
            return Ok(ss);
        };
        Ok(x)
    }
}

pub use crate::domain::models::{
    CopyDocumentRequest, DocumentMetadata, GetSnapshotRequest, PeerResponse,
};

/// Cloudflare callback adapter. The shared session is confined to one isolate.
#[durable_object]
pub struct DocumentSyncSession {
    session: Rc<SyncSession>,
}

impl DurableObject for DocumentSyncSession {
    fn new(state: State, env: Env) -> Self {
        Self {
            session: Rc::new(SyncSession::new(state, env)),
        }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        self.session.fetch(req).await
    }

    async fn websocket_message(&self, ws: WebSocket, msg: WebSocketIncomingMessage) -> Result<()> {
        self.session.websocket_message(ws, msg).await
    }

    async fn alarm(&self) -> Result<Response> {
        self.session.alarm().await
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        code: usize,
        reason: String,
        was_clean: bool,
    ) -> Result<()> {
        self.session
            .websocket_close(ws, code, reason, was_clean)
            .await
    }

    async fn websocket_error(&self, ws: WebSocket, error: Error) -> Result<()> {
        self.session.websocket_error(ws, error).await
    }
}
