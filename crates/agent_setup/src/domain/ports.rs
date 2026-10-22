//! What the setup service needs from the rest of Macro.
//!
//! Each port is the narrowest slice of an owning service that setup uses.
//! The import port in particular has no way to discard a candidate: content
//! an import brings in can carry prompt injections, so nothing a setup tool
//! does can decline items permanently or import anything the person has not
//! approved.

use async_trait::async_trait;
use import::domain::{
    models::{ImportSource, ImportState, NotionImportReport, NotionSharing, NotionWriteChoices},
    service::RunImportOutcome,
};
use macro_user_id::user_id::MacroUserIdStr;
use thiserror::Error;
use uuid::Uuid;

use super::catalog::{App, MailProvider};

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

    /// Lists what is in a source that Macro reads by listing (Linear issues,
    /// Slack channels) and stages it for the plan. `false` when a listing is
    /// already running.
    async fn start_discovery(
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

    /// Starts planning an import of the person's whole Notion workspace,
    /// replacing an earlier plan that was never approved. Nothing is written.
    async fn plan_notion(
        &self,
        user: &MacroUserIdStr<'static>,
        sharing: Option<NotionSharing>,
    ) -> Result<NotionImportReport>;

    /// Where the Notion plan or import stands.
    async fn notion_report(&self, user: &MacroUserIdStr<'static>) -> Result<NotionImportReport>;

    /// Ties the ready Notion plan's rows to `review_id`, for a plan the
    /// person approved in their agent rather than in an agent session. Rows
    /// planned later are not tied, so the write never sees them.
    async fn attach_notion_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
    ) -> Result<()>;

    /// Writes the Notion plan tied to `review_id`, with what the person left
    /// out or shared differently.
    async fn write_notion(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport>;
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

/// One email inbox connected to the account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inbox {
    /// Its address.
    pub address: String,
    /// Who hosts it.
    pub provider: MailProvider,
}

/// The person's email inboxes.
// `async_trait`: held as `Arc<dyn SetupInbox>`.
#[async_trait]
pub trait SetupInbox: Send + Sync + 'static {
    /// The inboxes connected to the account.
    async fn inboxes(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<Inbox>>;
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
    /// The agent's setup reached its final report.
    pub setup_done: bool,
    /// The person is on a Macro team. Slack channels come in as team
    /// channels, so importing them needs one.
    pub has_team: bool,
}

/// The account's onboarding.
#[async_trait]
pub trait SetupAccounts: Send + Sync + 'static {
    /// How the account is being set up.
    async fn status(&self, user: &MacroUserIdStr<'static>) -> Result<AccountStatus>;

    /// Hands setup to the agent, so the web flow doesn't interrupt the
    /// person. A no-op for accounts that already onboarded on the web.
    /// Idempotent.
    async fn hand_to_agent(&self, user: &MacroUserIdStr<'static>) -> Result<()>;

    /// Records that setup reached its final report, so later sessions stop
    /// leading with it. Idempotent; a no-op for accounts that aren't
    /// agent-led.
    async fn finish(&self, user: &MacroUserIdStr<'static>) -> Result<()>;
}
