//! Domain models for team agents.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Longest agent name, in characters.
pub const MAX_NAME_CHARS: usize = 80;

/// Longest job description or personality, in characters.
pub const MAX_PROFILE_CHARS: usize = 4000;

/// Where an agent's computer is in coming up.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::EnumString, strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TeamAgentStatus {
    /// The computer is bought and booting.
    Provisioning,
    /// The computer is up.
    Running,
    /// The computer could not be provisioned; `statusReason` says why.
    Failed,
}

/// A team agent: an AI teammate with its own Macro account and computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAgent {
    /// The agent's Macro user id (`macro|<email>`).
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    /// Team the agent belongs to.
    pub team_id: Uuid,
    /// Display name.
    pub name: String,
    /// The agent's email address.
    pub email: String,
    /// Admin who created the agent.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub created_by: Option<MacroUserIdStr<'static>>,
    /// The agent's Macro computer, once bought.
    pub computer_id: Option<Uuid>,
    /// Where the computer is in coming up.
    pub status: TeamAgentStatus,
    /// Why the status is `failed`.
    pub status_reason: Option<String>,
    /// Where the computer's setup is, while `provisioning` and once fetched.
    pub setup: Option<SetupProgress>,
    /// When the agent was created.
    pub created_at: DateTime<Utc>,
}

/// A team's agents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAgents {
    /// The agents, oldest first.
    pub agents: Vec<TeamAgent>,
}

/// The size of a Macro computer, from the computers catalog.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::EnumString, strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ComputerSize {
    /// One capacity unit.
    Standard,
    /// Two capacity units.
    Large,
    /// Four capacity units.
    Xl,
}

/// Input for inviting a team agent and buying its computer.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamAgent {
    /// Display name.
    pub name: String,
    /// What the agent is responsible for. Seeds the persona repo.
    pub job_description: String,
    /// How the agent behaves and talks. Seeds the persona repo.
    pub personality: String,
    /// The computer to buy.
    pub size: ComputerSize,
    /// Profile picture URL (a static file the caller uploaded).
    pub avatar_url: Option<String>,
}

/// How often a recurring price bills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BillingInterval {
    /// Every month.
    Month,
    /// Every year.
    Year,
}

/// What inviting an agent adds to the team's bill, in cents per interval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAgentQuote {
    /// The agent's seat; 0 when the team does not bill seats.
    pub seat: i64,
    /// The agent's computer.
    pub computer: i64,
    /// `seat + computer`.
    pub total: i64,
    /// ISO currency code, lowercase (`usd`).
    pub currency: String,
    /// How often both bill.
    pub interval: BillingInterval,
}

/// What one seat costs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatQuote {
    /// Price per interval, in the currency's smallest unit.
    pub amount: i64,
    /// ISO currency code, lowercase.
    pub currency: String,
    /// How often the seat bills.
    pub interval: BillingInterval,
}

/// What one computer costs (`hosted_runtimes::Quote`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerQuote {
    /// The computer's Stripe price.
    pub price_id: String,
    /// Price per interval, in the currency's smallest unit.
    pub amount: i64,
    /// ISO currency code, lowercase.
    pub currency: String,
    /// How often the computer bills.
    pub interval: BillingInterval,
}

/// A subscription item the computer purchase adds in its own Stripe update,
/// so the agent's seat and computer share one invoice
/// (`hosted_runtimes::SubscriptionItem`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionItem {
    /// Stripe price.
    pub price_id: String,
    /// Added to the item's current quantity.
    pub quantity: u32,
}

/// The long-lived service a persona runs next to macrod
/// (`hosted_runtimes::PersonaService`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonaService {
    /// systemd unit name, without the `.service` suffix.
    pub unit_name: String,
    /// `ExecStart` command line, run as the persona's OS user.
    pub exec: String,
    /// Extra `Environment=` values, on top of the persona's environment file.
    pub env: BTreeMap<String, String>,
}

/// Who a computer runs for: an OS user, its service, and the values written
/// to `/etc/macro/personas/<os_user>.env`, the unit's `EnvironmentFile`
/// (`hosted_runtimes::Persona`).
#[derive(Clone, PartialEq, Eq)]
pub struct Persona {
    /// Display name.
    pub name: String,
    /// OS user the service runs as.
    pub os_user: String,
    /// The service.
    pub extra_service: PersonaService,
    /// Config drive values. Carries the agent's bootstrap credentials.
    pub config: BTreeMap<String, String>,
}

impl std::fmt::Debug for Persona {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Persona")
            .field("name", &self.name)
            .field("os_user", &self.os_user)
            .field("extra_service", &self.extra_service)
            .field("config_keys", &self.config.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// A computer to buy for a team (`hosted_runtimes::PurchaseRequest`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerPurchase {
    /// The team whose subscription pays.
    pub team_id: Uuid,
    /// The admin or owner buying it.
    pub created_by: String,
    /// The computer's size.
    pub size: ComputerSize,
    /// Display name.
    pub name: Option<String>,
    /// Who the computer runs for.
    pub persona: Option<Persona>,
    /// Other items for the same Stripe update (the agent's seat).
    pub extra_items: Vec<SubscriptionItem>,
}

/// The coarse status a team sees (`hosted_runtimes::ComputerStatusKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputerStatusKind {
    /// Paying, creating, booting or connecting for the first time.
    SettingUp,
    /// Up.
    Ready,
    /// Frozen or suspended while idle.
    Asleep,
    /// Coming back from sleep or a stop.
    Waking,
    /// Powering off.
    Stopping,
    /// Powered off.
    Stopped,
    /// Gave up.
    Failed,
    /// Released and destroyed.
    Released,
}

