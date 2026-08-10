//! The domain service implementing the query port.
//!
//! [`FoldedMessageService`] is the explicit adapter between the two ports:
//! it holds something that can fold a session ([`FoldSession`]) and answers
//! [`FoldedMessageRepo`] queries with it. It does no folding of its own -
//! that lives in [`FoldSession`]'s blanket impl over
//! [`LogRepo`](crate::domain::ports::LogRepo) - so all this type decides is
//! which types answer the query API, which the blanket impl deliberately
//! leaves open.

use crate::domain::log::AgentSessionId;
use crate::domain::model::FoldedMessage;
use crate::domain::ports::{FoldSession, FoldedMessageRepo};

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
}
