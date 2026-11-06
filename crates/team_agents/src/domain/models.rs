//! Domain models for team agents.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use hosted_runtimes::domain::enrollment::{
    Persona, PersonaConfigKey, PersonaOsUser, PersonaService, SystemdUnitName,
};
pub use stripe_price_id::StripePriceId;

pub use super::mail::{MailMessageId, MailThreadId, MailboxId};

/// Longest agent name, in characters.
pub const MAX_NAME_CHARS: usize = 64;

/// Longest job description or personality, in characters.
pub const MAX_PROFILE_CHARS: usize = 4000;

/// Where an agent's computer is in coming up.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TeamAgentStatus {
    /// The computer is bought and booting.
    Provisioning,
    /// The computer is ready and its brain is healthy.
    Running,
    /// The computer is ready but its brain is temporarily unavailable.
    Unhealthy,
    /// Terminal provisioning or payment failure; `statusReason` says why.
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
    /// Failure, transient health, or pending purchase-link recovery diagnostic.
    pub status_reason: Option<String>,
    /// Whether failed computer provisioning can be retried without purchasing.
    pub retryable: bool,
    /// Durable billing outcome, absent only when no computer can be read.
    pub payment: Option<ComputerPayment>,
    /// Where the computer's setup is, while `provisioning` and once fetched.
    pub setup: Option<SetupProgress>,
    /// Most recent completed brain turn, from its harness health report.
    pub last_turn_at: Option<DateTime<Utc>>,
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
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
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
    /// Aura-2 model chosen in the voice picker; older clients use a persona default.
    #[serde(default)]
    pub voice: Option<String>,
    /// Whether the reviewed quote included the seat and computer for free.
    pub expected_included: bool,
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
    /// Both seat and computer are included, with no Stripe change.
    pub included: bool,
    /// Virtual CPUs in the quoted computer size.
    pub vcpus: u32,
    /// RAM in GB, from the computer size catalog.
    pub memory_gb: u32,
    /// Disk capacity in GB, from the computer size catalog.
    pub disk_gb: u32,
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
    /// Virtual CPUs in the quoted computer size.
    pub vcpus: u32,
    /// RAM in GB, from the computer size catalog.
    pub memory_gb: u32,
    /// Disk capacity in GB, from the computer size catalog.
    pub disk_gb: u32,
    /// The computer's Stripe price.
    pub price_id: StripePriceId,
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
    pub price_id: StripePriceId,
    /// Added to the item's current quantity.
    pub quantity: u32,
}

/// A computer to buy for a team (`hosted_runtimes::PurchaseRequest`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerPurchase {
    /// The team whose subscription pays.
    pub team_id: Uuid,
    /// The admin or owner buying it.
    pub created_by: MacroUserIdStr<'static>,
    /// The computer's size.
    pub size: ComputerSize,
    /// Display name.
    pub name: Option<String>,
    /// Who the computer runs for.
    pub persona: Option<Persona>,
    /// Other items for the same Stripe update (the agent's seat).
    pub extra_items: Vec<SubscriptionItem>,
}

/// Durable payment outcome supplied by hosted runtimes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ComputerPayment {
    /// The original payment effect is still resolving; no new purchase is safe.
    Pending,
    /// The bundled computer and seat purchase succeeded.
    Paid,
    /// Included without a subscription charge.
    Comped,
    /// Billing definitely refused the purchase; no item was billed.
    Unbilled,
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
    /// Survives lifecycle transitions, including release.
    pub payment: ComputerPayment,
    /// Coarse status.
    pub status: ComputerStatusKind,
    /// Present until the computer first connects.
    pub setup: Option<SetupProgress>,
    /// Latest observation for this computer's enrolled persona.
    pub brain: Option<BrainHealth>,
}

/// A persona's health observation from its computer's harness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrainHealth {
    /// Whether the reporting harness is still connected.
    pub connected: bool,
    /// When macrod checked the brain.
    pub checked_at: DateTime<Utc>,
    /// Whether the brain reported healthy.
    pub healthy: bool,
    /// Last bounded macrod diagnostic for an unhealthy or missing brain.
    pub last_error: Option<String>,
    /// Most recent completed brain turn, including on unhealthy probes.
    pub last_turn_at: Option<DateTime<Utc>>,
}

/// What the agent's workspace repo starts from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonaSeed {
    /// User-owned call voice, saved in the workspace repository.
    #[serde(default)]
    pub voice: Option<String>,
    /// Admin the brain should recognize as its creator; absent on older seeds.
    #[serde(default)]
    pub creator_id: Option<MacroUserIdStr<'static>>,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
}

pub use agent_credentials::{AgentApiKey, RepoToken};

/// The agent's workspace repo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRepo {
    /// Smart-HTTP clone URL.
    pub url: String,
    /// The agent's token for clone and push.
    pub token: RepoToken,
}

/// A new agent account to store.
#[derive(Debug, Clone)]
pub struct NewAgentAccount {
    /// Original non-secret workspace seed, retained for provisioning recovery.
    pub persona_seed: PersonaSeed,
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
    pub mailbox_id: Option<MailboxId>,
}

/// A mailbox created for an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailbox {
    /// Provider id of the mailbox; `None` when no email provider is set up.
    pub mailbox_id: Option<MailboxId>,
    /// The mailbox's address.
    pub email: String,
}

/// One email in an agent's mailbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    /// Provider message id.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub message_id: MailMessageId,
    /// Provider thread id.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub thread_id: MailThreadId,
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
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub message_id: MailMessageId,
}

/// Computer specifications, available independently of subscription pricing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ComputerSizeSpec {
    /// Catalog size.
    pub size: ComputerSize,
    /// Virtual CPU count.
    pub vcpus: u32,
    /// Memory in GB.
    pub memory_gb: u32,
    /// Disk capacity in GB.
    pub disk_gb: u32,
}

/// The computer catalog for inviting team agents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct TeamAgentSizes {
    /// Available sizes in catalog order.
    pub sizes: Vec<ComputerSizeSpec>,
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
    /// The team must start or renew its subscription before purchasing.
    #[error("the team needs an active subscription")]
    NoSubscription,
    /// Eligibility changed since the administrator reviewed the quote.
    #[error("The invitation price changed. Review the updated quote before confirming.")]
    QuoteChanged,
    /// The computer can't be bought right now (sold out or unavailable price).
    #[error("the computer can't be bought: {0}")]
    ComputerUnavailable(String),
    /// A saved purchase could not be identified; preserve its agent resources.
    #[error("the computer identity is unavailable")]
    ComputerIdentityUnavailable,
    /// Saved provisioning state cannot be retried.
    #[error("the agent can't be retried: {0}")]
    RetryUnavailable(String),
    /// The computer billing provider failed.
    #[error("the computer billing provider failed: {0}")]
    ComputerProvider(rootcause::Report),
    /// Repository creation failed before any purchase; the message is safe for clients.
    #[error("{0}")]
    InvitationFailed(String),
    /// The workspace repo provider failed.
    #[error("the repo provider failed: {0}")]
    RepoProvider(rootcause::Report),
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
