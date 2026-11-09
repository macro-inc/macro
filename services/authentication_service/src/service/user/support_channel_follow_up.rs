//! One follow-up in each new user's support channel, after the welcome.
//!
//! A support team member sends one message chosen from what the user did
//! while signing up: paid, got stuck connecting email or deciding on a plan,
//! signed up on the phone, brought a team, connected tools, or set up alone.
//! It goes out 30 seconds after the user finishes setup. Someone who hasn't
//! finished gets one only when the reason they are stuck is known, and nothing
//! if they never finish within the hour. It never goes out once anyone has
//! posted in the channel. The PostHog flag `support-channel-follow-up` assigns
//! each new user to `control` or `test`; only `test` gets the message.

use std::{future::Future, sync::Arc, time::Duration};

use analytics_client::AnalyticsClient;
use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::{
    models::{AdminTeamRole, EntityType, MemberTeamRole},
    ports::EntityAccessService,
};
use feature_flags::{FeatureFlags, outbound::posthog::PostHogFeatureFlags};
use futures::{StreamExt, stream};
use generic_email_domains::is_generic_email_domain;
use github::domain::{models::GithubLinkStatus, ports::GithubLinkService};
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

/// Gives a user who just finished setup time to land in the app.
const AFTER_SETUP: TimeDelta = TimeDelta::seconds(30);
/// When to look for a known reason someone hasn't finished setup.
const STUCK_CHECK: TimeDelta = TimeDelta::minutes(5);
/// How long to wait before looking again at someone still in setup. Short, so
/// someone who then finishes isn't kept waiting.
const RECHECK: TimeDelta = TimeDelta::minutes(1);
/// A follow-up still queued this long after the welcome is dropped.
const EXPIRY: TimeDelta = TimeDelta::hours(1);

const POLL_INTERVAL: Duration = Duration::from_secs(10);
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(30);
const CONCURRENT_DELIVERIES: usize = 4;
/// Longest team or tool name worth putting in a sentence.
const MAX_NAME_CHARS: usize = 40;
/// Most tools one message names.
const MAX_NAMED_TOOLS: usize = 2;
/// Connected apps the setup tools step doesn't offer, so they aren't tools
/// the user chose to bring in.
const NOT_SETUP_TOOLS: [&str; 2] = ["gmail", "google_calendar"];

/// Whether a user has paid, or opened a checkout without paying.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Billing {
    None,
    OpenedCheckout,
    Subscribed,
}

/// The user's Stripe state, read without creating anything.
pub(crate) trait FollowUpBilling: Send + Sync {
    type Err: std::error::Error + Send + Sync + 'static;

    fn billing(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Billing, Self::Err>> + Send;
}

/// Mail server host names for an email domain; empty when none are found.
pub(crate) trait MailExchanges: Send + Sync {
    fn exchanges(&self, domain: &str) -> impl Future<Output = Vec<String>> + Send;
}

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

    /// Call when the user starts connecting a Gmail inbox. The queue logs a
    /// failure, which only costs this user the Gmail message.
    pub(crate) async fn note_gmail_attempt(&self, user: &MacroUserIdStr<'_>) {
        let _ = self.queue.note_gmail_attempt(user).await;
    }
}

/// Sends queued follow-ups when they come due. Every replica runs one; a row
/// claim keeps two from sending the same follow-up.
pub(crate) struct SupportFollowUpWorker<A, T, O, C, G, B, M> {
    pub(crate) queue: PgSupportFollowUps,
    /// Reads the user's inbox and phone app devices.
    pub(crate) db: PgPool,
    pub(crate) messages: Arc<dyn MessageServiceApi>,
    pub(crate) access: Arc<A>,
    pub(crate) teams: Arc<T>,
    pub(crate) onboarding: O,
    pub(crate) connections: C,
    pub(crate) github: Arc<G>,
    pub(crate) billing: B,
    pub(crate) mail: M,
    pub(crate) analytics: Arc<AnalyticsClient>,
}

