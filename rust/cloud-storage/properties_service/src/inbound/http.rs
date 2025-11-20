//! HTTP inbound adapters - thin wrappers around domain services

use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use thiserror::Error;

use crate::domain::{
    models::{CreatePropertyRequest, PropertyOwner},
    services::PropertyServiceImpl,
};
use crate::outbound::{PgPermissionChecker, PropertiesPgStorage};
use model::user::UserContext;
use models_properties::api::{CreatePropertyDefinitionRequest, PropertyDataType};

// ===== Error Handling =====

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<crate::domain::error::PropertyError> for HttpError {
    fn from(err: crate::domain::error::PropertyError) -> Self {
        use crate::domain::error::PropertyError;
        match err {
            PropertyError::NotFound(msg) => HttpError::NotFound(msg),
            PropertyError::ValidationError(msg) => HttpError::BadRequest(msg),
            PropertyError::PermissionDenied(msg) => HttpError::PermissionDenied(msg),
            PropertyError::Internal(e) => HttpError::Internal(e.to_string()),
        }
    }
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        let status = match &self {
            HttpError::BadRequest(_) => StatusCode::BAD_REQUEST,
            HttpError::NotFound(_) => StatusCode::NOT_FOUND,
            HttpError::PermissionDenied(_) => StatusCode::FORBIDDEN,
            HttpError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

// ===== Conversion Helpers =====

fn convert_owner_from_api(owner: models_properties::shared::PropertyOwner) -> PropertyOwner {
    owner
}

fn extract_data_type_info(
    data_type: &PropertyDataType,
) -> Result<
    (
        models_properties::shared::DataType,
        bool,
        Option<models_properties::shared::EntityType>,
        Vec<(
            models_properties::service::property_option::PropertyOptionValue,
            i32,
        )>,
    ),
    HttpError,
> {
    use models_properties::service::property_option::PropertyOptionValue;
    use models_properties::shared::DataType;
    use models_properties::shared::EntityType;

    match data_type {
        PropertyDataType::Boolean { .. } => Ok((DataType::Boolean, false, None, vec![])),
        PropertyDataType::Date { .. } => Ok((DataType::Date, false, None, vec![])),
        PropertyDataType::Number { .. } => Ok((DataType::Number, false, None, vec![])),
        PropertyDataType::String { .. } => Ok((DataType::String, false, None, vec![])),
        PropertyDataType::SelectString { multi, options, .. } => {
            let opts = options
                .iter()
                .map(|o| {
                    (
                        PropertyOptionValue::String(o.value.clone()),
                        o.display_order,
                    )
                })
                .collect();
            Ok((DataType::SelectString, *multi, None, opts))
        }
        PropertyDataType::SelectNumber { multi, options, .. } => {
            let opts = options
                .iter()
                .map(|o| (PropertyOptionValue::Number(o.value), o.display_order))
                .collect();
            Ok((DataType::SelectNumber, *multi, None, opts))
        }
        PropertyDataType::Entity {
            multi,
            specific_type,
            ..
        } => {
            let entity_type = specific_type.map(|et| match et {
                models_properties::shared::EntityType::Channel => EntityType::Channel,
                models_properties::shared::EntityType::Chat => EntityType::Chat,
                models_properties::shared::EntityType::Document => EntityType::Document,
                models_properties::shared::EntityType::Project => EntityType::Project,
                models_properties::shared::EntityType::Thread => EntityType::Thread,
                models_properties::shared::EntityType::User => EntityType::User,
            });
            Ok((DataType::Entity, *multi, entity_type, vec![]))
        }
        PropertyDataType::Link { multi, .. } => Ok((DataType::Link, *multi, None, vec![])),
    }
}

// ===== Handlers =====

/// Create a property definition (with or without options)
#[tracing::instrument(skip(service, user_context), fields(user_id = %user_context.user_id))]
pub async fn create_property_definition(
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<CreatePropertyDefinitionRequest>,
) -> Result<StatusCode, HttpError> {
    tracing::info!(
        organization_id = ?request.owner.organization_id(),
        user_id = ?request.owner.user_id(),
        "creating property definition"
    );

    // Validate request
    if let Err(err) = request.validate() {
        tracing::error!(
            error = %err,
            "property definition validation failed"
        );
        return Err(HttpError::BadRequest(err.to_string()));
    }

    let owner: PropertyOwner = convert_owner_from_api(request.owner.clone());
    let (base_data_type, is_multi_select, specific_entity_type, options) =
        extract_data_type_info(&request.data_type)?;

    if options.is_empty() {
        // Create simple property without options
        let domain_request = CreatePropertyRequest {
            owner,
            display_name: request.display_name.clone(),
            data_type: base_data_type,
            is_multi_select,
            specific_entity_type,
        };
        service.create_property(domain_request).await?;
    } else {
        // Create property with options
        let domain_request = crate::domain::models::CreatePropertyWithOptionsRequest {
            owner,
            display_name: request.display_name.clone(),
            data_type: base_data_type,
            is_multi_select,
            specific_entity_type,
            options,
        };
        service.create_property_with_options(domain_request).await?;
    }

    Ok(StatusCode::CREATED)
}
