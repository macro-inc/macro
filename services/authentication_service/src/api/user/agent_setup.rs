use axum::{Json, extract::State, http::StatusCode};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use teams::domain::team_repo::TeamService;
use user_api_key::domain::{ports::UserApiKeyService, service::UserApiKeyServiceImpl};
use user_api_key::outbound::pg_user_api_keys_repo::PgUserApiKeysRepo;

use crate::api::context::{ApiContext, AuthorizationService};
use crate::service::user::agent_signup::AGENT_SIGNUP_KEY_NAME;

/// What an agent needs to start using the SDK.
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct AgentSetupResponse {
    /// The agent's API key. Shown only here; repeating setup revokes it.
    pub api_key: String,
    /// Whether joining the inviting team failed. The invite stays pending, and
    /// repeating setup tries again.
    pub team_join_failed: bool,
}

fn error(status: StatusCode, message: &str) -> (StatusCode, Json<ErrorResponse<'static>>) {
    (
        status,
        Json(ErrorResponse {
            message: message.to_string().into(),
        }),
    )
}

/// Finishes an agent's signup: joins the team that invited it and mints its
/// SDK token.
///
/// Safe to repeat until the agent confirms it saved the token: a reload replaces
/// the key, and a failed join stays pending for the next attempt.
#[utoipa::path(
    post,
    path = "/user/agent_setup",
    operation_id = "agent_setup",
    responses(
        (status = 200, body = AgentSetupResponse),
        (status = 401, body = String),
        (status = 403, body = ErrorResponse, description = "The account is not an agent"),
        (status = 409, body = ErrorResponse, description = "Setup is already confirmed"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(
    name = "agent.setup",
    skip_all,
    fields(user_id = %authorization.authorization.user.macro_user_id, joined_team_id),
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Json<AgentSetupResponse>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let macro_user_id = &authorization.authorization.user.macro_user_id;
    let user = macro_db_client::user::get::get_legacy_user_info(&ctx.db, macro_user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to load user");
            error(StatusCode::INTERNAL_SERVER_ERROR, "unable to load user")
        })?;

    if !user.is_agent {
        return Err(error(StatusCode::FORBIDDEN, "account is not an agent"));
    }
    if user.tutorial_complete {
        return Err(error(StatusCode::CONFLICT, "setup is already confirmed"));
    }

    let user_id = MacroUserIdStr::parse_from_str(macro_user_id.as_ref()).map_err(|e| {
        tracing::error!(error=?e, "unable to parse user id");
        error(StatusCode::INTERNAL_SERVER_ERROR, "invalid user id")
    })?;

    let joined = join_inviting_team(&ctx, &user_id).await;

    let created = UserApiKeyServiceImpl::new(PgUserApiKeysRepo::new(ctx.db.clone()))
        .replace_key(&user_id, AGENT_SIGNUP_KEY_NAME)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to mint agent key");
            error(StatusCode::INTERNAL_SERVER_ERROR, "unable to create token")
        })?;

    Ok(Json(AgentSetupResponse {
        api_key: created.key,
        team_join_failed: !joined,
    }))
}

/// Joins the oldest pending agent invite. A failure leaves the invite pending:
/// the agent still gets its token, and the next attempt tries the join again.
/// Returns `false` when a pending invite could not be joined.
async fn join_inviting_team(ctx: &ApiContext, user_id: &MacroUserIdStr<'_>) -> bool {
    let invites = match ctx.teams_service.get_user_invites(user_id).await {
        Ok(invites) => invites,
        Err(e) => {
            tracing::error!(error=?e, "unable to read agent invites");
            return false;
        }
    };

    let Some(invite) = invites
        .iter()
        .filter(|invite| invite.is_agent)
        .min_by_key(|invite| invite.created_at)
    else {
        return true;
    };

    match ctx.teams_service.join_team(&invite.id, user_id).await {
        Ok(member) => {
            tracing::Span::current().record("joined_team_id", member.team_id.to_string());
            true
        }
        Err(e) => {
            tracing::error!(error=?e, team_id=%invite.team_id, "unable to join inviting team");
            false
        }
    }
}