impl<A, T, O, C, G, B, M> SupportFollowUpWorker<A, T, O, C, G, B, M>
where
    A: EntityAccessService,
    T: TeamService,
    O: OnboardingRepo,
    C: ConnectionStore<Err = anyhow::Error> + Sync,
    G: GithubLinkService,
    B: FollowUpBilling,
    M: MailExchanges,
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
        let finished_setup_at = onboarding.and_then(|row| row.completed_at);

        let Some(trigger) = due(pending.scheduled_at, finished_setup_at, now) else {
            return;
        };
        // A failure is logged by `deliver` and retried once the claim lapses.
        let _ = self.deliver(pending, trigger, now).await;
    }

    #[tracing::instrument(
        name = "support_follow_up.deliver",
        skip_all,
        fields(
            channel_id = %pending.channel_id,
            trigger = <&str>::from(trigger),
            outcome = tracing::field::Empty,
            path = tracing::field::Empty,
        ),
        err
    )]
    async fn deliver(
        &self,
        pending: PendingFollowUp,
        trigger: Trigger,
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
            let reason = match trigger {
                Trigger::FinishedSetup => "expired",
                Trigger::StillInSetup => "setup_unfinished",
            };
            return self.skip(&pending, reason).await;
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

        let signals = self
            .signals(&pending, trigger == Trigger::FinishedSetup)
            .await?;
        let Some(path) = choose(&signals) else {
            // Still in setup with no known reason: look again later, and drop
            // it at expiry if they never finish.
            self.queue
                .snooze(pending.channel_id, now + RECHECK)
                .await
                .context("failed to snooze support follow-up")?;
            span.record("outcome", "waiting");
            return Ok(());
        };
        span.record("path", path.name());
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
                    content: message(&mention, &path),
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
                "path": path.name(),
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

    /// What the user did while signing up. Setup results (mail provider, team,
    /// tools) are only read once setup is finished, since only then can they
    /// pick the message.
    #[tracing::instrument(name = "support_follow_up.signals", skip_all, err)]
    async fn signals(
        &self,
        pending: &PendingFollowUp,
        finished_setup: bool,
    ) -> Result<Signals, Report> {
        let user = &pending.user_id;
        let domain = user.0.email_part().domain_part().to_ascii_lowercase();

        let inbox = async {
            email_db_client::links::get::fetch_link_by_macro_id(&self.db, user.as_ref())
                .await
                .into_rootcause()
                .context("failed to read the user's inbox")
        };
        let billing = async {
            self.billing
                .billing(user)
                .await
                .context("failed to read the user's billing")
        };
        let phone = async {
            notification_db_client::device::get_user_device_endpoints(&self.db, user.as_ref())
                .await
                .into_rootcause()
                .context("failed to read the user's phone app devices")
        };
        let (inbox, billing, devices) = tokio::try_join!(inbox, billing, phone)?;

        let mut signals = Signals {
            finished_setup,
            paid: billing == Billing::Subscribed,
            opened_checkout: billing == Billing::OpenedCheckout,
            on_phone: !devices.is_empty(),
            gmail_attempted: pending.gmail_attempted,
            inbox_connected: inbox.is_some(),
            work_domain: !is_generic_email_domain(&domain),
            mail_provider: MailProvider::Other,
            domain,
            team: None,
            tools: Vec::new(),
        };
        if !finished_setup {
            return Ok(signals);
        }

        let provider = async {
            if signals.inbox_connected {
                MailProvider::Other
            } else {
                MailProvider::from_exchanges(&self.mail.exchanges(&signals.domain).await)
            }
        };
        let (mail_provider, team, tools) =
            tokio::join!(provider, self.team(user), self.tools(user));
        signals.mail_provider = mail_provider;
        signals.team = team?;
        signals.tools = tools?;
        Ok(signals)
    }

    /// A team the user created and brought people into, by member or invite.
    async fn team(&self, user: &MacroUserIdStr<'static>) -> Result<Option<TeamSignal>, Report> {
        let teams = self
            .teams
            .get_user_teams(user)
            .await
            .context("failed to read the user's teams")?;
        for team in teams.iter().filter(|team| team.owner_id() == user.as_ref()) {
            let team_id = team.id().to_string();
            let member = self
                .access
                .generate_entity_access_receipt::<MemberTeamRole>(
                    user,
                    None,
                    &team_id,
                    EntityType::Team,
                )
                .await
                .context("the team's owner must be able to read it")?;
            let members = self
                .teams
                .get_team(member)
                .await
                .context("failed to read the team's members")?
                .members;
            let admin = self
                .access
                .generate_entity_access_receipt::<AdminTeamRole>(
                    user,
                    None,
                    &team_id,
                    EntityType::Team,
                )
                .await
                .context("the team's owner must be able to read its invites")?;
            let invites = self
                .teams
                .get_team_invites(admin)
                .await
                .context("failed to read the team's invites")?;
            if members.len() > 1 || !invites.is_empty() {
                return Ok(Some(TeamSignal {
                    name: plain_name(team.name()).map(str::to_owned),
                }));
            }
        }
        Ok(None)
    }

    /// Connected tools, plus GitHub, which Macro links itself. A GitHub check
    /// that fails counts as not linked, since it only changes which tool the
    /// message names.
    async fn tools(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<Tool>, Report> {
        let connections = async {
            self.connections
                .list(user)
                .await
                .into_rootcause()
                .context("failed to read the user's connected tools")
        };
        let github = async {
            match self.github.get_user_link_status(&user.0).await {
                Ok(GithubLinkStatus::Linked(_) | GithubLinkStatus::ReauthenticationRequired) => {
                    true
                }
                Ok(GithubLinkStatus::NotLinked) => false,
                Err(error) => {
                    tracing::warn!(?error, "failed to read the user's GitHub link");
                    false
                }
            }
        };
        let (connections, github) = tokio::join!(connections, github);
        let mut tools: Vec<Tool> = connections?
            .into_iter()
            .filter(|tool| tool.enabled && !NOT_SETUP_TOOLS.contains(&tool.app_slug.as_str()))
            .map(|tool| Tool {
                slug: tool.app_slug.to_ascii_lowercase(),
                name: tool.server_name,
            })
            .collect();
        if github {
            tools.push(Tool {
                slug: GITHUB.to_owned(),
                name: "GitHub".to_owned(),
            });
        }
        Ok(tools)
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

/// What made a follow-up worth looking at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Trigger {
    /// The user finished setup.
    FinishedSetup,
    /// Five minutes passed and the user is still in setup.
    StillInSetup,
}

/// Why the follow-up should be looked at `now`, or `None` while it should wait.
fn due(
    scheduled_at: DateTime<Utc>,
    finished_setup_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<Trigger> {
    match finished_setup_at {
        Some(finished) => (now >= finished + AFTER_SETUP).then_some(Trigger::FinishedSetup),
        None => (now >= scheduled_at + STUCK_CHECK).then_some(Trigger::StillInSetup),
    }
}

/// Whether anyone has posted besides the welcome. The follow-up's own message
/// is ignored so a retry after a lost response can still finish.
fn conversation_started(roots: &[MessageListItem], follow_up: Uuid) -> bool {
    let mut others = roots.iter().filter(|root| root.message.id != follow_up);
    let welcome = others.next();
    others.next().is_some() || welcome.is_some_and(|welcome| welcome.thread.reply_count > 0)
}

/// Who hosts a domain's mail, from its mail servers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MailProvider {
    Google,
    Microsoft,
    Other,
}

impl MailProvider {
    fn from_exchanges(exchanges: &[String]) -> Self {
        let hosted_by = |suffixes: &[&str]| {
            exchanges.iter().any(|host| {
                let host = host.trim_end_matches('.').to_ascii_lowercase();
                suffixes
                    .iter()
                    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
            })
        };
        if hosted_by(&["google.com", "googlemail.com"]) {
            Self::Google
        } else if hosted_by(&["outlook.com"]) {
            Self::Microsoft
        } else {
            Self::Other
        }
    }
}

/// A team the user brought people into. `name` is `None` when the team's name
/// can't go in a sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TeamSignal {
    name: Option<String>,
}

/// A connected tool: its app slug, lowercase, and its display name.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Tool {
    slug: String,
    name: String,
}

