use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::{Arc, LazyLock},
};

use bebop::Record;
use loro::{ExportMode, awareness::EphemeralStore};
use matchit::Router;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, instrument, trace, warn};
use worker::{
    Cors, Date, DurableObject, Env, Error, Method, Request, Response, ResponseBody,
    ResponseBuilder, Result, ScheduledTime, State, WebSocket, WebSocketIncomingMessage,
    WebSocketPair, durable_object,
};

use crate::{
    auth::{AccessLevel, TokenFrom, decode_jwt},
    constants::USER_PEER_D1_BINDING,
    d1::{PeerWithUserId, get_user_id_from_peer_id, insert_user_mapping},
    error::ResultExt,
    generated::schema::InitializeFromSnapshotRequest,
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    mutex::Mutex,
    state::DocumentState,
    storage::{
        SessionStorage, backends::durable_kv::DurableKVStorage, get_snapshot_storage,
        snapshot::SnapshotStorage,
    },
    tags::{get_ws_id_from_tags, new_ws_id},
    timeit, websocket,
};

pub const NO_SUCH_VALUE_ERR_STR: &str = "No such value in storage.";

pub mod status_codes {
    pub const OK: u16 = 200;
    pub const NOT_FOUND: u16 = 404;
    pub const UNAUTH: u16 = 401;
    pub const FORBIDDEN: u16 = 403;
}

const DOCUMENT_ID_KEY: &str = "DOCUMENT_ID";

mod path {
    pub const CONNECT: &str = "connect";
    pub const EXISTS: &str = "exists";
    pub const INITIALIZE: &str = "initialize";
    pub const RAW: &str = "raw";
    pub const SNAPSHOT: &str = "snapshot";
    pub const ACTIVE_PEERS_MARKER: &str = "active_peers";
    pub const PEER: &str = "peer";
    pub const METADATA: &str = "metadata";
    pub const DEBUG_DUMP_OPERATIONS: &str = "debug_dump_operations";
    pub const DEBUG_DO_KV_GET: &str = "debug_do_kv_get";
    pub const DEBUG_DO_KV_LIST: &str = "debug_do_kv_list";
    pub const WAKEUP: &str = "wakeup";
}

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

