//! Thin HTTP adapter for the caller's Slack sign-in, accounts and Slack
//! Connect catalogue: authenticated owners flow to [`SlackService`]. DSS
//! mounts [`slack_router`] at `/slack-linked`; added chats are served by
//! `external_chat`'s `/external-chats` routes.

use crate::domain::{models::*, service::SlackService};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    routing::{get, post},
};
use external_chat::inbound::router::{ApiError, authority, no_store};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Capabilities supplied by DSS.
pub struct SlackRouterState<Auth> {
    /// Use cases.
    pub service: Arc<SlackService>,
    /// Standard authentication provider.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for SlackRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<SlackRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SlackRouterState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Start an email sign-in.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SlackEmailLogin)]
pub struct EmailLogin {
    /// The Slack account's email address.
    pub email: String,
}

/// The captcha's solution.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SlackCaptchaSolution)]
pub struct CaptchaSolution {
    /// What the captcha widget returned.
    pub solution: String,
}

/// A code Slack sent (email confirmation or two-factor).
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SlackLoginCode)]
pub struct LoginCode {
    /// The code.
    pub code: String,
}

/// The workspaces to sign in to.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SlackWorkspaceChoice)]
pub struct WorkspaceChoice {
    /// Their team ids.
    pub team_ids: Vec<String>,
}

/// The consent generation the owner deliberately ends.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SlackDisconnectRequest)]
pub struct DisconnectRequest {
    /// Fences retries against a later sign-in.
    pub authorization_generation: i64,
    /// Also sign the session out at Slack.
    #[serde(default)]
    pub sign_out: bool,
}

/// Result of disconnecting.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SlackDisconnect)]
pub struct Disconnect {
    /// The account was connected at that generation and now isn't.
    pub disconnected: bool,
}

/// The caller's sign-in, accounts and catalogue, under `/slack-linked`.
pub fn slack_router<Auth, S>(state: SlackRouterState<Auth>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    no_store(
        Router::new()
            .route("/login", post(start_login::<Auth>))
            .route("/login/session", post(submit_session::<Auth>))
            .route(
                "/login/{id}",
                get(login::<Auth>).delete(cancel_login::<Auth>),
            )
            .route("/login/{id}/captcha", post(captcha::<Auth>))
            .route("/login/{id}/code", post(code::<Auth>))
            .route("/login/{id}/workspaces", post(workspaces::<Auth>))
            .route("/login/{id}/two-factor", post(two_factor::<Auth>))
            .route("/accounts", get(accounts::<Auth>))
            .route("/accounts/{id}/disconnect", post(disconnect::<Auth>))
            .route("/conversations", get(conversations::<Auth>))
            .route("/chats/{id}/history-import", post(import_history::<Auth>)),
    )
    .with_state(state)
}

