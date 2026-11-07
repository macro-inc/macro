//! Bridge native Cursor repository facts to the owning session operation.

use std::sync::{Arc, OnceLock};

use agent_session::domain::model::{AgentSessionId, SessionClaim};
use agent_session::domain::working_branch::SessionWorkingBranches;
use cursor_cloud_agents::domain::ports::WorkingBranchReporter;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

pub(super) struct CursorWorkingBranchReporter {
    pub service: Arc<dyn SessionWorkingBranches>,
    pub session: AgentSessionId,
    pub owner: MacroUserIdStr<'static>,
    pub claim: Arc<OnceLock<SessionClaim>>,
}

impl WorkingBranchReporter for CursorWorkingBranchReporter {
    fn set_working_branch<'a>(
        &'a self,
        repository_url: &'a str,
        branch: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), rootcause::Report>> + Send + 'a>> {
        Box::pin(async move {
            let claim = *self
                .claim
                .get()
                .ok_or_else(|| rootcause::report!("Cursor attachment is not activated"))?;
            self.service
                .set_working_branch(
                    self.session,
                    &self.owner,
                    repository_url,
                    branch,
                    Some(claim),
                )
                .await
                .map(|_| ())
                .map_err(|error| rootcause::report!("{error}"))
        })
    }
}
