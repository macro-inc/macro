//! Keep one independent workspace per native session across retries and restarts.

use super::*;
use crate::herdr::cli::Window;

#[cfg(test)]
mod test;

impl Adapter {
    pub(super) fn remember_window(
        &self,
        session: &Session,
        live: &Live,
        info: &crate::herdr::cli::AgentInfo,
    ) -> Result<(), RpcError> {
        let saved = lock(&session.window).clone();
        let Some(mut window) = info.window.clone() else {
            return Ok(());
        };
        // Observing an agent in a workspace does not grant ownership of it.
        // Retain ownership only while it remains in the workspace we created.
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

    pub(super) async fn session_window(
        &self,
        herdr: &HerdrCli,
        session: &Session,
        label: &str,
        previous: Option<&Live>,
    ) -> Result<Window, RpcError> {
        let saved = lock(&session.window).clone();
        if let Some(saved) = saved
            && let Some(window) = herdr.existing_window(&saved, &session.cwd).await?
        {
            *lock(&session.window) = Some(window.clone());
            self.save(session, previous)?;
            return Ok(window);
        }
        let window = herdr
            .open_workspace(&session.cwd, label, !self.options.no_focus)
            .await?;
        *lock(&session.window) = Some(window.clone());
        if let Err(error) = self.save(session, previous) {
            herdr.close_window(&window).await?;
            *lock(&session.window) = None;
            return Err(error);
        }
        Ok(window)
    }
}
