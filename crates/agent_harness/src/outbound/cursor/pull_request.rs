//! Bridge provider facts to Macro's shared session PR operation.

use std::pin::Pin;
use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use agent_session::domain::pull_request::SessionPullRequests;
use cursor_cloud_agents::inbound::acp::PullRequestReporter;
use macro_user_id::user_id::MacroUserIdStr;

pub(super) struct CursorPullRequestReporter {
    pub service: Arc<dyn SessionPullRequests>,
    pub session: AgentSessionId,
    pub owner: MacroUserIdStr<'static>,
}

impl PullRequestReporter for CursorPullRequestReporter {
    fn set_pull_request<'a>(
        &'a self,
        url: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), rootcause::Report>> + Send + 'a>> {
        Box::pin(async move {
            self.service
                .set_pull_request(self.session, &self.owner, url)
                .await
                .map(|_| ())
                .map_err(|error| rootcause::report!(error).into())
        })
    }
}
