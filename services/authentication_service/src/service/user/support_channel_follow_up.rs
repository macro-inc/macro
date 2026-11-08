//! One follow-up in each new user's support channel, after the welcome.
//!
//! A support team member asks one question about what the user set up during
//! onboarding. It goes out shortly after they finish onboarding, or five
//! minutes after the welcome if they haven't, and never once anyone has posted
//! in the channel. The PostHog flag `support-channel-follow-up` assigns each
//! new user to `control` or `test`; only `test` gets the message.

use std::{sync::Arc, time::Duration};

use analytics_client::AnalyticsClient;
use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use feature_flags::{FeatureFlags, outbound::posthog::PostHogFeatureFlags};
use futures::{StreamExt, stream};
use generic_email_domains::is_generic_email_domain;
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use mention_utils::serialize::user_mention;
use messages::domain::{
    api::MessageServiceApi,
    models::{
        MessageAttribution, MessageListItem, PostMessage, PostMessageNotificationPolicy,
        SimpleMention,
    },
    ports::MessageTimelineQuery,
    service::{MessageView, MessageWrite},
};
use onboarding::domain::ports::OnboardingRepo;
use pipedream_mcp::domain::ports::ConnectionStore;
use rootcause::{
    Report,
    prelude::{IntoRootcause, ResultExt},
};
use sqlx::PgPool;
use teams::domain::team_repo::TeamService;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::outbound::support_follow_ups::{PendingFollowUp, PgSupportFollowUps};

#[cfg(test)]
mod test;

const FLAG: &str = "support-channel-follow-up";
/// The experiment variant that gets the follow-up; `control` does not.
const SEND_VARIANT: &str = "test";
const SENDER_EMAIL: &str = "chaitanya@macro.com";

/// Gives a user who just finished onboarding time to land in the app.
const AFTER_ONBOARDING: TimeDelta = TimeDelta::seconds(30);
/// When to send to someone who hasn't finished onboarding.
const FALLBACK: TimeDelta = TimeDelta::minutes(5);
/// A follow-up still queued this long after the welcome, say after an outage,
/// is dropped rather than sent late.
const EXPIRY: TimeDelta = TimeDelta::hours(1);

const POLL_INTERVAL: Duration = Duration::from_secs(10);
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(30);
const CONCURRENT_DELIVERIES: usize = 4;
/// Longest team or tool name worth putting in a sentence.
const MAX_NAME_CHARS: usize = 40;

/// Assigns new users to the follow-up experiment and queues the message for
/// the `test` group.
#[derive(Clone)]
pub(crate) struct SupportFollowUpScheduler {
    queue: PgSupportFollowUps,
    flags: PostHogFeatureFlags,
    analytics: Arc<AnalyticsClient>,
}

impl SupportFollowUpScheduler {
    pub(crate) fn new(
        queue: PgSupportFollowUps,
        flags: PostHogFeatureFlags,
        analytics: Arc<AnalyticsClient>,
    ) -> Self {
        Self {
            queue,
            flags,
            analytics,
        }
    }

    /// Call once the welcome has posted in `channel_id`.
    #[tracing::instrument(
        name = "support_follow_up.schedule",
        skip_all,
        fields(%channel_id, variant = tracing::field::Empty),
        err
    )]
    pub(crate) async fn schedule(
        &self,
        channel_id: &str,
        user: &MacroUserIdStr<'static>,
    ) -> Result<(), Report> {
        let channel_id =
            Uuid::parse_str(channel_id).context("support channel has an invalid id")?;
        let flags = self
            .flags
            .load(user)
            .await
            .context("failed to load feature flags")?;
        let Some(variant) = flags.variant(FLAG) else {
            return Ok(());
        };
        tracing::Span::current().record("variant", variant);

        // Server-side flag reads record no exposure, so the experiment's
        // exposure event is sent here, for both groups. The client logs a
        // failed capture.
        let _ = self
            .analytics
            .track_posthog(
                user.as_ref(),
                "$feature_flag_called",
                serde_json::json!({
                    "$feature_flag": FLAG,
                    "$feature_flag_response": variant,
                }),
            )
            .await;

        if variant != SEND_VARIANT {
            return Ok(());
        }
        self.queue
            .schedule(channel_id, user, macro_uuid::generate_uuid_v7())
            .await
            .context("failed to queue support follow-up")?;
        Ok(())
    }
}

/// Sends queued follow-ups when they come due. Every replica runs one; a row
/// claim keeps two from sending the same follow-up.
pub(crate) struct SupportFollowUpWorker<A, T, O, C> {
    pub(crate) queue: PgSupportFollowUps,
    /// Reads the user's inbox.
    pub(crate) db: PgPool,
    pub(crate) messages: Arc<dyn MessageServiceApi>,
    pub(crate) access: Arc<A>,
    pub(crate) teams: Arc<T>,
    pub(crate) onboarding: O,
    pub(crate) connections: C,
    pub(crate) analytics: Arc<AnalyticsClient>,
}

