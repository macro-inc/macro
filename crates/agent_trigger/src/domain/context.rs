//! Reading why an agent was called, for the trigger events that call it.

use agent_session::domain::error::Result;
use messages::domain::events::MessagePostedMetadata;
use trigger_context::{
    AddressedBy, ContextPerson, DiscussionContext, FollowUpContext, TriggerContext,
};

use crate::domain::broker_events::{ThreadMessageKind, TriggerDecision};
use crate::domain::service::AuthorizedInvocation;

/// Reads the discussion a message was posted in, under the poster's verified
/// capability on its parent.
#[cfg_attr(test, mockall::automock)]
pub trait DiscussionReader: Send + Sync + 'static {
    /// The message's surface, its own thread through the message, nearby
    /// channel activity, what it replies to, and where a comment thread is
    /// anchored.
    fn discussion(
        &self,
        invocation: &AuthorizedInvocation,
        posted: &MessagePostedMetadata,
    ) -> impl Future<Output = Result<DiscussionContext>> + Send;
}

/// Names people and bots the way a reader would.
#[cfg_attr(test, mockall::automock)]
pub trait PeopleDirectory: Send + Sync + 'static {
    /// One entry per id, in order. An id with no name on record is named by
    /// its email, or by the id itself for a bot without a profile.
    fn people(&self, ids: Vec<String>) -> impl Future<Output = Result<Vec<ContextPerson>>> + Send;
}

/// Why a decision calls its agent: a mention opens a session, anything else
/// follows up in one that is running.
#[must_use]
pub fn discussion_trigger(
    decision: &TriggerDecision,
    discussion: DiscussionContext,
) -> TriggerContext {
    match decision {
        TriggerDecision::Open { .. } => TriggerContext::Mentioned(discussion),
        TriggerDecision::Existing { kind, .. } => TriggerContext::FollowUp(FollowUpContext {
            addressed_by: match kind {
                ThreadMessageKind::MentionThread => AddressedBy::Mention,
                ThreadMessageKind::ExplicitReply => AddressedBy::ExplicitReply,
                ThreadMessageKind::Inferred => AddressedBy::Inferred,
            },
            discussion,
        }),
    }
}
