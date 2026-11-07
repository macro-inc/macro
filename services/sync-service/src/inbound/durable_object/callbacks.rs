use super::*;

impl SyncSession<'_> {
    pub(super) async fn websocket_message(
        &mut self,
        ws: WebSocket,
        msg: WebSocketIncomingMessage,
    ) -> Result<()> {
        use sync_server_core::domain::room::InboundFrame;
        let frame = match msg {
            WebSocketIncomingMessage::String(text) => InboundFrame::Text(text),
            WebSocketIncomingMessage::Binary(bytes) => InboundFrame::Binary(bytes),
        };
        let heartbeat = matches!(&frame, InboundFrame::Text(text) if text == sync_protocol::PING);
        let handled = self.room.on_frame(&ws, frame);
        if heartbeat {
            handled.await.map_err(room_error)
        } else {
            worker_rs_otel::scope(&self.env, self.state.as_ref(), handled)
                .await
                .map_err(room_error)
        }
    }

    /// Map the core alarm outcome without changing durable retry behavior.
    pub(super) async fn alarm(&mut self) -> Result<Response> {
        use sync_server_core::domain::room::AlarmOutcome;
        let outcome = worker_rs_otel::scope(
            &self.env,
            self.state.as_ref(),
            self.room
                .on_alarm()
                .instrument(tracing::info_span!("do.alarm")),
        )
        .await
        .map_err(room_error)?;
        match outcome {
            AlarmOutcome::Skipped => Response::empty(),
            AlarmOutcome::Completed => Response::ok("ok"),
        }
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
