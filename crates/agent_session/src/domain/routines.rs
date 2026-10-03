//! Narrow, owner-authorized session operations for unattended routines.

pub mod models;
mod service;
mod status;

pub use models::*;
pub use service::RoutineSessionsService;

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
