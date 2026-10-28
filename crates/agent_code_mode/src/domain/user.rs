//! Code execution for an authenticated user outside any agent session.
use super::{
    CodeModeError, ExecutionActivity, ExecutionStatus,
    service::{Reviews, settle, validate_request},
};
use async_trait::async_trait;
use code_execution::domain::{ExecuteRequest, ProgramExecutor, RunEnvironment};
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Mint a short-lived credential for the user a run acts as.
#[async_trait]
pub trait UserExecutionCredentials: Send + Sync + 'static {
    /// The user comes from the authenticated request, never from generated code.
    async fn issue(&self, user: &MacroUserIdStr<'static>) -> Result<RunEnvironment, CodeModeError>;
}

/// Outcome returned straight to the caller; nothing is persisted.
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserExecutionReceipt {
    /// How the program ended.
    pub status: ExecutionStatus,
    /// Observed SDK operations, without arguments or responses.
    pub activity: Vec<ExecutionActivity>,
    /// More SDK operations ran than the activity list records.
    pub activity_truncated: bool,
    /// Only the value explicitly returned by the program.
    pub result: Option<Value>,
    /// Safe failure text, when execution did not succeed.
    pub error: Option<String>,
}

/// Run a program as the authenticated user, with no session, journal or reviews.
#[async_trait]
pub trait UserCodeMode: Send + Sync + 'static {
    /// Execute and wait for the outcome. Cancelling stops the process; completed
    /// API writes stand.
    async fn execute(
        &self,
        user: &MacroUserIdStr<'static>,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError>;
}

/// User-scoped code mode over an executor whose admission bounds its own traffic.
pub struct UserCodeModeService {
    executor: Arc<dyn ProgramExecutor>,
    credentials: Arc<dyn UserExecutionCredentials>,
}

impl UserCodeModeService {
    /// Bind the executor and credential issuer once at startup.
    pub fn new(
        executor: Arc<dyn ProgramExecutor>,
        credentials: Arc<dyn UserExecutionCredentials>,
    ) -> Self {
        Self {
            executor,
            credentials,
        }
    }
}

#[async_trait]
impl UserCodeMode for UserCodeModeService {
    #[tracing::instrument(
        name = "code_mode.user_execution",
        skip_all,
        fields(
            source_bytes = request.source.len(),
            timeout_ms = request.timeout_ms,
            status = tracing::field::Empty,
            activity = tracing::field::Empty,
        ),
        err
    )]
    async fn execute(
        &self,
        user: &MacroUserIdStr<'static>,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError> {
        validate_request(&request)?;
        let environment = self.credentials.issue(user).await?;
        let (progress, mut updates) = tokio::sync::mpsc::channel(512);
        let execution = self.executor.execute_program_with_progress(
            request,
            environment,
            cancel.child_token(),
            progress,
        );
        tokio::pin!(execution);
        let mut activity = Vec::new();
        let mut truncated = false;
        let mut progress_open = true;
        let outcome = loop {
            tokio::select! {
                outcome = &mut execution => break outcome,
                update = updates.recv(), if progress_open => match update {
                    Some(value) => super::activity::observe(&mut activity, &mut truncated, value),
                    None => progress_open = false,
                },
            }
        };
        while let Ok(value) = updates.try_recv() {
            super::activity::observe(&mut activity, &mut truncated, value);
        }
        super::activity::finish(&mut activity);
        let (status, result, error) = settle(outcome, Reviews::Rejected);
        let span = tracing::Span::current();
        span.record("status", tracing::field::debug(status));
        span.record("activity", activity.len());
        Ok(UserExecutionReceipt {
            status,
            activity,
            activity_truncated: truncated,
            result,
            error,
        })
    }
}

#[cfg(test)]
mod test;
