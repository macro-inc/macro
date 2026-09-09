use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};

use crate::domain::{
    model::{CreateTeamError, StartupType, Team, TeamProfile},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// The request body to create a new team
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct CreateTeamRequest {
    /// The name of the team
    pub name: String,
    /// What kind of startup the team is building
    #[serde(default)]
    pub startup_type: Option<StartupType>,
    /// Absolute URL of the team's logo image (an uploaded static file)
    #[serde(default)]
    pub logo_url: Option<String>,
}

/// Creates a new team.
#[utoipa::path(
    post,
    path = "/team",
    operation_id = "create_team",
    responses(
        (status = 200, body = Team),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateTeamRequest>,
) -> Result<Json<Team>, CreateTeamError> {
    let user = &user.authorization.user;
    // Teams are free up to FREE_TEAM_MAX_MEMBERS members - a subscription is
    // linked when the owner has one, but is no longer required to create.
    let subscription_id = state
        .service
        .is_user_premium(&user.macro_user_id)
        .await
        .map_err(|e| CreateTeamError::StorageLayerError(e.into()))?;

    let profile = TeamProfile {
        startup_type: req.startup_type,
        logo_url: req.logo_url.clone(),
    };
    let team = state
        .service
        .create_team(
            &user.macro_user_id,
            &req.name,
            &profile,
            subscription_id.as_ref(),
        )
        .await?;

    Ok(Json(team))
}
