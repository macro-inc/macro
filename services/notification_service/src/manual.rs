//! Manual notifications: a person, or agent code acting for them, writes a
//! notification and sends it to themselves or to someone who can already see
//! what it links to. Delivery goes through the notification ingress like every
//! other kind, and a notification is accepted only when the recipient's inbox
//! and Home would list it.

pub(crate) mod outbound;
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
use uuid::Uuid;

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

/// How email-thread links are checked. The inbox and Home list a thread only
/// for its owner, while it is Signal-important and in the inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EmailThreadLinks {
    /// Like every other link: refused unless the recipient's feeds list it.
    FeedChecked,
    /// Accepted after the access check alone, even when no feed lists it.
    #[expect(
        dead_code,
        reason = "the switch's other position, pending a product decision"
    )]
    AccessChecked,
}

/// Pending a product decision; switch here.
pub(crate) const EMAIL_THREAD_LINKS: EmailThreadLinks = EmailThreadLinks::FeedChecked;

/// A feed that shows notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Feed {
    Inbox,
    Home,
}

/// Whether a viewer's feeds would list a new notification about a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FeedVerdict {
    /// Both the inbox and Home would list it.
    Listed,
    /// This feed would not list it.
    NotListed(Feed),
}

impl FeedVerdict {
    /// The span value for this verdict.
    fn as_str(self) -> &'static str {
        match self {
            FeedVerdict::Listed => "listed",
            FeedVerdict::NotListed(_) => "not_listed",
        }
    }
}

/// Who is sending: the acting user, and the agent whose code runs for them.
pub(crate) struct ManualSender {
    pub user: MacroUserIdStr<'static>,
    /// The user's opaque FusionAuth id, recorded in traces in place of
    /// `user`, which carries an email address.
    pub opaque_id: String,
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
    /// The recipient's feed would not list it: their access does not come
    /// from a share the feeds read (a link share, an attachment), the entity
    /// is deleted, or the feed leaves it out (unlisted sessions, snippets on
    /// Home, mail that is not the recipient's Signal inbox mail).
    #[error("the recipient's {0} would not show a notification about this link")]
    NotListedForRecipient(Feed),
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

/// Whether a viewer's inbox and Home would list a new notification about an
/// entity, by the feeds' own membership rules.
pub(crate) trait FeedVisibility: Send + Sync + 'static {
    fn admits(
        &self,
        viewer: &MacroUserIdStr<'static>,
        link: &Entity<'static>,
    ) -> impl Future<Output = Result<FeedVerdict, rootcause::Report>> + Send;
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
pub(crate) struct ManualNotifications<Access, Feeds, Agents, Ingress> {
    pub access: Access,
    pub feeds: Feeds,
    pub agents: Agents,
    pub ingress: Ingress,
}

impl<Access, Feeds, Agents, Ingress> ManualNotifications<Access, Feeds, Agents, Ingress>
where
    Access: LinkAccess,
    Feeds: FeedVisibility,
    Agents: AgentProfiles,
    Ingress: NotificationIngress,
{
    #[tracing::instrument(
        name = "notification.send_manual",
        err,
        skip_all,
        fields(
            sender_id = %sender.opaque_id,
            agent_id = ?sender.agent_id,
            entity_type = %draft.link.entity_type,
            entity_id = %draft.link.entity_id,
            to_self = draft.recipient.is_none(),
            feed_verdict = tracing::field::Empty,
            refused_by = tracing::field::Empty,
            notification_id = tracing::field::Empty,
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

        let feeds_decide = entity_type != EntityType::EmailThread
            || EMAIL_THREAD_LINKS == EmailThreadLinks::FeedChecked;
        if feeds_decide {
            let viewer = recipient.as_ref().unwrap_or(&sender.user);
            let verdict = self
                .feeds
                .admits(viewer, &draft.link)
                .await
                .map_err(ManualNotificationError::Internal)?;
            let span = tracing::Span::current();
            span.record("feed_verdict", verdict.as_str());
            if let FeedVerdict::NotListed(feed) = verdict {
                span.record("refused_by", <&'static str>::from(feed));
                return Err(ManualNotificationError::NotListedForRecipient(feed));
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

        let notification_id = Uuid::now_v7();
        tracing::Span::current()
            .record("notification_id", tracing::field::display(notification_id));
        let request = SendNotificationRequestBuilder {
            notification_entity: draft.link,
            secondary_notification_entity: None,
            notification: ManualMetadata { title, body, agent },
            sender_id,
            recipient_ids: HashSet::from([recipient_id]),
        }
        .into_request_with_id(notification_id)
        .with_apns()
        .with_conn_gateway();

        self.ingress
            .send_notification(request)
            .await
            .map_err(|error| ManualNotificationError::Internal(error.into_dynamic()))?;

        Ok(())
    }
}
