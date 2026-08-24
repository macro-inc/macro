//! What counts as activity in the email domain.
//!
//! Only user-initiated changes are activity: inbound mail, provider syncs,
//! and link lifecycle carry no acting user and are dropped.

#[cfg(test)]
mod test;

use ::activity::{
    Action, Activity, ActivitySource, Actor, CommonAction, DomainActivity, EntityType, Ingest,
    event_time,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::events::{EmailEventOrigin, EmailTopicEvent};

/// Email-thread-exclusive actions. Common lifecycle actions go through
/// [`Activity::common`] and need no representation here.
#[derive(Debug, Clone, PartialEq)]
pub enum EmailThreadAction {
    /// An email message was sent on the thread.
    Sent,
}

/// An email-thread-exclusive activity.
#[derive(Debug, Clone, PartialEq)]
pub struct EmailThreadActivity {
    /// The thread acted on.
    pub thread_id: String,
    /// What happened to it.
    pub action: EmailThreadAction,
}

impl DomainActivity for EmailThreadActivity {
    const ENTITY_TYPE: EntityType = EntityType::EmailThread;

    fn entity_id(&self) -> &str {
        &self.thread_id
    }

    fn into_action(self) -> Action {
        match self.action {
            EmailThreadAction::Sent => Action::Sent,
        }
    }
}

impl ActivitySource for EmailTopicEvent {
    /// Maps one `macro.email` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let now = || event_time(event_id);
        // A thread mutation counts only when a user did it directly.
        let user_edit = |actor: &Option<MacroUserIdStr<'static>>,
                         origin: &EmailEventOrigin,
                         thread_id: Uuid| {
            match (actor, origin) {
                (Some(actor), EmailEventOrigin::UserAction) => {
                    Ingest::Insert(vec![Activity::common(
                        event_id,
                        0,
                        Actor::new_from_user(actor.clone()),
                        None,
                        EntityType::EmailThread,
                        thread_id.to_string(),
                        CommonAction::Edited,
                        now(),
                    )])
                }
                _ => Ingest::Ignore,
            }
        };

        match self {
            // Sent counts only when the user sent from Macro; a send synced
            // from another client (provider_sync) still carries the actor
            // but is not an act performed here.
            EmailTopicEvent::MessageSent(m) => match (&m.actor, &m.origin) {
                (Some(actor), EmailEventOrigin::UserAction) => {
                    Ingest::Insert(vec![Activity::from_domain(
                        event_id,
                        0,
                        Actor::new_from_user(actor.clone()),
                        None,
                        EmailThreadActivity {
                            thread_id: m.thread_id.to_string(),
                            action: EmailThreadAction::Sent,
                        },
                        now(),
                    )])
                }
                _ => Ingest::Ignore,
            },
            EmailTopicEvent::ThreadArchived(m) => user_edit(&m.actor, &m.origin, m.thread_id),
            EmailTopicEvent::ThreadTrashed(m) => user_edit(&m.actor, &m.origin, m.thread_id),
            EmailTopicEvent::ThreadStarred(m) => user_edit(&m.actor, &m.origin, m.thread_id),
            EmailTopicEvent::ThreadSpamChanged(m) => user_edit(&m.actor, &m.origin, m.thread_id),
            EmailTopicEvent::ThreadLabelsUpdated(m) => user_edit(&m.actor, &m.origin, m.thread_id),
            EmailTopicEvent::ThreadProjectChanged(m) => Ingest::Insert(vec![Activity::common(
                event_id,
                0,
                Actor::new_from_user(m.actor.clone()),
                None,
                EntityType::EmailThread,
                m.thread_id.to_string(),
                CommonAction::Edited,
                now(),
            )]),
            // Read-state, not a content mutation (and not view telemetry either —
            // opens arrive via the interaction capability).
            EmailTopicEvent::ThreadRead(_) => Ingest::Ignore,
            // Resolved by a later message_sent; counting both double-reports.
            EmailTopicEvent::MessageSendQueued(_) | EmailTopicEvent::MessageSendCancelled(_) => {
                Ingest::Ignore
            }
            // No acting user: inbound mail, provider syncs, link lifecycle,
            // backfill/reindex pipeline.
            EmailTopicEvent::MessageReceived(_)
            | EmailTopicEvent::MessageDraftSynced(_)
            | EmailTopicEvent::MessageDeleted(_)
            | EmailTopicEvent::LinkConnected(_)
            | EmailTopicEvent::LinkDisconnected(_)
            | EmailTopicEvent::LinkReauthRequired(_)
            | EmailTopicEvent::ThreadBackfilled(_)
            | EmailTopicEvent::ThreadsReindexRequested(_) => Ingest::Ignore,
        }
    }
}