macro_rules! or_unauth {
    ($none_if_unauth:expr) => {{
        let out = match $none_if_unauth {
            Some(x) => x,
            None => return Ok(response(status_codes::UNAUTH)),
        };
        out
    }};
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebSocketMetadata {
    pub user_id: Option<String>,
    pub access_level: AccessLevel,
    #[serde(with = "u64_serde_strings")]
    pub peer_ids: BTreeSet<u64>,
}

pub type WsMetaMap = BTreeMap<String, WebSocketMetadata>;

#[durable_object]
pub struct DocumentSyncSession {
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
    msg_buffer: Arc<Mutex<Vec<u8>>>,
}

mod u64_serde_strings {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::collections::BTreeSet;

    pub fn serialize<S: Serializer>(
        value: &BTreeSet<u64>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let string_set: BTreeSet<String> = value.iter().map(|x| x.to_string()).collect();
        string_set.serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<BTreeSet<u64>, D::Error> {
        let string_set: BTreeSet<String> = BTreeSet::deserialize(deserializer)?;
        string_set
            .into_iter()
            .map(|s| s.parse::<u64>().map_err(serde::de::Error::custom))
            .collect()
    }
    #[cfg(test)]
    mod test {
        use super::*;
        #[derive(Serialize, Deserialize)]
        struct Foo {
            #[serde(with = "super")]
            set: BTreeSet<u64>,
        }
        #[test]
        fn serde_u64_btree_set() -> std::result::Result<(), Box<dyn std::error::Error>> {
            let data = BTreeSet::from([1_u64, u64::MAX, u64::MIN, 0, 42]);
            let obj = Foo { set: data.clone() };
            let json = serde_json::to_string(&obj)?;
            let result: Foo = serde_json::from_str(&json)?;
            assert_eq!(result.set, data);
            Ok(())
        }
    }
}

pub struct Wsm<'a> {
    dss: &'a DocumentSyncSession,
    ws: &'a WebSocket,
    ws_id: Option<String>,
}
impl<'a> Wsm<'a> {
    pub fn new(dss: &'a DocumentSyncSession, ws: &'a WebSocket) -> Self {
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
    async fn get_peer_ids(&mut self) -> Result<Vec<u64>> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
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

    pub async fn can_edit(&mut self) -> Result<bool> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        Ok(self
            .dss
            .ws_meta_map
            .lock("Wsm::can_edit get")
            .get(&ws_id)
            .ok_or(Error::from("missing ws metadata"))?
            .access_level
            .can_edit())
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
                insert_user_mapping(db, &user_id, peerid, document_id).await?;
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

impl DocumentSyncSession {
    pub fn get_websockets(&self) -> Vec<WebSocket> {
        self.state.get_websockets()
    }
    async fn inner_fetch(&self, req: Request) -> Result<Response> {
        let url = req.url()?;
        let matched = ROUTER
            .at(url.path())
            .with_context(|| format!("Failed to route url: [{url}]"))?;

        match (
            *matched.value,
            matched.params.get("document_id").inspect(|document_id| {
                trace!(route =? matched.value, document_id = document_id, "matched route");
            }),
        ) {
            // connect authenticates via jwt in query
            (path::CONNECT, Some(document_id)) => {
                return self.connect_handler(req, document_id).await;
            }

            // EXIST, PEER, and WAKEUP don't require auth
            (path_needs_claims, Some(document_id)) => match path_needs_claims {
                path::EXISTS => return self.exists_handler(document_id).await,
                path::PEER => {
                    return self
                        .peer_handler(document_id, matched.params.get("peer_id"))
                        .await;
                }
                path::WAKEUP => return self.wakeup(document_id).await,
                // These need auth
                rest => {
                    let claims = or_unauth!(decode_jwt(&req, &self.env, TokenFrom::Headers).ok());
                    or_unauth!(claims.has_document_id_access(document_id).then_some(()));
                    match rest {
                        path::METADATA => return self.metadata_handler(document_id).await,
                        path::RAW => return self.raw_handler(document_id).await,
                        path::SNAPSHOT => return self.snapshot_handler(req, document_id).await,
                        path::ACTIVE_PEERS_MARKER => return self.active_peer_ids_handler().await,
                        path::INITIALIZE => {
                            or_unauth!(claims.has_permission(&AccessLevel::Edit).then_some(()));
                            return self.initialize_handler(req, document_id).await;
                        }
                        path::DEBUG_DUMP_OPERATIONS => {
                            or_unauth!(claims.has_permission(&AccessLevel::Admin).then_some(()));
                            return self.dump_operations(document_id).await;
                        }
                        path::DEBUG_DO_KV_GET => {
                            or_unauth!(claims.has_permission(&AccessLevel::Admin).then_some(()));
                            let key = matched.params.get("key").context("missing key argoument")?;
                            let value = self.session_storage().await?.debug_do_kv_get(key).await?;
                            Response::from_json(&value)
                        }
                        path::DEBUG_DO_KV_LIST => {
                            or_unauth!(claims.has_permission(&AccessLevel::Admin).then_some(()));
                            let prefix = matched
                                .params
                                .get("prefix")
                                .context("missing prefix argoument")?;
                            let kvs: Vec<(String, Vec<u8>)> = self
                                .session_storage()
                                .await?
                                .debug_list_do_kv(prefix)
                                .await?
                                .into_iter()
                                .filter_map(|kv| kv.ok())
                                .collect();
                            Response::from_json(&kvs)
                        }
                        _ => Ok(response(status_codes::NOT_FOUND)),
                    }
                }
            },
            (_, None) => Ok(response(status_codes::NOT_FOUND)),
        }
    }

    async fn initialize_handler(&self, mut req: Request, document_id: &str) -> Result<Response> {
        // NB: we expect DocumentSyncSession to not be initialized. If it is initialized, it's an error.
        let storage = get_snapshot_storage(&self.env, &self.state, document_id.to_string())?;

        if storage.has_snapshot().await? {
            return Err(Error::from("snapshot already exists"));
        } else {
            debug!(document_id = document_id, "Initializing snapshot");
            let body_raw = req.bytes().await?;
            let body = InitializeFromSnapshotRequest::deserialize(&body_raw).with_context(|| format!("Failed to deserialize InitializeFromSnapshotRequest with document_id: [{document_id}]"))?;
            storage.store_snapshot(&body.snapshot).await?;
            *self
                .document_id
                .lock("DocumentSyncSession::document_id set within initialize_handler") =
                Some(Arc::new(document_id.to_string()));
            self.state
                .storage()
                .put(DOCUMENT_ID_KEY, document_id.to_string())
                .await?;
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let session_storage = Rc::new(SessionStorage::new(storage, dkv_storage));
            *self
                .session_storage
                .lock("DocumentSyncSession::session_storage set within initialize_handler") =
                Some(session_storage);
        }

        // Broadcast initial sync to any sockets that connected before init landed.
        if let Ok(state) = self.document_state().await
            && let Ok(snapshot) = state.export_shallow_snapshot()
        {
            let awareness = self.awareness.encode_all();
            for ws in &self.state.get_websockets() {
                if let Err(e) = websocket::send_initial_sync(
                    ws,
                    snapshot.as_slice(),
                    awareness.as_slice(),
                    self.msg_buffer.clone(),
                ) {
                    warn!(
                        error =? e,
                        "failed to send delayed initial sync to a waiting peer"
                    );
                }
            }
        }

        Response::empty()
    }

    async fn active_peer_ids_handler(&self) -> Result<Response> {
        let mut peer_ids: BTreeSet<u64> = BTreeSet::new();
        for ws in self.state.get_websockets() {
            let new_peer_ids = Wsm::new(self, &ws).get_peer_ids().await?;
            peer_ids.extend(new_peer_ids);
        }
        let str_ids = peer_ids
            .into_iter()
            .map(|p| p.to_string())
            .collect::<Vec<String>>();

        let result = serde_json::to_vec(&str_ids).context("Failed to serialize ids")?;
        Ok(ResponseBuilder::new().body(ResponseBody::Body(result)))
    }

    async fn exists_handler(&self, id: &str) -> Result<Response> {
        Ok(response(if self.exists(id).await? {
            status_codes::OK
        } else {
            status_codes::NOT_FOUND
        }))
    }

    async fn raw_handler(&self, document_id: &str) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }
        let out = maybe_404!(self.document_state().await)?.get_json();
        Ok(ResponseBuilder::new().body(ResponseBody::Body(out.into_bytes())))
    }

    async fn snapshot_handler(&self, mut req: Request, document_id: &str) -> Result<Response> {
        if !self.exists(document_id).await? {
            return Ok(response(status_codes::NOT_FOUND));
        }

        let bytes = req.bytes().await?;
        let body: Option<GetSnapshotRequest> = if bytes.is_empty() {
            None
        } else {
            Some(serde_json::from_slice(&bytes)?)
        };

        let frontiers: Option<ExportMode> = body.and_then(|b| {
            if let Some(vid) = b.version_id {
                let id = loro::ID::new(vid.peer.parse::<u64>().unwrap(), vid.counter);
                Some(ExportMode::StateOnly(Some(Cow::Owned(
                    loro::Frontiers::ID(id),
                ))))
            } else {
                None
            }
        });

        let out = maybe_404!(self.document_state().await)?
            .export_snapshot(frontiers)
            .context("Couldn't export snapshot")?;
        Ok(ResponseBuilder::new().body(ResponseBody::Body(out)))
    }

    async fn dump_operations(&self, document_id: &str) -> Result<Response> {
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

    async fn peer_handler(&self, document_id: &str, peer_id: Option<&str>) -> Result<Response> {
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

    async fn wakeup(&self, document_id: &str) -> Result<Response> {
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

    async fn metadata_handler(&self, document_id: &str) -> Result<Response> {
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

    async fn connect_handler(&self, req: Request, document_id: &str) -> Result<Response> {
        let (res, elap) = timeit!({
            let claims = or_unauth!(decode_jwt(&req, &self.env, TokenFrom::QueryParams).ok());
            if self.maybe_set_document_id(document_id).await? {
                trace!("init document_id={document_id}");
            } else {
                trace!("document_id={document_id} already set");
            }

            //  Below is websocket stuff only i.e connect
            let pair = WebSocketPair::new().context("failed to create websocket pair")?;

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
                .lock("DocumentSyncSession::ws_meta_map insert in connect_handler")
                .insert(ws_id, ws_meta);

            // If the snapshot is already in storage, send the initial sync now.
            // Otherwise accept the WS without sending — initialize_handler will
            // broadcast initial sync to this socket once /initialize lands.
            let snapshot = self
                .document_state()
                .await
                .and_then(|state| state.export_shallow_snapshot());

            if let Ok(snapshot) = snapshot {
                websocket::send_initial_sync(
                    &pair.server,
                    snapshot.as_slice(),
                    self.awareness.encode_all().as_slice(),
                    self.msg_buffer.clone(),
                )
                .context("failed to send initial sync message")?;
            } else {
                debug!(
                    document_id = document_id,
                    "snapshot not yet available; deferring initial sync until /initialize"
                );
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
                .lock("DocumentSyncSession::document_id set within maybe_set_document_id") =
                Some(Arc::new(document_id.to_string()));
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Check if provided document_id exists.
    /// 1. is self.document_id set
    /// 2. is document_id  it do::kv
    /// 3. does snapshot exist with document_id?
    async fn exists(&self, document_id: &str) -> Result<bool> {
        if self.document_id_is_some() {
            return Ok(true);
        }
        // This gets document_id via dokv if it exists
        if self.document_id().await.is_ok() {
            return Ok(true);
        }
        // self.session_storage would not be set because it requires self.document_id be set
        let snapshot_storage =
            get_snapshot_storage(&self.env, &self.state, document_id.to_string())?;

        if snapshot_storage.has_snapshot().await? {
            self.maybe_set_document_id(document_id).await?;
            // set up session storage
            let dkv_storage = DurableKVStorage::new(self.state.storage());
            let session_storage = Rc::new(SessionStorage::new(snapshot_storage, dkv_storage));
            *self
                .session_storage
                .lock("DocumentSyncSession::session_storage set within exists") =
                Some(session_storage);
            return Ok(true);
        }
        Ok(false)
    }

    fn document_id_is_some(&self) -> bool {
        self.document_id
            .lock("DocumentSyncSession::document_id check is_some()")
            .is_some()
    }

    #[instrument(skip_all, err)]
    /// Get the `document_id`. First try checking self.document_id, if not there get from DOKV.
    async fn document_id(&self) -> Result<Arc<String>> {
        if let Some(id) = self
            .document_id
            .lock("DocumentSyncSession::document_id get within main document_id fn")
            .as_ref()
            .cloned()
        {
            return Ok(id);
        }
        let id: Arc<String> = Arc::new(
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
        );
        *self
            .document_id
            .lock("DocumentSyncSession::document_id set within main document_id fn") =
            Some(id.clone());
        Ok(id)
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
            let ss = Rc::new(SessionStorage::new(snapshot_storage, dkv_storage));
            *self
                .session_storage
                .lock("DocumentSyncSession::session_storage set within main session_storage fn") =
                Some(ss.clone());
            Ok(ss)
        }
    }

    /// Gets DocumentState, loading it if needed
    async fn document_state(&self) -> Result<Arc<DocumentState>> {
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

pub static ROUTER: LazyLock<Router<&str>> = LazyLock::new(|| {
    let mut router = Router::new();
    router
        .insert("/document/{document_id}/connect", path::CONNECT)
        .unwrap();
    router
        .insert("/document/{document_id}/exists", path::EXISTS)
        .unwrap();
    router
        .insert("/document/{document_id}/initialize", path::INITIALIZE)
        .unwrap();
    router
        .insert("/document/{document_id}/raw", path::RAW)
        .unwrap();
    router
        .insert(
            "/document/{document_id}/active_peers",
            path::ACTIVE_PEERS_MARKER,
        )
        .unwrap();
    router
        .insert("/document/{document_id}/snapshot", path::SNAPSHOT)
        .unwrap();
    router
        .insert("/document/{document_id}/peer/{peer_id}", path::PEER)
        .unwrap();
    router
        .insert("/document/{document_id}/metadata", path::METADATA)
        .unwrap();
    router
        .insert(
            "/document/{document_id}/debug_dump_operations",
            path::DEBUG_DUMP_OPERATIONS,
        )
        .unwrap();
    router
        .insert(
            "/document/{document_id}/debug_do_kv_get/{key}",
            path::DEBUG_DO_KV_GET,
        )
        .unwrap();
    router
        .insert(
            "/document/{document_id}/debug_do_kv_list/{prefix}",
            path::DEBUG_DO_KV_LIST,
        )
        .unwrap();
    router
        .insert("/document/{document_id}/wakeup", path::WAKEUP)
        .unwrap();
    router
});

impl DurableObject for DocumentSyncSession {
    fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            document_id: Mutex::new(None),
            document_state: Mutex::new(None),
            session_storage: Mutex::new(None),
            awareness: EphemeralStore::new(5_000),
            ws_meta_map: Arc::new(Mutex::new(Default::default())),
            msg_buffer: Arc::new(Mutex::new(vec![])),
        }
    }

    /// Fetch the durable object
    /// Upgrades the request to a websocket request connected to the document session
    async fn fetch(&self, req: Request) -> Result<Response> {
        let set_allow_origin = if let Some(origin) = req
            .headers()
            .get("Origin")
            .context("No `Origin` header found in header")?
        {
            if is_origin_allowed(&origin) {
                Some(origin)
            } else {
                return Ok(response(status_codes::FORBIDDEN));
            }
        } else {
            None
        };

        if req.method() == Method::Options {
            return Ok(Response::builder()
                .with_status(status_codes::OK)
                .with_cors(&cors(set_allow_origin.as_deref()))?
                .empty());
        }
        let res = self
            .inner_fetch(req)
            .await
            .context("DurableObject::fetch error")?;
        res.with_cors(&cors(set_allow_origin.as_deref()))
    }

    async fn websocket_message(&self, ws: WebSocket, msg: WebSocketIncomingMessage) -> Result<()> {
        const PONG: &str = "pong";
        const PING: &str = "ping";
        let binary_message = match msg {
            WebSocketIncomingMessage::String(message) => {
                // TODO do keepalive?
                if message == PING {
                    ws.send_with_str(PONG).ok();
                } else {
                    warn!("Received unknown 'String' message: {message:?}");
                }
                return Ok(());
            }
            WebSocketIncomingMessage::Binary(bm) => bm,
        };

        websocket::process_message(
            &ws,
            &self.document_id().await?,
            &*self.document_state().await?,
            &*self.session_storage().await?,
            &self.awareness,
            binary_message,
            self.msg_buffer.clone(),
            self,
        )
        .await
        .context("failed to process websocket message")?;

        bump_alarm(&self.state)
            .await
            .context("failed to keep document alive")?;

        Ok(())
    }

    /// Save document if needed
    #[instrument(skip_all, err)]
    async fn alarm(&self) -> Result<Response> {
        let state = match self
            .document_state()
            .await
            .context("failed to get document_state")
        {
            Ok(x) => x,
            Err(_e) => {
                // This is likely due to a programming issue. We don't return `Err`
                // because it wuld cause this alarm to retry, then fail again.
                return Response::empty();
            }
        };

        if state.should_save() {
            let seshs = self
                .session_storage()
                .await
                .context("failed to get session storage")?;

            // Keeps the worker alive for DEFAULT_TIME_TO_LIVE
            keepalive(DEFAULT_TIME_TO_LIVE);

            let doc_state = self.document_state().await?;
            let (sf, of) = doc_state.frontiers();
            seshs
                .store_snapshot(&doc_state)
                .await
                .context("failed to store snapshot")?;

            debug!(state_frontiers =? sf, oplog_frontiers =? of, "Stored new DocumentState");
            seshs
                .clear_applied_ops()
                .await
                .context("failed deleting applied ops")?;

            state.mark_exported();
        }

        // Re-arm the alarm while clients are connected so the in-memory state
        // stays warm and pending updates keep getting persisted. Updates reach
        // peers when they happen (PeerUpdate broadcast); pushing a full
        // snapshot to every client on every alarm tick only burned bandwidth
        // and stalled clients on large documents.
        if !self.state.get_websockets().is_empty() {
            bump_alarm(&self.state)
                .await
                .context("failed to keep document alive")?;
        } else {
            info!("durable object has reached 0 connections")
        }

        Response::ok("ok")
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        let peer_ids = Wsm::new(self, &ws).get_peer_ids().await?;
        for peer_id in peer_ids {
            self.awareness.delete(&peer_id.to_string());
            let update = self.awareness.encode(&peer_id.to_string());

            // Don't silently discard the error
            websocket::broadcast_awareness(
                &ws,
                self.state.get_websockets().as_slice(),
                update.as_slice(),
                self.msg_buffer.clone(),
            )
            .context("failed to broadcast awareness")?;
        }

        #[cfg(feature = "search-service")]
        if self.state.get_websockets().len() == 1 {
            crate::sps::update(&self.document_id().await?, &self.env).await?;
        }
        Ok(())
    }

    async fn websocket_error(&self, ws: WebSocket, error: Error) -> Result<()> {
        let ws_id = get_ws_id(&self.state, &ws)?;
        error!(ws_id = ws_id, error = ?error, "websocket error");
        // TODO update awareness stuff
        Ok(())
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct VersionIndicator {
    /// Json has trouble with peer id bigints, so we need to serialize from a string
    pub peer: String,
    pub counter: i32,
}

#[derive(serde::Deserialize, serde::Serialize, Debug)]
pub struct CopyDocumentRequest {
    pub target_document_id: String,
    pub version_id: Option<VersionIndicator>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug)]
pub struct GetSnapshotRequest {
    pub version_id: Option<VersionIndicator>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct DocumentMetadata {
    pub id: String,
    pub peers: Vec<PeerWithUserId>,
    pub version_id: String,
}

#[derive(serde::Serialize)]
pub struct PeerResponse {
    pub peer_id: String,
    pub user_id: String,
}

pub static ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://localhost:3005",
    "http://localhost:3006",
    "http://localhost:3007",
    "http://localhost:3008",
    "http://localhost:3009",
    "http://host.local:3000",
    "https://dev.macro.com",
    "https://staging.macro.com",
    "https://www.macro.com",
    "https://macro.com",
    "capacitor://localhost",
    "https://apollo-testing.macro.com",
];

pub fn is_origin_allowed(origin: &str) -> bool {
    if ALLOWED_ORIGINS.contains(&origin) {
        return true;
    }
    // Allow feature branch previews: https://{subdomain}.preview.macro.com
    if let Some(host) = origin.strip_prefix("https://")
        && let Some(subdomain) = host.strip_suffix(".preview.macro.com")
    {
        return !subdomain.is_empty() && !subdomain.contains('/');
    }
    false
}

/// Workaround for this bug: <https://github.com/cloudflare/workers-rs/issues/554>
pub fn cors(request_origin: Option<&str>) -> Cors {
    use worker::Method;
    let cors_origins = request_origin
        .map(|o| {
            if is_origin_allowed(o) {
                vec![o.to_string()]
            } else {
                vec![]
            }
        })
        .unwrap_or_default();

    Cors::new()
        .with_credentials(true)
        .with_allowed_headers(vec!["authorization", "content-type"])
        .with_methods(vec![
            Method::Get,
            Method::Post,
            Method::Put,
            Method::Patch,
            Method::Delete,
            Method::Options,
        ])
        .with_origins(cors_origins)
}
