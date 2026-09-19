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
    fn frames(&self, session: AgentSessionId) -> BoxFuture<'_, Vec<Message>> {
        Box::pin(async move {
            match self.repo.list_by_session(session).await {
                Ok(entries) => entries
                    .into_iter()
                    .map(|stored| stored.entry.content)
                    .collect(),
                // Degrade to the pre-replay behavior - the model's context
                // starts over - rather than failing the attach.
                Err(error) => {
                    tracing::warn!(
                        error = ?error,
                        %session,
                        "failed to load the session log; the in-memory agent starts with no model context"
                    );
                    Vec::new()
                }
            }
        })
    }
}
