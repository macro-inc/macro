//! One follow-up in each new user's support channel, after the welcome.
//!
//! A support team member sends one message chosen from what the user did at
//! signup. It goes out 30 seconds after setup finishes; someone still in setup
//! at five minutes only gets one when the reason they are stuck is known, and
//! nothing if they don't finish within the hour. It waits while the user is in
//! the middle of connecting Gmail or checking out, and never goes out once
//! anyone has posted. The PostHog flag `support-channel-follow-up` splits new users
//! into `control` and `test`; only `test` gets the message.

use std::{sync::Arc, time::Duration};

use analytics_client::AnalyticsClient;
use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use feature_flags::{FeatureFlags, outbound::posthog::PostHogFeatureFlags};
use futures::{StreamExt, stream};
use generic_email_domains::is_generic_email_domain;
use github::domain::{models::GithubLinkStatus, ports::GithubLinkService};
use gtm_invite::domain::ports::GtmInviteService;
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use mention_utils::serialize::user_mention;
use messages::domain::{
    api::MessageServiceApi,
    models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy, SimpleMention},
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
    domain::microsoft::MicrosoftAuth,
    outbound::{
        mail_exchanges::DnsMailExchanges,
        subscription_checkout::StripeCheckoutGateway,
        support_follow_ups::{PendingFollowUp, PgSupportFollowUps},
    },
};

#[cfg(test)]
mod test;

const FLAG: &str = "support-channel-follow-up";
const SEND_VARIANT: &str = "test";
pub(crate) const SENDER_EMAIL: &str = "chaitanya@macro.com";

const AFTER_SETUP: TimeDelta = TimeDelta::seconds(30);
const STUCK_CHECK: TimeDelta = TimeDelta::minutes(5);
const EXPIRY: TimeDelta = TimeDelta::hours(1);
/// How long a Gmail connection or checkout the user started may still be
/// under way.
const UNDER_WAY: TimeDelta = TimeDelta::minutes(5);

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

    /// Call when the user opens a checkout. The queue logs a failure.
    pub(crate) async fn note_checkout(&self, user: &MacroUserIdStr<'_>) {
        let _ = self.queue.note_checkout(user).await;
    }
}

/// Reads and posts in support channels as the follow-up's sender, with that
/// sender's own channel membership.
pub(crate) struct FollowUpSender<A> {
    pub(crate) messages: Arc<dyn MessageServiceApi>,
    pub(crate) access: Arc<A>,
}

