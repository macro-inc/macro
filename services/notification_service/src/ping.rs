//! Pings: a person, or agent code acting for them, writes a
//! notification about an entity and sends it to themselves or to people who
//! can already see that entity. Delivery goes through the notification ingress
//! like every other kind, and each recipient gets it only when their
//! Notifications inbox would list it.
//!
//! Three guards keep a looping program from flooding people: an identical
//! notification repeated within [`DEDUPE_WINDOW`] is delivered once, each
//! sender has an hourly allowance counted per recipient, and each person
//! receives at most a fixed number an hour from others.
//!
//! Sending is behind the [`AGENT_NOTIFICATIONS_FLAG`], read for the sender.

pub(crate) mod outbound;
#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::future::Future;
use std::time::Duration;

use bot_id::BotId;
use chrono::{DateTime, TimeDelta, Utc};
use feature_flags::FeatureFlags;
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::{PingAgent, PingMessage, PingMetadata};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// Turns pings on for a sender. The web app reads the same key
/// to show their settings.
pub(crate) const AGENT_NOTIFICATIONS_FLAG: &str = "enable-agent-notifications";

/// The longest title, in characters; longer ones are rejected, not cut.
pub(crate) const MAX_TITLE_CHARS: usize = 120;

/// The longest body, in characters; longer ones are rejected, not cut.
pub(crate) const MAX_BODY_CHARS: usize = 1000;

/// The most recipients one notification can name. A sanity bound, far above
/// any real audience.
pub(crate) const MAX_RECIPIENTS: usize = 100;

/// How long an identical notification (same sender, entity, recipients and
/// text) stays a repeat. Windows are fixed spans of the clock, so a repeat is
/// dropped when it falls in the same span as the first.
pub(crate) const DEDUPE_WINDOW: TimeDelta = TimeDelta::minutes(10);

/// How many recipients' checks run at once. Each is a handful of queries on
/// the primary database (about 11 ms in all, whatever the size of the
/// recipient's inbox), so a send to the most recipients one can name takes
/// about a quarter of a second.
const ADMISSIONS_AT_ONCE: usize = 8;

/// How many recipients' checks run at once across every send this process
/// handles. Each holds a primary connection for its queries, so concurrent
/// large sends queue here rather than drain a pool ingress and delivery
/// share.
const ADMISSIONS_PER_PROCESS: usize = 16;

static ADMISSION_SLOTS: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(ADMISSIONS_PER_PROCESS));

/// Namespace of the ids derived from a ping's content.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6f1d_2a54_9c3b_4e07_8a51_d2c9_7be4_0f36);

/// The kinds of entity whose view access the shared entity access check
/// answers and the app can open. A link must also be one the inbox lists; see
/// [`shown_in_inbox`]. A channel message is linkable too, and is filed under
/// its channel.
pub(crate) const ACCESS_CHECKED_TYPES: [EntityType; 13] = [
    EntityType::Document,
    EntityType::Chat,
    EntityType::Channel,
    EntityType::Project,
    EntityType::Initiative,
    EntityType::EmailThread,
    EntityType::CalendarEvent,
    EntityType::CrmCompany,
    EntityType::CrmContact,
    EntityType::AgentSession,
    EntityType::ScheduledAction,
    EntityType::Database,
    EntityType::Form,
];

/// Whether the Notifications inbox lists notifications filed under this kind
/// of entity. Anything else would be delivered and then never shown. Home
/// lists the same kinds except companies and contacts, whose notifications
/// have only ever shown in the inbox; whether a particular recipient's inbox
/// lists one is [`FeedVisibility`]'s to say.
pub(crate) fn shown_in_inbox(entity_type: EntityType) -> bool {
    notification_inbox::domain::policy::CANDIDATE_TYPES.contains(&entity_type)
}

/// Who is sending: the acting user, and the agent whose code runs for them.
pub(crate) struct PingSender {
    pub user: MacroUserIdStr<'static>,
    /// The user's opaque FusionAuth id, recorded in traces in place of
    /// `user`, which carries an email address.
    pub opaque_id: String,
    pub agent_id: Option<BotId>,
}

/// What the sender wrote and where it points.
pub(crate) struct PingDraft {
    /// Who gets it; empty sends it to the sender.
    pub recipients: Vec<MacroUserIdStr<'static>>,
    pub title: String,
    pub body: Option<String>,
    pub link: Entity<'static>,
}

