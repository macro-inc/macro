//! Accounts an agent signs in to on a harness's machine, e.g. a Claude
//! account for Claude Code. One account can be signed in on many machines and
//! a machine can hold one active login per provider; every sign-in is its own
//! login row, so history stays as signed-out rows.

use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Who an agent's account belongs to: the Postgres `agent_provider` enum of
/// `provider_accounts.provider` and `harness_account_logins.provider`. New
/// providers add a value there.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::EnumString,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "agent_provider", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentProvider {
    /// An Anthropic Claude account, for Claude Code.
    Claude,
}

/// What a provider reports about an account at sign-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderAccountIdentity {
    /// The provider's own account id (Claude: `oauthAccount.accountUuid`).
    pub external_account_id: String,
    /// The account's email address, for display.
    pub display_email: Option<String>,
    /// The account's organization, for display.
    pub display_org: Option<String>,
    /// The account's plan, e.g. `max`.
    pub plan: Option<String>,
}

/// An account at a provider, shared by every machine it is signed in on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderAccount {
    /// Row id.
    pub id: Uuid,
    /// The provider.
    pub provider: AgentProvider,
    /// What the provider last reported about it.
    pub identity: ProviderAccountIdentity,
}

/// One sign-in of a provider account on a harness's machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessAccountLogin {
    /// Row id.
    pub id: Uuid,
    /// The machine.
    pub harness_id: HarnessId,
    /// The account.
    pub account: ProviderAccount,
    /// Who signed it in through Macro; `None` once that user is deleted.
    pub signed_in_by: Option<MacroUserIdStr<'static>>,
    /// When the sign-in was recorded.
    pub signed_in_at: DateTime<Utc>,
    /// When the sign-in stops refreshing, as the machine last reported it.
    pub expires_at: Option<DateTime<Utc>>,
    /// When it was signed out; `None` while it is the machine's active login.
    pub signed_out_at: Option<DateTime<Utc>>,
}

/// A confirmed change to a machine's login at a provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountLoginChange {
    /// `signed_in_by` signed `account` in through Macro. Any active login
    /// for the provider on the machine is signed out first.
    SignedIn {
        /// The provider.
        provider: AgentProvider,
        /// The account the machine reported.
        account: ProviderAccountIdentity,
        /// The person whose request completed the sign-in.
        signed_in_by: MacroUserIdStr<'static>,
    },
    /// The provider's active login on the machine was signed out.
    SignedOut {
        /// The provider.
        provider: AgentProvider,
    },
}

impl AccountLoginChange {
    /// The provider it changes.
    pub const fn provider(&self) -> AgentProvider {
        match self {
            Self::SignedIn { provider, .. } | Self::SignedOut { provider } => *provider,
        }
    }
}