impl<A: EntityAccessService> FollowUpSender<A> {
    /// Whether anyone has posted in the channel besides the welcome and the
    /// follow-up `message_id`.
    async fn has_conversation(&self, channel_id: Uuid, message_id: Uuid) -> Result<bool, Report> {
        let sender = sender()?;
        let view = self
            .access
            .generate_entity_access_receipt::<MessageView>(
                &sender,
                None,
                &channel_id.to_string(),
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
        let roots = roots
            .iter()
            .map(|root| (root.message.id, root.thread.reply_count));
        Ok(conversation_started(roots, message_id))
    }

    /// Post the follow-up to `user`. Posting with the queued `message_id`
    /// makes a retry return the first post.
    async fn post(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        user: &MacroUserIdStr<'static>,
        content: String,
    ) -> Result<(), Report> {
        let sender = sender()?;
        let write = self
            .access
            .generate_entity_access_receipt::<MessageWrite>(
                &sender,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .context("support follow-up sender must be a channel member")?;
        self.messages
            .post_from_event(
                write,
                message_id,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::Unprompted,
                    notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                    content,
                    thread_id: None,
                    anchor: None,
                    mentions: vec![SimpleMention::user(user)],
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .context("failed to post support follow-up")?;
        Ok(())
    }
}

fn sender() -> Result<MacroUserIdStr<'static>, Report> {
    Ok(MacroUserIdStr::try_from_email(SENDER_EMAIL).context("invalid support follow-up sender")?)
}

/// Sends queued follow-ups when they come due. Every replica runs one; a
/// one-minute row claim keeps two from sending the same follow-up.
pub(crate) struct SupportFollowUpWorker<A, T, O, C, G, I> {
    pub(crate) queue: PgSupportFollowUps,
    pub(crate) db: PgPool,
    pub(crate) sender: FollowUpSender<A>,
    pub(crate) teams: T,
    pub(crate) onboarding: O,
    pub(crate) connections: C,
    pub(crate) github: Arc<G>,
    pub(crate) billing: StripeCheckoutGateway<I>,
    pub(crate) mail: DnsMailExchanges,
    /// Decides whether a user can connect Outlook; `None` when Outlook is not
    /// configured.
    pub(crate) microsoft: Option<Arc<dyn MicrosoftAuth>>,
    pub(crate) analytics: Arc<AnalyticsClient>,
}

impl<A, T, O, C, G, I> SupportFollowUpWorker<A, T, O, C, G, I>
where
    A: EntityAccessService,
    T: TeamRepository,
    O: OnboardingRepo,
    C: ConnectionStore<Err = anyhow::Error> + Sync,
    G: GithubLinkService,
    I: GtmInviteService,
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
                let channel_id = pending.channel_id;
                if tokio::time::timeout(DELIVERY_TIMEOUT, self.deliver_if_due(pending))
                    .await
                    .is_err()
                {
                    tracing::warn!(%channel_id, "support follow-up timed out; it will be retried");
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

        let signals = self.signals(&pending, finished_setup, now).await?;

        // Read the channel last, so nothing slow sits between this check and
        // the post.
        if self
            .sender
            .has_conversation(pending.channel_id, message_id)
            .await?
        {
            return self.skip(&pending, "conversation_started").await;
        }

        let Some(path) = choose(&signals) else {
            // Still in setup with no known reason, or in the middle of
            // connecting Gmail or checking out; the claim lapses in a minute
            // and it is looked at again.
            span.record("outcome", "waiting");
            return Ok(());
        };
        let path_name: &'static str = (&path).into();
        span.record("path", path_name);
        let mention = user_mention(user).context("failed to mention the user")?;
        self.sender
            .post(
                pending.channel_id,
                message_id,
                user,
                message(&mention, &path),
            )
            .await?;

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
        now: DateTime<Utc>,
    ) -> Result<Signals, Report> {
        let user = &pending.user_id;
        let domain = user.0.email_part().domain_part().to_ascii_lowercase();
        let checkout_opened = pending.checkout_opened_at.is_some();
        let checkout_under_way = under_way(pending.checkout_opened_at, now);
        let (inbox, paid, devices) = tokio::try_join!(
            async {
                email_db_client::links::get::fetch_link_by_macro_id(&self.db, user.as_ref())
                    .await
                    .into_rootcause()
                    .context("failed to read the user's inbox")
            },
            // Only someone who opened a checkout can have paid, so Stripe is
            // asked once, for them alone, when the checkout has had time to
            // finish.
            async {
                if checkout_opened && !checkout_under_way {
                    self.billing
                        .has_subscription(user)
                        .await
                        .context("failed to read the user's subscription")
                } else {
                    Ok(false)
                }
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
            paid,
            opened_checkout: checkout_opened && !paid,
            on_phone: !devices.is_empty(),
            gmail_attempted: pending.gmail_attempted_at.is_some(),
            mid_attempt: checkout_under_way
                || (inbox.is_none() && under_way(pending.gmail_attempted_at, now)),
            inbox_connected: inbox.is_some(),
            work_domain: !is_generic_email_domain(&domain),
            mail_provider: MailProvider::Other,
            outlook_offered: false,
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

            // Settings only shows the Outlook row to users who may connect it.
            if let (MailProvider::Microsoft, Some(microsoft)) = (mail_provider, &self.microsoft) {
                signals.outlook_offered = microsoft.new_connections_enabled(user).await;
            }
        }
        Ok(signals)
    }

    /// A team the user created and brought people into, else one they joined.
    async fn team(&self, user: &MacroUserIdStr<'static>) -> Result<Option<TeamTie>, Report> {
        let teams = self
            .teams
            .get_user_teams(user)
            .await
            .context("failed to read the user's teams")?;
        let mut joined = None;
        for team in &teams {
            let name = plain_name(team.name()).unwrap_or("your team").to_owned();
            if team.owner_id() != user.as_ref() {
                joined.get_or_insert(TeamTie::Joined(name));
                continue;
            }

            let (members, invites) = tokio::try_join!(
                self.teams.get_team_members(team.id()),
                self.teams.get_team_invites(team.id()),
            )
            .context("failed to read the user's team")?;
            if members.len() > 1 || !invites.is_empty() {
                return Ok(Some(TeamTie::Brought(name)));
            }
        }
        Ok(joined)
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

/// Whether something the user started is recent enough to still be under way.
fn under_way(started_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    started_at.is_some_and(|started_at| now < started_at + UNDER_WAY)
}

/// Whether anyone has posted besides the welcome, from each root message's id
/// and reply count. The follow-up's own message is ignored so a retry after a
/// lost response can still finish.
fn conversation_started(roots: impl IntoIterator<Item = (Uuid, i64)>, follow_up: Uuid) -> bool {
    let mut others = roots.into_iter().filter(|(id, _)| *id != follow_up);
    let welcome = others.next();
    others.next().is_some() || welcome.is_some_and(|(_, replies)| replies > 0)
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

/// A tool Macro can import from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Importable {
    Notion,
    Linear,
    Slack,
}

impl Importable {
    /// The app slugs it connects under; Slack's connector is `slack_v2`, and
    /// `slack` is its older name.
    fn slugs(self) -> &'static [&'static str] {
        match self {
            Self::Notion => &["notion"],
            Self::Linear => &["linear"],
            Self::Slack => &["slack", "slack_v2"],
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Notion => "Notion",
            Self::Linear => "Linear",
            Self::Slack => "Slack",
        }
    }

    /// What Macro brings over from it.
    fn brings(self) -> &'static str {
        match self {
            Self::Notion => "pages",
            Self::Linear => "issues",
            Self::Slack => "channels",
        }
    }
}

/// A connected tool's app slug, lowercase, and display name.
#[derive(Debug, Clone)]
struct Tool {
    slug: String,
    name: String,
}

/// How the user is tied to a team, with the team's name.
#[derive(Debug, Clone, PartialEq, Eq)]
enum TeamTie {
    /// They created it and brought people in.
    Brought(String),
    /// They joined one somebody else created.
    Joined(String),
}

#[derive(Debug, Clone)]
struct Signals {
    finished_setup: bool,
    paid: bool,
    opened_checkout: bool,
    on_phone: bool,
    gmail_attempted: bool,
    /// They started connecting Gmail or a checkout in the last five minutes
    /// and it has not landed yet.
    mid_attempt: bool,
    inbox_connected: bool,
    domain: String,
    work_domain: bool,
    mail_provider: MailProvider,
    /// Settings offers this user an Outlook connection.
    outlook_offered: bool,
    team: Option<TeamTie>,
    tools: Vec<Tool>,
}

#[derive(Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Path<'a> {
    Paid,
    GmailTrouble,
    Outlook,
    /// Google hosts their mail and no inbox is connected; the domain when it
    /// is a work address, `None` for Gmail.
    GoogleInbox(Option<&'a str>),
    Pricing,
    Phone,
    Team(&'a str),
    SeveralImports(Vec<Importable>),
    Notion,
    Linear,
    Slack,
    Github,
    OtherTools(Vec<&'a str>),
    Teammate(&'a str),
    SoloWork,
    Personal,
}

/// The first message that fits, or `None` to look again in a minute: while
/// the user is in the middle of connecting Gmail or checking out, or still in
/// setup for no known reason. Someone in setup only hears about what is
/// holding them: paying, Gmail, pricing, or being on the phone.
fn choose(s: &Signals) -> Option<Path<'_>> {
    if s.paid {
        return Some(Path::Paid);
    }
    if s.mid_attempt {
        return None;
    }
    if s.gmail_attempted && !s.inbox_connected {
        return Some(Path::GmailTrouble);
    }
    if s.finished_setup && !s.inbox_connected {
        match s.mail_provider {
            MailProvider::Microsoft if s.outlook_offered => return Some(Path::Outlook),
            MailProvider::Google => {
                return Some(Path::GoogleInbox(s.work_domain.then_some(&s.domain)));
            }
            MailProvider::Microsoft | MailProvider::Other => {}
        }
    }
    if s.opened_checkout {
        return Some(Path::Pricing);
    }
    if !s.finished_setup {
        return s.on_phone.then_some(Path::Phone);
    }
    if let Some(TeamTie::Brought(team)) = &s.team {
        return Some(Path::Team(team));
    }
    if let Some(path) = tool_path(&s.tools) {
        return Some(path);
    }
    if let Some(TeamTie::Joined(team)) = &s.team {
        return Some(Path::Teammate(team));
    }
    Some(if s.work_domain {
        Path::SoloWork
    } else {
        Path::Personal
    })
}

/// Tools Macro can import first, together when there are several, then
/// GitHub, then up to two others by name.
fn tool_path(tools: &[Tool]) -> Option<Path<'_>> {
    let has = |slug: &str| tools.iter().any(|tool| tool.slug == slug);
    let importable: Vec<Importable> = [Importable::Notion, Importable::Linear, Importable::Slack]
        .into_iter()
        .filter(|tool| tool.slugs().iter().any(|slug| has(slug)))
        .collect();
    match importable.as_slice() {
        [] => {}
        [Importable::Notion] => return Some(Path::Notion),
        [Importable::Linear] => return Some(Path::Linear),
        [Importable::Slack] => return Some(Path::Slack),
        _ => return Some(Path::SeveralImports(importable)),
    }
    if has("github") {
        return Some(Path::Github);
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
        Path::Paid => {
            "Thanks for subscribing! If you need any help getting set up I'm happy to hop on \
             a call with you."
                .to_owned()
        }
        Path::GmailTrouble => "Did connecting Gmail give you any trouble? If it was the \
             permissions screen, I can tell you what Macro does with your email."
            .to_owned(),
        Path::Outlook => "Macro works with Outlook, it's just not in setup yet. You can add it \
             from Settings → Email → Connect an Outlook account."
            .to_owned(),
        Path::GoogleInbox(domain) => {
            let mailbox = match domain {
                Some(domain) => format!("{domain} email"),
                None => "Gmail".to_owned(),
            };
            format!(
                "Your {mailbox} isn't in Macro yet. Was that on purpose, or did the permissions \
                 screen put you off? I can tell you what Macro does with your email, and you \
                 can add it any time from Settings → Email."
            )
        }
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
        Path::SeveralImports(tools) => {
            let names: Vec<&str> = tools.iter().map(|tool| tool.name()).collect();
            let brings: Vec<&str> = tools.iter().map(|tool| tool.brings()).collect();
            format!(
                "I saw you connected {}. Are you moving your team off them or keeping them \
                 alongside Macro? If you're moving, Macro can bring your {} over.",
                listed(&names),
                listed(&brings)
            )
        }
        Path::Notion => "I saw you connected Notion. Are you moving off it or keeping both? If \
             you're moving, Macro can bring your Notion pages over."
            .to_owned(),
        Path::Linear => "I saw you connected Linear. Are you moving off it or keeping both? If \
             you're moving, Macro can bring your Linear issues over."
            .to_owned(),
        Path::Slack => "I saw you connected Slack. Is your team moving its chat into Macro or \
             keeping Slack? If you're moving, Macro can bring your channels over."
            .to_owned(),
        Path::Github => "I saw you connected GitHub. Are you planning to have Macro's agents \
             write code in your repos, or mainly to review pull requests here?"
            .to_owned(),
        Path::OtherTools(names) => {
            let it = if names.len() == 1 { "it" } else { "them" };
            format!(
                "I saw you connected {}. What do you want Macro's AI doing with {it}?",
                listed(names)
            )
        }
        Path::Teammate(team) => format!(
            "Glad you've joined {team} on Macro. Is there anything I can help you get set up \
             with?"
        ),
        Path::SoloWork => {
            "Are you trying Macro just for yourself, or for the rest of your team too?".to_owned()
        }
        Path::Personal => "What are you hoping Macro takes over for you: email, docs, tasks, \
             or something else?"
            .to_owned(),
    };
    format!("Hey {user}! Chaitanya here, also on the Macro team. {body}")
}

/// Names as they read in a sentence: "a", "a and b", "a, b and c".
fn listed(items: &[&str]) -> String {
    match items {
        [first @ .., last] if !first.is_empty() => format!("{} and {last}", first.join(", ")),
        _ => items.concat(),
    }
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
