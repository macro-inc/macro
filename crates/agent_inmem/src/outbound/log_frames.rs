//! The production [`FrameSource`]: the session's durable Postgres log.

use agent_session::domain::model::{AgentSessionId, Message};
use agent_session::domain::ports::AgentSessionLogRepo;
use futures::future::BoxFuture;

use crate::domain::replay::FrameSource;

/// [`FrameSource`] over an [`AgentSessionLogRepo`] - the same log every
/// frame of the session was recorded into.
pub struct LogFrameSource<Repo> {
    repo: Repo,
}

impl<Repo> LogFrameSource<Repo> {
    /// Read frames from `repo`.
    #[must_use]
    pub fn new(repo: Repo) -> Self {
        Self { repo }
    }
}

impl<Repo> FrameSource for LogFrameSource<Repo>
where
    Repo: AgentSessionLogRepo,
{
    fn frames(
        &self,
        session: AgentSessionId,
    ) -> BoxFuture<'_, agent_session::domain::error::Result<Vec<Message>>> {
        Box::pin(async move {
            let entries = self.repo.list_by_session(session).await?;
            Ok(entries
                .into_iter()
                .map(|stored| stored.entry.content)
                .collect())
        })
    }
}