/// Start an email sign-in.
#[utoipa::path(post, path = "/slack-linked/login", operation_id = "slack_linked_start_login", request_body = EmailLogin, responses((status = 200, body = Login)))]
pub async fn start_login<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(body): Json<EmailLogin>,
) -> Result<Json<Login>, ApiError> {
    Ok(Json(
        state
            .service
            .start_email_login(
                &auth.authorization.macro_user_id,
                &body.email,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Sign in with a pasted or desktop-captured session.
#[utoipa::path(post, path = "/slack-linked/login/session", operation_id = "slack_linked_submit_session", request_body = SessionSubmission, responses((status = 200, body = Login)))]
pub async fn submit_session<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(body): Json<SessionSubmission>,
) -> Result<Json<Login>, ApiError> {
    Ok(Json(
        state
            .service
            .submit_session(
                &auth.authorization.macro_user_id,
                &body,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Poll the caller's sign-in.
#[utoipa::path(get, path = "/slack-linked/login/{id}", operation_id = "slack_linked_login", params(("id" = Uuid, Path)), responses((status = 200, body = Login)))]
pub async fn login<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<Login>, ApiError> {
    Ok(Json(
        state
            .service
            .login(
                &auth.authorization.macro_user_id,
                id,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Cancel the caller's sign-in.
#[utoipa::path(delete, path = "/slack-linked/login/{id}", operation_id = "slack_linked_cancel_login", params(("id" = Uuid, Path)), responses((status = 200, body = Login)))]
pub async fn cancel_login<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<Login>, ApiError> {
    Ok(Json(
        state
            .service
            .cancel_login(
                &auth.authorization.macro_user_id,
                id,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

async fn submit<Auth: MacroAuthorizationService>(
    state: &SlackRouterState<Auth>,
    auth: &MacroAuthorizationExtractor<Auth, UserOnly>,
    id: Uuid,
    step: LoginStepName,
    input: LoginInput,
) -> Result<Json<Login>, ApiError> {
    Ok(Json(
        state
            .service
            .submit_login_input(
                &auth.authorization.macro_user_id,
                id,
                step,
                input,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Answer the captcha step.
#[utoipa::path(post, path = "/slack-linked/login/{id}/captcha", operation_id = "slack_linked_login_captcha", params(("id" = Uuid, Path)), request_body = CaptchaSolution, responses((status = 200, body = Login)))]
pub async fn captcha<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    Json(body): Json<CaptchaSolution>,
) -> Result<Json<Login>, ApiError> {
    let input = LoginInput::Captcha {
        solution: body.solution,
    };
    submit(&state, &auth, id, LoginStepName::Captcha, input).await
}

/// Answer the emailed-code step.
#[utoipa::path(post, path = "/slack-linked/login/{id}/code", operation_id = "slack_linked_login_code", params(("id" = Uuid, Path)), request_body = LoginCode, responses((status = 200, body = Login)))]
pub async fn code<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    Json(body): Json<LoginCode>,
) -> Result<Json<Login>, ApiError> {
    let input = LoginInput::Code { code: body.code };
    submit(&state, &auth, id, LoginStepName::EmailCode, input).await
}

/// Choose the workspaces to sign in to.
#[utoipa::path(post, path = "/slack-linked/login/{id}/workspaces", operation_id = "slack_linked_login_workspaces", params(("id" = Uuid, Path)), request_body = WorkspaceChoice, responses((status = 200, body = Login)))]
pub async fn workspaces<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    Json(body): Json<WorkspaceChoice>,
) -> Result<Json<Login>, ApiError> {
    let input = LoginInput::Workspaces {
        team_ids: body.team_ids,
    };
    submit(&state, &auth, id, LoginStepName::PickWorkspaces, input).await
}

/// Answer the two-factor step.
#[utoipa::path(post, path = "/slack-linked/login/{id}/two-factor", operation_id = "slack_linked_login_two_factor", params(("id" = Uuid, Path)), request_body = LoginCode, responses((status = 200, body = Login)))]
pub async fn two_factor<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    Json(body): Json<LoginCode>,
) -> Result<Json<Login>, ApiError> {
    let input = LoginInput::TwoFactor { code: body.code };
    submit(&state, &auth, id, LoginStepName::TwoFactor, input).await
}

/// The caller's accounts.
#[utoipa::path(get, path = "/slack-linked/accounts", operation_id = "slack_linked_accounts", responses((status = 200, body = AccountList)))]
pub async fn accounts<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<AccountList>, ApiError> {
    Ok(Json(
        state
            .service
            .accounts(&auth.authorization.macro_user_id)
            .await?,
    ))
}

/// End one account's consent.
#[utoipa::path(post, path = "/slack-linked/accounts/{id}/disconnect", operation_id = "slack_linked_disconnect", params(("id" = Uuid, Path)), request_body = DisconnectRequest, responses((status = 200, body = Disconnect)))]
pub async fn disconnect<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    Json(body): Json<DisconnectRequest>,
) -> Result<Json<Disconnect>, ApiError> {
    Ok(Json(Disconnect {
        disconnected: state
            .service
            .disconnect(
                &auth.authorization.macro_user_id,
                id,
                body.authorization_generation,
                body.sign_out,
                authority(&auth.authorization),
            )
            .await?,
    }))
}

/// The caller's Slack Connect conversations; asks for a refresh.
#[utoipa::path(get, path = "/slack-linked/conversations", operation_id = "slack_linked_conversations", responses((status = 200, body = ConversationList)))]
pub async fn conversations<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<ConversationList>, ApiError> {
    Ok(Json(
        state
            .service
            .conversations(&auth.authorization.macro_user_id)
            .await?,
    ))
}

/// Import another page of a chat's earlier messages.
#[utoipa::path(post, path = "/slack-linked/chats/{id}/history-import", operation_id = "slack_linked_import_history", params(("id" = Uuid, Path)), responses((status = 200, body = HistoryImport)))]
pub async fn import_history<Auth: MacroAuthorizationService>(
    State(state): State<SlackRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<HistoryImport>, ApiError> {
    Ok(Json(
        state
            .service
            .import_history(
                &auth.authorization.macro_user_id,
                id,
                authority(&auth.authorization),
            )
            .await?,
    ))
}
