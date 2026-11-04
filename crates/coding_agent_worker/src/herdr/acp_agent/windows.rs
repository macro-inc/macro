//! Reuse a native session's workspace across launch retries and daemon restarts.

use super::*;

#[cfg(test)]
mod test;

impl Adapter {
    /// A failed launch acknowledgment can leave the native agent running. Adopt
    /// it before the prompt's normal busy/dialog handling, without launching twice.
    #[tracing::instrument(
        name = "macrod.native_session_recover",
        skip_all,
        fields(session_id = %session.id, recovered = false),
        err(Debug)
    )]
    pub(super) async fn recover_running(
        &self,
        herdr: &HerdrCli,
        session: &Session,
    ) -> Result<Option<Live>, RpcError> {
        let name = agent_name(&session.id);
        let mut info = match herdr.agent_info(&name).await {
            Ok(info) => info,
            Err(error) if error.missing_agent() => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if !matches!(
            info.status.as_str(),
            "idle" | "done" | "working" | "blocked"
        ) {
            if self.options.kind.reports_status() {
                return Err(HerdrError::NotReady.into());
            }
            herdr
                .wait_ready(&name, self.options.kind.herdr_kind(), false)
                .await?;
            info = herdr.agent_info(&name).await?;
        }
        if !models::same_session(session, &info) {
            return Err(RpcError::invalid(
                "Herdr agent identity no longer matches this session",
            ));
        }
        let record = self.store.load(&session.id).map_err(|error| {
            RpcError::internal(format!("could not restore native session: {error}"))
        })?;
        let mut live = Live {
            session: session.id.clone(),
            cwd: session.cwd.clone(),
            started: std::time::UNIX_EPOCH + Duration::from_secs(record.started),
            name,
            log: self.options.kind.log(),
            path: record.transcript,
            cursor: Cursor::default(),
            pending: VecDeque::new(),
            seen_alive: true,
            closed_reported: false,
        };
        if lock(&session.native_id).is_none() {
            *lock(&session.native_id) = info.session_id.clone();
        }
        if live.path.is_none() {
            live.path = self.locate(&live, lock(&session.native_id).as_deref());
        }
        self.remember_window(session, &live, &info)?;
        tracing::Span::current().record("recovered", true);
        Ok(Some(live))
    }

    pub(super) fn remember_window(
        &self,
        session: &Session,
        live: &Live,
        info: &crate::herdr::cli::AgentInfo,
    ) -> Result<(), RpcError> {
        if !models::same_session(session, info) {
            return Err(RpcError::invalid(
                "Herdr agent identity no longer matches this session",
            ));
        }
        let saved = lock(&session.window).clone();
        let Some(mut window) = info.window.clone() else {
            return Ok(());
        };
        // An observed workspace may be shared. Retain ownership only while the
        // pane remains in the workspace this session created.
        window.workspace_id = saved
            .as_ref()
            .and_then(|saved| saved.workspace_id.as_ref())
            .filter(|workspace| info.workspace_id.as_deref() == Some(workspace.as_str()))
            .cloned();
        if saved.as_ref() != Some(&window) {
            *lock(&session.window) = Some(window);
            self.save(session, Some(live))?;
        }
        Ok(())
    }

    #[tracing::instrument(
        name = "macrod.native_session_window",
        skip_all,
        fields(session_id = %session.id, workspace_id, reused = false),
        err(Debug)
    )]
    pub(super) async fn session_window(
        &self,
        herdr: &HerdrCli,
        session: &Session,
        launch: &AgentLaunch<'_>,
        previous: Option<&Live>,
    ) -> Result<Window, RpcError> {
        let saved = lock(&session.window).clone();
        if let Some(saved) = saved
            && let Some(window) = herdr.existing_window(&saved, &session.cwd).await?
        {
            tracing::Span::current().record("reused", true);
            if let Some(id) = &window.workspace_id {
                tracing::Span::current().record("workspace_id", id.as_str());
            }
            *lock(&session.window) = Some(window.clone());
            self.save(session, previous)?;
            return Ok(window);
        }
        let window = herdr.open_agent(launch).await?;
        if let Some(id) = &window.workspace_id {
            tracing::Span::current().record("workspace_id", id.as_str());
        }
        *lock(&session.window) = Some(window.clone());
        if let Err(error) = self.save(session, previous) {
            *lock(&session.window) = None;
            if let Err(close) = herdr.close_window(&window).await {
                tracing::warn!(%close, pane = %window.pane_id, "could not close an unsaved native window");
            }
            return Err(error);
        }
        Ok(window)
    }
}
