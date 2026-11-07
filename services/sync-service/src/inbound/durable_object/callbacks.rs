use super::*;

impl SyncSession<'_> {
    pub(super) async fn websocket_message(
        &mut self,
        ws: WebSocket,
        msg: WebSocketIncomingMessage,
    ) -> Result<()> {
        if self.source_blocked().await? {
            ws.close(Some(1008), Some("session frozen or retired"))?;
            return Ok(());
        }
        if !self.validate_surface_sockets(Some(&ws)).await? {
            return Ok(());
        }
        use sync_protocol::PING;
        let binary_message = match msg {
            WebSocketIncomingMessage::String(message) => {
                // Heartbeat: deliberately unspanned to keep it out of traces.
                if message == PING {
                    self.room.heartbeat(&ws);
                } else {
                    return worker_rs_otel::scope(&self.env, self.state.as_ref(), async {
                        warn!("Received unknown 'String' message: {message:?}");
                        Ok(())
                    })
                    .await;
                }
                return Ok(());
            }
            WebSocketIncomingMessage::Binary(bm) => bm,
        };
        let ws_id = get_ws_id(&self.state, &ws)?;
        let Some(binary_message) = Socket::receive(&mut self.inbound, &ws_id, &binary_message)?
        else {
            return Ok(());
        };
        let env = self.env.clone();
        let runtime = self.state.clone();
        worker_rs_otel::scope(&env, runtime.as_ref(), async {
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

                let document_state = self.document_state().await?;
                self.session_storage().await?;
                protocol::process_message(
                    &self.socket_for(&ws),
                    &document_id,
                    &document_state,
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
    pub(super) async fn alarm(&mut self) -> Result<Response> {
        if self.source_blocked().await? {
            return Response::empty();
        }
        self.validate_surface_sockets(None).await?;
        let span = tracing::info_span!("do.alarm");
        let env = self.env.clone();
        let runtime = self.state.clone();
        worker_rs_otel::scope(&env, runtime.as_ref(), async {
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
                .store_snapshot(self.operation_log.as_ref().expect("log initialized"), self.document.as_ref().expect("document loaded"))
                .await
                .context("failed to store snapshot")?;

            debug!(state_frontiers =? sf, oplog_frontiers =? of, "Stored new DocumentState");
            seshs
                .clear_applied_ops(self.operation_log.as_mut().expect("log initialized"))
                .await
                .context("failed deleting applied ops")?;

            self.document.as_mut().expect("document loaded").mark_exported(crate::state::monotonic());

            // The old wait_until future captured these on its first poll, at
            // the next yield or return, before any callback could acquire the
            // barrier. Capturing now under the same room guard yields the same
            // snapshot and editor set, without sharing mutable room state.
            let publication = self.document_id().await.ok().and_then(|document_id| {
                doc_state.export_shallow_snapshot().ok().map(|snapshot| (document_id, snapshot))
            }).map(|(document_id, snapshot)| (document_id, snapshot, take_editors(&mut self.pending_editors)));
            let env = self.env.clone();
            // Preserve the scheduling effect even if exporting failed.
            self.state.wait_until(crate::background(async move {
                if let Some((document_id, snapshot, editors)) = publication {
                    report_new_doc_state(&document_id, &snapshot, &env, editors).await;
                    report_interaction(&document_id, &env, InteractionReason::Edited).await;
                }
            }));
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
        &mut self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        worker_rs_otel::scope(&self.env, self.state.as_ref(), self.room.on_close(&ws))
            .await
            .map_err(room_error)
    }
}

fn room_config() -> RoomConfig {
    RoomConfig {
        awareness_timeout: WallDuration(5_000),
        alarm_delay: std::time::Duration::from_secs(5),
        isolate_keepalive: DEFAULT_TIME_TO_LIVE,
        create_default_state: cfg!(feature = "create-default-state"),
        oversized_message_warning: 1_000_000,
    }
}
impl DocumentSyncSession {
    async fn fetch_locked(&self, req: Request) -> Result<Response> {
        // This is the old mutation barrier: it covers the gate and the full
        // routed handler, so migration cannot interleave between them.
        let mut room = self.room.clone().lock_owned().await;
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
            self.state.as_ref(),
            async {
                async {
                    if let Some(response) =
                        SyncSession::new(&mut room, self.state.clone(), self.env.clone())
                            .gate_request(&req)
                            .await?
                    {
                        return Ok(response);
                    }
                    crate::inbound::router::dispatch(
                        room,
                        self.state.clone(),
                        self.env.clone(),
                        req,
                    )
                    .await
                }
                .await
                .context("DurableObject::fetch error")
            }
            .instrument(span),
        )
        .await;
        res?.with_cors(&cors(set_allow_origin.as_deref()))
    }
}
#[expect(
    clippy::arc_with_non_send_sync,
    reason = "single-threaded DO; the guard is the barrier"
)]
impl DurableObject for DocumentSyncSession {
    fn new(state: State, env: Env) -> Self {
        #[cfg(feature = "transcript")]
        let (state, env) = crate::transcript::observe(state, env);
        let state = Rc::new(state);
        let room = Room::new(WorkerPorts::new(state.clone(), env.clone()), room_config());
        Self {
            state,
            env,
            room: Arc::new(futures::lock::Mutex::new(room)),
        }
    }
    async fn fetch(&self, req: Request) -> Result<Response> {
        #[cfg(feature = "transcript")]
        return crate::transcript::scope(self.state.id().to_string(), self.fetch_locked(req)).await;
        #[cfg(not(feature = "transcript"))]
        self.fetch_locked(req).await
    }
    async fn websocket_message(&self, ws: WebSocket, msg: WebSocketIncomingMessage) -> Result<()> {
        let callback = async {
            let mut room = self.room.lock().await;
            SyncSession::new(&mut room, self.state.clone(), self.env.clone())
                .websocket_message(ws, msg)
                .await
        };
        #[cfg(feature = "transcript")]
        return crate::transcript::scope(self.state.id().to_string(), callback).await;
        #[cfg(not(feature = "transcript"))]
        callback.await
    }
    async fn alarm(&self) -> Result<Response> {
        let callback = async {
            let mut room = self.room.lock().await;
            SyncSession::new(&mut room, self.state.clone(), self.env.clone())
                .alarm()
                .await
        };
        #[cfg(feature = "transcript")]
        return crate::transcript::scope(self.state.id().to_string(), callback).await;
        #[cfg(not(feature = "transcript"))]
        callback.await
    }
    async fn websocket_close(
        &self,
        ws: WebSocket,
        code: usize,
        reason: String,
        was_clean: bool,
    ) -> Result<()> {
        let callback = async {
            let mut room = self.room.lock().await;
            SyncSession::new(&mut room, self.state.clone(), self.env.clone())
                .websocket_close(ws, code, reason, was_clean)
                .await
        };
        #[cfg(feature = "transcript")]
        return crate::transcript::scope(self.state.id().to_string(), callback).await;
        #[cfg(not(feature = "transcript"))]
        callback.await
    }
    async fn websocket_error(&self, ws: WebSocket, error: Error) -> Result<()> {
        let callback = worker_rs_otel::scope(&self.env, self.state.as_ref(), async {
            let ws_id = get_ws_id(&self.state, &ws)?;
            error!(ws_id, error = ?error, "websocket error");
            Ok(())
        });
        #[cfg(feature = "transcript")]
        return crate::transcript::scope(self.state.id().to_string(), callback).await;
        #[cfg(not(feature = "transcript"))]
        callback.await
    }
}