/// Steps a new computer goes through, in order (`hosted_runtimes::SetupStep`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
    /// The Stripe update.
    Paying,
    /// Creating the instance.
    Creating,
    /// Booting it.
    Booting,
    /// Waiting for macrod to connect.
    Connecting,
    /// Done.
    Ready,
}

/// Setup progress, for the invite flow to show
/// (`hosted_runtimes::SetupProgress`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    /// The current step.
    pub step: SetupStep,
    /// 1-based position of `step`.
    pub position: u8,
    /// Number of steps.
    pub total: u8,
}

/// A computer as its team sees it; the fields of
/// `hosted_runtimes::ComputerStatus` this crate reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerStatus {
    /// Coarse status.
    pub status: ComputerStatusKind,
    /// Present until the computer first connects.
    pub setup: Option<SetupProgress>,
}

/// What the agent's workspace repo starts from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonaSeed {
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
}

/// A secret the caller must never log: an API key or repo token.
///
/// [`Debug`] redacts it.
#[derive(Clone, PartialEq, Eq)]
pub struct Credential(String);

impl Credential {
    /// Wrap a freshly minted secret.
    pub fn new(secret: String) -> Self {
        Self(secret)
    }

    /// The secret, for the config drive only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Credential(redacted)")
    }
}

/// The agent's workspace repo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRepo {
    /// Smart-HTTP clone URL.
    pub url: String,
    /// The agent's token for clone and push.
    pub token: Credential,
}

/// A new agent account to store.
#[derive(Debug, Clone)]
pub struct NewAgentAccount {
    /// The agent's Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// The agent's email address (lowercase).
    pub email: String,
    /// Team the agent joins.
    pub team_id: Uuid,
    /// Admin creating the agent.
    pub created_by: MacroUserIdStr<'static>,
    /// Display name.
    pub name: String,
    /// Profile picture URL.
    pub avatar_url: Option<String>,
    /// The agent's mailbox at the email provider, when one was created.
    pub mailbox_id: Option<String>,
}

/// A mailbox created for an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailbox {
    /// Provider id of the mailbox; `None` when no email provider is set up.
    pub mailbox_id: Option<String>,
    /// The mailbox's address.
    pub email: String,
}

/// One email in an agent's mailbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    /// Provider message id.
    pub message_id: String,
    /// Provider thread id.
    pub thread_id: String,
    /// Sender.
    pub from: String,
    /// Recipients.
    pub to: Vec<String>,
    /// Subject line.
    pub subject: Option<String>,
    /// Short preview of the body.
    pub preview: Option<String>,
    /// Plain-text body, when fetched individually.
    pub text: Option<String>,
    /// When the provider received or sent it.
    pub received_at: DateTime<Utc>,
}

/// A page of an agent's emails, newest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailMessages {
    /// The emails.
    pub messages: Vec<EmailMessage>,
}

/// An email for an agent to send.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SendEmail {
    /// Recipients.
    pub to: Vec<String>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text: String,
    /// Optional HTML body.
    pub html: Option<String>,
}

/// The provider's id for a sent email.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SentEmail {
    /// Provider message id.
    pub message_id: String,
}

/// Errors from team agent operations.
#[derive(Debug, thiserror::Error)]
pub enum TeamAgentError {
    /// The request is malformed.
    #[error("{0}")]
    BadRequest(String),
    /// The caller is not a team agent.
    #[error("the caller is not a team agent")]
    NotAnAgent,
    /// No agent with that id on the caller's team.
    #[error("no such agent on this team")]
    NotFound,
    /// Email is not set up on this deployment, or the agent has no mailbox.
    #[error("email is not available for this agent")]
    EmailUnavailable,
    /// The caller may not do this.
    #[error("not allowed")]
    Forbidden,
    /// Team agents aren't available to the caller yet (feature flag).
    #[error("team agents aren't available for this account yet")]
    NotEnabled,
    /// The computer can't be bought right now (sold out, no subscription).
    #[error("the computer can't be bought: {0}")]
    ComputerUnavailable(String),
    /// The email provider failed.
    #[error("the email provider failed: {0}")]
    EmailProvider(rootcause::Report),
    /// Anything else.
    #[error("internal error: {0}")]
    Internal(rootcause::Report),
}

impl TeamAgentError {
    /// Wrap an adapter error as internal.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }

    /// An internal error from a message.
    pub fn internal_message(message: impl Into<String>) -> Self {
        Self::internal(InternalMessage(message.into()))
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct InternalMessage(String);
