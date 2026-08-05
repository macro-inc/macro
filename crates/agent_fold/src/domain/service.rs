//! The domain service implementing the query port.
//!
//! [`FoldedMessageService`] is the explicit adapter between the two ports:
//! it holds something that can fold a session ([`FoldSession`]) and answers
//! [`FoldedMessageRepo`] queries with it. It does no folding of its own -
//! that lives in [`FoldSession`]'s blanket impl over
//! [`LogRepo`](crate::domain::ports::LogRepo) - so the only thing this type
//! adds is the `get_message` lookup, which is just a filter over `messages`.

use crate::domain::model::{FoldedMessage, MessageId};
use crate::domain::ports::{FoldSession, FoldedMessageRepo};
use agent_session::domain::model::AgentSessionId;

/// Serves [`FoldedMessageRepo`] queries by delegating to a [`FoldSession`].
#[derive(Debug, Clone)]
pub struct FoldedMessageService<Sessions> {
    sessions: Sessions,
}

impl<Sessions> FoldedMessageService<Sessions> {
    /// A service answering queries by folding through the given session.
    pub fn new(sessions: Sessions) -> Self {
        Self { sessions }
    }
}

impl<Sessions> FoldedMessageRepo for FoldedMessageService<Sessions>
where
    Sessions: FoldSession + Sync,
{
    #[tracing::instrument(err, skip(self))]
    async fn messages(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<FoldedMessage>, rootcause::Report> {
        self.sessions.fold_session(session).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_message(
        &self,
        session: AgentSessionId,
        id: MessageId,
    ) -> Result<Option<FoldedMessage>, rootcause::Report> {
        let messages = self.sessions.fold_session(session).await?;
        Ok(messages.into_iter().find(|message| message.id() == id))
    }
}
