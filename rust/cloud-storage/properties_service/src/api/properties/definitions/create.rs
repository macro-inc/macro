use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::ApiContext;
use model::user::UserContext;
use models_properties::api::{CreatePropertyDefinitionRequest, PropertyDataType};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use properties_db_client::{
    error::PropertiesDatabaseError, property_definitions::insert as property_definitions_insert,
};

#[derive(Debug, Error)]
pub enum CreatePropertyDefinitionErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("{0}")]
    InvalidRequest(String),
}

impl IntoResponse for CreatePropertyDefinitionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            CreatePropertyDefinitionErr::InternalError(_)
            | CreatePropertyDefinitionErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            CreatePropertyDefinitionErr::InvalidRequest(_) => StatusCode::BAD_REQUEST,
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
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(context, user_context), fields(user_id = %user_context.user_id))]
pub async fn create_property_definition(
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<CreatePropertyDefinitionRequest>,
) -> Result<(StatusCode, Json<PropertyDefinition>), CreatePropertyDefinitionErr> {
    tracing::info!(
        organization_id = ?request.owner.organization_id(),
        user_id = ?request.owner.user_id(),
        "creating property definition"
    );

    if let Err(err) = request.validate() {
        tracing::error!(
            error = %err,
            "property definition validation failed"
        );
        return Err(CreatePropertyDefinitionErr::InvalidRequest(err.to_string()));
    }

    let (base_data_type, property_options) = match &request.data_type {
        PropertyDataType::SelectString { options, .. } => {
            let property_options: Vec<PropertyOption> = options
                .iter()
                .map(|opt| PropertyOption {
                    id: Uuid::nil(),                     // Temporary ID, will be replaced by DB
                    property_definition_id: Uuid::nil(), // Temporary ID, will be replaced by DB
                    display_order: opt.display_order,
                    value: PropertyOptionValue::String(opt.value.clone()),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                })
                .collect();
            (request.data_type.to_data_type(), property_options)
        }
        PropertyDataType::SelectNumber { options, .. } => {
            let property_options: Vec<PropertyOption> = options
                .iter()
                .map(|opt| PropertyOption {
                    id: Uuid::nil(),                     // Temporary ID, will be replaced by DB
                    property_definition_id: Uuid::nil(), // Temporary ID, will be replaced by DB
                    display_order: opt.display_order,
                    value: PropertyOptionValue::Number(opt.value),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                })
                .collect();
            (request.data_type.to_data_type(), property_options)
        }
        _ => (request.data_type.to_data_type(), Vec::new()),
    };

    let property = if property_options.is_empty() {
        tracing::debug!("no options provided, using simple creation");

        property_definitions_insert::create_property_definition(
            &context.db,
            request.owner.organization_id(),
            request.owner.user_id(),
            &request.display_name,
            base_data_type,
            request.data_type.is_multi_select(),
            request.data_type.specific_entity_type(),
        )
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                display_name = %request.display_name,
                "failed to create property definition in database"
            );
        })?
    } else {
        tracing::debug!(
            options_count = property_options.len(),
            "options provided, using transactional creation"
        );

        property_definitions_insert::create_property_definition_with_options(
            &context.db,
            request.owner.organization_id(),
            request.owner.user_id(),
            &request.display_name,
            base_data_type,
            request.data_type.is_multi_select(),
            request.data_type.specific_entity_type(),
            property_options,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                display_name = %request.display_name,
                "failed to create property definition with options in database"
            );
        })?
    };

    tracing::info!(
        property_id = %property.id,
        display_name = %property.display_name,
        data_type = ?property.data_type,
        "successfully created property definition"
    );

    Ok((StatusCode::CREATED, Json(property)))
}
