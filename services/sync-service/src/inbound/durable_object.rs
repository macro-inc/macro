//! Worker callback adapter. CS-61: the single-threaded DO uses a futures mutex
//! as its whole-callback barrier; runtime handles never enter RoomMemory.
use super::cors::{cors, is_origin_allowed};
use crate::outbound::room_ports::WorkerPorts;
use std::{rc::Rc, sync::Arc};
use sync_protocol::time::WallDuration;
use sync_server_core::domain::{
    operation_log::OperationLog,
    ports::RoomPorts,
    room::{Room, RoomConfig, RoomMemory},
    types::SessionKey,
};

use tracing::{Instrument, error, instrument, trace, warn};
use worker::{
    DurableObject, Env, Error, Method, Request, Response, ResponseBody, ResponseBuilder, Result,
    State, WebSocket, WebSocketIncomingMessage, durable_object,
};

use crate::{
    auth::AuthToken,
    error::ResultExt,
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    storage::SessionStorage,
    tags::get_ws_id_from_tags,
};

fn room_error(error: sync_server_core::domain::room::RoomError) -> Error {
    Error::from(error.to_string())
}

pub mod status_codes {
    pub const OK: u16 = 200;
    pub const NOT_FOUND: u16 = 404;
    pub const UNAUTH: u16 = 401;
    pub const FORBIDDEN: u16 = 403;
}

mod callbacks;
pub(crate) mod document_api;
mod document_delete;
mod surface_api;
pub(crate) mod surface_migration;

pub fn response(status_code: u16) -> Response {
    Response::builder().with_status(status_code).empty()
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

pub fn get_ws_id(state: &State, ws: &WebSocket) -> Result<String> {
    let tags = state.get_tags(ws);
    get_ws_id_from_tags(&tags)
}

impl SyncSession<'_> {
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
        use sync_server_core::domain::room::{RequestGate, RouteClass};
        let url = req.url()?;
        let segments: Vec<_> = url.path().split('/').collect();
        if let ["", "document", id, ..] = segments.as_slice() {
            tracing::Span::current().record("document.id", *id);
        }
        let route = if url.path().starts_with("/surface/") {
            RouteClass::Surface
        } else if matches!(segments.as_slice(), ["", "document", _, "migration", _]) {
            RouteClass::Migration
        } else {
            RouteClass::Document
        };
        Ok(
            match self.room.gate_request(route).await.map_err(room_error)? {
                RequestGate::Allowed => None,
                RequestGate::SourceBlocked => Some(response(status_codes::FORBIDDEN)),
            },
        )
    }

    pub(in crate::inbound) async fn initialize_handler(
        &mut self,
        mut req: Request,
        document_id: &str,
    ) -> Result<Response> {
        use sync_server_core::domain::room::InitializeOutcome;
        match self
            .room
            .initialize_with_body(SessionKey::new(document_id.to_owned()), req.bytes())
            .await
            .map_err(room_error)?
        {
            InitializeOutcome::Initialized => Response::empty(),
            InitializeOutcome::AlreadyInitialized => {
                Response::error("snapshot already exists", 409)
            }
        }
    }

    /// Active peer ids. With `include_ai = false`, AI editors (peer ids from the
    /// reserved AI block or signed agent actors) are filtered out.
    pub(in crate::inbound) async fn active_peer_ids_handler(
        &mut self,
        include_ai: bool,
    ) -> Result<Response> {
        let ids = self
            .room
            .active_peers(include_ai)
            .await
            .map_err(room_error)?
            .into_iter()
            .map(|peer| peer.0.to_string())
            .collect::<Vec<_>>();
        let result = serde_json::to_vec(&ids).context("Failed to serialize ids")?;
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
        match self
            .room
            .raw_json(&SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)?
        {
            Some(json) => Ok(ResponseBuilder::new().body(ResponseBody::Body(json.into_bytes()))),
            None => Ok(response(status_codes::NOT_FOUND)),
        }
    }

    pub(in crate::inbound) async fn snapshot_handler(
        &mut self,
        mut req: Request,
        document_id: &str,
    ) -> Result<Response> {
        use sync_server_core::domain::room::SnapshotOutcome;
        let body = async {
            let bytes = req.bytes().await?;
            Ok::<Option<GetSnapshotRequest>, Error>(if bytes.is_empty() {
                None
            } else {
                Some(serde_json::from_slice(&bytes)?)
            })
        };
        match self
            .room
            .snapshot_with_body(&SessionKey::new(document_id.to_owned()), body)
            .await
            .map_err(room_error)?
        {
            SnapshotOutcome::Snapshot(bytes) => {
                Ok(ResponseBuilder::new().body(ResponseBody::Body(bytes)))
            }
            SnapshotOutcome::NotFound => Ok(response(status_codes::NOT_FOUND)),
            SnapshotOutcome::BadRequest => Ok(response(400)),
        }
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
        let peer = peer_id.ok_or_else(|| Error::from("missing `peer_id` in path"))?;
        let parsed = peer
            .parse::<u64>()
            .with_context(|| format!("Couldn't parse peer_id: '{peer}' into u64"))?;
        let user_id = self
            .room
            .peer_user(
                &SessionKey::new(document_id.to_owned()),
                sync_server_core::domain::types::PeerId(parsed),
            )
            .await
            .map_err(room_error)?;
        ResponseBuilder::new().from_json(&PeerResponse {
            peer_id: peer.to_owned(),
            user_id,
        })
    }

    pub(in crate::inbound) async fn wakeup(&mut self, document_id: &str) -> Result<Response> {
        let _ = self.warmup(document_id).await.inspect_err(
            |error| warn!(document_id = document_id, error = ?error, "failed to warm up document"),
        );

        let out = keepalive(DEFAULT_TIME_TO_LIVE);
        ResponseBuilder::new().from_json(&out)
    }

    async fn warmup(&mut self, document_id: &str) -> Result<()> {
        self.room
            .warm_up(&SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)
    }

    pub(in crate::inbound) async fn metadata_handler(
        &mut self,
        document_id: &str,
    ) -> Result<Response> {
        match self
            .room
            .metadata(&SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)?
        {
            Some(metadata) => ResponseBuilder::new().from_json(&metadata),
            None => Ok(response(status_codes::NOT_FOUND)),
        }
    }

    pub(in crate::inbound) async fn blame_handler(
        &mut self,
        node_id: Option<&str>,
    ) -> Result<Response> {
        let node = node_id.ok_or_else(|| Error::from("missing node_id"))?;
        match self.room.blame(node).await.map_err(room_error)? {
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
        self.room
            .exists(&SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)
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
}

pub use crate::domain::models::{CopyDocumentRequest, GetSnapshotRequest, PeerResponse};

/// Cloudflare callback adapter. One owned guard is the callback barrier.
#[durable_object]
pub struct DocumentSyncSession {
    state: Rc<State>,
    env: Env,
    room: Arc<futures::lock::Mutex<Room<WorkerPorts>>>,
}
