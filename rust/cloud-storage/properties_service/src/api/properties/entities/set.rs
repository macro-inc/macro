use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::{
    context::PropertiesHandlerState, properties::entities::types::SetEntityPropertyRequest,
};
use model::user::UserContext;
use models_properties::EntityType;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum SetEntityPropertyErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for SetEntityPropertyErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SetEntityPropertyErr::Properties(e) => match e {
                PropertiesErr::Validation(_) => StatusCode::BAD_REQUEST,
                PropertiesErr::PermissionDenied => StatusCode::FORBIDDEN,
                PropertiesErr::Repo(_) | PropertiesErr::PermissionServiceNotConfigured => {
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            },
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
#[tracing::instrument(skip(state, user_context), fields(entity_id = %entity_id, property_id = %property_uuid, entity_type = ?entity_type, user_id = %user_context.user_id, request = ?request), err)]
pub async fn set_entity_property(
    Path((entity_type, entity_id, property_uuid)): Path<(EntityType, String, Uuid)>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<SetEntityPropertyRequest>,
) -> Result<StatusCode, SetEntityPropertyErr> {
    tracing::info!("setting entity property");

    state
        .properties_service
        .set_entity_property(
            &user_context.user_id,
            &entity_id,
            entity_type,
            property_uuid,
            request.value,
        )
        .await?;

    tracing::info!("successfully set entity property");

    Ok(StatusCode::NO_CONTENT)
}
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use models_properties::api::SetPropertyValue;
    use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
    use models_properties::service::property_value::PropertyValue;
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

        let result = Some(
            models_properties::convert_set_property_value_to_property_value(
                &multi_option_with_dupes,
            ),
        );

        // Should have only 3 unique values
        let Some(PropertyValue::SelectOption(option_ids)) = result else {
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

        let result =
            Some(models_properties::convert_set_property_value_to_property_value(&multi_option));

        // Should have 2 values
        let Some(PropertyValue::SelectOption(option_ids)) = result else {
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

        let entity_ref_1 = EntityReference::new("doc-1", EntityType::Document);
        let entity_ref_2 = EntityReference::new("user-1", EntityType::User);
        let entity_ref_1_dup = EntityReference::new("doc-1", EntityType::Document); // Same as entity_ref_1

        // Test with duplicate entity references
        let multi_entity_ref_with_dupes = SetPropertyValue::MultiEntityReference {
            references: vec![
                entity_ref_1.clone(),
                entity_ref_2.clone(),
                entity_ref_1_dup, // Duplicate
            ],
        };

        let result = Some(
            models_properties::convert_set_property_value_to_property_value(
                &multi_entity_ref_with_dupes,
            ),
        );

        // Should have only 2 unique values (duplicates removed)
        let Some(PropertyValue::EntityRef(entity_refs)) = result else {
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
        let entity_ref_1 = EntityReference::new("123", EntityType::Document);
        let entity_ref_2 = EntityReference::new("123", EntityType::User); // Same ID but different type

        let multi_entity_ref = SetPropertyValue::MultiEntityReference {
            references: vec![entity_ref_1, entity_ref_2],
        };

        let result = Some(
            models_properties::convert_set_property_value_to_property_value(&multi_entity_ref),
        );

        // Should have 1 value (considered duplicates, keeps first occurrence)
        let Some(PropertyValue::EntityRef(entity_refs)) = result else {
            panic!("Expected EntityRef variant");
        };
        assert_eq!(entity_refs.len(), 1);
        // Should keep the Document type (first occurrence)
        assert_eq!(entity_refs[0].entity_type, EntityType::Document);
        assert_eq!(entity_refs[0].entity_id, "123");
    }
}