impl<A, T, O, C> SupportFollowUpWorker<A, T, O, C>
where
    A: EntityAccessService,
    T: TeamService,
    O: OnboardingRepo,
    C: ConnectionStore<Err = anyhow::Error> + Sync,
{
    /// Poll the queue until `stop` is cancelled. Stopping mid-batch is safe:
    /// an interrupted delivery is retried, with the same message id, once its
    /// claim lapses.
    pub(crate) async fn run(self, stop: CancellationToken) {
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                () = stop.cancelled() => return,
                _ = interval.tick() => {}
            }
            tokio::select! {
                () = stop.cancelled() => return,
                () = self.poll() => {}
            }
        }
    }

    async fn poll(&self) {
        // The queue logs a failed read; the next poll tries again.
        let Ok(pending) = self.queue.unclaimed().await else {
            return;
        };
        stream::iter(pending)
            .for_each_concurrent(CONCURRENT_DELIVERIES, |pending| async move {
                let delivery = self.deliver_if_due(pending, Utc::now());
                if tokio::time::timeout(DELIVERY_TIMEOUT, delivery)
                    .await
                    .is_err()
                {
                    tracing::warn!("support follow-up timed out; it will be retried");
                }
            })
            .await;
    }

    async fn deliver_if_due(&self, pending: PendingFollowUp, now: DateTime<Utc>) {
        // The repository logs a failed read; the next poll tries again.
        let Ok(onboarding) = self.onboarding.get_row(&pending.user_id).await else {
            return;
        };
        let finished_onboarding_at = onboarding.and_then(|row| row.completed_at);

        let Some(trigger) = due(pending.scheduled_at, finished_onboarding_at, now) else {
            return;
        };
        // A failure is logged by `deliver` and retried once the claim lapses.
        let _ = self
            .deliver(pending, trigger, finished_onboarding_at.is_some(), now)
            .await;
    }

    #[tracing::instrument(
        name = "support_follow_up.deliver",
        skip_all,
        fields(
            channel_id = %pending.channel_id,
            trigger = <&str>::from(trigger),
            outcome = tracing::field::Empty,
            segment = tracing::field::Empty,
        ),
        err
    )]
    async fn deliver(
        &self,
        pending: PendingFollowUp,
        trigger: Trigger,
        finished_onboarding: bool,
        now: DateTime<Utc>,
    ) -> Result<(), Report> {
        let span = tracing::Span::current();
        let user = &pending.user_id;
        let Some(message_id) = self
            .queue
            .claim(pending.channel_id)
            .await
            .context("failed to claim support follow-up")?
        else {
            span.record("outcome", "claimed_elsewhere");
            return Ok(());
        };

        if now >= pending.scheduled_at + EXPIRY {
            return self.skip(&pending, "expired").await;
        }

        let sender = MacroUserIdStr::try_from_email(SENDER_EMAIL)
            .context("invalid support follow-up sender")?;
        let channel_id = pending.channel_id.to_string();
        let view = self
            .access
            .generate_entity_access_receipt::<MessageView>(
                &sender,
                None,
                &channel_id,
                EntityType::Channel,
            )
            .await
            .context("support follow-up sender must be a channel member")?;
        let roots = self
            .messages
            .timeline(
                view,
                MessageTimelineQuery {
                    limit: Some(3),
                    ..Default::default()
                },
            )
            .await
            .context("failed to read the support channel")?
            .items;
        if conversation_started(&roots, message_id) {
            return self.skip(&pending, "conversation_started").await;
        }

        let setup = if finished_onboarding {
            self.setup(user).await?
        } else {
            Setup::default()
        };
        let segment = segment(&setup);
        span.record("segment", <&str>::from(&segment));
        let mention = user_mention(user).context("failed to mention the user")?;

        let write = self
            .access
            .generate_entity_access_receipt::<MessageWrite>(
                &sender,
                None,
                &channel_id,
                EntityType::Channel,
            )
            .await
            .context("support follow-up sender must be a channel member")?;
        // Posting with the queued id makes a retry return the first post.
        self.messages
            .post_from_event(
                write,
                message_id,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::Unprompted,
                    notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                    content: message(&mention, &segment),
                    thread_id: None,
                    anchor: None,
                    mentions: vec![SimpleMention::user(user)],
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .context("failed to post support follow-up")?;

        self.queue
            .finish(pending.channel_id)
            .await
            .context("failed to finish support follow-up")?;
        span.record("outcome", "sent");
        self.track(
            user,
            "support_follow_up_sent",
            serde_json::json!({
                "segment": <&str>::from(&segment),
                "trigger": <&str>::from(trigger),
                "seconds_after_welcome": (now - pending.scheduled_at).num_seconds(),
            }),
        )
        .await;
        Ok(())
    }

    async fn skip(&self, pending: &PendingFollowUp, reason: &'static str) -> Result<(), Report> {
        self.queue
            .finish(pending.channel_id)
            .await
            .context("failed to finish support follow-up")?;
        tracing::Span::current().record("outcome", reason);
        self.track(
            &pending.user_id,
            "support_follow_up_skipped",
            serde_json::json!({ "reason": reason }),
        )
        .await;
        Ok(())
    }

    /// What the user connected and created during onboarding.
    async fn setup(&self, user: &MacroUserIdStr<'static>) -> Result<Setup, Report> {
        let inbox = async {
            email_db_client::links::get::fetch_link_by_macro_id(&self.db, user.as_ref())
                .await
                .into_rootcause()
                .context("failed to read the user's inbox")
        };
        let teams = async {
            self.teams
                .get_user_teams(user)
                .await
                .context("failed to read the user's teams")
        };
        let tools = async {
            self.connections
                .list(user)
                .await
                .into_rootcause()
                .context("failed to read the user's connected tools")
        };
        let (inbox, teams, tools) = tokio::try_join!(inbox, teams, tools)?;

        Ok(Setup {
            finished_onboarding: true,
            inbox_domain: inbox.map(|link| link.email_address.0.domain_part().to_ascii_lowercase()),
            team: teams
                .iter()
                .filter(|team| team.owner_id() == user.as_ref())
                .find_map(|team| plain_name(team.name()))
                .map(str::to_owned),
            tools: tools
                .iter()
                .filter(|tool| tool.enabled)
                .filter_map(|tool| plain_name(&tool.server_name))
                .take(2)
                .map(str::to_owned)
                .collect(),
        })
    }

    async fn track(
        &self,
        user: &MacroUserIdStr<'static>,
        event: &'static str,
        properties: serde_json::Value,
    ) {
        // The client logs a failed capture.
        let _ = self
            .analytics
            .track_posthog(user.as_ref(), event, properties)
            .await;
    }
}

