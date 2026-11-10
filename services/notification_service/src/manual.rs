//! Manual notifications: a person, or agent code acting for them, writes a
//! notification and sends it to themselves or to someone who can already see
//! what it links to. Delivery goes through the notification ingress like every
//! other kind.

pub(crate) mod bots;
pub(crate) mod entity_access;
pub(crate) mod sessions;
#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::future::Future;

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::{ManualMetadata, ManualNotificationAgent};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;

/// The longest title, in characters; longer ones are rejected, not cut.
pub(crate) const MAX_TITLE_CHARS: usize = 120;

/// The longest body, in characters; longer ones are rejected, not cut.
pub(crate) const MAX_BODY_CHARS: usize = 1000;

/// The kinds of entity whose view access the shared entity access check
/// answers and the app can open. A link must also be one the inbox and Home
/// list; see [`shown_in_inbox_and_home`].
pub(crate) const ACCESS_CHECKED_TYPES: [EntityType; 9] = [
    EntityType::Document,
    EntityType::Chat,
    EntityType::Channel,
    EntityType::Project,
    EntityType::EmailThread,
    EntityType::AgentSession,
    EntityType::ScheduledAction,
    EntityType::Database,
    EntityType::Form,
];

/// Whether the inbox and Home list notifications filed under this kind of
/// entity. Anything else would be delivered and then never shown.
pub(crate) fn shown_in_inbox_and_home(entity_type: EntityType) -> bool {
    notification_inbox::domain::policy::CANDIDATE_TYPES.contains(&entity_type)
        && work_feed::domain::policy::candidate_types(&[]).contains(&entity_type)
}

/// Who is sending: the acting user, and the agent whose code runs for them.
pub(crate) struct ManualSender {
    pub user: MacroUserIdStr<'static>,
    pub agent_id: Option<BotId>,
}

/// What the sender wrote and where it points.
pub(crate) struct ManualNotificationDraft {
    /// `None` sends it to the sender.
    pub recipient: Option<MacroUserIdStr<'static>>,
    pub title: String,
    pub body: Option<String>,
    pub link: Entity<'static>,
}

/// Why a manual notification was refused.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ManualNotificationError {
    #[error("title must not be empty")]
    EmptyTitle,
    #[error("title is longer than {MAX_TITLE_CHARS} characters")]
    TitleTooLong,
    #[error("body is longer than {MAX_BODY_CHARS} characters")]
    BodyTooLong,
    #[error("notifications cannot link to a {0}")]
    UnlinkableEntity(EntityType),
    /// The inbox and Home never list notifications about this kind of entity.
    #[error("notifications linking to a {0} would not appear in the inbox or Home")]
    NotShownInInbox(EntityType),
    /// The inbox and Home leave out unlisted and hidden agent sessions, such
    /// as a routine's runs unless the routine lists them.
    #[error(
        "the linked agent session is not listed, so the notification would not appear in the inbox or Home"
    )]
    UnlistedAgentSession,
    /// The sender cannot see the link, or it does not exist.
    #[error("the linked entity was not found")]
    LinkNotFound,
    /// The recipient cannot see the link, so notifying them would leak it.
    #[error("the recipient cannot see the linked entity")]
    RecipientCannotSeeLink,
    #[error("internal manual notification error: {0:?}")]
    Internal(rootcause::Report),
}

/// Whether a user can at least view an entity.
pub(crate) trait LinkAccess: Send + Sync + 'static {
    fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// Whether an agent session is listed: shown wherever its owner's sessions are.
pub(crate) trait SessionListing: Send + Sync + 'static {
    fn is_listed(
        &self,
        session: &Entity<'_>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// The name and avatar an agent shows as a sender.
pub(crate) trait AgentProfiles: Send + Sync + 'static {
    /// `None` when no such agent exists.
    fn profile(
        &self,
        agent_id: BotId,
    ) -> impl Future<Output = Result<Option<ManualNotificationAgent>, rootcause::Report>> + Send;
}

