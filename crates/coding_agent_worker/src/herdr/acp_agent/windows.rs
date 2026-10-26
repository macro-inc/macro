//! Keep one tab per native session across launch retries and daemon restarts.

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
        if let Some(window) = &info.window
            && saved.as_ref() != Some(window)
        {
            *lock(&session.window) = Some(window.clone());
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
            .open_window(&session.cwd, label, !self.options.no_focus)
            .await?;
        *lock(&session.window) = Some(window.clone());
        if let Err(error) = self.save(session, previous) {
            herdr.close_tab(&window.tab_id).await?;
            *lock(&session.window) = None;
            return Err(error);
        }
        Ok(window)
    }
}
