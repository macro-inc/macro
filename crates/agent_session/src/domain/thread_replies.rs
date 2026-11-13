//! Pausing an agent's replies in the thread its session was started from.
//!
//! A session started from a thread answers later messages there without a
//! mention when they read as meant for it. Pausing stops that: the agent then
//! answers only messages that mention it. Resuming restores it.

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, RequiredPermission, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::auto_archive::session_id;
use super::error::{AgentSessionError, Result};
use super::model::AgentSessionId;

#[cfg(test)]
mod test;

/// Whether a session's thread replies apply and are paused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThreadRepliesState {
    /// The session was started from a thread, so it answers replies there.
    pub from_thread: bool,
    /// Unmentioned replies are paused: the agent answers only mentions.
    pub paused: bool,
}

/// Storage for paused thread replies.
pub trait ThreadRepliesRepo: Send + Sync + 'static {
    /// The session's thread-reply state.
    fn thread_replies(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<ThreadRepliesState>> + Send;

    /// Pause the session's thread replies on behalf of `by`, or resume them
    /// with `None`. Pausing an already paused session keeps who paused it.
    fn set_thread_replies_paused(
        &self,
        session: AgentSessionId,
        by: Option<&MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Reading and changing whether a session answers unmentioned thread replies.
pub trait ThreadReplies: Send + Sync + 'static {
    /// The state of the session `access` covers.
    fn thread_replies(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<ThreadRepliesState>> + Send;

    /// Pause or resume the replies of the session `access` covers.
    fn set_paused(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        paused: bool,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Thread replies over the session store.
pub struct ThreadRepliesService<R> {
    repo: R,
}

impl<R> ThreadRepliesService<R> {
    /// Build the service over the session store.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: ThreadRepliesRepo> ThreadReplies for ThreadRepliesService<R> {
    async fn thread_replies(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ThreadRepliesState> {
        self.repo.thread_replies(session_id(access)?).await
    }

    #[tracing::instrument(
        name = "agent_session.thread_replies.set_paused",
        err,
        skip(self, access),
        fields(session_id = tracing::field::Empty)
    )]
    async fn set_paused(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        paused: bool,
    ) -> Result<()> {
        let session = session_id(access)?;
        tracing::Span::current().record("session_id", tracing::field::display(session));
        if !paused {
            return self.repo.set_thread_replies_paused(session, None).await;
        }
        let by = acting_user(access)?;
        if !self.repo.thread_replies(session).await?.from_thread {
            return Err(AgentSessionError::NotFromThread(session));
        }
        self.repo.set_thread_replies_paused(session, Some(by)).await
    }
}

fn acting_user<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> Result<&MacroUserIdStr<'static>> {
    access.acting_user_id().ok_or(AgentSessionError::Forbidden)
}
