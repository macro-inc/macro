//! Claude Code sign-in on a Macro computer, run by its macrod.
//!
//! Each route sends a [`ComputerCommand`] to the computer's runtime through
//! [`ComputerControl`], which carries it to whichever replica holds the
//! runtime connection. An account lease serializes sign-in, sign-out and their
//! `claude_mode` writes across replicas.

use std::sync::Arc;

use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use harness_id::HarnessId;
use harnesses::domain::models::{ClaudeMode, ClaudeModeChange, HarnessPermission};
use harnesses::domain::ports::{HarnessError, HarnessService};
use hosted_runtimes::domain::models::{FleetAttachment, FleetUnavailable};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

#[cfg(test)]
mod test;

use super::control::{self as bus, ComputerControl};

/// State for the Claude sign-in routes.
pub struct ClaudeAccessState<Harnesses, Auth> {
    harnesses: Arc<Harnesses>,
    rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    fleet_attachment: FleetAttachment,
    control: ComputerControl,
    redis: redis::Client,
    cleanup: TaskTracker,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Harnesses, Auth> Clone for ClaudeAccessState<Harnesses, Auth> {
    fn clone(&self) -> Self {
        Self {
            harnesses: Arc::clone(&self.harnesses),
            rollout: self.rollout.clone(),
            fleet_attachment: self.fleet_attachment,
            control: self.control.clone(),
            redis: self.redis.clone(),
            cleanup: self.cleanup.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Harnesses, Auth> FromRef<ClaudeAccessState<Harnesses, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ClaudeAccessState<Harnesses, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the Claude sign-in routes over `control`.
#[expect(
    clippy::too_many_arguments,
    reason = "router composition requires explicit rollout and physical fleet attachment facts"
)]
pub fn router<Harnesses, Auth>(
    control: ComputerControl,
    redis: redis::Client,
    harnesses: Harnesses,
    authorization_state: MacroAuthorizationState<Auth>,
    rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    fleet_attachment: FleetAttachment,
    tasks: &TaskTracker,
) -> Router
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let state = ClaudeAccessState {
        harnesses: Arc::new(harnesses),
        control,
        rollout,
        fleet_attachment,
        redis,
        cleanup: tasks.clone(),
        authorization_state,
    };
    Router::new()
        .route(
            "/harnesses/{harness_id}/claude-sign-in",
            post(claude_sign_in_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-sign-in/complete",
            post(claude_sign_in_complete_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-sign-in/cancel",
            post(claude_sign_in_cancel_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-sign-out",
            post(claude_sign_out_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-mode",
            get(claude_mode_handler::<Harnesses, Auth>),
        )
        .with_state(state)
}

/// Harness path.
#[derive(Debug, serde::Deserialize)]
pub struct HarnessPath {
    harness_id: HarnessId,
}

/// `POST /harnesses/{harness_id}/claude-sign-in` answer.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClaudeSignInStarted {
    /// Where the user signs in to Claude, in their own browser.
    pub url: String,
}

/// `POST /harnesses/{harness_id}/claude-sign-in/complete` body.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct ClaudeSignInComplete {
    /// The code Claude showed after the user signed in.
    pub code: String,
}

/// `POST /harnesses/{harness_id}/claude-sign-in/complete` answer.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSignedIn {
    /// Always `true`.
    pub signed_in: bool,
    /// The Claude account's email address, when Claude reports one.
    pub account: Option<String>,
}

/// How Claude Code on a computer is paid for.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClaudeModeResponse {
    /// `macro_credits` or `own_account`.
    #[schema(value_type = String, example = "macro_credits")]
    pub mode: ClaudeMode,
}

/// Start a Claude sign-in on the computer and return its URL.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "start_claude_sign_in",
    path = "/harnesses/{harness_id}/claude-sign-in",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses(
        (status = 200, body = ClaudeSignInStarted),
        (status = 400), (status = 403), (status = 404), (status = 409), (status = 422), (status = 503), (status = 504),
    )
)]
pub async fn claude_sign_in_handler<Harnesses, Auth>(
    State(state): State<ClaudeAccessState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<ClaudeSignInStarted>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    let account_change = bus::AccountChange::claim(&state.redis, path.harness_id, &state.cleanup)
        .await?
        .cancel_on_drop(state.control.clone(), path.harness_id);
    let result = match state
        .control
        .send(path.harness_id, ComputerCommand::ClaudeSignInStart)
        .await?
    {
        ComputerControlResult::SignInStarted { url } => Ok(Json(ClaudeSignInStarted { url })),
        other => Err(ComputerRouteError::from_result(other)),
    };
    account_change.release().await?;
    result
}

