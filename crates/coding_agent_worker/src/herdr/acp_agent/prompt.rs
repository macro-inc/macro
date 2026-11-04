//! Native prompt submission, steering, and transcript delivery.

use super::*;

#[cfg(test)]
mod test;

impl Adapter {
    pub(super) async fn prompt(
        self: &Arc<Self>,
        session: &Arc<Session>,
        text: &str,
    ) -> Result<&'static str, RpcError> {
        let herdr = self.herdr.as_ref().ok_or_else(|| {
            RpcError::internal("macrod herdr-acp needs a macrod started inside herdr")
        })?;
        let cancel = CancellationToken::new();
        *lock(&session.cancel) = Some(cancel.clone());
        let _cancellation = PromptCancellation(&session.cancel);
        // Enter steers an active Codex turn. Slash commands need the idle
        // composer, and approval dialogs must never receive prompt text.
        let can_steer = self.options.kind == TuiAgent::Codex && !text.trim_start().starts_with('/');

        let mut guard = session.live.lock().await;
        if guard.is_none() {
            *guard = self.recover_running(herdr, session).await?;
            if guard.is_some() {
                self.save(session, guard.as_ref())?;
            }
        }
        if let Some(live) = guard.as_mut() {
            // Claude and native controls wait for the current turn. Ordinary
            // Codex prompts can reach the active turn through its composer.
            let wait = tracing::info_span!(
                "macrod.herdr.prompt_wait",
                session_id = %session.id,
                native_turns = 0u32,
                exit_dismissed = false,
                outcome = tracing::field::Empty,
            );
            let waited = async {
                let mut native_turns = 0u32;
                loop {
                    if cancel.is_cancelled() {
                        return Ok(None);
                    }
                    let info = herdr.agent_info(&live.name).await;
                    if can_steer && info.as_ref().is_ok_and(|info| info.status == "working") {
                        tracing::Span::current().record("outcome", "steering");
                        return Ok(Some(info));
                    }
                    if !info
                        .as_ref()
                        .is_ok_and(|info| matches!(info.status.as_str(), "working" | "blocked"))
                    {
                        return Ok(Some(info));
                    }
                    if info.as_ref().is_ok_and(|info| info.status == "blocked")
                        && self.stay(herdr, &live.name).await?
                    {
                        tracing::Span::current().record("exit_dismissed", true);
                        continue;
                    }
                    native_turns += 1;
                    tracing::Span::current().record("native_turns", native_turns);
                    // An interrupted native turn ends "cancelled" too; only a
                    // Stop from Macro drops the waiting prompt.
                    self.follow(herdr, session, live, &cancel, true, None).await?;
                    if cancel.is_cancelled() {
                        return Ok(None);
                    }
                }
            }
            .instrument(wait.clone())
            .await
            .inspect_err(|error: &RpcError| {
                wait.record("outcome", "failed");
                tracing::warn!(parent: &wait, error = %error.message, "queued prompt failed while waiting");
            })?;
            let Some(info) = waited else {
                wait.record("outcome", "cancelled");
                return Ok("cancelled");
            };
            wait.record("outcome", "ready");
            match info {
                Ok(info) => {
                    tracing::Span::current()
                        .record("steering", can_steer && info.status == "working");
                    if info.cwd.as_ref().is_some_and(|cwd| cwd != &session.cwd)
                        || info
                            .session_id
                            .as_ref()
                            .zip(lock(&session.native_id).as_ref())
                            .is_some_and(|(actual, expected)| actual != expected)
                    {
                        return Err(RpcError::invalid(
                            "Herdr agent identity no longer matches this session",
                        ));
                    }
                    self.remember_window(session, live, &info)?;
                }
                Err(error) if error.missing_agent() => {
                    let mut restarted = self.launch(herdr, session, text, guard.as_ref()).await?;
                    if let Some(old) = guard.take() {
                        restarted.path = old.path;
                        restarted.cursor = old.cursor;
                        restarted.log = old.log;
                        restarted.pending = old.pending;
                    }
                    *guard = Some(restarted);
                    self.save(session, guard.as_ref())?;
                }
                Err(error) => return Err(error.into()),
            }
        }
        if guard.is_none() {
            *guard = Some(self.launch(herdr, session, text, None).await?);
            self.save(session, guard.as_ref())?;
        }
        let Some(live) = guard.as_mut() else {
            return Err(RpcError::internal("the Claude Code window did not start"));
        };

