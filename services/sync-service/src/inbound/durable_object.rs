use std::{
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
};

use loro::awareness::EphemeralStore;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tower_service::Service;
use tracing::{Instrument, debug, error, info, warn};

use worker::{
    Date, DurableObject, Env, Error, Request, Response, Result, ScheduledTime, State, WebSocket,
    WebSocketIncomingMessage, durable_object, send::SendWrapper,
};

use crate::{
    domain::permissions::AccessLevel,
    error::ResultExt,
    inbound::{
        auth::Authenticator,
        router::do_router,
        socket::websocket,
        sync_service::{SyncServiceImpl, Wsm, report_interaction, report_new_doc_state},
    },
    keepalive::{DEFAULT_TIME_TO_LIVE, keepalive},
    mutex::Mutex,
    outbound::{dss_internal::InteractionReason, secrets::Secrets},
    tags::get_ws_id_from_tags,
};

pub const NO_SUCH_VALUE_ERR_STR: &str = "No such value in storage.";

pub mod status_codes {
    pub const OK: u16 = 200;
}

pub fn response(status_code: u16) -> Response {
    Response::builder().with_status(status_code).empty()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebSocketMetadata {
    pub user_id: Option<String>,
    pub access_level: AccessLevel,
    #[serde(with = "crate::inbound::utils::u64_serde_strings")]
    pub peer_ids: BTreeSet<u64>,
}

pub type WsMetaMap = BTreeMap<String, WebSocketMetadata>;

#[durable_object]
pub struct DocumentSyncSession {
    session: Rc<SyncServiceImpl>,
}

pub fn get_ws_id(state: &State, ws: &WebSocket) -> Result<String> {
    let tags = state.get_tags(ws);
    get_ws_id_from_tags(&tags)
}

/// Ensure an alarm is scheduled ~5 seconds out, unless one is already pending.
async fn bump_alarm(state: &State) -> Result<()> {
    if let Some(at) = state.storage().get_alarm().await?
        && at as f64 > Date::now().as_millis() as f64
    {
        return Ok(());
    }
    state
        .storage()
        .set_alarm(ScheduledTime::from(
            Duration::from_secs(5).as_millis() as i64
        ))
        .await?;
    Ok(())
}

impl DurableObject for DocumentSyncSession {
    fn new(state: State, env: Env) -> Self {
        Self {
            session: Rc::new(SyncServiceImpl::new(
                state,
                env,
                Mutex::new(None),
                Mutex::new(None),
                Mutex::new(None),
                EphemeralStore::new(5_000),
                Arc::new(Mutex::new(Default::default())),
            )),
        }
    }

    /// Fetch the durable object. All routes (including the websocket `connect`
    /// upgrade) go through the axum router; CORS and preflight are handled by
    /// its `CorsLayer`.
    async fn fetch(&self, req: Request) -> Result<Response> {
        let traceparent = worker_rs_otel::traceparent_from_request(&req);
        let (remote_id, remote_parent) = worker_rs_otel::remote_fields(traceparent.as_ref());
        let path = req.path();
        // Every DO route is /document/{document_id}/..., so the id can be
        // recorded up front rather than from inside the router.
        let document_id = path
            .strip_prefix("/document/")
            .and_then(|rest| rest.split('/').next())
            .unwrap_or_default()
            .to_string();
        let span = tracing::info_span!(
            "do.request",
            http.path = %path,
            document.id = %document_id,
            snapshot.bytes = tracing::field::Empty,
            trace.remote_id = %remote_id,
            trace.remote_parent = %remote_parent,
        );

        worker_rs_otel::scope(
            &self.session.env,
            &self.session.state,
            async {
                let http_req = worker::HttpRequest::try_from(req)?;
                let auth = Authenticator::new(Secrets::from(&self.session.env));
                let mut router = do_router(SendWrapper::new(self.session.clone()), auth);
                let axum_res = router
                    .call(http_req)
                    .await
                    .unwrap_or_else(|e: std::convert::Infallible| match e {});
                Response::try_from(axum_res).context("DurableObject::fetch error")
            }
            .instrument(span),
        )
        .await
    }

    async fn websocket_message(&self, ws: WebSocket, msg: WebSocketIncomingMessage) -> Result<()> {
        const PONG: &str = "pong";
        const PING: &str = "ping";
        let binary_message = match msg {
            WebSocketIncomingMessage::String(message) => {
                // Heartbeat: deliberately unspanned to keep it out of traces.
                if message == PING {
                    ws.send_with_str(PONG).ok();
                } else {
                    return worker_rs_otel::scope(&self.session.env, &self.session.state, async {
                        warn!("Received unknown 'String' message: {message:?}");
                        Ok(())
                    })
                    .await;
                }
                return Ok(());
            }
            WebSocketIncomingMessage::Binary(bm) => bm,
        };
        worker_rs_otel::scope(&self.session.env, &self.session.state, async {
            let mut telemetry = websocket::InboundMessageTelemetry::new(binary_message.len());

            let res: Result<()> = async {
                let document_id = self.session.document_id().await.inspect_err(|_| {
                    telemetry.record_error_stage("document_context");
                })?;
                let ws_id = get_ws_id(&self.session.state, &ws).ok();
                telemetry.record_context(document_id.as_str(), ws_id);

                let message =
                    websocket::deserialize_message(&binary_message).inspect_err(|_| {
                        telemetry.record_message_type("invalid");
                        telemetry.record_error_stage("deserialize");
                    })?;
                telemetry.record_message_type(websocket::message_type(&message));

                let sender = self.session.socket_for(&ws)?;
                let sockets = self.session.get_sockets()?;
                websocket::process_message(
                    &sender,
                    &sockets,
                    &document_id,
                    &*self.session.document_state().await?,
                    &*self.session.session_storage().await?,
                    &self.session.awareness,
                    message,
                    &self.session,
                    &mut telemetry,
                )
                .await
                .inspect_err(|_| {
                    telemetry.record_error_stage("process");
                })
                .context("failed to process websocket message")?;

                bump_alarm(&self.session.state)
                    .await
                    .inspect_err(|_| {
                        telemetry.record_error_stage("alarm");
                    })
                    .context("failed to keep document alive")?;

                Ok(())
            }
            .await;

            if let Err(error) = &res {
                let span = telemetry.error_span();
                {
                    let _entered = span.enter();
                    tracing::error!(error = ?error, "failed to handle websocket message");
                }
            }
            res
        })
        .await
    }

    /// Save document if needed
    async fn alarm(&self) -> Result<Response> {
        let span = tracing::info_span!("do.alarm");
        worker_rs_otel::scope(
            &self.session.env,
            &self.session.state,
            async {
                let state = match self
                    .session
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
                .session
                .session_storage()
                .await
                .context("failed to get session storage")?;

            // Keeps the worker alive for DEFAULT_TIME_TO_LIVE
            keepalive(DEFAULT_TIME_TO_LIVE);

            let doc_state = self.session.document_state().await?;
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

            let document_id = self.session.document_id().await.ok();
            let env = self.session.env.clone();
            self.session.state.wait_until(async move {
                if let Some(document_id) = document_id
                    && let Ok(snapshot) = doc_state.export_shallow_snapshot()
                {
                    // best effort
                    report_new_doc_state(&document_id, &snapshot, &env).await;
                    report_interaction(&document_id, &env, InteractionReason::Edited).await;
                }
            });
        }

        self.session.flush_pending_blame();

        // Re-arm the alarm while clients are connected so the in-memory state
        // stays warm and pending updates keep getting persisted. Updates reach
        // peers when they happen (PeerUpdate broadcast); pushing a full
        // snapshot to every client on every alarm tick only burned bandwidth
        // and stalled clients on large documents.
        if !self.session.state.get_websockets().is_empty() {
            bump_alarm(&self.session.state)
                .await
                .context("failed to keep document alive")?;
        } else {
            info!("durable object has reached 0 connections")
        }

                Response::ok("ok")
            }
            .instrument(span),
        )
        .await
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        worker_rs_otel::scope(&self.session.env, &self.session.state, async {
            let ws_id = get_ws_id(&self.session.state, &ws)?;
            let peer_ids = Wsm::new(&self.session, ws_id.clone())
                .get_peer_ids()
                .await?;
            for peer_id in peer_ids {
                self.session.awareness.delete(&peer_id.to_string());
                let update = self.session.awareness.encode(&peer_id.to_string());

                // Don't silently discard the error
                let from = self.session.socket_for(&ws)?;
                let sockets = self.session.get_sockets()?;
                websocket::broadcast_awareness(&from, &sockets, update.as_slice())
                    .context("failed to broadcast awareness")?;
            }

            if self.session.state.get_websockets().len() == 1
                && let Ok(document_id) = self.session.document_id().await
                && let Ok(state) = self.session.document_state().await
                && let Ok(snapshot) = state.export_shallow_snapshot()
            {
                let env = self.session.env.clone();
                self.session.state.wait_until(async move {
                    report_new_doc_state(&document_id, &snapshot, &env).await;
                    report_interaction(&document_id, &env, InteractionReason::LastLeave).await;
                });
            }
            Ok(())
        })
        .await
    }

    async fn websocket_error(&self, ws: WebSocket, error: Error) -> Result<()> {
        worker_rs_otel::scope(&self.session.env, &self.session.state, async {
            let ws_id = get_ws_id(&self.session.state, &ws)?;
            error!(ws_id = ws_id, error = ?error, "websocket error");
            // TODO update awareness stuff
            Ok(())
        })
        .await
    }
}
