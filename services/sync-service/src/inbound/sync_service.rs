use std::{borrow::Cow, collections::BTreeSet, rc::Rc, sync::Arc};

use bebop::Record;
use loro::{ExportMode, awareness::EphemeralStore};
use tracing::{debug, error, instrument, trace, warn};
use worker::{Env, Error, Response, State, WebSocket, WebSocketPair};

use crate::{
    constants::USER_PEER_D1_BINDING,
    domain::{
        ai_peer::is_ai_peer,
        document_id::DocumentId,
        models::{BlameRow, DocumentMetadata, GetSnapshotRequest, PeerResponse},
        permissions::AuthToken,
        ports::{SyncServiceAdmin, SyncServiceCore, SyncServiceError},
        state::DocumentState,
    },
    error::ResultExt,
    generated::schema::InitializeFromSnapshotRequest,
    inbound::{
        durable_object::{NO_SUCH_VALUE_ERR_STR, WebSocketMetadata, WsMetaMap, get_ws_id},
        socket::{RemoteSocket, websocket},
    },
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    mutex::Mutex,
    outbound::{
        d1::{BlameEvent, get_blame_for_node, get_user_id_from_peer_id, insert_user_mapping},
        dss_internal::{DssInternal, DssInternalClient, InteractionReason},
        storage::{
            SessionStorage, backends::durable_kv::DurableKVStorage, get_snapshot_storage,
            snapshot::SnapshotStorage,
        },
    },
    tags::new_ws_id,
    timeit,
};

const DOCUMENT_ID_KEY: &str = "DOCUMENT_ID";

/// send a shallow snapshot to cache and search service
/// we should eagerly call this from time to time to keep our backend up to date on
/// the status of the document:
/// - every few seconds
/// - on creation
/// - on everyone being disconnected
pub(crate) async fn report_new_doc_state(document_id: &DocumentId, snapshot: &[u8], env: &Env) {
    if let Err(err) = DssInternalClient::new(env)
        .publish_shallow_snapshot(document_id, snapshot)
        .await
    {
        warn!(error=?err, "failed to push snapshot to DSS");
    }
    #[cfg(feature = "search-service")]
    if let Err(err) = crate::outbound::sps::update(document_id, env).await {
        warn!(error=?err, "failed to update search index");
    }
}

/// Report an interaction (join/leave/periodic edit) to DSS.
pub(crate) async fn report_interaction(
    document_id: &DocumentId,
    env: &Env,
    reason: InteractionReason,
) {
    if let Err(err) = DssInternalClient::new(env)
        .publish_interaction(document_id.as_str(), reason)
        .await
    {
        warn!(error=?err, "failed to push interaction to DSS");
    }
}

pub struct SyncServiceImpl {
    pub(crate) state: State,
    pub(crate) env: Env,
    /// id of the document, comes from URL path
    document_id: Mutex<Option<Arc<DocumentId>>>,
    /// Current document state
    document_state: Mutex<Option<Arc<DocumentState>>>,
    /// Access to document related IO
    session_storage: Mutex<Option<Rc<SessionStorage>>>,
    pub(crate) awareness: EphemeralStore,
    /// a map from websocket's ID's to websocket metadata
    ws_meta_map: Arc<Mutex<WsMetaMap>>,
    /// Buffered blame events. Flushed via D1 batch on each alarm tick.
    pending_blame: Arc<Mutex<Vec<BlameEvent>>>,
}

pub struct Wsm<'a> {
    dss: &'a SyncServiceImpl,
    id: String,
}
impl<'a> Wsm<'a> {
    pub fn new(dss: &'a SyncServiceImpl, id: String) -> Self {
        Self { dss, id }
    }

    async fn maybe_update_ws_meta_map(&mut self) -> worker::Result<()> {
        let ws_id = self.id.clone();
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

    pub async fn get_peer_ids(&mut self) -> worker::Result<Vec<u64>> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.id.clone();
        Ok(self
            .dss
            .ws_meta_map
            .lock("Wsm::get_peer_ids get")
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .peer_ids
            .iter()
            .cloned()
            .collect())
    }

    pub async fn can_edit(&mut self) -> worker::Result<bool> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.id.clone();
        Ok(self
            .dss
            .ws_meta_map
            .lock("Wsm::can_edit get")
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .access_level
            .can_edit())
    }

    pub async fn add_new_peerid(
        &mut self,
        peerid: u64,
        document_id: &DocumentId,
    ) -> worker::Result<()> {
        self.maybe_update_ws_meta_map().await?;

        let ws_id = self.id.clone();

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
                insert_user_mapping(db, &user_id, peerid, document_id).await?;
            }
        }
        Ok(())
    }
}

