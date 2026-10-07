//! Telling people about tool calls the egress proxy holds for the owner.
//!
//! Each state of a held call becomes a frame in the session's log, which is
//! what the session view renders and answers from; a call that starts
//! waiting also notifies the owner, the only person who can approve it, and
//! every change reaches the harness, which tells the thread that prompted
//! the turn. All best-effort: the hold stands on its approval row either way.
//!
//! Also here: releasing a session's held calls when its turn ends, stops, or
//! the session is deleted, by listening to the same lifecycle facts the
//! harness publishes.

use std::pin::Pin;
use std::sync::Arc;

use agent_egress::domain::approval::{ToolApproval, ToolApprovalAnswers};
use agent_egress::domain::ports::ToolApprovalAnnouncer;
use agent_session::domain::events::AgentSessionLifecycleEvent;
use agent_session::domain::lifecycle::session_identity;
use agent_session::domain::ports::AgentSessionLifecyclePublisher;
use agent_session::domain::service::AgentSessionService;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{HeldToolCall, ToolApprovalChange};
use crate::domain::notifications::plan_tool_approval;
use crate::domain::ports::{AgentSessionNotifier, HeldToolCallObserver};

#[cfg(test)]
mod test;

/// [`ToolApprovalAnnouncer`] over the session's log, the notifier, and the
/// harness.
pub struct SessionToolApprovalAnnouncer<Sessions, Notifier, HeldCalls> {
    sessions: Sessions,
    notifier: Notifier,
    held_calls: HeldCalls,
}

impl<Sessions, Notifier, HeldCalls> SessionToolApprovalAnnouncer<Sessions, Notifier, HeldCalls> {
    /// Announce through `sessions`' log, `notifier`, and `held_calls`.
    pub fn new(sessions: Sessions, notifier: Notifier, held_calls: HeldCalls) -> Self {
        Self {
            sessions,
            notifier,
            held_calls,
        }
    }
}

impl<Sessions, Notifier, HeldCalls> SessionToolApprovalAnnouncer<Sessions, Notifier, HeldCalls>
where
    Sessions: AgentSessionService,
    Notifier: AgentSessionNotifier,
{
    async fn record(&self, approval: &ToolApproval) {
        if let Err(error) = self
            .sessions
            .record_frame(approval.session, approval.notice().to_server_message())
            .await
        {
            tracing::error!(
                error = ?error,
                session = %approval.session,
                approval = %approval.id,
                "could not record a held tool call in the session log"
            );
        }
    }

    async fn notify_owner(&self, approval: &ToolApproval) -> anyhow::Result<()> {
        let session = self.sessions.get_session(approval.session).await?;
        let (bot, participants) = tokio::try_join!(
            self.sessions.session_bot(session.bot_id),
            self.sessions.session_participants(session.id),
        )?;
        let identity = session_identity(&session, &bot, participants)?;
        self.notifier
            .notify(plan_tool_approval(
                &identity,
                approval.id.as_uuid(),
                approval.requested_by.as_ref(),
                &approval.server_name,
                &approval.tool_name,
            ))
            .await;
        Ok(())
    }
}

impl<Sessions, Notifier, HeldCalls> ToolApprovalAnnouncer
    for SessionToolApprovalAnnouncer<Sessions, Notifier, HeldCalls>
where
    Sessions: AgentSessionService,
    Notifier: AgentSessionNotifier,
    HeldCalls: HeldToolCallObserver,
{
    async fn requested(&self, approval: &ToolApproval, _owner: &MacroUserIdStr<'static>) {
        self.record(approval).await;
        self.held_calls.changed(
            approval.session,
            ToolApprovalChange::Held(HeldToolCall {
                approval_id: approval.id.to_string(),
                server_slug: approval.server_slug.clone(),
                server_name: approval.server_name.clone(),
                tool_name: approval.tool_name.clone(),
            }),
        );
        if let Err(error) = self.notify_owner(approval).await {
            tracing::warn!(
                error = ?error,
                session = %approval.session,
                approval = %approval.id,
                "could not notify the owner of a held tool call"
            );
        }
    }

    async fn resolved(&self, approval: &ToolApproval) {
        self.record(approval).await;
        self.held_calls.changed(
            approval.session,
            ToolApprovalChange::Settled {
                approval_id: approval.id.to_string(),
            },
        );
    }
}

/// Publishes lifecycle facts through `inner`, releasing a session's held
/// tool calls first when its turn ends, it stops, or it is deleted: none of
/// those leaves anybody waiting on the answer.
pub struct ReleaseHeldCallsOnTurnEnd<Inner, Approvals> {
    inner: Inner,
    approvals: Arc<Approvals>,
}

impl<Inner, Approvals> ReleaseHeldCallsOnTurnEnd<Inner, Approvals> {
    /// Wrap `inner`, releasing through `approvals`.
    pub fn new(inner: Inner, approvals: Arc<Approvals>) -> Self {
        Self { inner, approvals }
    }
}

impl<Inner, Approvals> AgentSessionLifecyclePublisher
    for ReleaseHeldCallsOnTurnEnd<Inner, Approvals>
where
    Inner: AgentSessionLifecyclePublisher,
    Approvals: ToolApprovalAnswers,
{
    fn publish(
        &self,
        event: AgentSessionLifecycleEvent,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let ended = match &event {
                AgentSessionLifecycleEvent::TurnEnded(ended) => Some(ended.identity.session_id),
                AgentSessionLifecycleEvent::Stopped(stopped) => Some(stopped.identity.session_id),
                AgentSessionLifecycleEvent::Deleted(deleted) => Some(deleted.identity.session_id),
                _ => None,
            };
            if let Some(session) = ended
                && let Err(error) = self.approvals.release_session(session).await
            {
                tracing::warn!(
                    error = ?error,
                    %session,
                    "could not release a session's held tool calls"
                );
            }
            self.inner.publish(event).await;
        })
    }
}