const GITHUB: &str = "github";

/// What the user did while signing up.
#[derive(Debug, Clone)]
struct Signals {
    finished_setup: bool,
    paid: bool,
    opened_checkout: bool,
    /// The phone app registered this user's device.
    on_phone: bool,
    gmail_attempted: bool,
    inbox_connected: bool,
    /// The signup email's domain, lowercase.
    domain: String,
    work_domain: bool,
    /// Only looked up once setup is finished and no inbox is connected.
    mail_provider: MailProvider,
    team: Option<TeamSignal>,
    tools: Vec<Tool>,
}

/// Which message to send.
#[derive(Debug, PartialEq, Eq)]
enum Path<'a> {
    Pro,
    GmailTrouble,
    Outlook,
    GoogleWorkInbox(&'a str),
    Pricing,
    Phone,
    Team(Option<&'a str>),
    Notion,
    Linear,
    Slack,
    Github,
    OtherTools(Vec<&'a str>),
    SoloWork,
    Personal,
}

impl Path<'_> {
    fn name(&self) -> &'static str {
        match self {
            Self::Pro => "pro",
            Self::GmailTrouble => "gmail_trouble",
            Self::Outlook => "outlook",
            Self::GoogleWorkInbox(_) => "google_work_inbox",
            Self::Pricing => "pricing",
            Self::Phone => "phone",
            Self::Team(_) => "team",
            Self::Notion => "notion",
            Self::Linear => "linear",
            Self::Slack => "slack",
            Self::Github => "github",
            Self::OtherTools(_) => "other_tools",
            Self::SoloWork => "solo_work",
            Self::Personal => "personal",
        }
    }
}

