use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{
        DirectJoinOutcome, DomainTeam, JoinTeamByDomainError, JoinTeamDirectlyError, TeamError,
    },
    team_repo::{TeamInviteLinkService, TeamService},
};

use super::TeamRouterState;

/// The team the caller may join because it claims their email domain.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct DomainTeamResponse {
    /// The team, or null when no team claims the caller's email domain.
    pub team: Option<DomainTeam>,
}

/// The result of joining the team that claims the caller's email domain.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct JoinTeamByDomainResponse {
    /// The team the caller joined.
    pub team_id: uuid::Uuid,
    /// True when the caller was already on the team and nothing changed.
    pub already_member: bool,
}

impl IntoResponse for JoinTeamByDomainError {
    fn into_response(self) -> Response {
        let status = match self {
            JoinTeamByDomainError::NoDomainTeam => StatusCode::NOT_FOUND,
            JoinTeamByDomainError::AlreadyInAnotherTeam => StatusCode::CONFLICT,
            JoinTeamByDomainError::TeamError(e)
            | JoinTeamByDomainError::JoinError(JoinTeamDirectlyError::TeamError(e)) => {
                return e.into_response();
            }
            JoinTeamByDomainError::JoinError(JoinTeamDirectlyError::JoinTeamError(e)) => {
                return e.into_response();
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Gets the team whose auto-join domain matches the caller's email domain, so
/// the caller can choose to join it.
#[utoipa::path(
    get,
    path = "/team/domain",
    operation_id = "get_team_by_domain",
    responses(
        (status = 200, body = DomainTeamResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn get_handler<
    T: TeamService + TeamInviteLinkService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<DomainTeamResponse>, TeamError> {
    let team = state
        .service
        .get_team_by_domain(&authorization.authorization.user.macro_user_id)
        .await?;
    Ok(Json(DomainTeamResponse { team }))
}

/// Joins the team whose auto-join domain matches the caller's email domain.
#[utoipa::path(
    post,
    path = "/team/domain/join",
    operation_id = "join_team_by_domain",
    responses(
        (status = 200, body = JoinTeamByDomainResponse),
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
) -> Result<Json<JoinTeamByDomainResponse>, JoinTeamByDomainError> {
    let outcome = state
        .service
        .join_team_by_domain(&authorization.authorization.user.macro_user_id)
        .await?;
    Ok(Json(JoinTeamByDomainResponse {
        team_id: outcome.team_id(),
        already_member: matches!(outcome, DirectJoinOutcome::AlreadyMember { .. }),
    }))
}