/// Who a ping was sent to. A notified recipient's own
/// preferences can still keep it from them; that is theirs to know.
#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PingOutcome {
    /// The recipients it was queued for, in the order they were named.
    #[schema(value_type = Vec<String>)]
    pub notified: Vec<MacroUserIdStr<'static>>,
    /// The recipients it was not sent to.
    pub skipped: Vec<SkippedRecipient>,
}

/// A recipient a ping was not sent to.
#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRecipient {
    /// The recipient.
    #[schema(value_type = String)]
    pub user_id: MacroUserIdStr<'static>,
    /// Why they were left out.
    pub reason: SkipReason,
}

/// Why a recipient was left out of a ping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    /// They cannot open the linked entity, so notifying them would leak it.
    NoAccess,
    /// They can open it, but their Notifications inbox would not list it:
    /// their access does not come from a share the inbox reads (a link
    /// share, an attachment), it is deleted, or the inbox leaves it out (an
    /// unlisted session, mail that is not their own Signal inbox mail).
    NotListed,
    /// They have received as many notifications from others this hour as
    /// anyone may.
    RecipientLimit,
}

impl SkipReason {
    /// The span field counting recipients skipped for this reason.
    fn as_str(self) -> &'static str {
        match self {
            SkipReason::NoAccess => "no_access",
            SkipReason::NotListed => "not_listed",
            SkipReason::RecipientLimit => "recipient_limit",
        }
    }
}

/// Why a ping was refused.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PingError {
    /// The sender's `enable-agent-notifications` flag is off.
    #[error("agent notifications are not enabled for this account")]
    NotEnabled,
    /// The sender's flags could not be read, so nothing says they may send.
    #[error("could not check whether agent notifications are enabled: {0:?}")]
    FlagsUnavailable(rootcause::Report),
    #[error("title must not be empty")]
    EmptyTitle,
    #[error("title is longer than {MAX_TITLE_CHARS} characters")]
    TitleTooLong,
    #[error("body is longer than {MAX_BODY_CHARS} characters")]
    BodyTooLong,
    #[error("a notification can name at most {MAX_RECIPIENTS} recipients")]
    TooManyRecipients,
    #[error("notifications cannot link to a {0}")]
    UnlinkableEntity(EntityType),
    /// The inbox never lists notifications about this kind of entity.
    #[error("notifications linking to a {0} would not appear in the inbox")]
    NotShownInInbox(EntityType),
    /// The sender cannot see the link, or it does not exist.
    #[error("the linked entity was not found")]
    LinkNotFound,
    /// The sender's allowance has no room for this many recipients.
    #[error(
        "too many notifications: a sender can notify at most {} recipients an hour; try again in {} minutes",
        .0.limit,
        .0.retry_after.as_secs().div_ceil(60)
    )]
    AllowanceExceeded(AllowanceExceeded),
    #[error("internal ping error: {0:?}")]
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

/// Whether a viewer's Notifications inbox would list a new notification about
/// an entity, by the inbox's own membership rules.
pub(crate) trait FeedVisibility: Send + Sync + 'static {
    fn admits(
        &self,
        viewer: &MacroUserIdStr<'static>,
        link: &Entity<'static>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// Where a channel message is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LocatedMessage {
    pub channel_id: Uuid,
    pub message_id: Uuid,
    /// The top-level message it replies to; `None` when it is top-level.
    pub thread_id: Option<Uuid>,
}

/// Finds the channel messages a user can read.
pub(crate) trait ChannelMessages: Send + Sync + 'static {
    /// `None` when there is no such live channel message or `user` cannot
    /// read its channel.
    fn locate(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: &str,
    ) -> impl Future<Output = Result<Option<LocatedMessage>, rootcause::Report>> + Send;
}

/// A sender's allowance had no room for what they asked to send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AllowanceExceeded {
    /// How many notifications the allowance holds per window.
    pub limit: u64,
    /// How long until the allowance is whole again.
    pub retry_after: Duration,
}