/// What made a follow-up due.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Trigger {
    OnboardingFinished,
    Fallback,
}

/// Why the follow-up should go out at `now`, or `None` while it should wait.
fn due(
    scheduled_at: DateTime<Utc>,
    finished_onboarding_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<Trigger> {
    if finished_onboarding_at.is_some_and(|finished| now >= finished + AFTER_ONBOARDING) {
        return Some(Trigger::OnboardingFinished);
    }
    (now >= scheduled_at + FALLBACK).then_some(Trigger::Fallback)
}

/// Whether anyone has posted besides the welcome. The follow-up's own message
/// is ignored so a retry after a lost response can still finish.
fn conversation_started(roots: &[MessageListItem], follow_up: Uuid) -> bool {
    let mut others = roots.iter().filter(|root| root.message.id != follow_up);
    let welcome = others.next();
    others.next().is_some() || welcome.is_some_and(|welcome| welcome.thread.reply_count > 0)
}

/// What the user set up during onboarding.
#[derive(Debug, Default)]
struct Setup {
    finished_onboarding: bool,
    /// Domain of the connected inbox, lowercase.
    inbox_domain: Option<String>,
    /// A team the user created.
    team: Option<String>,
    /// Up to two connected tools.
    tools: Vec<String>,
}

/// Which question to ask, chosen from the strongest signal.
#[derive(Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Segment<'a> {
    Unfinished,
    NoInbox,
    Team(&'a str),
    Tools(&'a [String]),
    WorkInbox(&'a str),
    PersonalInbox,
}

fn segment(setup: &Setup) -> Segment<'_> {
    if !setup.finished_onboarding {
        return Segment::Unfinished;
    }
    let Some(domain) = &setup.inbox_domain else {
        return Segment::NoInbox;
    };
    if let Some(team) = &setup.team {
        return Segment::Team(team);
    }
    if !setup.tools.is_empty() {
        return Segment::Tools(&setup.tools);
    }
    if is_generic_email_domain(domain) {
        Segment::PersonalInbox
    } else {
        Segment::WorkInbox(domain)
    }
}

/// The follow-up text. `user` is the mention that opens it.
fn message(user: &str, segment: &Segment<'_>) -> String {
    let question = match segment {
        Segment::Unfinished => "What were you hoping Macro would do for you when you signed up? \
             One line is plenty."
            .to_owned(),
        Segment::NoInbox => "Your inbox isn't connected yet. What do you use for email? \
             If Macro doesn't support it yet, I'll tell you straight."
            .to_owned(),
        Segment::Team(team) => format!(
            "Nice, {team} is set up. What's the team moving over from, \
             Notion, ClickUp, something else?"
        ),
        Segment::Tools([tool]) => format!(
            "You brought in {tool}. Are you running Macro alongside it, \
             or hoping to move off it?"
        ),
        Segment::Tools(tools) => format!(
            "You brought in {}. Are you running Macro alongside them, \
             or hoping to move off one?",
            tools.join(" and ")
        ),
        Segment::WorkInbox(domain) => format!(
            "Your {domain} inbox is in. What's the team using today \
             that you're hoping Macro replaces?"
        ),
        Segment::PersonalInbox => "Your inbox is in. What do you want Macro to take off your \
             plate, work, personal stuff, or both?"
            .to_owned(),
    };
    format!("{user}, Chaitanya from the Macro team. {question}")
}

/// A team or tool name that can go in a sentence as is: short, with no
/// Markdown or mention markup. Anything else is left out of the message.
fn plain_name(name: &str) -> Option<&str> {
    let name = name.trim();
    let plain = !name.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '&' | '\'' | '.' | ',' | '-' | '+'));
    plain.then_some(name)
}
