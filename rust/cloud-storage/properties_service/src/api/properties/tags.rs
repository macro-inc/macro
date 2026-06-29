use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;

use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use model::user::UserContext;
use models_properties::api::PropertyDefinitionWithOptionsResponse;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use properties_db_client::{
    error::PropertiesDatabaseError,
    property_definitions::insert::{self as property_definitions_insert, DefinitionOwner},
    property_options::get as property_options_get,
};

#[derive(Debug, Error)]
pub enum GetTagsErr {
    #[error("An internal error occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("An internal error occurred")]
    DatabaseError(#[from] PropertiesDatabaseError),
}

impl IntoResponse for GetTagsErr {
    fn into_response(self) -> Response {
        tracing::error!(error = ?self, error_type = "GetTagsErr", "Internal server error");
        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()).into_response()
    }
}

/// Get the caller's tag sets: their personal set, plus their team's shared set when on a team.
/// Each set is resolved and provisioned on first use.
#[utoipa::path(
    get,
    path = "/properties/tags",
    responses(
        (status = 200, description = "Tag sets retrieved", body = Vec<PropertyDefinitionWithOptionsResponse>),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context, team), fields(user_id = %user_context.user_id), err)]
pub async fn get_tags(
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
) -> Result<Json<Vec<PropertyDefinitionWithOptionsResponse>>, GetTagsErr> {
    let mut sets = Vec::new();

    let user_definition = property_definitions_insert::get_or_create_tag_definition(
        &state.db,
        DefinitionOwner::User(&user_context.user_id),
    )
    .await?;
    sets.push(load_with_options(&state.db, user_definition).await?);

    if let Some(team_id) = caller_team_id(&team) {
        let team_definition = property_definitions_insert::get_or_create_tag_definition(
            &state.db,
            DefinitionOwner::Team(team_id),
        )
        .await?;
        sets.push(load_with_options(&state.db, team_definition).await?);
    }

    Ok(Json(sets))
}

async fn load_with_options(
    db: &sqlx::PgPool,
    definition: PropertyDefinition,
) -> Result<PropertyDefinitionWithOptionsResponse, PropertiesDatabaseError> {
    let property_options = property_options_get::get_property_options(db, definition.id).await?;
    Ok(PropertyDefinitionWithOptions {
        definition,
        property_options,
    }
    .into())
}
