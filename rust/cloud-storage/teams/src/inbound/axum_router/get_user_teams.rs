use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{
    model::{Team, TeamError},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Gets all teams for the authenticated user.
#[utoipa::path(
    get,
    path = "/team/user",
    operation_id = "get_user_teams",
    responses(
        (status = 200, body = Vec<Team>),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    State(state): State<TeamRouterState<T, Eas>>,
    user_context: MacroUserExtractor,
) -> Result<Json<Vec<Team>>, TeamError> {
    let teams = state
        .service
        .get_user_teams(&user_context.macro_user_id)
        .await?;
    Ok(Json(teams))
}
