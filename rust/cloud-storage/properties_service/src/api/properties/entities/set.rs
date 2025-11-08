use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::collections::HashSet;
use thiserror::Error;
use uuid::Uuid;

use crate::api::{context::ApiContext, properties::entities::types::SetEntityPropertyRequest};
use model::user::UserContext;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType, api::SetPropertyValue};
use properties_db_client::{
    entity_properties::upsert as entity_properties_upsert, error::PropertiesDatabaseError,
    property_definitions::get as property_definitions_get,
};

#[derive(Debug, Error)]
pub enum SetEntityPropertyErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Permission error: {0}")]
    Permission(#[from] crate::api::permissions::PermissionError),
    #[error("Property definition not found")]
    PropertyNotFound,
    #[error("{0}")]
    InvalidRequest(String),
    #[error("One or more option IDs do not belong to this property")]
    InvalidPropertyOptions,
}

impl IntoResponse for SetEntityPropertyErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SetEntityPropertyErr::InternalError(_) | SetEntityPropertyErr::DatabaseError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            SetEntityPropertyErr::Permission(e) => e.status_code(),
            SetEntityPropertyErr::PropertyNotFound => StatusCode::NOT_FOUND,
            SetEntityPropertyErr::InvalidRequest(_)
            | SetEntityPropertyErr::InvalidPropertyOptions => StatusCode::BAD_REQUEST,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "SetEntityPropertyErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Set or update a property value for an entity, or attach a property without a value
#[utoipa::path(
    put,
    path = "/properties/entities/{entity_type}/{entity_id}/{property_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID"),
        ("property_id" = Uuid, Path, description = "Property ID")
    ),
    request_body = SetEntityPropertyRequest,
    responses(
        (status = 204, description = "Entity property set successfully (with or without value)"),
        (status = 400, description = "Invalid request or entity type"),
        (status = 404, description = "Entity or property not found"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(context, user_context), fields(entity_id = %entity_id, property_id = %property_uuid, entity_type = ?entity_type, user_id = %user_context.user_id, request = ?request))]
pub async fn set_entity_property(
    Path((entity_type, entity_id, property_uuid)): Path<(EntityType, String, Uuid)>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<SetEntityPropertyRequest>,
) -> Result<StatusCode, SetEntityPropertyErr> {
    tracing::info!("setting entity property");

    let entity_ref = EntityReference {
        entity_id: entity_id.clone(),
        entity_type,
    };
    crate::api::permissions::check_entity_edit_permission(
        &context,
        &user_context.user_id,
        &entity_ref,
    )
    .await?;

    let property_definition =
        property_definitions_get::get_property_definition(&context.db, property_uuid)
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error = ?e,
                    property_id = %property_uuid,
                    "failed to get property definition"
                );
            })?
            .ok_or_else(|| {
                tracing::error!(
                    property_id = %property_uuid,
                    "property definition not found"
                );
                SetEntityPropertyErr::PropertyNotFound
            })?;

    // Determine the value to set (if any) and validate
    let property_value = match &request.value {
        Some(value) => {
            // Validate that the request value is compatible with the property definition
            if let Err(err) = value.validate_compatibility(
                &property_definition.data_type,
                property_definition.is_multi_select,
            ) {
                tracing::error!(
                    property_id = %property_uuid,
                    data_type = ?property_definition.data_type,
                    is_multi_select = property_definition.is_multi_select,
                    value_type = ?value,
                    error = %err,
                    "property value type doesn't match property definition"
                );
                return Err(SetEntityPropertyErr::InvalidRequest(err.to_string()));
            }

            // Convert SetPropertyValue to PropertyValue (JSONB format)
            convert_property_value_to_jsonb(value)
        }
        None => {
            tracing::debug!("no value provided, attaching property without value");
            None
        }
    };

    // Validate property options at service layer (before upserting)
    let option_ids = entity_properties_upsert::extract_option_ids(&property_value);
    if !option_ids.is_empty() {
        entity_properties_upsert::validate_property_options(
            &context.db,
            property_uuid,
            &option_ids,
        )
        .await
        .map_err(|e| {
            // Check if this is a validation error for invalid options
            if matches!(e, PropertiesDatabaseError::InvalidPropertyOptions { .. }) {
                tracing::warn!(
                    error = %e,
                    entity_id = %entity_id,
                    property_id = %property_uuid,
                    "invalid property options provided"
                );
                return SetEntityPropertyErr::InvalidPropertyOptions;
            }
            tracing::error!(
                error = ?e,
                "option validation failed"
            );
            SetEntityPropertyErr::InternalError(anyhow::anyhow!("Option validation failed: {}", e))
        })?;
    }

    let has_value = property_value.is_some();

    tracing::debug!(has_value = has_value, "setting property in database");

    entity_properties_upsert::upsert_entity_property_values(
        &context.db,
        &entity_id,
        entity_type,
        property_uuid,
        property_value,
    )
    .await
    .map_err(|e| {
        // Check if this is a validation error for invalid options
        if matches!(e, PropertiesDatabaseError::InvalidPropertyOptions { .. }) {
            tracing::warn!(
                error = %e,
                entity_id = %entity_id,
                property_id = %property_uuid,
                "invalid property options provided"
            );
            return SetEntityPropertyErr::InvalidPropertyOptions;
        }

        tracing::error!(
            error = ?e,
            entity_id = %entity_id,
            property_id = %property_uuid,
            entity_type = ?entity_type,
            "failed to set entity property"
        );
        SetEntityPropertyErr::InternalError(anyhow::anyhow!(
            "Failed to upsert entity property: {}",
            e
        ))
    })?;

    tracing::info!(
        entity_id = %entity_id,
        property_id = %property_uuid,
        entity_type = ?entity_type,
        has_value = has_value,
        "successfully set entity property"
    );

    Ok(StatusCode::NO_CONTENT)
}