        // Relay whatever the native session did before this prompt, so a
        // turn end already in the transcript never ends this prompt's turn.
        loop {
            let offset = live.cursor.offset;
            self.forward(session, live, &mut None)?;
            if offset == live.cursor.offset && live.pending.is_empty() {
                break;
            }
        }
        if cancel.is_cancelled() {
            return Ok("cancelled");
        }
        // The observer cannot acquire this session until the turn ends. Publish
        // native settings now, while the freshly started composer is visible.
        self.sync_model(session, live).await;
        if self.options.kind == TuiAgent::Codex
            && let Some(requested) = effort::command(text)
        {
            let requested = requested?;
            let message = tokio::select! {
                () = cancel.cancelled() => return Ok("cancelled"),
                result = tokio::time::timeout(Duration::from_secs(20), self.codex_effort(session, live, requested)) => {
                    result.map_err(|_| RpcError::internal("effort change was not confirmed; check the native session in Herdr"))??
                }
            };
            self.notify_update(
                &session.id,
                json!({
                    "sessionUpdate":"agent_message_chunk", "content":{"type":"text","text":message},
                }),
            );
            return Ok("end_turn");
        }
        herdr.prompt_agent(&live.name, text).await?;
        if let Some(command) = commands::native_control(self.options.kind, text) {
            // Herdr acknowledges PTY delivery, not the resulting setting. These
            // commands need not write a transcript entry or start a model turn.
            self.notify_update(&session.id, json!({
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": format!(
                    "Sent `{command}` to {} in Herdr. Check its response and complete any confirmation there.",
                    self.options.kind.herdr_kind(),
                )},
            }));
            return Ok("end_turn");
        }
        let outcome = self
            .follow(
                herdr,
                session,
                live,
                &cancel,
                false,
                can_steer.then_some(text),
            )
            .await;
        *lock(&session.cancel) = None;
        self.save(session, guard.as_ref())?;
        outcome
    }

    /// Dismiss the exit confirmation a second Ctrl-C in Herdr leaves behind,
    /// so the prompt waiting on it can run. Returns whether it pressed Esc.
    async fn stay(&self, herdr: &HerdrCli, name: &str) -> Result<bool, RpcError> {
        let before = herdr.agent_info(name).await?;
        let screen = herdr.read_agent(name).await?;
        if !crate::herdr::controls::exit_confirmation(self.options.kind, &screen) {
            return Ok(false);
        }
        let after = herdr.agent_info(name).await?;
        let current = herdr.read_agent(name).await?;
        if !crate::herdr::controls::same_dialog(
            &screen,
            &current,
            before.state_change_seq,
            after.state_change_seq,
            &after.status,
        ) {
            return Ok(false);
        }
        herdr.send_keys(name, &["esc"]).await?;
        tracing::info!(
            agent = name,
            "dismissed the native exit confirmation for a queued prompt"
        );
        tokio::time::sleep(POLL).await;
        Ok(true)
    }

    /// Stream the turn from the transcript until it ends. `running` says
    /// the native turn is known to have started, so it may end without
    /// ever reporting `working` (a dialog dismissed in Herdr).
    pub(super) async fn follow(
        self: &Arc<Self>,
        herdr: &HerdrCli,
        session: &Arc<Session>,
        live: &mut Live,
        cancel: &CancellationToken,
        running: bool,
        mut expected_prompt: Option<&str>,
    ) -> Result<&'static str, RpcError> {
        let started = Instant::now();
        let mut ticks = 0u32;
        let mut settled = 0u32;
        let mut missing = 0u32;
        let mut active = running;
        let mut open_tool: Option<OpenTool> = None;
        // Bumped whenever a dialog is asked about or goes away, so a late
        // answer from Macro never presses keys into a different dialog.
        let generation = Arc::new(AtomicU64::new(0));
        let mut asking = false;
        let mut last_output = Instant::now();
        let mut asked_seq = None;
        let mut interrupt_failed = false;
        let _epoch = PermissionEpoch(generation.clone());
        loop {
            tokio::select! {
                () = cancel.cancelled(), if !interrupt_failed => {
                    if interrupt(herdr, &live.name).await? {
                        self.forward(session, live, &mut open_tool)?;
                        return Ok("cancelled");
                    }
                    // Answering `cancelled` now would end the turn in Macro
                    // while the agent keeps working; follow it to its end.
                    tracing::warn!(session = %session.id, "the native turn kept running after Esc");
                    interrupt_failed = true;
                }
                () = tokio::time::sleep(POLL) => {}
            }
            let (moved, ended) =
                self.forward_submission(session, live, &mut open_tool, &mut expected_prompt)?;
            if moved {
                last_output = Instant::now();
            }
            if let Some(stop) = ended {
                return Ok(stop);
            }

            ticks += 1;
            if !ticks.is_multiple_of(STATUS_EVERY) {
                continue;
            }
            // A startup screen may have hidden the footer before submission.
            // Retry without waiting for a model response to release the observer.
            let needs_settings = lock(&session.effort).is_none();
            if needs_settings {
                self.sync_model(session, live).await;
            }
            let info = match herdr.agent_info(&live.name).await {
                Ok(info) => {
                    missing = 0;
                    self.remember_window(session, live, &info)?;
                    if info.session_id.is_some() {
                        *lock(&session.native_id) = info.session_id.clone();
                    }
                    if live.path.is_none() {
                        live.path = self.locate(live, info.session_id.as_deref());
                    }
                    self.save(session, Some(live))?;
                    info
                }
                Err(error) => {
                    missing += 1;
                    if missing >= MISSING_AGENT_CHECKS {
                        return Err(RpcError::internal(format!(
                            "the agent's herdr window is gone: {error}"
                        )));
                    }
                    continue;
                }
            };
            let status = info.status;
            if asked_seq.is_some_and(|seq| seq != info.state_change_seq) {
                asking = false;
                generation.fetch_add(1, Ordering::SeqCst);
            }
            if status != "blocked" && std::mem::take(&mut asking) {
                generation.fetch_add(1, Ordering::SeqCst);
            }
            match status.as_str() {
                "working" => {
                    active = true;
                    settled = 0;
                }
                "blocked" => {
                    settled = 0;
                    if !std::mem::replace(&mut asking, true) {
                        asked_seq = Some(info.state_change_seq);
                        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
                        self.ask_permission(session, live, open_tool.clone(), current, &generation);
                    }
                }
                "idle" | "done" => {
                    settled += 1;
                    if active
                        && expected_prompt.is_none()
                        && settled >= SETTLED_CHECKS
                        && last_output.elapsed() >= SETTLED_QUIET
                    {
                        self.forward(session, live, &mut open_tool)?;
                        return Ok("end_turn");
                    }
                    if (!active || expected_prompt.is_some()) && started.elapsed() > QUIET_START {
                        return Err(RpcError::internal(
                            "the native TUI did not confirm prompt submission; check its input in Herdr",
                        ));
                    }
                }
                _ => {}
            }
        }
    }

    /// Relay new transcript lines. Returns whether anything moved and the
    /// stop reason if the turn ended.
    pub(super) fn forward(
        &self,
        session: &Session,
        live: &mut Live,
        open_tool: &mut Option<OpenTool>,
    ) -> Result<(bool, Option<&'static str>), RpcError> {
        self.forward_submission(session, live, open_tool, &mut None)
    }

    /// A completion from before Codex recorded the submitted prompt belongs to
    /// the preceding turn. It cannot complete the pending ACP request.
    fn forward_submission(
        &self,
        session: &Session,
        live: &mut Live,
        open_tool: &mut Option<OpenTool>,
        expected_prompt: &mut Option<&str>,
    ) -> Result<(bool, Option<&'static str>), RpcError> {
        let mut moved = false;
        let mut ended = None;
        if live.pending.is_empty() {
            live.pending = self.drain(live)?.into();
        }
        while let Some(event) = live.pending.pop_front() {
            if let LogEvent::Update(update) | LogEvent::LateUpdate(update) = &event
                && update["sessionUpdate"] == "user_message_chunk"
                && expected_prompt.is_some_and(|text| {
                    update.pointer("/content/text").and_then(Value::as_str) == Some(text.trim())
                })
            {
                *expected_prompt = None;
                tracing::info!(session_id = %session.id, "native transcript confirmed prompt receipt");
            }
            match event {
                LogEvent::ModelChanged(model) => {
                    self.report_model(session, live, &model)?;
                }
                LogEvent::Update(update) => {
                    moved = true;
                    // Codex logs a command only once it has run, so its log
                    // never names the call a permission dialog is about.
                    if self.options.kind == TuiAgent::Claude {
                        track_open_tool(open_tool, &update);
                    }
                    self.notify_update(&session.id, update);
                }
                LogEvent::TurnEnded(stop) => {
                    if expected_prompt.is_some() {
                        continue;
                    }
                    self.turn_complete(&session.id, stop);
                    ended = Some(stop);
                    break;
                }
                // A waiting Macro prompt owns the next turn: the item joins
                // it, and only the prompt's own turn end may answer it.
                LogEvent::LateUpdate(update) => {
                    moved = true;
                    self.notify_update(&session.id, update);
                    if !session.prompt_pending.load(Ordering::SeqCst) {
                        self.turn_complete(&session.id, "end_turn");
                    }
                }
            }
        }
        Ok((moved, ended))
    }
}