/// How many notifications a sender may still send, and a recipient still
/// receive. Ceilings against runaway programs, not quotas ordinary use comes
/// near.
pub(crate) trait SendAllowance: Send + Sync + 'static {
    /// Count `notifications`, one per recipient, against `sender`'s
    /// allowance. Nothing is counted when they do not all fit.
    fn take(
        &self,
        sender: &MacroUserIdStr<'_>,
        notifications: u64,
    ) -> impl Future<Output = Result<Result<(), AllowanceExceeded>, rootcause::Report>> + Send;

    /// Count one notification from someone else against `recipient`'s hourly
    /// cap, shared by every sender. `false`, with nothing counted, when they
    /// are at it.
    fn take_received(
        &self,
        recipient: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;

    /// Give back one notification [`SendAllowance::take_received`] counted,
    /// for a send that did not go out.
    fn give_back_received(
        &self,
        recipient: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// The name and avatar an agent shows as a sender.
pub(crate) trait AgentProfiles: Send + Sync + 'static {
    /// `None` when no such agent exists.
    fn profile(
        &self,
        agent_id: BotId,
    ) -> impl Future<Output = Result<Option<PingAgent>, rootcause::Report>> + Send;
}

/// Validates pings and hands them to the notification ingress.
pub(crate) struct Pings<Flags, Access, Feeds, Messages, Agents, Allowance, Ingress> {
    pub flags: Flags,
    pub access: Access,
    pub feeds: Feeds,
    pub messages: Messages,
    pub agents: Agents,
    pub allowance: Allowance,
    pub ingress: Ingress,
}

/// The entity a notification is filed under, and the message inside it the
/// sender linked.
struct Target {
    entity: Entity<'static>,
    message: Option<PingMessage>,
}

impl<Flags, Access, Feeds, Messages, Agents, Allowance, Ingress>
    Pings<Flags, Access, Feeds, Messages, Agents, Allowance, Ingress>
where
    Flags: FeatureFlags,
    Access: LinkAccess,
    Feeds: FeedVisibility,
    Messages: ChannelMessages,
    Agents: AgentProfiles,
    Allowance: SendAllowance,
    Ingress: NotificationIngress,
{
    /// Send `draft` at `now` to each named recipient whose inbox would list
    /// its link. Recipients who cannot see it, whose inbox would not list it,
    /// or who are at their hourly cap are skipped and reported, never given
    /// access. Refused outright while the sender's flag is off.
    #[tracing::instrument(
        name = "notification.send_ping",
        err,
        skip_all,
        fields(
            sender_id = %sender.opaque_id,
            agent_id = ?sender.agent_id,
            entity_type = %draft.link.entity_type,
            entity_id = %draft.link.entity_id,
            recipients = draft.recipients.len(),
            notified = tracing::field::Empty,
            skipped = tracing::field::Empty,
            no_access = tracing::field::Empty,
            not_listed = tracing::field::Empty,
            recipient_limit = tracing::field::Empty,
            notification_ids = tracing::field::Empty,
        )
    )]
    pub(crate) async fn send(
        &self,
        sender: PingSender,
        draft: PingDraft,
        now: DateTime<Utc>,
    ) -> Result<PingOutcome, PingError> {
        let enabled = self
            .flags
            .load(&sender.user)
            .await
            .map_err(PingError::FlagsUnavailable)?
            .is_enabled(AGENT_NOTIFICATIONS_FLAG);
        if !enabled {
            return Err(PingError::NotEnabled);
        }

        let title = draft.title.trim().to_string();
        if title.is_empty() {
            return Err(PingError::EmptyTitle);
        }

        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(PingError::TitleTooLong);
        }

        let body = draft
            .body
            .map(|body| body.trim().to_string())
            .filter(|body| !body.is_empty());
        if body
            .as_ref()
            .is_some_and(|body| body.chars().count() > MAX_BODY_CHARS)
        {
            return Err(PingError::BodyTooLong);
        }

        // Nobody named means the sender; a name given twice counts once.
        let mut named = HashSet::new();
        let mut recipients: Vec<MacroUserIdStr<'static>> = draft
            .recipients
            .into_iter()
            .filter(|recipient| named.insert(recipient.clone()))
            .collect();
        if recipients.len() > MAX_RECIPIENTS {
            return Err(PingError::TooManyRecipients);
        }
        if recipients.is_empty() {
            recipients.push(sender.user.clone());
        }

        let target = self.target(&sender.user, draft.link).await?;

        // Before any recipient is counted, so a failed lookup leaves no count
        // to give back.
        let agent = match sender.agent_id {
            Some(agent_id) => self
                .agents
                .profile(agent_id)
                .await
                .map_err(PingError::Internal)?,
            None => None,
        };

        let mut outcome = PingOutcome {
            notified: Vec::with_capacity(recipients.len()),
            skipped: Vec::new(),
        };
        // Each recipient's checks are a few queries; a few at a time keeps a
        // send to many people quick without a burst on the database.
        // Collected first: a lazy `map` held across the await below makes
        // the handler's future fail axum's `Send` bound.
        let checks: Vec<_> = recipients
            .into_iter()
            .map(|recipient| {
                let own = recipient == sender.user;
                self.admit(recipient, own, &target.entity)
            })
            .collect();
        let admissions: Vec<_> = futures::stream::iter(checks)
            .buffered(ADMISSIONS_AT_ONCE)
            .collect()
            .await;
        let mut failed = None;
        for (recipient, admission) in admissions {
            match admission {
                Ok(()) => outcome.notified.push(recipient),
                Err(Admission::Skipped(reason)) => outcome.skipped.push(SkippedRecipient {
                    user_id: recipient,
                    reason,
                }),
                Err(Admission::Failed(error)) => {
                    failed.get_or_insert(error);
                }
            }
        }
        if let Some(error) = failed {
            self.give_back(&outcome, &sender.user).await;
            return Err(error);
        }
        let span = tracing::Span::current();
        span.record("notified", outcome.notified.len());
        span.record("skipped", outcome.skipped.len());
        for reason in [
            SkipReason::NoAccess,
            SkipReason::NotListed,
            SkipReason::RecipientLimit,
        ] {
            let count = outcome
                .skipped
                .iter()
                .filter(|skipped| skipped.reason == reason)
                .count();
            span.record(reason.as_str(), count);
        }

        if outcome.notified.is_empty() {
            return Ok(outcome);
        }

        // Counted before sending, so the ceiling holds. A send that then
        // fails stays counted, which errs toward stopping a loop.
        // usize is at most 64 bits on every target this service builds for.
        let notifications = outcome.notified.len() as u64;
        let allowed = self
            .allowance
            .take(&sender.user, notifications)
            .await
            .map_err(PingError::Internal)
            .and_then(|taken| taken.map_err(PingError::AllowanceExceeded));
        if let Err(error) = allowed {
            self.give_back(&outcome, &sender.user).await;
            return Err(error);
        }

        let metadata = PingMetadata {
            title,
            body,
            agent,
            message: target.message,
        };

        // The ingress drops a recipient who is also the sender, so the
        // sender's own copy goes out separately with no sender.
        let (own, others): (HashSet<_>, HashSet<_>) = outcome
            .notified
            .iter()
            .cloned()
            .partition(|recipient| recipient == &sender.user);
        let mut ids = Vec::with_capacity(2);
        for (sender_id, recipient_ids) in [(Some(sender.user.clone()), others), (None, own)] {
            if recipient_ids.is_empty() {
                continue;
            }
            // The ingress creates a notification once per id, so a repeat of
            // this one within the window is not delivered again.
            let id = notification_id(&sender, &target.entity, &metadata, &recipient_ids, now);
            ids.push(id);
            let request = SendNotificationRequestBuilder {
                notification_entity: target.entity.clone(),
                secondary_notification_entity: None,
                notification: metadata.clone(),
                sender_id,
                recipient_ids,
            }
            .into_request_with_id(id)
            .with_apns()
            .with_conn_gateway();

            let queued = self.ingress.send_notification(request).await;
            if let Err(error) = queued {
                // What already went out is delivered; giving every recipient
                // back their count errs toward letting a retry through.
                self.give_back(&outcome, &sender.user).await;
                return Err(PingError::Internal(error.into_dynamic()));
            }
        }
        tracing::Span::current().record("notification_ids", tracing::field::debug(&ids));

        Ok(outcome)
    }

    /// Whether `recipient` gets a notification about `entity`, counting it
    /// against their cap when they do. `own` is the sender, whose access was
    /// checked with the link and who has no cap on pings to themselves.
    async fn admit(
        &self,
        recipient: MacroUserIdStr<'static>,
        own: bool,
        entity: &Entity<'static>,
    ) -> (MacroUserIdStr<'static>, Result<(), Admission>) {
        // The semaphore is never closed, so acquiring cannot fail.
        let admission = match ADMISSION_SLOTS.acquire().await {
            Ok(_slot) => self.check(&recipient, own, entity).await,
            Err(closed) => Err(Admission::internal(rootcause::report!(
                "the admission semaphore closed: {closed}"
            ))),
        };
        (recipient, admission)
    }

    async fn check(
        &self,
        recipient: &MacroUserIdStr<'static>,
        own: bool,
        entity: &Entity<'static>,
    ) -> Result<(), Admission> {
        if !own {
            let sees_link = self
                .access
                .can_view(recipient, entity)
                .await
                .map_err(Admission::internal)?;
            if !sees_link {
                return Err(Admission::Skipped(SkipReason::NoAccess));
            }
        }

        let listed = self
            .feeds
            .admits(recipient, entity)
            .await
            .map_err(Admission::internal)?;
        if !listed {
            return Err(Admission::Skipped(SkipReason::NotListed));
        }

        if !own {
            let room = self
                .allowance
                .take_received(recipient)
                .await
                .map_err(Admission::internal)?;
            if !room {
                return Err(Admission::Skipped(SkipReason::RecipientLimit));
            }
        }
        Ok(())
    }

    /// Give back the received counts [`Self::admit`] took for `outcome`'s
    /// notified recipients, when the send does not go out. A count that
    /// cannot be given back stays spent until the hour is up.
    async fn give_back(&self, outcome: &PingOutcome, sender: &MacroUserIdStr<'_>) {
        for recipient in outcome
            .notified
            .iter()
            .filter(|recipient| *recipient != sender)
        {
            if let Err(error) = self.allowance.give_back_received(recipient).await {
                tracing::warn!(error = ?error, "could not give back a recipient's notification count");
            }
        }
    }

    /// What `link` files a notification under, once `sender` is known to see
    /// it. A channel message files it under the message's channel.
    async fn target(
        &self,
        sender: &MacroUserIdStr<'static>,
        link: Entity<'static>,
    ) -> Result<Target, PingError> {
        if link.entity_type == EntityType::ChannelMessage {
            let message = self
                .messages
                .locate(sender, &link.entity_id)
                .await
                .map_err(PingError::Internal)?
                .ok_or(PingError::LinkNotFound)?;
            return Ok(Target {
                entity: EntityType::Channel.with_entity_string(message.channel_id.to_string()),
                message: Some(PingMessage {
                    message_id: message.message_id,
                    thread_id: message.thread_id,
                }),
            });
        }

        let entity_type = link.entity_type;
        if !ACCESS_CHECKED_TYPES.contains(&entity_type) {
            return Err(PingError::UnlinkableEntity(entity_type));
        }
        if !shown_in_inbox(entity_type) {
            return Err(PingError::NotShownInInbox(entity_type));
        }

        let sender_sees_link = self
            .access
            .can_view(sender, &link)
            .await
            .map_err(PingError::Internal)?;
        if !sender_sees_link {
            return Err(PingError::LinkNotFound);
        }

        Ok(Target {
            entity: link,
            message: None,
        })
    }
}

