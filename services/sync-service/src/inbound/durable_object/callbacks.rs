use super::*;

impl SyncSession {
    pub(super) fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            document_id: Mutex::new(None),
            document_state: Mutex::new(None),
            session_storage: Mutex::new(None),
            awareness: EphemeralStore::new(5_000),
            ws_meta_map: Arc::new(Mutex::new(Default::default())),
            inbound: Arc::new(Mutex::new(HashMap::new())),
            pending_blame: Arc::new(Mutex::new(Vec::new())),
            pending_editors: Arc::new(Mutex::new(Default::default())),
            mapped_writing_peers: Mutex::new(Default::default()),
            surface_lifecycle: Mutex::new(None),
            source_migration: Mutex::new(None),
            mutation_barrier: futures::lock::Mutex::new(()),
        }
    }

    /// Fetch the durable object
    /// Upgrades the request to a websocket request connected to the document session
    pub(super) async fn fetch(self: &Rc<Self>, req: Request) -> Result<Response> {
        let _barrier = self.mutation_barrier.lock().await;
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
        let traceparent = worker_rs_otel::traceparent_from_request(&req);
        let (remote_id, remote_parent) = worker_rs_otel::remote_fields(traceparent.as_ref());
        let path = req.path();
        let span = tracing::info_span!(
            "do.request",
            http.path = %path,
            document.id = tracing::field::Empty,
            snapshot.bytes = tracing::field::Empty,
            trace.remote_id = %remote_id,
            trace.remote_parent = %remote_parent,
        );

        // Log the failure inside the span and the scope: the scope flushes
        // telemetry when it ends, and a log buffered after it is only exported
        // if a later request on the same isolate happens to flush it.
        let res = worker_rs_otel::scope(
            &self.env,
            &self.state,
            async {
                self.inner_fetch(req)
                    .await
                    .context("DurableObject::fetch error")
            }
            .instrument(span),
        )
        .await;
        res?.with_cors(&cors(set_allow_origin.as_deref()))
    }

    pub(super) async fn websocket_message(
        &self,
        ws: WebSocket,
        msg: WebSocketIncomingMessage,
    ) -> Result<()> {
        let _barrier = self.mutation_barrier.lock().await;
        if self.source_blocked().await? {
            ws.close(Some(1008), Some("session frozen or retired"))?;
            return Ok(());
        }
        if !self.validate_surface_sockets(Some(&ws)).await? {
            return Ok(());
        }
        const PONG: &str = "pong";
        const PING: &str = "ping";
        let binary_message = match msg {
            WebSocketIncomingMessage::String(message) => {
                // Heartbeat: deliberately unspanned to keep it out of traces.
                if message == PING {
                    ws.send_with_str(PONG).ok();
                } else {
                    return worker_rs_otel::scope(&self.env, &self.state, async {
                        warn!("Received unknown 'String' message: {message:?}");
                        Ok(())
                    })
                    .await;
                }
                return Ok(());
            }
            WebSocketIncomingMessage::Binary(bm) => bm,
        };
        let socket = self.socket_for(&ws);
        let ws_id = get_ws_id(&self.state, &ws)?;
        let Some(binary_message) = socket.receive(&ws_id, &binary_message)? else {
            return Ok(());
        };
        worker_rs_otel::scope(&self.env, &self.state, async {
            let mut telemetry = protocol::InboundMessageTelemetry::new(binary_message.len());

            let res: Result<()> = async {
                let document_id = self.document_id().await.inspect_err(|_| {
                    telemetry.record_error_stage("document_context");
                })?;
                let ws_id = get_ws_id_from_tags(&self.state.get_tags(&ws)).ok();
                telemetry.record_context(&document_id, ws_id);

                let message = protocol::deserialize_message(&binary_message).inspect_err(|_| {
                    telemetry.record_message_type("invalid");
                    telemetry.record_error_stage("deserialize");
                })?;
                telemetry.record_message_type(protocol::message_type(&message));

                protocol::process_message(
                    &self.socket_for(&ws),
                    &document_id,
                    &*self.document_state().await?,
                    &*self.session_storage().await?,
                    &self.awareness,
                    message,
                    self,
                    &mut telemetry,
                )
                .await
                .inspect_err(|_| {
                    telemetry.record_error_stage("process");
                })
                .context("failed to process websocket message")?;

                bump_alarm(&self.state)
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
    pub(super) async fn alarm(&self) -> Result<Response> {
        let _barrier = self.mutation_barrier.lock().await;
        if self.source_blocked().await? {
            return Response::empty();
        }
        self.validate_surface_sockets(None).await?;
        let span = tracing::info_span!("do.alarm");
        worker_rs_otel::scope(&self.env, &self.state, async {
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

            let document_id = self.document_id().await.ok();
            let pending_editors = self.pending_editors.clone();
            let env = self.env.clone();
            self.state.wait_until(async move {
                if let Some(document_id) = document_id
                    && let Ok(snapshot) = doc_state.export_shallow_snapshot()
                {
                    let editors = take_editors(&pending_editors);
                    report_new_doc_state(&document_id, &snapshot, &env, editors).await;
                    report_interaction(&document_id, &env, InteractionReason::Edited).await;
                }
            });
        }

        self.flush_pending_blame();

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
        .instrument(span))
        .await
    }

    pub(super) async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        let _barrier = self.mutation_barrier.lock().await;
        if self.source_blocked().await? {
            self.forget_websocket_metadata(&ws).await;
            return Ok(());
        }
        worker_rs_otel::scope(&self.env, &self.state, async {
            // Sockets closed by `delete_handler` report back after the session is gone.
            if self.try_document_id().await?.is_none() {
                self.forget_websocket_metadata(&ws).await;
                return Ok(());
            }
            self.validate_surface_sockets(None).await?;
            let peer_ids = Wsm::new(self, &ws).get_peer_ids(true).await?;
            for peer_id in peer_ids {
                self.awareness.delete(&peer_id.to_string());
                let update = self.awareness.encode(&peer_id.to_string());

                // Don't silently discard the error
                protocol::broadcast_awareness(self, &self.socket_for(&ws), update.as_slice())
                    .context("failed to broadcast awareness")?;
            }

            if self.state.get_websockets().len() == 1
                && let Ok(state) = self.document_state().await
                && let Ok(document_id) = self.document_id().await
                && let Ok(snapshot) = state.export_shallow_snapshot()
            {
                let editors = take_editors(&self.pending_editors);
                let env = self.env.clone();
                self.state.wait_until(async move {
                    report_new_doc_state(&document_id, &snapshot, &env, editors).await;
                    report_interaction(&document_id, &env, InteractionReason::LastLeave).await;
                });
            }
            self.forget_websocket_metadata(&ws).await;
            Ok(())
        })
        .await
    }

    pub(super) async fn websocket_error(&self, ws: WebSocket, error: Error) -> Result<()> {
        worker_rs_otel::scope(&self.env, &self.state, async {
            let ws_id = get_ws_id(&self.state, &ws)?;
            error!(ws_id = ws_id, error = ?error, "websocket error");
            // TODO update awareness stuff
            Ok(())
        })
        .await
    }
}