/// Finish the Claude sign-in with what the user pasted.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "complete_claude_sign_in",
    path = "/harnesses/{harness_id}/claude-sign-in/complete",
    params(("harness_id" = String, Path, description = "Harness ID")),
    request_body = ClaudeSignInComplete,
    responses(
        (status = 200, body = ClaudeSignedIn),
        (status = 400), (status = 403), (status = 404), (status = 409), (status = 422), (status = 503), (status = 504),
    )
)]
pub async fn claude_sign_in_complete_handler<Harnesses, Auth>(
    State(state): State<ClaudeAccessState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
    Json(body): Json<ClaudeSignInComplete>,
) -> Result<Json<ClaudeSignedIn>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let signed_in_by = caller.authorization.user.macro_user_id.clone();
    state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    let account = state
        .complete_sign_in(path.harness_id, body.code, signed_in_by)
        .await?;
    Ok(Json(ClaudeSignedIn {
        signed_in: true,
        account,
    }))
}

/// Cancel the pending setup-token process. Its terminal completion releases
/// the original request's account lease, including on another replica.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "cancel_claude_sign_in",
    path = "/harnesses/{harness_id}/claude-sign-in/cancel",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses((status = 204), (status = 403), (status = 404), (status = 409), (status = 422), (status = 503), (status = 504))
)]
pub async fn claude_sign_in_cancel_handler<Harnesses, Auth>(
    State(state): State<ClaudeAccessState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<StatusCode, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    let released = bus::AccountChangeRelease::watch(&state.redis, path.harness_id).await?;
    match state
        .control
        .send(path.harness_id, ComputerCommand::ClaudeSignInCancel)
        .await?
    {
        ComputerControlResult::SignInCancelled => {
            released.wait().await?;
            Ok(StatusCode::NO_CONTENT)
        }
        other => Err(ComputerRouteError::from_result(other)),
    }
}

/// Forget the computer's Claude account and return it to Macro credits.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "claude_sign_out",
    path = "/harnesses/{harness_id}/claude-sign-out",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses(
        (status = 200, body = ClaudeModeResponse),
        (status = 403), (status = 404), (status = 409), (status = 422), (status = 503), (status = 504),
    )
)]
pub async fn claude_sign_out_handler<Harnesses, Auth>(
    State(state): State<ClaudeAccessState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<ClaudeModeResponse>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    let account_change =
        bus::AccountChange::claim(&state.redis, path.harness_id, &state.cleanup).await?;
    let result = match state
        .control
        .send(path.harness_id, ComputerCommand::ClaudeSignOut)
        .await?
    {
        ComputerControlResult::SignedOut => {
            state
                .harnesses
                .set_claude_mode(path.harness_id, ClaudeModeChange::SignedOut)
                .await?;
            Ok(Json(ClaudeModeResponse {
                mode: ClaudeMode::MacroCredits,
            }))
        }
        other => Err(ComputerRouteError::from_result(other)),
    };
    account_change.release().await?;
    result
}

/// How Claude Code on the computer is paid for.
#[utoipa::path(
    get,
    tag = "computers",
    operation_id = "get_claude_mode",
    path = "/harnesses/{harness_id}/claude-mode",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses((status = 200, body = ClaudeModeResponse), (status = 403), (status = 404), (status = 503))
)]
pub async fn claude_mode_handler<Harnesses, Auth>(
    State(state): State<ClaudeAccessState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<ClaudeModeResponse>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let harness = state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    Ok(Json(ClaudeModeResponse {
        mode: harness.claude_mode,
    }))
}

