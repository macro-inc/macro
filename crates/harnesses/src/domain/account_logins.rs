//! Accounts an agent signs in to on a harness's machine, e.g. a Claude
//! account for Claude Code. One account can be signed in on many machines and
//! a machine can hold one active login per provider; every sign-in is its own
//! login row, so history stays as signed-out rows.

use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub use harnessd_protocol::AgentProvider;

/// What a provider reports about an account at sign-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderAccountIdentity {
    /// The account's id at the provider (Claude: the fingerprint harnessd
    /// reports for its credential).
    pub external_account_id: String,
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
    /// The machine is signed in to `account`. On the active login's own
    /// account only its expiry moves; otherwise any active login for the
    /// provider is signed out and a new one starts.
    SignedIn {
        /// The provider.
        provider: AgentProvider,
        /// The account the machine reported.
        account: ProviderAccountIdentity,
        /// When the machine's credential stops working.
        expires_at: Option<DateTime<Utc>>,
        /// The person whose request completed the sign-in; `None` when the
        /// machine reported a sign-in nobody made through Macro.
        signed_in_by: Option<MacroUserIdStr<'static>>,
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
