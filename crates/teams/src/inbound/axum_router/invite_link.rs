use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{
        models::{AdminTeamRole, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationRejection,
    MacroAuthorizationService, UserOrInternal, refuse_agent_run,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{
        JoinTeamByInviteLinkError, JoinTeamByInviteLinkOutcome, JoinTeamDirectlyError,
        ManageTeamInviteLinkError, TeamError, TeamInviteLinkTeam, TeamInviteLinkToken,
    },
    team_repo::{TeamInviteLinkService, TeamService},
};

use super::TeamRouterState;

/// The caller's team invite link.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct TeamInviteLinkResponse {
    /// The link's token, or null when the team has no invite link.
    pub token: Option<TeamInviteLinkToken>,
}

/// A newly created team invite link.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct CreatedTeamInviteLinkResponse {
    /// The new link's token. Any previous link stops working.
    pub token: TeamInviteLinkToken,
}

/// The result of opening a team invite link.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct JoinTeamByInviteLinkResponse {
    /// The team the link joins.
    pub team_id: uuid::Uuid,
    /// True when the user was already on the team and nothing changed.
    pub already_member: bool,
}

/// Identifies an invite link. The token travels in the body, not the path, so
/// request spans and access logs that record the path never see it.
#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct TeamInviteLinkTokenRequest {
    /// The invite link's token.
    pub token: TeamInviteLinkToken,
}

impl IntoResponse for ManageTeamInviteLinkError {
    fn into_response(self) -> Response {
        match self {
            ManageTeamInviteLinkError::NonAdminInvitesDisabled
            | ManageTeamInviteLinkError::ResetRequiresAdmin => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: self.to_string().into(),
                }),
            )
                .into_response(),
            ManageTeamInviteLinkError::TeamError(e) => e.into_response(),
        }
    }
}

impl IntoResponse for JoinTeamByInviteLinkError {
    fn into_response(self) -> Response {
        match self {
            JoinTeamByInviteLinkError::LinkNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: self.to_string().into(),
                }),
            )
                .into_response(),
            JoinTeamByInviteLinkError::AlreadyInAnotherTeam => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: self.to_string().into(),
                }),
            )
                .into_response(),
            JoinTeamByInviteLinkError::TeamError(e)
            | JoinTeamByInviteLinkError::JoinError(JoinTeamDirectlyError::TeamError(e)) => {
                e.into_response()
            }
            JoinTeamByInviteLinkError::JoinError(JoinTeamDirectlyError::JoinTeamError(e)) => {
                e.into_response()
            }
        }
    }
}

/// Why an agent's program may not read or make the team's invite link: its
/// token lets anyone holding it join the team.
pub const PROGRAM_INVITE_LINK_REFUSAL: &str = "An agent's program cannot read or create the team's invite link. Ask the user to share it from the team settings in Macro.";

/// Why the invite link was not read or made.
#[derive(Debug, thiserror::Error)]
pub enum InviteLinkHandlerError {
    /// An agent's program asked for it.
    #[error(transparent)]
    Refused(#[from] MacroAuthorizationRejection),
    /// The team service refused or failed.
    #[error(transparent)]
    Link(#[from] ManageTeamInviteLinkError),
}

impl IntoResponse for InviteLinkHandlerError {
    fn into_response(self) -> Response {
        match self {
            Self::Refused(rejection) => rejection.into_response(),
            Self::Link(error) => error.into_response(),
        }
    }
}

/// Refuse an agent's program on the routes that hand out the link's token.
fn refuse_program(
    caller: &MacroAuthorizationExtractor<impl MacroAuthorizationService, AnyPrincipal>,
    headers: &HeaderMap,
) -> Result<(), MacroAuthorizationRejection> {
    refuse_agent_run(
        caller
            .authorization
            .acting_user()
            .is_some_and(|user| user.agent_id.is_some()),
        headers,
        PROGRAM_INVITE_LINK_REFUSAL,
    )
}

/// Gets the team's invite link. Anyone who may invite people to the team may
/// see it. An agent's program is refused (403).
#[utoipa::path(
    get,
    path = "/team/invite-link",
    operation_id = "get_team_invite_link",
    responses(
        (status = 200, body = TeamInviteLinkResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn get_handler<
    T: TeamService + TeamInviteLinkService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    caller: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    headers: HeaderMap,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
) -> Result<Json<TeamInviteLinkResponse>, InviteLinkHandlerError> {
    refuse_program(&caller, &headers)?;
    let token = state
        .service
        .get_team_invite_link(access.entity_access_receipt)
        .await?;
    Ok(Json(TeamInviteLinkResponse { token }))
}

/// Creates the team's invite link, replacing any existing one. Anyone who may
/// invite people may create the first link; replacing one requires a team
/// admin or owner. An agent's program is refused (403).
#[utoipa::path(
    post,
    path = "/team/invite-link",
    operation_id = "create_team_invite_link",
    responses(
        (status = 201, body = CreatedTeamInviteLinkResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn create_handler<
    T: TeamService + TeamInviteLinkService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    caller: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    headers: HeaderMap,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
) -> Result<(StatusCode, Json<CreatedTeamInviteLinkResponse>), InviteLinkHandlerError> {
    refuse_program(&caller, &headers)?;
    let token = state
        .service
        .create_team_invite_link(access.entity_access_receipt)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(CreatedTeamInviteLinkResponse { token }),
    ))
}

/// Turns off the team's invite link. Requires a team admin or owner.
#[utoipa::path(
    delete,
    path = "/team/invite-link",
    operation_id = "delete_team_invite_link",
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn delete_handler<
    T: TeamService + TeamInviteLinkService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
) -> Result<StatusCode, TeamError> {
    state
        .service
        .delete_team_invite_link(access.entity_access_receipt)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Gets the team an invite link joins, so the user can see it before joining.
#[utoipa::path(
    post,
    path = "/team/invite-link/team",
    operation_id = "get_team_by_invite_link",
    request_body = TeamInviteLinkTokenRequest,
    responses(
        (status = 200, body = TeamInviteLinkTeam),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn get_team_handler<
    T: TeamService + TeamInviteLinkService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    _authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(TeamInviteLinkTokenRequest { token }): Json<TeamInviteLinkTokenRequest>,
) -> Result<Json<TeamInviteLinkTeam>, JoinTeamByInviteLinkError> {
    let team = state.service.get_team_by_invite_link(&token).await?;
    Ok(Json(team))
}

/// Joins the team an invite link belongs to.
#[utoipa::path(
    post,
    path = "/team/invite-link/join",
    operation_id = "join_team_by_invite_link",
    request_body = TeamInviteLinkTokenRequest,
    responses(
        (status = 200, body = JoinTeamByInviteLinkResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn join_handler<
    T: TeamService + TeamInviteLinkService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(TeamInviteLinkTokenRequest { token }): Json<TeamInviteLinkTokenRequest>,
) -> Result<Json<JoinTeamByInviteLinkResponse>, JoinTeamByInviteLinkError> {
    let outcome = state
        .service
        .join_team_by_invite_link(&token, &authorization.authorization.user.macro_user_id)
        .await?;
    Ok(Json(JoinTeamByInviteLinkResponse {
        team_id: outcome.team_id(),
        already_member: matches!(outcome, JoinTeamByInviteLinkOutcome::AlreadyMember { .. }),
    }))
}