impl<Harnesses, Auth> ClaudeAccessState<Harnesses, Auth>
where
    Harnesses: HarnessService,
{
    /// Finish runtime confirmation and its mode write even if the HTTP waiter
    /// disappears after macrod commits. A dropped waiter asks macrod to cancel;
    /// whichever terminal outcome won is still reconciled before lease release.
    /// `signed_in_by` is recorded as the sign-in's signer, who hears when it
    /// runs out.
    async fn complete_sign_in(
        &self,
        harness_id: HarnessId,
        code: String,
        signed_in_by: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, ComputerRouteError> {
        let account_change = bus::AccountChange::claim(&self.redis, harness_id, &self.cleanup)
            .await?
            .cancel_on_drop(self.control.clone(), harness_id);
        let cancellation = CancellationToken::new();
        let waiter = cancellation.clone().drop_guard();
        let control = self.control.clone();
        let harnesses = Arc::clone(&self.harnesses);
        let (reply, received) = tokio::sync::oneshot::channel();
        self.cleanup.spawn(
            async move {
                let completion = async {
                    let result = match control
                        .send(harness_id, ComputerCommand::ClaudeSignInComplete { code })
                        .await?
                    {
                        ComputerControlResult::SignedIn { account } => {
                            harnesses
                                .set_claude_mode(
                                    harness_id,
                                    ClaudeModeChange::SignedIn { signed_in_by },
                                )
                                .await?;
                            Ok(account)
                        }
                        other => Err(ComputerRouteError::from_result(other)),
                    };
                    account_change.release().await?;
                    result
                };
                tokio::pin!(completion);
                let result = tokio::select! {
                    biased;
                    () = cancellation.cancelled() => {
                        if let Err(error) = control.send(harness_id, ComputerCommand::ClaudeSignInCancel).await {
                            tracing::warn!(error = ?error, "could not cancel a dropped sign-in submission");
                        }
                        completion.await
                    }
                    result = &mut completion => result,
                };
                let _ = reply.send(result);
            }
            .instrument(tracing::Span::current()),
        );
        let result = received.await.map_err(|_| {
            ComputerRouteError::Internal(rootcause::report!("sign-in completion worker stopped"))
        })?;
        waiter.disarm();
        result
    }

    /// The harness, when the caller has `access` and it is a Macro computer.
    async fn authorize_computer(
        &self,
        caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
        harness_id: HarnessId,
        access: HarnessPermission,
    ) -> Result<harnesses::domain::models::Harness, ComputerRouteError> {
        if !self
            .rollout
            .enabled(&caller.authorization.user.macro_user_id)
            .await
        {
            return Err(ComputerRouteError::RolloutDisabled);
        }
        let harness = self
            .harnesses
            .authorize_harness(caller.authorization.user.macro_user_id, harness_id, access)
            .await?;
        if harness.computer_id.is_none() {
            return Err(ComputerRouteError::BadRequest(
                "this runtime is not a Macro computer".to_owned(),
            ));
        }
        self.fleet_attachment.require_attached()?;
        Ok(harness)
    }
}

/// Why a computer route failed.
#[derive(Debug, thiserror::Error)]
pub enum ComputerRouteError {
    /// The request cannot apply to this harness.
    #[error("{0}")]
    BadRequest(String),
    /// The caller may not do this.
    #[error("you cannot do that on this computer")]
    Forbidden,
    /// The per-user computer rollout is off or unavailable.
    #[error("Macro computers are not enabled for this user")]
    RolloutDisabled,
    /// Hosted computers have no fleet attached in this environment.
    #[error(transparent)]
    Unavailable(#[from] FleetUnavailable),
    /// No such harness.
    #[error("{0}")]
    NotFound(String),
    /// The computer is not in a state to do it (not connected, no display).
    #[error("{0}")]
    Conflict(String),
    /// Another request cancelled this pending sign-in.
    #[error("Claude sign-in was cancelled")]
    SignInCancelled,
    /// Claude rejected the code; the caller must start a new sign-in.
    #[error("That code didn't work — sign in again to get a new one")]
    InvalidCode,
    /// The computer tried and failed; the message is safe to show.
    #[error("{0}")]
    Failed(String),
    /// The computer did not answer in time.
    #[error("the computer did not answer in time")]
    Timeout,
    /// Anything else.
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl ComputerRouteError {
    fn from_result(result: ComputerControlResult) -> Self {
        match result {
            ComputerControlResult::SignInCancelled => Self::SignInCancelled,
            ComputerControlResult::InvalidCode => Self::InvalidCode,
            ComputerControlResult::Failed { message } => Self::Failed(message),
            other => Self::Internal(rootcause::report!(
                "the computer answered an unexpected {other:?}"
            )),
        }
    }
}

impl From<HarnessError> for ComputerRouteError {
    fn from(error: HarnessError) -> Self {
        match error {
            HarnessError::BadRequest(message) => Self::BadRequest(message),
            HarnessError::NotFound(message) => Self::NotFound(message),
            HarnessError::Gone(message) => Self::Conflict(message),
            HarnessError::Unauthorized => Self::Forbidden,
            HarnessError::Throttled => Self::Conflict("try again later".to_owned()),
            HarnessError::Repo(error) => Self::Internal(rootcause::report!("{error:?}")),
        }
    }
}

impl IntoResponse for ComputerRouteError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Forbidden | Self::RolloutDisabled => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Failed(_) | Self::InvalidCode | Self::SignInCancelled => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self, "computer route failed");
        }
        let mut body = serde_json::json!({ "message": self.to_string() });
        if matches!(self, Self::InvalidCode) {
            body["code"] = serde_json::json!("invalid_code");
        }
        (status, Json(body)).into_response()
    }
}
