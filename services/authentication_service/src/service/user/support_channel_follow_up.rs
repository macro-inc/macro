//! One follow-up in each new user's support channel, after the welcome.
//!
//! A support team member sends one message chosen from what the user did at
//! signup. It goes out 30 seconds after setup finishes; someone still in setup
//! at five minutes only gets one when the reason they are stuck is known, and
//! nothing if they don't finish within the hour. It never goes out once anyone
//! has posted. The PostHog flag `support-channel-follow-up` splits new users
//! into `control` and `test`; only `test` gets the message.

use std::{sync::Arc, time::Duration};

use analytics_client::AnalyticsClient;
use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
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
use teams::domain::team_repo::TeamRepository;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    api::context::GtmInviteServiceType,
    outbound::{
        mail_exchanges::DnsMailExchanges,
        subscription_checkout::{Billing, StripeCheckoutGateway},
        support_follow_ups::{PendingFollowUp, PgSupportFollowUps},
    },
};

#[cfg(test)]
mod test;

const FLAG: &str = "support-channel-follow-up";
const SEND_VARIANT: &str = "test";
const SENDER_EMAIL: &str = "chaitanya@macro.com";

const AFTER_SETUP: TimeDelta = TimeDelta::seconds(30);
const STUCK_CHECK: TimeDelta = TimeDelta::minutes(5);
const EXPIRY: TimeDelta = TimeDelta::hours(1);

const POLL_INTERVAL: Duration = Duration::from_secs(10);
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(30);
const CONCURRENT_DELIVERIES: usize = 4;
const MAX_NAME_CHARS: usize = 40;

/// Assigns new users to the experiment and queues the message for `test`.
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

        // Server-side flag reads record no exposure, so it is sent here for
        // both groups. The client logs a failed capture.
        let _ = self
            .analytics
            .track_posthog(
                user.as_ref(),
                "$feature_flag_called",
                serde_json::json!({ "$feature_flag": FLAG, "$feature_flag_response": variant }),
            )
            .await;

        if variant == SEND_VARIANT {
            self.queue
                .schedule(channel_id, user, macro_uuid::generate_uuid_v7())
                .await
                .context("failed to queue support follow-up")?;
        }
        Ok(())
    }

    /// Call when the user starts connecting Gmail. The queue logs a failure.
    pub(crate) async fn note_gmail_attempt(&self, user: &MacroUserIdStr<'_>) {
        let _ = self.queue.note_gmail_attempt(user).await;
    }
}

/// Sends queued follow-ups when they come due. Every replica runs one; a
/// one-minute row claim keeps two from sending the same follow-up.
pub(crate) struct SupportFollowUpWorker<A, T, O, C, G> {
    pub(crate) queue: PgSupportFollowUps,
    pub(crate) db: PgPool,
    pub(crate) messages: Arc<dyn MessageServiceApi>,
    pub(crate) access: Arc<A>,
    pub(crate) teams: T,
    pub(crate) onboarding: O,
    pub(crate) connections: C,
    pub(crate) github: Arc<G>,
    pub(crate) billing: StripeCheckoutGateway<GtmInviteServiceType>,
    pub(crate) mail: DnsMailExchanges,
    pub(crate) analytics: Arc<AnalyticsClient>,
}