/// Why [`Pings::admit`] left a recipient out.
enum Admission {
    Skipped(SkipReason),
    Failed(PingError),
}

impl Admission {
    fn internal(report: rootcause::Report) -> Self {
        Admission::Failed(PingError::Internal(report))
    }
}

/// The id of the notification `sender` sends to `recipients`: the same for
/// the same words about the same thing to the same people within one
/// [`DEDUPE_WINDOW`], and different otherwise.
fn notification_id(
    sender: &PingSender,
    entity: &Entity<'_>,
    metadata: &PingMetadata,
    recipients: &HashSet<MacroUserIdStr<'static>>,
    now: DateTime<Utc>,
) -> Uuid {
    let mut recipients: Vec<&str> = recipients
        .iter()
        .map(|recipient| recipient.as_ref())
        .collect();
    recipients.sort_unstable();
    let window = now.timestamp().div_euclid(DEDUPE_WINDOW.num_seconds());
    // JSON keeps the fields apart, so no two different notifications share
    // one encoding.
    let content = serde_json::json!([
        sender.user.as_ref(),
        sender.agent_id.map(|agent| agent.as_uuid()),
        entity.entity_type.to_string(),
        entity.entity_id,
        metadata.message,
        metadata.title,
        metadata.body,
        recipients,
        window,
    ]);
    Uuid::new_v5(&NOTIFICATION_ID_NAMESPACE, content.to_string().as_bytes())
}