/// Validates manual notifications and hands them to the notification ingress.
pub(crate) struct ManualNotifications<Access, Sessions, Agents, Ingress> {
    pub access: Access,
    pub sessions: Sessions,
    pub agents: Agents,
    pub ingress: Ingress,
}

impl<Access, Sessions, Agents, Ingress> ManualNotifications<Access, Sessions, Agents, Ingress>
where
    Access: LinkAccess,
    Sessions: SessionListing,
    Agents: AgentProfiles,
    Ingress: NotificationIngress,
{
    #[tracing::instrument(
        name = "notification.send_manual",
        err,
        skip_all,
        fields(
            sender_id = %sender.user,
            agent_id = ?sender.agent_id,
            entity_type = %draft.link.entity_type,
            entity_id = %draft.link.entity_id,
            to_self = draft.recipient.is_none(),
        )
    )]
    pub(crate) async fn send(
        &self,
        sender: ManualSender,
        draft: ManualNotificationDraft,
    ) -> Result<(), ManualNotificationError> {
        let title = draft.title.trim().to_string();
        if title.is_empty() {
            return Err(ManualNotificationError::EmptyTitle);
        }

        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(ManualNotificationError::TitleTooLong);
        }

        let body = draft
            .body
            .map(|body| body.trim().to_string())
            .filter(|body| !body.is_empty());
        if body
            .as_ref()
            .is_some_and(|body| body.chars().count() > MAX_BODY_CHARS)
        {
            return Err(ManualNotificationError::BodyTooLong);
        }

        let entity_type = draft.link.entity_type;
        if !ACCESS_CHECKED_TYPES.contains(&entity_type) {
            return Err(ManualNotificationError::UnlinkableEntity(entity_type));
        }
        if !shown_in_inbox_and_home(entity_type) {
            return Err(ManualNotificationError::NotShownInInbox(entity_type));
        }

        let sender_sees_link = self
            .access
            .can_view(&sender.user, &draft.link)
            .await
            .map_err(ManualNotificationError::Internal)?;
        if !sender_sees_link {
            return Err(ManualNotificationError::LinkNotFound);
        }

        // Email threads are left as they are: the inbox shows them only while
        // Signal-important and not shared, which changes after sending.
        if entity_type == EntityType::AgentSession {
            let listed = self
                .sessions
                .is_listed(&draft.link)
                .await
                .map_err(ManualNotificationError::Internal)?;
            if !listed {
                return Err(ManualNotificationError::UnlistedAgentSession);
            }
        }

        let recipient = draft
            .recipient
            .filter(|recipient| recipient != &sender.user);

        if let Some(recipient) = &recipient {
            let recipient_sees_link = self
                .access
                .can_view(recipient, &draft.link)
                .await
                .map_err(ManualNotificationError::Internal)?;
            if !recipient_sees_link {
                return Err(ManualNotificationError::RecipientCannotSeeLink);
            }
        }

        let agent = match sender.agent_id {
            Some(agent_id) => self
                .agents
                .profile(agent_id)
                .await
                .map_err(ManualNotificationError::Internal)?,
            None => None,
        };

        // The ingress drops a recipient who is also the sender, so a note to
        // oneself goes out with no sender.
        let (sender_id, recipient_id) = match recipient {
            Some(recipient) => (Some(sender.user), recipient),
            None => (None, sender.user),
        };

        let request = SendNotificationRequestBuilder {
            notification_entity: draft.link,
            secondary_notification_entity: None,
            notification: ManualMetadata { title, body, agent },
            sender_id,
            recipient_ids: HashSet::from([recipient_id]),
        }
        .into_request()
        .with_apns()
        .with_conn_gateway();

        self.ingress
            .send_notification(request)
            .await
            .map_err(|error| ManualNotificationError::Internal(error.into_dynamic()))?;

        Ok(())
    }
}
