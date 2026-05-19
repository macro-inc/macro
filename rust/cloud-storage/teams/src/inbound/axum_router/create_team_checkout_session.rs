use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{Team, TeamCheckoutError, TeamCheckoutSessionRequest},
    team_repo::TeamService,
};

use super::TeamRouterState;

impl IntoResponse for TeamCheckoutError {
    fn into_response(self) -> Response {
        let status = match self {
            TeamCheckoutError::TeamAlreadyHasPlanError
            | TeamCheckoutError::MissingCustomerId
            | TeamCheckoutError::AlreadySubscribed => StatusCode::BAD_REQUEST,
            TeamCheckoutError::TeamError(_) | TeamCheckoutError::CustomerError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
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

/// Team checkout session response
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamCheckoutSessionResponse {
    /// The checkout url
    pub url: String,
}

/// Creates a new team.
#[utoipa::path(
    post,
    path = "/team/checkout",
    operation_id = "create_team_checkout_session",
    responses(
        (status = 200, body = Team),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Json(req): Json<TeamCheckoutSessionRequest>,
) -> Result<Json<TeamCheckoutSessionResponse>, crate::domain::model::TeamCheckoutError> {
    let url = state
        .service
        .create_checkout_session(access.entity_access_receipt, &req)
        .await?;

    Ok(Json(TeamCheckoutSessionResponse { url }))
}
