//! Reuse a native session's workspace across launch retries and daemon restarts.

use super::*;

#[cfg(test)]
mod test;

impl Adapter {
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
            herdr.close_window(&window).await?;
            *lock(&session.window) = None;
            return Err(error);
        }
        Ok(window)
    }
}