/// The first message that fits, or `None` while the user is still in setup
/// with no known reason. Someone still in setup only gets a message about
/// what is holding them: paying, Gmail, pricing, or being on the phone.
fn choose(signals: &Signals) -> Option<Path<'_>> {
    let no_inbox = !signals.inbox_connected;
    if signals.paid {
        return Some(Path::Pro);
    }
    if signals.gmail_attempted && no_inbox {
        return Some(Path::GmailTrouble);
    }
    if signals.finished_setup && no_inbox {
        match signals.mail_provider {
            MailProvider::Microsoft => return Some(Path::Outlook),
            MailProvider::Google if signals.work_domain => {
                return Some(Path::GoogleWorkInbox(&signals.domain));
            }
            MailProvider::Google | MailProvider::Other => {}
        }
    }
    if signals.opened_checkout {
        return Some(Path::Pricing);
    }
    if !signals.finished_setup {
        return signals.on_phone.then_some(Path::Phone);
    }
    if let Some(team) = &signals.team {
        return Some(Path::Team(team.name.as_deref()));
    }
    if let Some(path) = tool_path(&signals.tools) {
        return Some(path);
    }
    Some(if signals.work_domain {
        Path::SoloWork
    } else {
        Path::Personal
    })
}

/// Tools Macro can import come first, then GitHub, then any others by name.
fn tool_path(tools: &[Tool]) -> Option<Path<'_>> {
    let has = |slug: &str| tools.iter().any(|tool| tool.slug == slug);
    if has("notion") {
        return Some(Path::Notion);
    }
    if has("linear") {
        return Some(Path::Linear);
    }
    if has("slack") {
        return Some(Path::Slack);
    }
    if has(GITHUB) {
        return Some(Path::Github);
    }
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| plain_name(&tool.name))
        .take(MAX_NAMED_TOOLS)
        .collect();
    (!names.is_empty()).then_some(Path::OtherTools(names))
}

/// The follow-up text. `user` is the mention that opens it.
fn message(user: &str, path: &Path<'_>) -> String {
    let body = match path {
        Path::Pro => "Excited to have you on Pro. If you need any help getting set up \
             I'm happy to hop on a call with you."
            .to_owned(),
        Path::GmailTrouble => "Did connecting Gmail give you any trouble? If it was the \
             permissions screen, I can tell you exactly what Macro does with your email."
            .to_owned(),
        Path::Outlook => "Macro works with Outlook, it's just not in setup yet. You can add \
             it from Settings → Email → Connect an Outlook account."
            .to_owned(),
        Path::GoogleWorkInbox(domain) => format!(
            "Your {domain} email isn't in Macro yet. You can add it from Settings → Email → \
             Connect a Google Workspace account."
        ),
        Path::Pricing => "Still deciding on a plan? Want me to set you up with a free month of \
             Pro to try it properly?"
            .to_owned(),
        Path::Phone => {
            "Are you going to use Macro mostly on your phone, or on your computer too?".to_owned()
        }
        Path::Team(name) => format!(
            "Excited to have {} on Macro! Want to do a quick call to help get the rest of the \
             team on board?",
            name.unwrap_or("your team")
        ),
        Path::Notion => "I saw you connected Notion. Are you moving off it or keeping both? If \
             you're moving, Macro can bring your Notion pages over."
            .to_owned(),
        Path::Linear => "I saw you connected Linear. Are you moving off it or keeping both? If \
             you're moving, Macro can bring your Linear issues over."
            .to_owned(),
        Path::Slack => "I saw you connected Slack. Is your team moving its chat into Macro or \
             keeping Slack? If you're moving, Macro can bring your channels over."
            .to_owned(),
        Path::Github => {
            "I saw you connected GitHub. What do you want Macro doing with your repos?".to_owned()
        }
        Path::OtherTools(names) => match names.as_slice() {
            [one] => {
                format!("I saw you connected {one}. What do you want Macro's AI doing with it?")
            }
            names => format!(
                "I saw you connected {}. What do you want Macro's AI doing with them?",
                names.join(" and ")
            ),
        },
        Path::SoloWork => {
            "Are you trying Macro just for yourself, or for the rest of your team too?".to_owned()
        }
        Path::Personal => "Curious what brought you here. Is Macro for work, a side project, or \
             your own life?"
            .to_owned(),
    };
    format!("Hey {user}, Chaitanya here, also on the Macro team. {body}")
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