/// Convert SetPropertyValue to PropertyValue for JSONB storage
fn convert_property_value_to_jsonb(value: &SetPropertyValue) -> Option<PropertyValue> {
    Some(match value {
        // Single primitive values
        SetPropertyValue::Boolean { value } => PropertyValue::Bool(*value),
        SetPropertyValue::Date { value } => PropertyValue::Date(*value),
        SetPropertyValue::Number { value } => PropertyValue::Num(*value),
        SetPropertyValue::String { value } => PropertyValue::Str(value.clone()),

        // Single select option
        SetPropertyValue::SelectOption { option_id } => {
            PropertyValue::SelectOption(vec![*option_id])
        }

        // Multi-select options
        SetPropertyValue::MultiSelectOption { option_ids } => {
            let original_count = option_ids.len();
            let unique_ids: HashSet<Uuid> = option_ids.iter().copied().collect();

            if unique_ids.len() < original_count {
                tracing::warn!(
                    original_count = original_count,
                    unique_count = unique_ids.len(),
                    "Duplicate option IDs detected in MultiSelectOption, deduplicating"
                );
            }

            let ids: Vec<Uuid> = unique_ids.into_iter().collect();
            PropertyValue::SelectOption(ids)
        }

        // Single entity reference
        SetPropertyValue::EntityReference { reference } => {
            PropertyValue::EntityRef(vec![EntityReference {
                entity_type: reference.entity_type,
                entity_id: reference.entity_id.clone(),
            }])
        }

        // Multi-entity references
        SetPropertyValue::MultiEntityReference { references } => {
            let original_count = references.len();

            let mut seen_ids: HashSet<String> = HashSet::new();
            let unique_refs: Vec<EntityReference> = references
                .iter()
                .filter(|ref_| seen_ids.insert(ref_.entity_id.clone()))
                .map(|ref_| EntityReference {
                    entity_type: ref_.entity_type,
                    entity_id: ref_.entity_id.clone(),
                })
                .collect();

            if unique_refs.len() < original_count {
                tracing::warn!(
                    original_count = original_count,
                    unique_count = unique_refs.len(),
                    "Duplicate entity references detected in MultiEntityReference, deduplicating by entity_id"
                );
            }

            PropertyValue::EntityRef(unique_refs)
        }

        // Single link
        SetPropertyValue::Link { url } => PropertyValue::Link(vec![url.clone()]),

        // Multi-link
        SetPropertyValue::MultiLink { urls } => {
            let original_count = urls.len();
            let unique_urls: HashSet<String> = urls.iter().cloned().collect();

            if unique_urls.len() < original_count {
                tracing::warn!(
                    original_count = original_count,
                    unique_count = unique_urls.len(),
                    "Duplicate URLs detected in MultiLink, deduplicating"
                );
            }

            let links: Vec<String> = unique_urls.into_iter().collect();
            PropertyValue::Link(links)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
    use std::collections::HashSet;
    use uuid::Uuid;

    /// Helper function to create a test property option
    fn create_test_property_option(
        property_id: Uuid,
        string_value: Option<String>,
        number_value: Option<f64>,
    ) -> PropertyOption {
        let value = match (number_value, string_value) {
            (Some(num), None) => PropertyOptionValue::Number(num),
            (None, Some(str)) => PropertyOptionValue::String(str),
            _ => PropertyOptionValue::String("default".to_string()),
        };

        PropertyOption {
            id: macro_uuid::generate_uuid_v7(),
            property_definition_id: property_id,
            display_order: 1,
            value,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_property_option_ownership_validation() {
        // Test that we can identify which option IDs belong to which properties
        let property_id_1 = macro_uuid::generate_uuid_v7();
        let property_id_2 = macro_uuid::generate_uuid_v7();

        let option_1 =
            create_test_property_option(property_id_1, Some("Option 1".to_string()), None);
        let option_2 =
            create_test_property_option(property_id_1, Some("Option 2".to_string()), None);
        let option_3 =
            create_test_property_option(property_id_2, Some("Option 3".to_string()), None);

        let property_1_options = vec![option_1.clone(), option_2.clone()];
        let valid_option_ids: HashSet<Uuid> = property_1_options.iter().map(|opt| opt.id).collect();

        // Option 1 and 2 should be valid for property 1
        assert!(valid_option_ids.contains(&option_1.id));
        assert!(valid_option_ids.contains(&option_2.id));

        // Option 3 should not be valid for property 1 (belongs to property 2)
        assert!(!valid_option_ids.contains(&option_3.id));
    }

    #[test]
    fn test_option_id_extraction() {
        let option_id_1 = macro_uuid::generate_uuid_v7();
        let option_id_2 = macro_uuid::generate_uuid_v7();

        // Test single option extraction
        let single_option = SetPropertyValue::SelectOption {
            option_id: option_id_1,
        };
        let extracted_single = match single_option {
            SetPropertyValue::SelectOption { option_id } => vec![option_id],
            SetPropertyValue::MultiSelectOption { option_ids } => option_ids,
            _ => vec![],
        };
        assert_eq!(extracted_single, vec![option_id_1]);

        // Test multi option extraction
        let multi_option = SetPropertyValue::MultiSelectOption {
            option_ids: vec![option_id_1, option_id_2],
        };
        let extracted_multi = match multi_option {
            SetPropertyValue::SelectOption { option_id } => vec![option_id],
            SetPropertyValue::MultiSelectOption { option_ids } => option_ids,
            _ => vec![],
        };
        assert_eq!(extracted_multi, vec![option_id_1, option_id_2]);

        // Test non-option value
        let string_value = SetPropertyValue::String {
            value: "test".to_string(),
        };
        let extracted_none = match string_value {
            SetPropertyValue::SelectOption { option_id } => vec![option_id],
            SetPropertyValue::MultiSelectOption { option_ids } => option_ids,
            _ => vec![],
        };
        assert!(extracted_none.is_empty());
    }

    #[test]
    fn test_multi_select_option_deduplication() {
        let option_id_1 = macro_uuid::generate_uuid_v7();
        let option_id_2 = macro_uuid::generate_uuid_v7();
        let option_id_3 = macro_uuid::generate_uuid_v7();

        // Test with duplicate option IDs
        let multi_option_with_dupes = SetPropertyValue::MultiSelectOption {
            option_ids: vec![
                option_id_1,
                option_id_2,
                option_id_1, // Duplicate
                option_id_3,
                option_id_2, // Duplicate
            ],
        };

        let result = convert_property_value_to_jsonb(&multi_option_with_dupes).unwrap();

        // Should have only 3 unique values
        let PropertyValue::SelectOption(option_ids) = result else {
            panic!("Expected SelectOption variant");
        };
        assert_eq!(option_ids.len(), 3);

        // Verify all unique IDs are present
        let result_option_ids: HashSet<Uuid> = option_ids.iter().copied().collect();
        assert!(result_option_ids.contains(&option_id_1));
        assert!(result_option_ids.contains(&option_id_2));
        assert!(result_option_ids.contains(&option_id_3));
        assert_eq!(result_option_ids.len(), 3);
    }

    #[test]
    fn test_multi_select_option_no_duplicates() {
        let option_id_1 = macro_uuid::generate_uuid_v7();
        let option_id_2 = macro_uuid::generate_uuid_v7();

        // Test with no duplicates
        let multi_option = SetPropertyValue::MultiSelectOption {
            option_ids: vec![option_id_1, option_id_2],
        };

        let result = convert_property_value_to_jsonb(&multi_option).unwrap();

        // Should have 2 values
        let PropertyValue::SelectOption(option_ids) = result else {
            panic!("Expected SelectOption variant");
        };
        assert_eq!(option_ids.len(), 2);

        let result_option_ids: HashSet<Uuid> = option_ids.iter().copied().collect();
        assert!(result_option_ids.contains(&option_id_1));
        assert!(result_option_ids.contains(&option_id_2));
    }

    #[test]
    fn test_multi_entity_reference_deduplication() {
        use models_properties::EntityReference;

        let entity_ref_1 = EntityReference {
            entity_type: EntityType::Document,
            entity_id: "doc-1".to_string(),
        };
        let entity_ref_2 = EntityReference {
            entity_type: EntityType::User,
            entity_id: "user-1".to_string(),
        };
        let entity_ref_1_dup = EntityReference {
            entity_type: EntityType::Document,
            entity_id: "doc-1".to_string(), // Same as entity_ref_1
        };

        // Test with duplicate entity references
        let multi_entity_ref_with_dupes = SetPropertyValue::MultiEntityReference {
            references: vec![
                entity_ref_1.clone(),
                entity_ref_2.clone(),
                entity_ref_1_dup, // Duplicate
            ],
        };

        let result = convert_property_value_to_jsonb(&multi_entity_ref_with_dupes).unwrap();

        // Should have only 2 unique values (duplicates removed)
        let PropertyValue::EntityRef(entity_refs) = result else {
            panic!("Expected EntityRef variant");
        };
        assert_eq!(entity_refs.len(), 2);

        // Verify the unique combinations are present
        let has_doc_1 = entity_refs
            .iter()
            .any(|r| r.entity_type == EntityType::Document && r.entity_id == "doc-1");
        let has_user_1 = entity_refs
            .iter()
            .any(|r| r.entity_type == EntityType::User && r.entity_id == "user-1");

        assert!(has_doc_1);
        assert!(has_user_1);
    }

    #[test]
    fn test_multi_entity_reference_different_types_same_id() {
        use models_properties::EntityReference;

        // Test that same ID with different entity types ARE considered duplicates
        // (deduplicating by entity_id only, keeping first occurrence)
        let entity_ref_1 = EntityReference {
            entity_type: EntityType::Document,
            entity_id: "123".to_string(),
        };
        let entity_ref_2 = EntityReference {
            entity_type: EntityType::User,
            entity_id: "123".to_string(), // Same ID but different type
        };

        let multi_entity_ref = SetPropertyValue::MultiEntityReference {
            references: vec![entity_ref_1, entity_ref_2],
        };

        let result = convert_property_value_to_jsonb(&multi_entity_ref).unwrap();

        // Should have 1 value (considered duplicates, keeps first occurrence)
        let PropertyValue::EntityRef(entity_refs) = result else {
            panic!("Expected EntityRef variant");
        };
        assert_eq!(entity_refs.len(), 1);
        // Should keep the Document type (first occurrence)
        assert_eq!(entity_refs[0].entity_type, EntityType::Document);
        assert_eq!(entity_refs[0].entity_id, "123");
    }
}
