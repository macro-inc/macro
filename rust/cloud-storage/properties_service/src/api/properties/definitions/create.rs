use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;

use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use model::user::UserContext;
use models_properties::api::{CreatePropertyDefinitionRequest, CreatePropertyScope};
use models_properties::service::property_definition::PropertyDefinition;
use properties::domain::model::PropertyDefinitionOwner;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum CreatePropertyDefinitionErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
    #[error("You must be on a team to create a team property")]
    TeamMembershipRequired,
}

impl IntoResponse for CreatePropertyDefinitionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            CreatePropertyDefinitionErr::Properties(e) => match e {
                PropertiesErr::Validation(_) => StatusCode::BAD_REQUEST,
                PropertiesErr::NotFound => StatusCode::NOT_FOUND,
                PropertiesErr::PermissionDenied | PropertiesErr::SystemPropertyNotModifiable => {
                    StatusCode::FORBIDDEN
                }
                PropertiesErr::Repo(_) | PropertiesErr::PermissionServiceNotConfigured => {
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            },
            CreatePropertyDefinitionErr::TeamMembershipRequired => StatusCode::FORBIDDEN,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "CreatePropertyDefinitionErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Create a new property definition
#[utoipa::path(
    post,
    path = "/properties/definitions",
    request_body = CreatePropertyDefinitionRequest,
    responses(
        (status = 201, description = "Property definition created successfully", body = PropertyDefinition),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Team membership required for team scope"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context, team), fields(user_id = %user_context.user_id), err)]
pub async fn create_property_definition(
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
    Json(request): Json<CreatePropertyDefinitionRequest>,
) -> Result<(StatusCode, Json<PropertyDefinition>), CreatePropertyDefinitionErr> {
    // Derive the owner from the authenticated caller - clients never supply owner ids.
    let owner = match request.scope {
        CreatePropertyScope::User => PropertyDefinitionOwner::User(user_context.user_id.as_str()),
        CreatePropertyScope::Team => {
            let team_id =
                caller_team_id(&team).ok_or(CreatePropertyDefinitionErr::TeamMembershipRequired)?;
            PropertyDefinitionOwner::Team(team_id)
        }
    };

    tracing::info!(
        owner = ?owner,
        scope = ?request.scope,
        "creating property definition"
    );

    let property = state
        .properties_service
        .create_property_definition(owner, &request)
        .await?;

    Ok((StatusCode::CREATED, Json(property)))
}