impl<A, T, O, C, G> SupportFollowUpWorker<A, T, O, C, G>
where
    A: EntityAccessService,
    T: TeamRepository,
    O: OnboardingRepo,
    C: ConnectionStore<Err = anyhow::Error> + Sync,
    G: GithubLinkService,
{
    /// Poll until `stop` is cancelled. An interrupted delivery is retried,
    /// with the same message id, once its claim lapses.
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
                if tokio::time::timeout(DELIVERY_TIMEOUT, self.deliver_if_due(pending))
                    .await
                    .is_err()
                {
                    tracing::warn!("support follow-up timed out; it will be retried");
                }
            })
            .await;
    }

    async fn deliver_if_due(&self, pending: PendingFollowUp) {
        // The repository logs a failed read; the next poll tries again.
        let Ok(onboarding) = self.onboarding.get_row(&pending.user_id).await else {
            return;
        };
        let finished_setup_at = onboarding.and_then(|row| row.completed_at);
        let now = Utc::now();
        if due(pending.scheduled_at, finished_setup_at, now) {
            // `deliver` logs a failure; it is retried once the claim lapses.
            let _ = self
                .deliver(pending, finished_setup_at.is_some(), now)
                .await;
        }
    }

    #[tracing::instrument(
        name = "support_follow_up.deliver",
        skip_all,
        fields(
            channel_id = %pending.channel_id,
            finished_setup,
            outcome = tracing::field::Empty,
            path = tracing::field::Empty,
        ),
        err
    )]
    async fn deliver(
        &self,
        pending: PendingFollowUp,
        finished_setup: bool,
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

        let signals = self.signals(&pending, finished_setup).await?;
        let Some(path) = choose(&signals) else {
            // Still in setup with no known reason; the claim lapses in a
            // minute and it is looked at again.
            span.record("outcome", "waiting");
            return Ok(());
        };
        let path_name: &'static str = (&path).into();
        span.record("path", path_name);
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
                "path": path_name,
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

    /// What the user did at signup. The mail provider, team and tools only
    /// pick a message once setup is finished, so they are read only then.
    #[tracing::instrument(name = "support_follow_up.signals", skip_all, err)]
    async fn signals(
        &self,
        pending: &PendingFollowUp,
        finished_setup: bool,
    ) -> Result<Signals, Report> {
        let user = &pending.user_id;
        let domain = user.0.email_part().domain_part().to_ascii_lowercase();
        let (inbox, billing, devices) = tokio::try_join!(
            async {
                email_db_client::links::get::fetch_link_by_macro_id(&self.db, user.as_ref())
                    .await
                    .into_rootcause()
                    .context("failed to read the user's inbox")
            },
            async {
                self.billing
                    .follow_up_billing(user)
                    .await
                    .context("failed to read the user's billing")
            },
            async {
                notification_db_client::device::get_user_device_endpoints(&self.db, user.as_ref())
                    .await
                    .into_rootcause()
                    .context("failed to read the user's phone app devices")
            },
        )?;
        let mut signals = Signals {
            finished_setup,
            billing,
            on_phone: !devices.is_empty(),
            gmail_attempted: pending.gmail_attempted,
            inbox_connected: inbox.is_some(),
            work_domain: !is_generic_email_domain(&domain),
            mail_provider: MailProvider::Other,
            domain,
            team: None,
            tools: Vec::new(),
        };
        if finished_setup {
            let (mail_provider, team, tools) = tokio::join!(
                async {
                    if signals.inbox_connected {
                        MailProvider::Other
                    } else {
                        MailProvider::from_exchanges(&self.mail.exchanges(&signals.domain).await)
                    }
                },
                self.team(user),
                self.tools(user),
            );
            signals.mail_provider = mail_provider;
            signals.team = team?;
            signals.tools = tools?;
        }
        Ok(signals)
    }

    /// The name of a team the user created and brought people into.
    async fn team(&self, user: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        let teams = self
            .teams
            .get_user_teams(user)
            .await
            .context("failed to read the user's teams")?;
        for team in teams.iter().filter(|team| team.owner_id() == user.as_ref()) {
            let (members, invites) = tokio::try_join!(
                self.teams.get_team_members(team.id()),
                self.teams.get_team_invites(team.id()),
            )
            .context("failed to read the user's team")?;
            if members.len() > 1 || !invites.is_empty() {
                let name = plain_name(team.name()).unwrap_or("your team");
                return Ok(Some(name.to_owned()));
            }
        }
        Ok(None)
    }

    /// Connected apps, plus GitHub, which Macro links itself. A failed GitHub
    /// check counts as not linked: it only changes which tool is named.
    async fn tools(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<Tool>, Report> {
        let (connections, github) = tokio::join!(
            self.connections.list(user),
            self.github.get_user_link_status(&user.0),
        );
        let mut tools: Vec<Tool> = connections
            .into_rootcause()
            .context("failed to read the user's connected tools")?
            .into_iter()
            .filter(|tool| tool.enabled)
            .map(|tool| Tool {
                slug: tool.app_slug.to_ascii_lowercase(),
                name: tool.server_name,
            })
            .collect();
        if matches!(
            github,
            Ok(GithubLinkStatus::Linked(_) | GithubLinkStatus::ReauthenticationRequired)
        ) {
            tools.push(Tool {
                slug: "github".to_owned(),
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

/// Whether to look at a follow-up: 30 seconds after setup finishes, or five
/// minutes after the welcome while the user is still in setup.
fn due(
    scheduled_at: DateTime<Utc>,
    finished_setup_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> bool {
    match finished_setup_at {
        Some(finished) => now >= finished + AFTER_SETUP,
        None => now >= scheduled_at + STUCK_CHECK,
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
    fn from_exchanges(hosts: &[String]) -> Self {
        let hosted_by = |domain: &str| {
            hosts.iter().any(|host| {
                let host = host.trim_end_matches('.').to_ascii_lowercase();
                host == domain || host.ends_with(&format!(".{domain}"))
            })
        };
        if hosted_by("google.com") || hosted_by("googlemail.com") {
            Self::Google
        } else if hosted_by("outlook.com") {
            Self::Microsoft
        } else {
            Self::Other
        }
    }
}

/// A connected tool's app slug, lowercase, and display name.
#[derive(Debug, Clone)]
struct Tool {
    slug: String,
    name: String,
}

#[derive(Debug, Clone)]
struct Signals {
    finished_setup: bool,
    billing: Billing,
    on_phone: bool,
    gmail_attempted: bool,
    inbox_connected: bool,
    domain: String,
    work_domain: bool,
    mail_provider: MailProvider,
    team: Option<String>,
    tools: Vec<Tool>,
}

#[derive(Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Path<'a> {
    Pro,
    GmailTrouble,
    Outlook,
    GoogleWorkInbox(&'a str),
    Pricing,
    Phone,
    Team(&'a str),
    Notion,
    Linear,
    Slack,
    Github,
    OtherTools(Vec<&'a str>),
    SoloWork,
    Personal,
}

/// The first message that fits, or `None` while the user is still in setup
/// for no known reason. Someone in setup only hears about what is holding
/// them: paying, Gmail, pricing, or being on the phone.
fn choose(s: &Signals) -> Option<Path<'_>> {
    if s.billing == Billing::Subscribed {
        return Some(Path::Pro);
    }
    if s.gmail_attempted && !s.inbox_connected {
        return Some(Path::GmailTrouble);
    }
    if s.finished_setup && !s.inbox_connected {
        match s.mail_provider {
            MailProvider::Microsoft => return Some(Path::Outlook),
            MailProvider::Google if s.work_domain => return Some(Path::GoogleWorkInbox(&s.domain)),
            MailProvider::Google | MailProvider::Other => {}
        }
    }
    if s.billing == Billing::OpenedCheckout {
        return Some(Path::Pricing);
    }
    if !s.finished_setup {
        return s.on_phone.then_some(Path::Phone);
    }
    if let Some(team) = &s.team {
        return Some(Path::Team(team));
    }
    if let Some(path) = tool_path(&s.tools) {
        return Some(path);
    }
    Some(if s.work_domain {
        Path::SoloWork
    } else {
        Path::Personal
    })
}

/// Tools Macro can import first, then GitHub, then up to two others by name.
fn tool_path(tools: &[Tool]) -> Option<Path<'_>> {
    let has = |slug: &str| tools.iter().any(|tool| tool.slug == slug);
    for (slug, path) in [
        ("notion", Path::Notion),
        ("linear", Path::Linear),
        ("slack", Path::Slack),
        ("github", Path::Github),
    ] {
        if has(slug) {
            return Some(path);
        }
    }
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| plain_name(&tool.name))
        .take(2)
        .collect();
    (!names.is_empty()).then_some(Path::OtherTools(names))
}

/// The follow-up text. `user` is the mention that opens it.
fn message(user: &str, path: &Path<'_>) -> String {
    let body = match path {
        Path::Pro => {
            "Excited to have you on Pro. If you need any help getting set up I'm happy to \
             hop on a call with you."
                .to_owned()
        }
        Path::GmailTrouble => "Did connecting Gmail give you any trouble? If it was the \
             permissions screen, I can tell you exactly what Macro does with your email."
            .to_owned(),
        Path::Outlook => "Macro works with Outlook, it's just not in setup yet. You can add it \
             from Settings → Email → Connect an Outlook account."
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
        Path::Team(team) => format!(
            "Excited to have {team} on Macro. Want to do a quick call to help get the rest of the \
             team on board?"
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
        Path::OtherTools(names) => {
            let it = if names.len() == 1 { "it" } else { "them" };
            format!(
                "I saw you connected {}. What do you want Macro's AI doing with {it}?",
                names.join(" and ")
            )
        }
        Path::SoloWork => {
            "Are you trying Macro just for yourself, or for the rest of your team too?".to_owned()
        }
        Path::Personal => "Curious what brought you here. Is Macro for work, a side project, or \
             your own life?"
            .to_owned(),
    };
    format!("Hey {user}! Chaitanya here, also on the Macro team. {body}")
}

/// A team or tool name short and plain enough to put in a sentence; markup
/// and mention syntax are left out.
fn plain_name(name: &str) -> Option<&str> {
    let name = name.trim();
    let plain = !name.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '&' | '\'' | '.' | ',' | '-' | '+'));
    plain.then_some(name)
}
