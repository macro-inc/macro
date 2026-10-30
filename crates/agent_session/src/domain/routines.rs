//! Narrow, owner-authorized session operations for unattended routines.

pub mod models;
mod service;
mod status;

pub use models::*;
pub use service::RoutineSessionsService;

/// Catalog tools a routine step calls directly, with no agent deciding.
///
/// Never replay a call after an ambiguous error: tools are not idempotent.
pub trait RoutineTools: Send + Sync + 'static {
    /// Run one tool as the command's owner.
    fn call_tool(
        &self,
        command: CallRoutineTool,
    ) -> impl Future<Output = Result<RoutineToolOutcome, RoutineSessionError>> + Send;
}

/// Runs catalog tools as a user. Implemented by the host that holds the tools.
pub trait RoutineToolRunner: Send + Sync + 'static {
    /// Run `tool` with `arguments` as `owner`.
    fn run(
        &self,
        owner: &macro_user_id::user_id::MacroUserIdStr<'static>,
        tool: &str,
        arguments: serde_json::Map<String, serde_json::Value>,
    ) -> impl Future<Output = Result<RoutineToolOutcome, RoutineSessionError>> + Send;
}

/// For hosts without tools: every call is unavailable.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoRoutineTools;

impl RoutineToolRunner for NoRoutineTools {
    async fn run(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
        _: &str,
        _: serde_json::Map<String, serde_json::Value>,
    ) -> Result<RoutineToolOutcome, RoutineSessionError> {
        Err(RoutineSessionError::RuntimeUnavailable)
    }
}

/// The only session operations available to routine execution.
///
/// Preparation and prompting are separate so callers can retain the session id
/// for cleanup. Neither operation is safe to replay after an ambiguous failure:
/// control deduplication covers queued/in-flight actions, not completed actions.
pub trait RoutineSessions: Send + Sync + 'static {
    /// Authorize a selection without provisioning or requiring a live runtime.
    fn validate(
        &self,
        command: ValidateRoutineSession,
    ) -> impl Future<Output = Result<ValidatedRoutineSession, RoutineSessionError>> + Send;

    /// Reauthorize the persona and open an idle session with its selected model.
    fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> impl Future<Output = Result<PreparedRoutineSession, RoutineSessionError>> + Send;

    /// Submit the first prompt once through the normal control pipeline.
    fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> impl Future<Output = Result<RoutinePromptAccepted, RoutineSessionError>> + Send;

    /// Read the initial action's progress, never the session's latest turn alone.
    fn status(
        &self,
        command: RoutineSessionAction,
    ) -> impl Future<Output = Result<RoutineActionStatus, RoutineSessionError>> + Send;

    /// Request a stop; acceptance does not establish that work has stopped.
    fn cancel(
        &self,
        command: RoutineSessionAction,
    ) -> impl Future<Output = Result<(), RoutineSessionError>> + Send;
}

/// The Pipedream apps a user has connected and enabled for tool use, which
/// is what the egress proxy treats as connected.
pub trait ConnectedApps: Send + Sync + 'static {
    /// App slugs of the user's enabled connections.
    fn connected_app_slugs(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> impl Future<Output = anyhow::Result<Vec<String>>> + Send;
}
