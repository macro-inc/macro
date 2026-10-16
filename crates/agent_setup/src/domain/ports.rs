//! What the setup service needs from the rest of Macro.
//!
//! Each port is the narrowest slice of an owning service that setup uses.
//! The import port in particular has no way to discard a candidate and starts
//! every gather with automatic import off: content an import brings in can
//! carry prompt injections, so nothing a setup tool does can decline items
//! permanently or import anything the person has not approved.

use async_trait::async_trait;
use import::domain::{
    models::{ImportSource, ImportState},
    service::RunImportOutcome,
};
use macro_user_id::user_id::MacroUserIdStr;
use thiserror::Error;
use uuid::Uuid;

use super::catalog::App;

/// Why a setup step could not run.
#[derive(Debug, Error)]
pub enum SetupError {
    /// Something the agent can fix or route around. The message says what to
    /// do and is shown to the agent as is.
    #[error("{0}")]
    Actionable(String),
    /// A failure the agent cannot do anything about.
    #[error("internal setup error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for SetupError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

/// Result alias for setup operations.
pub type Result<T> = std::result::Result<T, SetupError>;

/// The import service, as setup uses it.
// `async_trait`: the service holds every port as `Arc<dyn …>`.
#[async_trait]
pub trait SetupImports: Send + Sync + 'static {
    /// Runs and candidates for the person.
    async fn state(&self, user: &MacroUserIdStr<'static>) -> Result<ImportState>;

    /// Starts the one-time gather for a source with automatic import off, so
    /// candidates wait for the plan. `false` when a run already exists.
    async fn start_gather(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool>;

    /// Starts a repeatable discovery (sources that support it). `false` when
    /// one is already running.
    async fn start_discovery(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool>;

    /// Re-runs a failed or dismissed gather.
    async fn retry_gather(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool>;

    /// Starts copying in the given staged candidates. Never discards.
    async fn run_import(
        &self,
        user: &MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
    ) -> Result<RunImportOutcome>;
}

/// Connections the person has made to their apps.
// `async_trait`: held as `Arc<dyn SetupConnections>`.
#[async_trait]
pub trait SetupConnections: Send + Sync + 'static {
    /// Whether the app is connected and usable for this person.
    async fn is_connected(&self, user: &MacroUserIdStr<'static>, app: &App) -> Result<bool>;

    /// The display name of a connectable app the connector directory offers,
    /// or `None` when it offers none by that slug.
    async fn directory_name(&self, slug: &str) -> Result<Option<String>>;
}

/// The person's email inboxes.
// `async_trait`: held as `Arc<dyn SetupInbox>`.
#[async_trait]
pub trait SetupInbox: Send + Sync + 'static {
    /// Addresses of the inboxes connected to the account.
    async fn addresses(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<String>>;
}

/// How the account is being set up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AccountStatus {
    /// The person's agent leads setup; the web onboarding flow is skipped.
    pub agent_led: bool,
    /// The person already finished onboarding on the web.
    pub onboarded_on_web: bool,
    /// The account was created moments ago and never onboarded on the web: a
    /// sign-up through the person's agent that hasn't been handed over yet.
    pub new_account: bool,
}

/// The account's onboarding.
#[async_trait]
pub trait SetupAccounts: Send + Sync + 'static {
    /// How the account is being set up.
    async fn status(&self, user: &MacroUserIdStr<'static>) -> Result<AccountStatus>;

    /// Hands setup to the agent, so the web flow neither interrupts the person
    /// nor auto-imports behind the plan. A no-op for accounts that already
    /// onboarded on the web. Idempotent.
    async fn hand_to_agent(&self, user: &MacroUserIdStr<'static>) -> Result<AccountStatus>;
}