impl SyncServiceImpl {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        state: State,
        env: Env,
        document_id: Mutex<Option<Arc<DocumentId>>>,
        document_state: Mutex<Option<Arc<DocumentState>>>,
        session_storage: Mutex<Option<Rc<SessionStorage>>>,
        awareness: EphemeralStore,
        ws_meta_map: Arc<Mutex<WsMetaMap>>,
    ) -> Self {
        Self {
            state,
            env,
            document_id,
            document_state,
            session_storage,
            awareness,
            ws_meta_map,
            pending_blame: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(crate) fn push_blame_events(&self, events: Vec<BlameEvent>) {
        if events.is_empty() {
            return;
        }
        self.pending_blame
            .lock("SyncServiceImpl::push_blame_events")
            .extend(events);
    }

    /// Drain the pending blame buffer and write all events via a single D1
    /// batch in the background. Returns immediately; the actual write runs
    /// inside `wait_until` so the alarm handler doesn't block on D1.
    pub(crate) fn flush_pending_blame(&self) {
        let pending: Vec<BlameEvent> = std::mem::take(
            &mut *self
                .pending_blame
                .lock("SyncServiceImpl::flush_pending_blame"),
        );
        if pending.is_empty() {
            return;
        }
        let env = self.env.clone();
        self.state.wait_until(async move {
            if let Err(e) = crate::outbound::d1::insert_blame_many(&env, &pending).await {
                warn!(error = ?e, "failed to flush pending blame");
            }
        });
    }

    pub(crate) fn socket_for(&self, ws: &WebSocket) -> worker::Result<RemoteSocket> {
        Ok(RemoteSocket::new(ws.clone(), get_ws_id(&self.state, ws)?))
    }

    pub(crate) fn get_sockets(&self) -> worker::Result<Vec<RemoteSocket>> {
        self.state
            .get_websockets()
            .into_iter()
            .map(|ws| {
                let id = get_ws_id(&self.state, &ws)?;
                Ok(RemoteSocket::new(ws, id))
            })
            .collect()
    }

    pub(crate) async fn warmup(&self, document_id: &DocumentId) -> worker::Result<()> {
        if !self.document_exists(document_id).await? {
            return Ok(());
        }

        self.session_storage().await?;
        self.document_state().await?;
        Ok(())
    }

    pub(crate) async fn maybe_set_document_id(
        &self,
        document_id: &DocumentId,
    ) -> worker::Result<bool> {
        if !self.document_id_is_some() {
            debug!("Setting DO::kv({DOCUMENT_ID_KEY}, {document_id})");
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id.as_str())
                .await?;
            *self
                .document_id
                .lock("DocumentSyncSession::document_id set within maybe_set_document_id") =
                Some(Arc::new(document_id.clone()));
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Check if provided document_id exists.
    /// 1. is self.document_id set
    /// 2. is document_id  it do::kv
    /// 3. does snapshot exist with document_id?
    pub(crate) async fn document_exists(&self, document_id: &DocumentId) -> worker::Result<bool> {
        if self.document_id_is_some() {
            return Ok(true);
        }
        // This gets document_id via dokv if it exists
        if self.document_id().await.is_ok() {
            return Ok(true);
        }
        // self.session_storage would not be set because it requires self.document_id be set
        let snapshot_storage = get_snapshot_storage(&self.env, &self.state, document_id)?;

        if snapshot_storage.has_snapshot().await? {
            self.maybe_set_document_id(document_id).await?;
            // set up session storage
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let session_storage = Rc::new(SessionStorage::new(snapshot_storage, dkv_storage));
            *self
                .session_storage
                .lock("DocumentSyncSession::session_storage set within document_exists") =
                Some(session_storage);
            return Ok(true);
        }
        Ok(false)
    }

    pub(crate) fn document_id_is_some(&self) -> bool {
        self.document_id
            .lock("DocumentSyncSession::document_id check is_some()")
            .is_some()
    }

    #[instrument(skip_all, err)]
    /// Get the `document_id`. First try checking self.document_id, if not there get from DOKV.
    pub(crate) async fn document_id(&self) -> worker::Result<Arc<DocumentId>> {
        if let Some(id) = self
            .document_id
            .lock("DocumentSyncSession::document_id get within main document_id fn")
            .as_ref()
            .cloned()
        {
            return Ok(id);
        }
        let id: Arc<DocumentId> = Arc::new(DocumentId(
            self.state
                .storage()
                .get(DOCUMENT_ID_KEY)
                .await
                .with_context(|| {
                    format!(
                        "Could not get document_id via DOCUMENT_ID_KEY = [{}] from DO storage",
                        DOCUMENT_ID_KEY
                    )
                })?
                .ok_or(Error::from("DOCUMENT_ID not found in storage"))?,
        ));
        *self
            .document_id
            .lock("DocumentSyncSession::document_id set within main document_id fn") =
            Some(id.clone());
        Ok(id)
    }

    pub(crate) async fn session_storage(&self) -> worker::Result<Rc<SessionStorage>> {
        if let Some(ss) = self
            .session_storage
            .lock("session_storage get within main session_storage fn")
            .as_ref()
        {
            Ok(ss.clone())
        } else {
            let id = self.document_id().await?;
            let snapshot_storage = get_snapshot_storage(&self.env, &self.state, &id)?;
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let ss = Rc::new(SessionStorage::new(snapshot_storage, dkv_storage));
            *self
                .session_storage
                .lock("DocumentSyncSession::session_storage set within main session_storage fn") =
                Some(ss.clone());
            Ok(ss)
        }
    }

    /// Gets DocumentState, loading it if needed
    pub(crate) async fn document_state(&self) -> worker::Result<Arc<DocumentState>> {
        let Some(x) = self
            .document_state
            .lock("DocumentSyncSession::document_state get within main document_state fn")
            .as_ref()
            .cloned()
        else {
            let ss = Arc::new(self.session_storage().await?.load_document_state().await?);
            *self
                .document_state
                .lock("DocumentSyncSession::document_state set within main document_state fn") =
                Some(ss.clone());
            return Ok(ss);
        };
        Ok(x)
    }
}

impl SyncServiceCore for SyncServiceImpl {
    async fn connect(
        &self,
        claims: AuthToken,
        document_id: &DocumentId,
    ) -> Result<worker::Response, SyncServiceError> {
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
                peer_ids: Default::default(),
            };

            self.state.storage().put(&ws_id, &ws_meta).await?;
            self.ws_meta_map
                .lock("DocumentSyncSession::ws_meta_map insert in connect")
                .insert(ws_id.clone(), ws_meta);

            // If the snapshot is already in storage, send the initial sync now.
            // Otherwise accept the WS without sending — initialize will
            // broadcast initial sync to this socket once /initialize lands.
            let snapshot = self
                .document_state()
                .await
                .and_then(|state| state.export_shallow_snapshot());

            if let Ok(snapshot) = snapshot {
                // Size of the initial sync this connect sent — the server end
                // of the client's `doc.sync.initial-sync` span.
                tracing::Span::current().record("snapshot.bytes", snapshot.len());
                let socket = RemoteSocket::new(pair.server, ws_id.clone());
                websocket::send_initial_sync(
                    &socket,
                    snapshot.as_slice(),
                    self.awareness.encode_all().as_slice(),
                )?;
            } else {
                debug!(
                    document_id = document_id.as_str(),
                    "snapshot not yet available; deferring initial sync until /initialize"
                );
            }

            // This is the single source of truth for `FirstJoin`: whenever
            // the peer count genuinely transitions 0 -> 1, regardless of
            // whether the document already has content.
            if is_first_join {
                let document_id_owned = document_id.clone();
                let env = self.env.clone();
                self.state.wait_until(async move {
                    report_interaction(&document_id_owned, &env, InteractionReason::FirstJoin)
                        .await;
                });
            }

            Response::from_websocket(pair.client).context("failed to create websocket response")?
        });

        trace!(
            document_id = document_id.as_str(),
            duration_ms = elap.as_millis(),
            "DO::connect"
        );
        Ok(res)
    }

    async fn exists(&self, id: &DocumentId) -> Result<bool, SyncServiceError> {
        Ok(self.document_exists(id).await?)
    }

    async fn metadata(
        &self,
        id: &DocumentId,
    ) -> Result<Option<DocumentMetadata>, SyncServiceError> {
        if !self.document_exists(id).await? {
            return Ok(None);
        }
        let db = self.env.d1(USER_PEER_D1_BINDING)?;
        let peers = crate::outbound::d1::get_peers_for_document_id(db, id).await?;
        let version_id = self.document_state().await?.version_id();
        Ok(Some(DocumentMetadata {
            peers,
            version_id: version_id.to_string(),
            id: id.as_str().to_string(),
        }))
    }

    async fn raw(&self, id: &DocumentId) -> Result<Option<String>, SyncServiceError> {
        if !self.document_exists(id).await? {
            return Ok(None);
        }
        match self.document_state().await {
            Ok(state) => Ok(Some(state.get_json())),
            Err(Error::JsError(s)) if s.contains(NO_SUCH_VALUE_ERR_STR) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    async fn active_peers(&self, include_ai: bool) -> Result<Vec<u64>, SyncServiceError> {
        let mut peer_ids: BTreeSet<u64> = BTreeSet::new();
        for socket in self.get_sockets()? {
            let new_peer_ids = Wsm::new(self, socket.id().to_string())
                .get_peer_ids()
                .await?;
            peer_ids.extend(
                new_peer_ids
                    .into_iter()
                    .filter(|&p| include_ai || !is_ai_peer(p)),
            );
        }
        Ok(peer_ids.into_iter().collect())
    }

    async fn peer(&self, id: &DocumentId, peer_id: &str) -> Result<PeerResponse, SyncServiceError> {
        let p64: u64 = peer_id
            .parse()
            .with_context(|| format!("Couldn't parse peer_id: '{peer_id}' into u64"))?;
        let db = self.env.d1(USER_PEER_D1_BINDING)?;
        let user_id = get_user_id_from_peer_id(db, id, &p64).await?;
        Ok(PeerResponse {
            peer_id: peer_id.to_string(),
            user_id,
        })
    }

    async fn blame(
        &self,
        id: &DocumentId,
        node_id: &str,
    ) -> Result<Option<BlameRow>, SyncServiceError> {
        let db = self.env.d1(USER_PEER_D1_BINDING)?;
        Ok(get_blame_for_node(db, id.as_str(), node_id).await?)
    }

    async fn snapshot(
        &self,
        id: &DocumentId,
        request: GetSnapshotRequest,
    ) -> Result<Option<Vec<u8>>, SyncServiceError> {
        if !self.document_exists(id).await? {
            return Ok(None);
        }

        let frontiers: Option<ExportMode> = request.version_id.map(|vid| {
            let id = loro::ID::new(vid.peer.parse::<u64>().unwrap(), vid.counter);
            ExportMode::StateOnly(Some(Cow::Owned(loro::Frontiers::ID(id))))
        });

        let out = self
            .document_state()
            .await?
            .export_snapshot(frontiers)
            .context("Couldn't export snapshot")?;
        Ok(Some(out))
    }

    async fn initialize(&self, id: &DocumentId, snapshot: Vec<u8>) -> Result<(), SyncServiceError> {
        let document_id = id;
        // NB: we expect DocumentSyncSession to not be initialized. If it is initialized, it's an error.
        let storage = get_snapshot_storage(&self.env, &self.state, document_id)?;

        if storage.has_snapshot().await? {
            return Err(Error::from("snapshot already exists").into());
        } else {
            debug!(document_id = document_id.as_str(), "Initializing snapshot");
            let body = InitializeFromSnapshotRequest::deserialize(&snapshot).with_context(|| format!("Failed to deserialize InitializeFromSnapshotRequest with document_id: [{document_id}]"))?;
            storage.store_snapshot(&body.snapshot).await?;
            *self
                .document_id
                .lock("DocumentSyncSession::document_id set within initialize") =
                Some(Arc::new(document_id.clone()));
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id.as_str())
                .await?;
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let session_storage = Rc::new(SessionStorage::new(storage, dkv_storage));
            *self
                .session_storage
                .lock("DocumentSyncSession::session_storage set within initialize") =
                Some(session_storage);
        }

        // Broadcast initial sync to any sockets that connected before init landed.
        if let Ok(state) = self.document_state().await
            && let Ok(snapshot) = state.export_shallow_snapshot()
        {
            let awareness = self.awareness.encode_all();
            for socket in self.get_sockets()? {
                if let Err(e) =
                    websocket::send_initial_sync(&socket, snapshot.as_slice(), awareness.as_slice())
                {
                    warn!(
                        error =? e,
                        "failed to send delayed initial sync to a waiting peer"
                    );
                }
            }
            let document_id = document_id.clone();
            let env = self.env.clone();
            self.state.wait_until(async move {
                report_new_doc_state(&document_id, &snapshot, &env).await;
            });
        }

        Ok(())
    }

    async fn wakeup(&self, id: &DocumentId) -> Result<Option<(i32, i32)>, SyncServiceError> {
        let _ = self.warmup(id).await.inspect_err(
            |error| warn!(document_id = id.as_str(), error = ?error, "failed to warm up document"),
        );
        Ok(keepalive(DEFAULT_TIME_TO_LIVE))
    }
}

impl SyncServiceAdmin for SyncServiceImpl {
    async fn dump_operations(
        &self,
        id: &DocumentId,
    ) -> Result<Option<Vec<(String, Vec<u8>)>>, SyncServiceError> {
        if !self.document_exists(id).await? {
            return Ok(None);
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

        Ok(Some(key_ops))
    }

    async fn debug_kv_get(&self, key: &str) -> Result<serde_json::Value, SyncServiceError> {
        let value = self.session_storage().await?.debug_do_kv_get(key).await?;
        Ok(serde_json::to_value(value).context("failed to serialize kv value")?)
    }

    async fn debug_kv_list(
        &self,
        prefix: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, SyncServiceError> {
        let kvs: Vec<(String, Vec<u8>)> = self
            .session_storage()
            .await?
            .debug_list_do_kv(prefix)
            .await?
            .into_iter()
            .filter_map(|kv| kv.ok())
            .collect();
        Ok(kvs)
    }
}
