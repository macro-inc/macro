use axum::{
    Json,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use crate::api::context::ApiContext;
use model::user::UserContext;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use properties_db_client::{
    error::PropertiesDatabaseError, property_definitions::get as property_definitions_get,
};

#[derive(Debug, Error)]
pub enum ListPropertiesErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("organization_id is required for org scope")]
    MissingOrganizationId,
}

impl IntoResponse for ListPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListPropertiesErr::InternalError(_) | ListPropertiesErr::DatabaseError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            ListPropertiesErr::MissingOrganizationId => StatusCode::BAD_REQUEST,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "ListPropertiesErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Scope filter for property queries
#[derive(Debug, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PropertyScope {
    /// User-scoped properties only
    User,
    /// Organization-scoped properties only
    Org,
    /// Both user and organization properties
    All,
}

/// Query parameters for listing properties
#[derive(Debug, Deserialize, ToSchema)]
pub struct ListPropertiesQuery {
    /// Scope filter for properties
    pub scope: PropertyScope,
    /// Whether to include property options in the response
    #[serde(default)]
    pub include_options: bool,
}

/// Response for property definition with optional property options
#[derive(Debug, Serialize, ToSchema)]
#[serde(untagged)]
pub enum PropertyDefinitionResponse {
    Simple(PropertyDefinition),
    WithOptions(PropertyDefinitionWithOptions),
}

/// List property definitions with flexible filtering
#[utoipa::path(
    get,
    path = "/properties/definitions",
    params(
        ("scope" = PropertyScope, Query, description = "Filter by scope: 'user' for user-scoped only, 'org' for organization-scoped only, 'all' for both scopes"),
        ("include_options" = Option<bool>, Query, description = "Whether to include property options in the response")
    ),
    responses(
        (status = 200, description = "Properties retrieved successfully", body = Vec<PropertyDefinitionResponse>),
        (status = 400, description = "Invalid request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, user_context))]
pub async fn list_properties(
    Query(query): Query<ListPropertiesQuery>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<Vec<PropertyDefinitionResponse>>, ListPropertiesErr> {
    let (org_id, user_id_opt) = match query.scope {
        PropertyScope::Org => (user_context.organization_id, None),
        PropertyScope::User => (None, Some(user_context.user_id.as_str())),
        PropertyScope::All => (
            user_context.organization_id,
            Some(user_context.user_id.as_str()),
        ),
    };

    tracing::info!(
        organization_id = ?org_id,
        scope = ?query.scope,
        user_id = %user_context.user_id,
        "listing properties"
    );

    if query.scope == PropertyScope::Org && org_id.is_none() {
        return Err(ListPropertiesErr::MissingOrganizationId);
    }

    let response = if query.include_options {
        let properties_with_options =
            property_definitions_get::get_properties_with_options(&context.db, org_id, user_id_opt)
                .await
                .inspect_err(|e| {
                    tracing::error!(
                        error = ?e,
                        organization_id = ?org_id,
                        scope = ?query.scope,
                        user_id = %user_context.user_id,
                        "failed to retrieve properties with options"
                    );
                })?;

        let response: Vec<PropertyDefinitionResponse> = properties_with_options
            .into_iter()
            .map(PropertyDefinitionResponse::WithOptions)
            .collect();

        tracing::info!(
            properties_count = response.len(),
            organization_id = ?org_id,
            scope = ?query.scope,
            user_id = %user_context.user_id,
            "successfully retrieved properties with options"
        );
        response
    } else {
        let properties = property_definitions_get::get_properties(&context.db, org_id, user_id_opt)
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error = ?e,
                    organization_id = ?org_id,
                    scope = ?query.scope,
                    user_id = %user_context.user_id,
                    "failed to retrieve properties"
                );
            })?;

        let response: Vec<PropertyDefinitionResponse> = properties
            .into_iter()
            .map(PropertyDefinitionResponse::Simple)
            .collect();

        tracing::info!(
            properties_count = response.len(),
            organization_id = ?org_id,
            scope = ?query.scope,
            user_id = %user_context.user_id,
            "successfully retrieved properties"
        );
        response
    };

    Ok(Json(response))
}
