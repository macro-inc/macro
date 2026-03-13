use axum::{Json, extract::State};
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{model::Team, team_repo::TeamService};

use super::TeamRouterState;

/// The request body to create a new team
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct CreateTeamRequest {
    /// The name of the team
    pub name: String,
}

/// Creates a new team.
#[utoipa::path(
    post,
    path = "/team",
    operation_id = "create_team",
    responses(
        (status = 200, body = Team),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService>(
    State(state): State<TeamRouterState<T>>,
    user_context: MacroUserExtractor,
    Json(req): Json<CreateTeamRequest>,
) -> Result<Json<Team>, crate::domain::model::CreateTeamError> {
    let team = state
        .service
        .create_team(&user_context.macro_user_id, &req.name)
        .await?;

    Ok(Json(team))
}
