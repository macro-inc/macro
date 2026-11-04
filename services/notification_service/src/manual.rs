//! Manual notifications: a person, or agent code acting for them, writes a
//! notification and sends it to themselves or to someone who can already see
//! what it links to. Delivery goes through the notification ingress like every
//! other kind.

pub(crate) mod bots;
pub(crate) mod entity_access;
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

/// The kinds of entity a manual notification can link to: the ones a
/// recipient's access can be checked against and the app can open.
pub(crate) const LINKABLE_ENTITY_TYPES: [EntityType; 9] = [
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

/// The name and avatar an agent shows as a sender.
pub(crate) trait AgentProfiles: Send + Sync + 'static {
    /// `None` when no such agent exists.
    fn profile(
        &self,
        agent_id: BotId,
    ) -> impl Future<Output = Result<Option<ManualNotificationAgent>, rootcause::Report>> + Send;
}

/// Validates manual notifications and hands them to the notification ingress.
pub(crate) struct ManualNotifications<Access, Agents, Ingress> {
    pub access: Access,
    pub agents: Agents,
    pub ingress: Ingress,
}

impl<Access, Agents, Ingress> ManualNotifications<Access, Agents, Ingress>
where
    Access: LinkAccess,
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

        if !LINKABLE_ENTITY_TYPES.contains(&draft.link.entity_type) {
            return Err(ManualNotificationError::UnlinkableEntity(
                draft.link.entity_type,
            ));
        }

        let sender_sees_link = self
            .access
            .can_view(&sender.user, &draft.link)
            .await
            .map_err(ManualNotificationError::Internal)?;
        if !sender_sees_link {
            return Err(ManualNotificationError::LinkNotFound);
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
