//! Claude Code sign-in on a Macro computer, run by harnessd on it.
//!
//! Each route sends one request to harnessd through [`Harnessd`], which
//! records the computer's Claude login from harnessd's status under the
//! computer's lock.

use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use harness_id::HarnessId;
use harnessd_protocol::{AgentProvider, ErrorKind, Request};
use harnesses::domain::account_logins::HarnessAccountLogin;
use harnesses::domain::models::{ClaudeMode, HarnessPermission};
use harnesses::domain::ports::{HarnessError, HarnessService};
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::models::{FleetAttachment, FleetUnavailable};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

#[cfg(test)]
mod test;

use super::harnessd::{Harnessd, HarnessdError};

/// State for the Claude sign-in routes.
pub struct ClaudeAccessState<Harnesses, Auth> {
    harnesses: Arc<Harnesses>,
    harnessd: Harnessd<Harnesses>,
    rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    fleet_attachment: FleetAttachment,
    cleanup: TaskTracker,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Harnesses, Auth> Clone for ClaudeAccessState<Harnesses, Auth> {
    fn clone(&self) -> Self {
        Self {
            harnesses: Arc::clone(&self.harnesses),
            harnessd: self.harnessd.clone(),
            rollout: self.rollout.clone(),
            fleet_attachment: self.fleet_attachment,
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

/// Build the Claude sign-in routes over `harnessd`.
pub fn router<Harnesses, Auth>(
    harnessd: Harnessd<Harnesses>,
    harnesses: Arc<Harnesses>,
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
        harnesses,
        harnessd,
        rollout,
        fleet_attachment,
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
}

/// How Claude Code on a computer is paid for, and its Claude sign-in when it
/// uses its own.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClaudeModeResponse {
    /// How Claude Code is paid for.
    pub mode: ClaudeMode,
    /// The active Claude sign-in; absent on Macro credits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<ClaudeAccountStatus>,
}

/// A computer's active Claude sign-in. Claude's long-lived credential names
/// no account, so there is no email or plan to show.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccountStatus {
    /// Who signed it in through Macro; absent once that user is deleted or
    /// when it was signed in on the computer itself.
    #[schema(value_type = Option<String>)]
    pub signed_in_by: Option<MacroUserIdStr<'static>>,
    /// When it was signed in.
    pub signed_in_at: chrono::DateTime<chrono::Utc>,
    /// When the credential stops working, as the computer last reported it.
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ClaudeModeResponse {
    fn of(login: Option<HarnessAccountLogin>) -> Self {
        match login {
            None => Self {
                mode: ClaudeMode::MacroCredits,
                account: None,
            },
            Some(login) => Self {
                mode: ClaudeMode::OwnAccount,
                account: Some(ClaudeAccountStatus {
                    signed_in_by: login.signed_in_by,
                    signed_in_at: login.signed_in_at,
                    expires_at: login.expires_at,
                }),
            },
        }
    }
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
    let computer_id = state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    match state
        .run(
            path.harness_id,
            computer_id,
            Request::SignInStart {
                agent: AgentProvider::Claude,
            },
            None,
        )
        .await?
    {
        harnessd_protocol::Response::SignInStarted { url, .. } => Ok(Json(ClaudeSignInStarted {
            url: trusted_sign_in_url(&url)?.to_owned(),
        })),
        other => Err(ComputerRouteError::from_answer(other)),
    }
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
    let computer_id = state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    match state
        .run(
            path.harness_id,
            computer_id,
            Request::SignInComplete {
                agent: AgentProvider::Claude,
                code: body.code,
            },
            Some(signed_in_by),
        )
        .await?
    {
        harnessd_protocol::Response::SignedIn { .. } => {
            Ok(Json(ClaudeSignedIn { signed_in: true }))
        }
        other => Err(ComputerRouteError::from_answer(other)),
    }
}

/// Cancel the computer's waiting sign-in, including one a completion is
/// still finishing.
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
    let computer_id = state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    match state
        .run(
            path.harness_id,
            computer_id,
            Request::SignInCancel {
                agent: AgentProvider::Claude,
            },
            None,
        )
        .await?
    {
        answer @ harnessd_protocol::Response::Error { .. } => {
            Err(ComputerRouteError::from_answer(answer))
        }
        _ => Ok(StatusCode::NO_CONTENT),
    }
}

/// Forget the computer's Claude credential and return it to Macro credits.
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
    let computer_id = state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    match state
        .run(
            path.harness_id,
            computer_id,
            Request::SignOut {
                agent: AgentProvider::Claude,
            },
            None,
        )
        .await?
    {
        harnessd_protocol::Response::SignedOut { .. } => Ok(Json(ClaudeModeResponse::of(None))),
        other => Err(ComputerRouteError::from_answer(other)),
    }
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
    state
        .authorize_computer(caller, path.harness_id, HarnessPermission::Manage)
        .await?;
    let login = state
        .harnesses
        .active_account_login(path.harness_id, AgentProvider::Claude)
        .await?;
    Ok(Json(ClaudeModeResponse::of(login)))
}

/// Hosts `claude setup-token` sends people to; the pinned Claude Code
/// uses `claude.com`.
const SIGN_IN_HOSTS: &[&str] = &["claude.com", "claude.ai"];

/// `url` when it is a Claude OAuth sign-in link, which the browser then
/// opens. The link comes from the guest, which its users control, so
/// anything else (another scheme or host) is refused.
fn trusted_sign_in_url(url: &str) -> Result<&str, ComputerRouteError> {
    let parsed = url::Url::parse(url).map_err(|_| ComputerRouteError::UntrustedSignInUrl)?;
    let trusted = parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && parsed
            .host_str()
            .is_some_and(|host| SIGN_IN_HOSTS.contains(&host))
        && parsed.path().ends_with("/oauth/authorize");
    if !trusted {
        tracing::warn!("a computer returned an untrusted Claude sign-in link");
        return Err(ComputerRouteError::UntrustedSignInUrl);
    }
    Ok(url)
}

impl<Harnesses, Auth> ClaudeAccessState<Harnesses, Auth>
where
    Harnesses: HarnessService,
{
    /// Run `request` to its end even if the HTTP caller goes away, so a
    /// sign-in harnessd finished is still recorded with its signer.
    async fn run(
        &self,
        harness_id: HarnessId,
        computer_id: ComputerId,
        request: Request,
        signed_in_by: Option<MacroUserIdStr<'static>>,
    ) -> Result<harnessd_protocol::Response, ComputerRouteError> {
        let harnessd = self.harnessd.clone();
        let (reply, received) = tokio::sync::oneshot::channel();
        self.cleanup.spawn(
            async move {
                let answer = harnessd
                    .run(harness_id, computer_id, request, signed_in_by)
                    .await;
                let _ = reply.send(answer);
            }
            .instrument(tracing::Span::current()),
        );
        let answer = received.await.map_err(|_| {
            ComputerRouteError::Internal(rootcause::report!("the harnessd worker stopped"))
        })?;
        Ok(answer?)
    }

    /// The computer behind the harness, when the caller has `access` and it
    /// is a Macro computer.
    async fn authorize_computer(
        &self,
        caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
        harness_id: HarnessId,
        access: HarnessPermission,
    ) -> Result<ComputerId, ComputerRouteError> {
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
        let Some(computer_id) = harness.computer_id else {
            return Err(ComputerRouteError::BadRequest(
                "this runtime is not a Macro computer".to_owned(),
            ));
        };
        self.fleet_attachment.require_attached()?;
        Ok(computer_id)
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
    /// The computer's sign-in link is not Claude's.
    #[error("the computer returned a sign-in link that isn't Claude's")]
    UntrustedSignInUrl,
    /// Anything else.
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl ComputerRouteError {
    /// A harnessd answer the route did not ask for.
    fn from_answer(answer: harnessd_protocol::Response) -> Self {
        let harnessd_protocol::Response::Error { kind, .. } = answer else {
            return Self::Internal(rootcause::report!(
                "harnessd answered an unexpected {answer:?}"
            ));
        };
        match kind {
            ErrorKind::InvalidCode => Self::InvalidCode,
            ErrorKind::MalformedCode => {
                Self::BadRequest("paste the code Claude showed you".to_owned())
            }
            ErrorKind::NoPendingSignIn => {
                Self::Conflict("no Claude sign-in is waiting; start one first".to_owned())
            }
            ErrorKind::Cancelled => Self::SignInCancelled,
            ErrorKind::Timeout => Self::Timeout,
            ErrorKind::Failed => {
                Self::Failed("Claude could not sign in on the computer".to_owned())
            }
            ErrorKind::Unavailable => {
                Self::Conflict("the computer's sign-in service is not running".to_owned())
            }
            ErrorKind::InvalidRequest => Self::Internal(rootcause::report!(
                "harnessd did not understand the request"
            )),
        }
    }
}

impl From<HarnessdError> for ComputerRouteError {
    fn from(error: HarnessdError) -> Self {
        match error {
            HarnessdError::Unreachable(_) => {
                tracing::warn!(error = ?error, "could not reach harnessd");
                Self::Conflict("the computer is not reachable; is it running?".to_owned())
            }
            HarnessdError::Timeout => Self::Timeout,
            HarnessdError::Harness(error) => error.into(),
            error @ (HarnessdError::Unreadable(_)
            | HarnessdError::AnswerTooLarge
            | HarnessdError::Lock(_)) => Self::Internal(rootcause::report!("{error}")),
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
            error @ HarnessError::ComputerHarness => Self::Conflict(error.to_string()),
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
            Self::Failed(_)
            | Self::InvalidCode
            | Self::SignInCancelled
            | Self::UntrustedSignInUrl => StatusCode::UNPROCESSABLE_ENTITY,
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
