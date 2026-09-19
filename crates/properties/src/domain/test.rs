//! Unit tests for PropertiesServiceImpl using mockall-generated repo.

use super::service_impl::PropertiesServiceImpl;
use crate::domain::error::PropertiesErr;
use crate::domain::model::{
    EditReceipt, EntityPropertyMutationSnapshot, GetOrCreateTagDefinitionResult,
    PropertyAccessReceiptExt, TagScope, UpdatePropertyOptionOutcome, ViewReceipt,
    canonical_entity_type,
};
use crate::domain::{
    ports::{MockNotificationService, MockPermissionService, MockPropertiesRepo},
    service::PropertiesService,
};
use anyhow::anyhow;
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{
    AccessLevel, BotId, BotReceiptScope, Entity, EntityAccessAuth, EntityAccessReceipt,
    EntityPermission, EntityType as AccessEntityType, ViewAccessLevel,
};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_properties::{
    DataType, EntityType, PropertyOwner,
    api::{
        AddNumberOptionRequest, AddPropertyOptionRequest, AddStringOptionRequest,
        CreatePropertyDefinitionRequest, CreatePropertyScope, PropertyDataType,
        UpdatePropertyOptionRequest,
    },
    service::{
        entity_property::EntityProperty,
        property_definition::PropertyDefinition,
        property_option::{PropertyOption, PropertyOptionValue},
        property_value::PropertyValue,
    },
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

fn entity_property(
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
) -> EntityProperty {
    EntityProperty {
        id: Uuid::new_v4(),
        entity_id: entity_id.to_owned(),
        entity_type,
        property_definition_id,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

fn entity_property_for_event(
    id: Uuid,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    updated_at: chrono::DateTime<chrono::Utc>,
) -> EntityProperty {
    EntityProperty {
        id,
        entity_id: entity_id.to_owned(),
        entity_type,
        property_definition_id,
        created_at: updated_at,
        updated_at,
    }
}

fn entity_property_mutation(
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    value: Option<PropertyValue>,
) -> EntityPropertyMutationSnapshot {
    EntityPropertyMutationSnapshot {
        property: entity_property(entity_id, entity_type, property_definition_id),
        value,
        previous_value: None,
    }
}

fn entity_property_option_selection_for_event(
    entity_property_id: Uuid,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    option_ids: Vec<Uuid>,
) -> crate::domain::model::EntityPropertyOptionSelection {
    crate::domain::model::EntityPropertyOptionSelection {
        property_definition_id,
        option_ids: option_ids.clone(),
        mutation: Some(EntityPropertyMutationSnapshot {
            property: entity_property_for_event(
                entity_property_id,
                entity_id,
                entity_type,
                property_definition_id,
                event_timestamp(),
            ),
            value: Some(PropertyValue::SelectOption(option_ids)),
            previous_value: None,
        }),
    }
}

fn event_timestamp() -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339("2026-07-27T18:45:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc)
}

fn caller_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

#[derive(Clone, Debug, PartialEq)]
struct PublishedPropertyEvent {
    topic: &'static str,
    key: String,
    envelope: serde_json::Value,
}

#[derive(Clone, Default)]
struct RecordingEventBroker {
    events: Arc<Mutex<Vec<PublishedPropertyEvent>>>,
    fail_scheduling: bool,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            fail_scheduling: true,
            ..Self::default()
        }
    }

    fn events(&self) -> Vec<PublishedPropertyEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        if self.fail_scheduling {
            return Err(EventBrokerError::Publish(
                "intentional scheduling failure".to_string(),
            ));
        }

        self.events.lock().unwrap().push(PublishedPropertyEvent {
            topic: event.topic(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn service_with_event_broker<B: MacroEventBroker>(
    repo: MockPropertiesRepo,
    event_broker: B,
) -> PropertiesServiceImpl<MockPropertiesRepo, MockPermissionService, MockNotificationService, B> {
    PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    )
    .with_event_broker(event_broker)
}

fn property_definition_for_event(
    id: Uuid,
    display_name: &str,
    data_type: DataType,
    is_multi_select: bool,
) -> PropertyDefinition {
    let created_at = chrono::DateTime::parse_from_rfc3339("2026-07-27T12:34:56Z")
        .unwrap()
        .with_timezone(&chrono::Utc);

    PropertyDefinition {
        id,
        owner: PropertyOwner::User {
            user_id: caller_user_id().to_string(),
        },
        display_name: display_name.to_string(),
        data_type,
        is_multi_select,
        specific_entity_type: None,
        created_at,
        updated_at: created_at,
        is_system: false,
        is_metadata: false,
    }
}

fn create_property_definition_request() -> CreatePropertyDefinitionRequest {
    CreatePropertyDefinitionRequest {
        scope: CreatePropertyScope::User,
        display_name: "Priority".to_string(),
        data_type: PropertyDataType::Entity {
            specific_type: Some(EntityType::Document),
            multi: true,
        },
    }
}

fn property_option_for_event(
    id: Uuid,
    property_definition_id: Uuid,
    display_order: i32,
    value: PropertyOptionValue,
    color: Option<&str>,
) -> PropertyOption {
    let created_at = chrono::DateTime::parse_from_rfc3339("2026-07-27T12:34:56Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let updated_at = chrono::DateTime::parse_from_rfc3339("2026-07-27T13:45:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);

    PropertyOption {
        id,
        property_definition_id,
        display_order,
        value,
        color: color.map(str::to_string),
        created_at,
        updated_at,
    }
}

fn expect_owned_modifiable_definition(
    repo: &mut MockPropertiesRepo,
    definition: PropertyDefinition,
) {
    let authorized_definition = definition.clone();
    repo.expect_get_property_definition()
        .return_once(move |_| Box::pin(async move { Ok(Some(definition)) }));
    repo.expect_get_property_definition_with_owner()
        .return_once(move |_, _, _| Box::pin(async move { Ok(Some(authorized_definition)) }));
}

fn only_published_property_event(event_broker: &RecordingEventBroker) -> PublishedPropertyEvent {
    let events = event_broker.events();
    assert_eq!(events.len(), 1);
    events.into_iter().next().unwrap()
}

#[tokio::test]
async fn property_definition_event_create_publishes_authoritative_snapshot() {
    let property_definition_id = Uuid::from_u128(0xA1);
    let mut property =
        property_definition_for_event(property_definition_id, "Priority", DataType::Entity, true);
    property.specific_entity_type = Some(EntityType::Document);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_create_property_definition()
        .return_once(move |_, _, _, _, _, _| Box::pin(async move { Ok(property) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .create_property_definition(
            &caller_user_id(),
            None,
            &create_property_definition_request(),
        )
        .await
        .unwrap();

    assert_eq!(result.id, property_definition_id);
    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["schema_version"], 1);
    assert_eq!(published.envelope["event_type"], "property.created");
    assert_eq!(
        published.envelope["metadata"]["property_definition_id"],
        property_definition_id.to_string()
    );
    assert_eq!(
        published.envelope["metadata"]["actor_user_id"],
        caller_user_id().to_string()
    );
    assert_eq!(
        published.envelope["metadata"]["owner"],
        serde_json::json!({
            "scope": "user",
            "user_id": caller_user_id().to_string(),
        })
    );
    assert_eq!(published.envelope["metadata"]["display_name"], "Priority");
    assert_eq!(published.envelope["metadata"]["data_type"], "ENTITY");
    assert_eq!(published.envelope["metadata"]["is_multi_select"], true);
    assert_eq!(
        published.envelope["metadata"]["specific_entity_type"],
        "DOCUMENT"
    );
    assert_eq!(
        published.envelope["metadata"]["created_at"],
        "2026-07-27T12:34:56Z"
    );
}

#[tokio::test]
async fn property_definition_event_ensure_tag_set_publishes_only_when_created() {
    let property_definition_id = Uuid::from_u128(0xA2);
    let property =
        property_definition_for_event(property_definition_id, "Tags", DataType::Tag, true);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_or_create_tag_definition()
        .return_once(move |_| {
            Box::pin(async move {
                Ok(GetOrCreateTagDefinitionResult {
                    definition: property,
                    created: true,
                })
            })
        });
    repo.expect_get_property_options()
        .return_once(|_| Box::pin(async { Ok(Vec::new()) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let tag_set = service
        .ensure_tag_set(&caller_user_id(), None, TagScope::User)
        .await
        .unwrap();

    assert_eq!(tag_set.definition.unwrap().id, property_definition_id);
    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["event_type"], "property.created");
    assert_eq!(published.envelope["metadata"]["data_type"], "TAG");
    assert_eq!(
        published.envelope["metadata"]["actor_user_id"],
        caller_user_id().to_string()
    );
}

#[tokio::test]
async fn property_definition_event_existing_tag_set_publishes_nothing() {
    let property =
        property_definition_for_event(Uuid::from_u128(0xA3), "Tags", DataType::Tag, true);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_or_create_tag_definition()
        .return_once(move |_| {
            Box::pin(async move {
                Ok(GetOrCreateTagDefinitionResult {
                    definition: property,
                    created: false,
                })
            })
        });
    repo.expect_get_property_options()
        .return_once(|_| Box::pin(async { Ok(Vec::new()) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .ensure_tag_set(&caller_user_id(), None, TagScope::User)
        .await
        .unwrap();

    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_definition_event_delete_publishes_pre_delete_snapshot() {
    let property_definition_id = Uuid::from_u128(0xA4);
    let property = property_definition_for_event(
        property_definition_id,
        "Archived priority",
        DataType::SelectString,
        false,
    );
    let authorized_property = property.clone();

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .return_once(move |_| Box::pin(async move { Ok(Some(property)) }));
    repo.expect_get_property_definition_with_owner()
        .return_once(move |_, _, _| Box::pin(async move { Ok(Some(authorized_property)) }));
    repo.expect_delete_property_definition()
        .return_once(|_| Box::pin(async { Ok(()) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .delete_property_definition(property_definition_id, &caller_user_id(), None)
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["event_type"], "property.deleted");
    assert_eq!(
        published.envelope["metadata"]["actor_user_id"],
        caller_user_id().to_string()
    );
    assert_eq!(
        published.envelope["metadata"]["owner"],
        serde_json::json!({
            "scope": "user",
            "user_id": caller_user_id().to_string(),
        })
    );
    assert_eq!(
        published.envelope["metadata"]["display_name"],
        "Archived priority"
    );
    assert_eq!(published.envelope["metadata"]["data_type"], "SELECT_STRING");
}

#[tokio::test]
async fn property_definition_event_create_repository_failure_publishes_nothing() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_create_property_definition()
        .return_once(|_, _, _, _, _, _| {
            Box::pin(async { Err(anyhow!("property definition create failed")) })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .create_property_definition(
            &caller_user_id(),
            None,
            &create_property_definition_request(),
        )
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_definition_event_ensure_tag_set_repository_failure_publishes_nothing() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_or_create_tag_definition()
        .return_once(|_| Box::pin(async { Err(anyhow!("tag set create failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .ensure_tag_set(&caller_user_id(), None, TagScope::User)
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_definition_event_delete_repository_failure_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xA5);
    let property =
        property_definition_for_event(property_definition_id, "Priority", DataType::String, false);
    let authorized_property = property.clone();

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .return_once(move |_| Box::pin(async move { Ok(Some(property)) }));
    repo.expect_get_property_definition_with_owner()
        .return_once(move |_, _, _| Box::pin(async move { Ok(Some(authorized_property)) }));
    repo.expect_delete_property_definition()
        .return_once(|_| Box::pin(async { Err(anyhow!("property definition delete failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .delete_property_definition(property_definition_id, &caller_user_id(), None)
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_definition_event_broker_scheduling_failure_is_non_fatal() {
    let property_definition_id = Uuid::from_u128(0xA6);
    let property =
        property_definition_for_event(property_definition_id, "Priority", DataType::Entity, true);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_create_property_definition()
        .return_once(move |_, _, _, _, _, _| Box::pin(async move { Ok(property) }));
    let service = service_with_event_broker(repo, RecordingEventBroker::failing());

    let result = service
        .create_property_definition(
            &caller_user_id(),
            None,
            &create_property_definition_request(),
        )
        .await
        .unwrap();

    assert_eq!(result.id, property_definition_id);
}

#[tokio::test]
async fn property_option_event_add_string_publishes_full_returned_state_and_exact_key() {
    let property_definition_id = Uuid::from_u128(0xB1);
    let option_id = Uuid::from_u128(0xB2);
    let definition =
        property_definition_for_event(property_definition_id, "Tags", DataType::Tag, true);
    let option = property_option_for_event(
        option_id,
        property_definition_id,
        7,
        PropertyOptionValue::String("Persisted tag".to_string()),
        Some("#ABCDEF"),
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_create_property_option()
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(option) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let request = AddPropertyOptionRequest::SelectString {
        option: AddStringOptionRequest {
            display_order: 3,
            value: "Requested tag".to_string(),
            color: Some("#123456".to_string()),
        },
    };

    let created = service
        .add_property_option(&caller_user_id(), None, property_definition_id, &request)
        .await
        .unwrap();

    assert_eq!(created.id, option_id);
    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["event_type"], "property_option.created");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "option_id": option_id,
            "property_definition_id": property_definition_id,
            "actor_user_id": caller_user_id().to_string(),
            "value": { "type": "string", "value": "Persisted tag" },
            "color": "#ABCDEF",
            "display_order": 7,
        })
    );
}

#[tokio::test]
async fn property_option_event_add_number_publishes_number_payload() {
    let property_definition_id = Uuid::from_u128(0xB3);
    let option_id = Uuid::from_u128(0xB4);
    let definition = property_definition_for_event(
        property_definition_id,
        "Estimate",
        DataType::SelectNumber,
        false,
    );
    let option = property_option_for_event(
        option_id,
        property_definition_id,
        4,
        PropertyOptionValue::Number(13.5),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_create_property_option()
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(option) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let request = AddPropertyOptionRequest::SelectNumber {
        option: AddNumberOptionRequest {
            display_order: 4,
            value: 13.5,
        },
    };

    service
        .add_property_option(&caller_user_id(), None, property_definition_id, &request)
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["event_type"], "property_option.created");
    assert_eq!(
        published.envelope["metadata"]["value"],
        serde_json::json!({ "type": "number", "value": 13.5 })
    );
    assert_eq!(
        published.envelope["metadata"]["color"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn property_option_event_add_repository_failure_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xB5);
    let definition = property_definition_for_event(
        property_definition_id,
        "Estimate",
        DataType::SelectNumber,
        false,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_create_property_option()
        .return_once(|_, _, _, _| Box::pin(async { Err(anyhow!("option create failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let request = AddPropertyOptionRequest::SelectNumber {
        option: AddNumberOptionRequest {
            display_order: 0,
            value: 1.0,
        },
    };

    let result = service
        .add_property_option(&caller_user_id(), None, property_definition_id, &request)
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_update_publishes_full_post_update_state_and_exact_key() {
    let property_definition_id = Uuid::from_u128(0xB6);
    let option_id = Uuid::from_u128(0xB7);
    let definition =
        property_definition_for_event(property_definition_id, "Tags", DataType::Tag, true);
    let existing = property_option_for_event(
        option_id,
        property_definition_id,
        1,
        PropertyOptionValue::String("Before".to_string()),
        Some("#111111"),
    );
    let updated = property_option_for_event(
        option_id,
        property_definition_id,
        9,
        PropertyOptionValue::String("Persisted after".to_string()),
        Some("#FEDCBA"),
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(existing)) }));
    repo.expect_update_property_option()
        .return_once(move |_, _, _, _| {
            Box::pin(async move { Ok(UpdatePropertyOptionOutcome::Updated(updated)) })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let request = UpdatePropertyOptionRequest {
        value: Some("Requested after".to_string()),
        color: Some("#123456".to_string()),
        display_order: Some(8),
    };

    let result = service
        .update_property_option(
            &caller_user_id(),
            None,
            property_definition_id,
            option_id,
            &request,
        )
        .await
        .unwrap();

    assert_eq!(result.display_order, 9);
    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["event_type"], "property_option.updated");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "option_id": option_id,
            "property_definition_id": property_definition_id,
            "actor_user_id": caller_user_id().to_string(),
            "value": { "type": "string", "value": "Persisted after" },
            "color": "#FEDCBA",
            "display_order": 9,
        })
    );
}

#[tokio::test]
async fn property_option_event_update_not_found_outcome_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xB8);
    let option_id = Uuid::from_u128(0xB9);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );
    let existing = property_option_for_event(
        option_id,
        property_definition_id,
        0,
        PropertyOptionValue::String("Before".to_string()),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(existing)) }));
    repo.expect_update_property_option()
        .return_once(|_, _, _, _| Box::pin(async { Ok(UpdatePropertyOptionOutcome::NotFound) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .update_property_option(
            &caller_user_id(),
            None,
            property_definition_id,
            option_id,
            &empty_update_property_option_request(),
        )
        .await;

    assert!(matches!(result, Err(PropertiesErr::OptionNotFound)));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_update_duplicate_value_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xBA);
    let option_id = Uuid::from_u128(0xBB);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );
    let existing = property_option_for_event(
        option_id,
        property_definition_id,
        0,
        PropertyOptionValue::String("Before".to_string()),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(existing)) }));
    repo.expect_update_property_option()
        .return_once(|_, _, _, _| {
            Box::pin(async { Ok(UpdatePropertyOptionOutcome::DuplicateValue) })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let request = UpdatePropertyOptionRequest {
        value: Some("Duplicate".to_string()),
        color: None,
        display_order: None,
    };

    let result = service
        .update_property_option(
            &caller_user_id(),
            None,
            property_definition_id,
            option_id,
            &request,
        )
        .await;

    assert!(matches!(result, Err(PropertiesErr::DuplicateOptionValue)));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_update_repository_error_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xBC);
    let option_id = Uuid::from_u128(0xBD);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );
    let existing = property_option_for_event(
        option_id,
        property_definition_id,
        0,
        PropertyOptionValue::String("Before".to_string()),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(existing)) }));
    repo.expect_update_property_option()
        .return_once(|_, _, _, _| Box::pin(async { Err(anyhow!("option update failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .update_property_option(
            &caller_user_id(),
            None,
            property_definition_id,
            option_id,
            &empty_update_property_option_request(),
        )
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_update_missing_option_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xBE);
    let option_id = Uuid::from_u128(0xBF);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(|_| Box::pin(async { Ok(None) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .update_property_option(
            &caller_user_id(),
            None,
            property_definition_id,
            option_id,
            &empty_update_property_option_request(),
        )
        .await;

    assert!(matches!(result, Err(PropertiesErr::OptionNotFound)));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_update_mismatched_option_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xC0);
    let option_id = Uuid::from_u128(0xC1);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );
    let mismatched = property_option_for_event(
        option_id,
        Uuid::from_u128(0xC2),
        0,
        PropertyOptionValue::String("Other property".to_string()),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(mismatched)) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .update_property_option(
            &caller_user_id(),
            None,
            property_definition_id,
            option_id,
            &empty_update_property_option_request(),
        )
        .await;

    assert!(matches!(result, Err(PropertiesErr::OptionNotFound)));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_delete_publishes_one_pre_delete_snapshot_with_exact_key() {
    let property_definition_id = Uuid::from_u128(0xC3);
    let option_id = Uuid::from_u128(0xC4);
    let definition = property_definition_for_event(
        property_definition_id,
        "Estimate",
        DataType::SelectNumber,
        false,
    );
    let option = property_option_for_event(
        option_id,
        property_definition_id,
        2,
        PropertyOptionValue::Number(21.5),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(option)) }));
    repo.expect_delete_property_option()
        .return_once(|_, _| Box::pin(async { Ok(true) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .delete_property_option(&caller_user_id(), None, property_definition_id, option_id)
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, property_definition_id.to_string());
    assert_eq!(published.envelope["event_type"], "property_option.deleted");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "option_id": option_id,
            "property_definition_id": property_definition_id,
            "actor_user_id": caller_user_id().to_string(),
            "value": { "type": "number", "value": 21.5 },
        })
    );
}

#[tokio::test]
async fn property_option_event_delete_not_found_outcome_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xC5);
    let option_id = Uuid::from_u128(0xC6);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );
    let option = property_option_for_event(
        option_id,
        property_definition_id,
        0,
        PropertyOptionValue::String("Gone".to_string()),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(option)) }));
    repo.expect_delete_property_option()
        .return_once(|_, _| Box::pin(async { Ok(false) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .delete_property_option(&caller_user_id(), None, property_definition_id, option_id)
        .await;

    assert!(matches!(result, Err(PropertiesErr::OptionNotFound)));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn property_option_event_delete_repository_error_publishes_nothing() {
    let property_definition_id = Uuid::from_u128(0xC7);
    let option_id = Uuid::from_u128(0xC8);
    let definition = property_definition_for_event(
        property_definition_id,
        "Priority",
        DataType::SelectString,
        false,
    );
    let option = property_option_for_event(
        option_id,
        property_definition_id,
        0,
        PropertyOptionValue::String("Still present".to_string()),
        None,
    );

    let mut repo = MockPropertiesRepo::new();
    expect_owned_modifiable_definition(&mut repo, definition);
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(option)) }));
    repo.expect_delete_property_option()
        .return_once(|_, _| Box::pin(async { Err(anyhow!("option delete failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .delete_property_option(&caller_user_id(), None, property_definition_id, option_id)
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

fn empty_update_property_option_request() -> UpdatePropertyOptionRequest {
    UpdatePropertyOptionRequest {
        value: None,
        color: None,
        display_order: None,
    }
}

/// An edit receipt for the test caller, minted without an access check.
fn edit_receipt(entity_id: &str, entity_type: EntityType) -> EditReceipt {
    EditReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        entity_id,
        canonical_entity_type(entity_type),
    )
}

fn edit_receipt_for_user(user_id: &str, entity_id: &str, entity_type: EntityType) -> EditReceipt {
    EditReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(user_id)
            .unwrap()
            .into_owned(),
        entity_id,
        canonical_entity_type(entity_type),
    )
}

/// A view receipt for the test caller, minted without an access check.
fn view_receipt(entity_id: &str, entity_type: EntityType) -> ViewReceipt {
    ViewReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        entity_id,
        canonical_entity_type(entity_type),
    )
}

#[tokio::test]
async fn entity_property_event_set_publishes_null_authoritative_snapshot() {
    let property_definition_id = Uuid::from_u128(0xE701);
    let entity_property_id = Uuid::from_u128(0xE702);
    let updated_at = event_timestamp();
    let assignment = entity_property_for_event(
        entity_property_id,
        "doc1",
        EntityType::Document,
        property_definition_id,
        updated_at,
    );

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(property_definition_id, false))) })
    });
    repo.expect_upsert_entity_property()
        .withf(move |entity_id, entity_type, definition_id, value| {
            entity_id == "doc1"
                && *entity_type == EntityType::Document
                && *definition_id == property_definition_id
                && value.is_none()
        })
        .return_once(move |_, _, _, _| {
            Box::pin(async move {
                Ok(EntityPropertyMutationSnapshot {
                    property: assignment,
                    value: None,
                    previous_value: None,
                })
            })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .set_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            property_definition_id,
            None,
        )
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.topic, "macro.properties");
    assert_eq!(published.key, "doc1");
    assert_eq!(published.envelope["event_type"], "entity_property.updated");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "entity_property_id": entity_property_id,
            "entity_id": "doc1",
            "entity_type": "DOCUMENT",
            "property_definition_id": property_definition_id,
            "actor_user_id": caller_user_id(),
            "previous_value": null,
            "value": null,
            "updated_at": updated_at,
        })
    );
}

#[tokio::test]
async fn entity_property_event_set_failures_do_not_publish_before_commit() {
    let property_definition_id = Uuid::from_u128(0xE703);

    let mut validation_repo = MockPropertiesRepo::new();
    validation_repo
        .expect_get_property_definition()
        .return_once(|_| Box::pin(async { Ok(None) }));
    validation_repo.expect_upsert_entity_property().times(0);
    let validation_broker = RecordingEventBroker::default();
    let validation_service = service_with_event_broker(validation_repo, validation_broker.clone());

    let validation_result = validation_service
        .set_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            property_definition_id,
            None,
        )
        .await;

    assert!(matches!(
        validation_result,
        Err(PropertiesErr::Validation(_))
    ));
    assert!(validation_broker.events().is_empty());

    let mut repository_failure_repo = MockPropertiesRepo::new();
    repository_failure_repo
        .expect_get_property_definition()
        .return_once(move |_| {
            Box::pin(
                async move { Ok(Some(multi_select_definition(property_definition_id, false))) },
            )
        });
    repository_failure_repo
        .expect_upsert_entity_property()
        .return_once(|_, _, _, _| Box::pin(async { Err(anyhow!("upsert failed")) }));
    let repository_failure_broker = RecordingEventBroker::default();
    let repository_failure_service =
        service_with_event_broker(repository_failure_repo, repository_failure_broker.clone());

    let repository_result = repository_failure_service
        .set_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            property_definition_id,
            None,
        )
        .await;

    assert!(repository_result.is_err());
    assert!(repository_failure_broker.events().is_empty());
}

#[tokio::test]
async fn entity_property_event_actor_is_only_an_authenticated_user() {
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"));
    let bot_access = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        BotReceiptScope::Team {
            team_id: Uuid::new_v4(),
        },
        "doc1",
        AccessEntityType::Document,
    );
    let unauthenticated_access = EditReceipt::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: "doc1".to_string(),
            entity_type: AccessEntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    let internal_access =
        EditReceipt::dangerously_assert_internal_user("doc1", AccessEntityType::Document);

    for access in [bot_access, unauthenticated_access, internal_access] {
        let property_definition_id = Uuid::from_u128(0xE704);
        let assignment = entity_property_for_event(
            Uuid::from_u128(0xE705),
            "doc1",
            EntityType::Document,
            property_definition_id,
            event_timestamp(),
        );
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_property_definition().return_once(move |_| {
            Box::pin(
                async move { Ok(Some(multi_select_definition(property_definition_id, false))) },
            )
        });
        repo.expect_upsert_entity_property()
            .return_once(move |_, _, _, _| {
                Box::pin(async move {
                    Ok(EntityPropertyMutationSnapshot {
                        property: assignment,
                        value: None,
                        previous_value: None,
                    })
                })
            });
        let event_broker = RecordingEventBroker::default();
        let service = service_with_event_broker(repo, event_broker.clone());

        service
            .set_entity_property(&access, property_definition_id, None)
            .await
            .unwrap();

        let published = only_published_property_event(&event_broker);
        assert_eq!(
            published.envelope["metadata"]["actor_user_id"],
            serde_json::Value::Null
        );
        assert!(published.envelope["metadata"]["actor"].is_null());
        assert!(published.envelope["metadata"]["on_behalf_of"].is_null());
    }
}

#[tokio::test]
async fn entity_property_event_delegates_user_scoped_bot_writes() {
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000005759"));
    let bot_access = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        BotReceiptScope::User {
            acting_user: caller_user_id(),
        },
        "doc1",
        AccessEntityType::Document,
    );
    let property_definition_id = Uuid::from_u128(0xE706);
    let assignment = entity_property_for_event(
        Uuid::from_u128(0xE707),
        "doc1",
        EntityType::Document,
        property_definition_id,
        event_timestamp(),
    );
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(property_definition_id, false))) })
    });
    repo.expect_upsert_entity_property()
        .return_once(move |_, _, _, _| {
            Box::pin(async move {
                Ok(EntityPropertyMutationSnapshot {
                    property: assignment,
                    value: None,
                    previous_value: None,
                })
            })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .set_entity_property(&bot_access, property_definition_id, None)
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(
        published.envelope["metadata"]["actor_user_id"],
        serde_json::Value::Null
    );
    assert_eq!(
        published.envelope["metadata"]["actor"],
        "bot|00000000-0000-0000-0000-000000005759"
    );
    assert_eq!(
        published.envelope["metadata"]["on_behalf_of"],
        caller_user_id().as_ref()
    );
}

#[test]
fn bot_receipt_has_no_authenticated_user_identity() {
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"));
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_bot(
        bot_id.into_storage_id(),
        BotReceiptScope::Team {
            team_id: Uuid::new_v4(),
        },
        "document-1",
        entity_access::domain::models::EntityType::Document,
    );
    let access = receipt;

    assert!(access.authenticated_user().is_none());
    assert!(matches!(access.auth(), EntityAccessAuth::Bot(id) if id.bot_id() == bot_id));
}

/// Creates a mock permission service that mints edit receipts for any entity.
fn create_mock_permission_service() -> MockPermissionService {
    let mut perm_checker = MockPermissionService::new();
    perm_checker
        .expect_mint_edit_receipt()
        .returning(|_, entity_id, entity_type| {
            let receipt = EditReceipt::dangerously_assert_authenticated_user(
                caller_user_id(),
                entity_id,
                entity_type,
            );
            Box::pin(async move { Ok(receipt) })
        });
    perm_checker
}

#[tokio::test]
async fn test_set_status_complete_through_general_property_mutation() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::STATUS_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Status".to_string(),
                data_type: models_properties::DataType::SelectString,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_count_valid_property_options()
        .withf(|property_id, option_ids| {
            *property_id == SystemPropertyKey::STATUS_UUID
                && option_ids == [StatusOption::COMPLETED_UUID]
        })
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_upsert_entity_property()
        .withf(|entity_id, entity_type, property_id, value| {
            entity_id == "e1"
                && *entity_type == EntityType::Document
                && *property_id == SystemPropertyKey::STATUS_UUID
                && *value
                    == Some(PropertyValue::SelectOption(vec![
                        StatusOption::COMPLETED_UUID,
                    ]))
        })
        .returning(|entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move {
                Ok(EntityPropertyMutationSnapshot {
                    property,
                    value: None,
                    previous_value: None,
                })
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let property = service
        .set_entity_property(
            &edit_receipt("e1", EntityType::Document),
            SystemPropertyKey::STATUS_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::SelectOption {
                    option_id: StatusOption::COMPLETED_UUID,
                },
            ),
        )
        .await
        .unwrap();

    assert_eq!(property.property.entity_id, "e1");
    assert_eq!(
        property.property.property_definition_id,
        SystemPropertyKey::STATUS_UUID
    );
    assert_eq!(
        property.value,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID
        ]))
    );
}

// ============================================================================
// task relationship (Parent Task / Subtasks) unit tests
// ============================================================================

fn parent_task_value(parent_id: Uuid) -> models_properties::api::requests::SetPropertyValue {
    models_properties::api::requests::SetPropertyValue::EntityReference {
        reference: models_properties::shared::EntityReference {
            entity_type: EntityType::Task,
            entity_id: parent_id.to_string(),
            specific_message_id: None,
        },
    }
}

fn subtasks_value(subtask_ids: &[Uuid]) -> models_properties::api::requests::SetPropertyValue {
    models_properties::api::requests::SetPropertyValue::MultiEntityReference {
        references: subtask_ids
            .iter()
            .map(|id| models_properties::shared::EntityReference {
                entity_type: EntityType::Task,
                entity_id: id.to_string(),
                specific_message_id: None,
            })
            .collect(),
    }
}

fn task_relationship_definition(property_definition_id: Uuid) -> PropertyDefinition {
    PropertyDefinition {
        id: property_definition_id,
        owner: PropertyOwner::System,
        display_name: "Task relationship".to_string(),
        data_type: DataType::Entity,
        is_multi_select: property_definition_id == SystemPropertyKey::SUBTASKS_UUID,
        specific_entity_type: Some(EntityType::Task),
        created_at: event_timestamp(),
        updated_at: event_timestamp(),
        is_system: true,
        is_metadata: false,
    }
}

fn expect_task_storage(repo: &mut MockPropertiesRepo, task_id: Uuid) {
    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .return_once(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
}

#[tokio::test]
async fn entity_property_event_parent_task_uses_primary_task_snapshot_only() {
    let task_id = Uuid::from_u128(0xE710);
    let parent_id = Uuid::from_u128(0xE711);
    let entity_property_id = Uuid::from_u128(0xE712);
    let updated_at = event_timestamp();
    let assignment = entity_property_for_event(
        entity_property_id,
        &task_id.to_string(),
        EntityType::Task,
        SystemPropertyKey::PARENT_TASK_UUID,
        updated_at,
    );
    let mut repo = MockPropertiesRepo::new();
    expect_task_storage(&mut repo, task_id);
    repo.expect_get_property_definition().return_once(|_| {
        Box::pin(async {
            Ok(Some(task_relationship_definition(
                SystemPropertyKey::PARENT_TASK_UUID,
            )))
        })
    });
    repo.expect_link_parent_task()
        .withf(move |target_task_id, target_parent_id| {
            *target_task_id == task_id && *target_parent_id == Some(parent_id)
        })
        .return_once(move |_, _| Box::pin(async move { Ok(Some(assignment)) }));
    let event_broker = RecordingEventBroker::default();
    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    )
    .with_event_broker(event_broker.clone());

    service
        .set_entity_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(parent_id)),
        )
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, task_id.to_string());
    assert_eq!(published.envelope["event_type"], "entity_property.updated");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "entity_property_id": entity_property_id,
            "entity_id": task_id,
            "entity_type": "TASK",
            "property_definition_id": SystemPropertyKey::PARENT_TASK_UUID,
            "actor_user_id": caller_user_id(),
            "previous_value": null,
            "value": {
                "type": "EntityReference",
                "value": [{
                    "entity_id": parent_id,
                    "entity_type": "TASK",
                }],
            },
            "updated_at": updated_at,
        })
    );
}

#[tokio::test]
async fn entity_property_event_subtasks_publishes_complete_primary_value_only() {
    let task_id = Uuid::from_u128(0xE713);
    let subtask_ids = [Uuid::from_u128(0xE714), Uuid::from_u128(0xE715)];
    let assignment = entity_property_for_event(
        Uuid::from_u128(0xE716),
        &task_id.to_string(),
        EntityType::Task,
        SystemPropertyKey::SUBTASKS_UUID,
        event_timestamp(),
    );
    let mut repo = MockPropertiesRepo::new();
    expect_task_storage(&mut repo, task_id);
    repo.expect_get_property_definition().return_once(|_| {
        Box::pin(async {
            Ok(Some(task_relationship_definition(
                SystemPropertyKey::SUBTASKS_UUID,
            )))
        })
    });
    repo.expect_link_subtasks()
        .withf(move |target_task_id, target_subtask_ids| {
            *target_task_id == task_id && target_subtask_ids.as_slice() == subtask_ids
        })
        .return_once(move |_, _| Box::pin(async move { Ok(Some(assignment)) }));
    let event_broker = RecordingEventBroker::default();
    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    )
    .with_event_broker(event_broker.clone());

    service
        .set_entity_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&subtask_ids)),
        )
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, task_id.to_string());
    assert_eq!(published.envelope["metadata"]["entity_type"], "TASK");
    assert_eq!(
        published.envelope["metadata"]["value"],
        serde_json::json!({
            "type": "EntityReference",
            "value": [
                {"entity_id": subtask_ids[0], "entity_type": "TASK"},
                {"entity_id": subtask_ids[1], "entity_type": "TASK"},
            ],
        })
    );
}

#[tokio::test]
async fn entity_property_event_task_permission_and_transaction_failures_publish_nothing() {
    let task_id = Uuid::from_u128(0xE717);
    let parent_id = Uuid::from_u128(0xE718);

    let mut permission_repo = MockPropertiesRepo::new();
    expect_task_storage(&mut permission_repo, task_id);
    permission_repo
        .expect_get_property_definition()
        .return_once(|_| {
            Box::pin(async {
                Ok(Some(task_relationship_definition(
                    SystemPropertyKey::PARENT_TASK_UUID,
                )))
            })
        });
    permission_repo.expect_link_parent_task().times(0);
    let mut permission_service = MockPermissionService::new();
    permission_service
        .expect_mint_edit_receipt()
        .return_once(|_, _, _| Box::pin(async { Err(anyhow!("permission denied")) }));
    let permission_broker = RecordingEventBroker::default();
    let service = PropertiesServiceImpl::new(
        permission_repo,
        Some(permission_service),
        None::<MockNotificationService>,
    )
    .with_event_broker(permission_broker.clone());

    let result = service
        .set_entity_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(parent_id)),
        )
        .await;

    assert!(matches!(result, Err(PropertiesErr::PermissionDenied)));
    assert!(permission_broker.events().is_empty());

    let mut transaction_repo = MockPropertiesRepo::new();
    expect_task_storage(&mut transaction_repo, task_id);
    transaction_repo
        .expect_get_property_definition()
        .return_once(|_| {
            Box::pin(async {
                Ok(Some(task_relationship_definition(
                    SystemPropertyKey::PARENT_TASK_UUID,
                )))
            })
        });
    transaction_repo
        .expect_link_parent_task()
        .return_once(|_, _| Box::pin(async { Err(anyhow!("transaction failed")) }));
    let transaction_broker = RecordingEventBroker::default();
    let service = PropertiesServiceImpl::new(
        transaction_repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    )
    .with_event_broker(transaction_broker.clone());

    let result = service
        .set_entity_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(parent_id)),
        )
        .await;

    assert!(result.is_err());
    assert!(transaction_broker.events().is_empty());
}

#[tokio::test]
async fn test_link_parent_task_delegates_to_repo() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let parent_id = Uuid::from_u128(0xabcdef01_2345_6789_abcd_ef0123456789);

    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && *p == Some(parent_id))
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::PARENT_TASK_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(parent_id)),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_parent_task_clear_parent() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && p.is_none())
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::PARENT_TASK_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            None,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_parent_task_requires_edit_on_parent() {
    // Linking mutates the parent's Subtasks property, so edit access to the
    // parent is required: a failed mint on the parent must deny the link and
    // never touch the repo.
    let mut repo = MockPropertiesRepo::new();
    repo.expect_link_parent_task().times(0);

    let mut perm_service = MockPermissionService::new();
    perm_service
        .expect_mint_edit_receipt()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("Access denied")) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let err = service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(Uuid::from_u128(0xF00D))),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionDenied
    ));
}

#[tokio::test]
async fn test_link_parent_task_rejects_bot_and_unauthenticated_callers() {
    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000000123"));
    let bot_access = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        BotReceiptScope::Team {
            team_id: Uuid::new_v4(),
        },
        &task_id.to_string(),
        AccessEntityType::Document,
    );
    let unauthenticated_access = EditReceipt::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: task_id.to_string(),
            entity_type: AccessEntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();

    for access in [bot_access, unauthenticated_access] {
        let mut repo = MockPropertiesRepo::new();
        repo.expect_link_parent_task().times(0);
        let service = PropertiesServiceImpl::new(
            repo,
            None::<MockPermissionService>,
            None::<MockNotificationService>,
        );

        let err = service
            .handle_task_relationship_property(
                &access,
                SystemPropertyKey::PARENT_TASK_UUID,
                Some(parent_task_value(Uuid::from_u128(0xF00D))),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            crate::domain::error::PropertiesErr::PermissionDenied
        ));
    }
}

#[tokio::test]
async fn test_link_parent_task_allows_user_scoped_bot_receipt() {
    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let parent_id = Uuid::from_u128(0xabcdef01_2345_6789_abcd_ef0123456789);
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000005759"));
    let bot_access = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        BotReceiptScope::User {
            acting_user: caller_user_id(),
        },
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    let mut repo = MockPropertiesRepo::new();
    repo.expect_link_parent_task()
        .withf(move |t, p| *t == task_id && *p == Some(parent_id))
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::PARENT_TASK_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &bot_access,
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(parent_id)),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_parent_task_error_propagates() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_link_parent_task()
        .returning(|_, _| Box::pin(async { Err(anyhow!("link failed")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .handle_task_relationship_property(
            &edit_receipt(&Uuid::nil().to_string(), EntityType::Task),
            SystemPropertyKey::PARENT_TASK_UUID,
            Some(parent_task_value(Uuid::nil())),
        )
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "link failed");
}

#[tokio::test]
async fn test_link_subtasks_delegates_to_repo() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let subtask_1 = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa);
    let subtask_2 = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbbb);

    repo.expect_link_subtasks()
        .withf(move |t, s| {
            *t == task_id && s.len() == 2 && s.contains(&subtask_1) && s.contains(&subtask_2)
        })
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::SUBTASKS_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&[subtask_1, subtask_2])),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_subtasks_clear_all() {
    let mut repo = MockPropertiesRepo::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    repo.expect_link_subtasks()
        .withf(move |t, s| *t == task_id && s.is_empty())
        .returning(|task_id, _| {
            let property = entity_property(
                &task_id.to_string(),
                EntityType::Task,
                SystemPropertyKey::SUBTASKS_UUID,
            );
            Box::pin(async move { Ok(Some(property)) })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            None,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn test_link_subtasks_requires_edit_on_subtasks() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_link_subtasks().times(0);

    let mut perm_service = MockPermissionService::new();
    perm_service
        .expect_mint_edit_receipt()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("Access denied")) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let err = service
        .handle_task_relationship_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&[Uuid::from_u128(0xF00D)])),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionDenied
    ));
}

#[tokio::test]
async fn test_link_subtasks_error_propagates() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_link_subtasks()
        .returning(|_, _| Box::pin(async { Err(anyhow!("subtask link failed")) }));
    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .handle_task_relationship_property(
            &edit_receipt(&Uuid::nil().to_string(), EntityType::Task),
            SystemPropertyKey::SUBTASKS_UUID,
            Some(subtasks_value(&[Uuid::nil()])),
        )
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "subtask link failed");
}

// ============================================================================
// get_property_value unit tests
// ============================================================================

#[tokio::test]
async fn test_get_property_value_returns_value_when_exists() {
    let mut repo = MockPropertiesRepo::new();

    let prop_id = Uuid::from_u128(0xdeadbeef_dead_beef_dead_beefdeadbeef);

    repo.expect_get_entity_property_value()
        .withf(move |entity_id, entity_type, p| {
            entity_id == "e1" && *entity_type == EntityType::Document && *p == prop_id
        })
        .returning(|_, _, _| Box::pin(async { Ok(Some(PropertyValue::Str("hello".to_string()))) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_property_value(&view_receipt("e1", EntityType::Document), prop_id)
        .await
        .unwrap();

    assert_eq!(result, Some(PropertyValue::Str("hello".to_string())));
}

#[tokio::test]
async fn test_get_property_value_returns_none_when_not_attached() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_property_value(&view_receipt("e1", EntityType::Document), Uuid::nil())
        .await
        .unwrap();

    assert_eq!(result, None);
}

#[tokio::test]
async fn test_get_property_value_error_path() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("db error")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .get_property_value(&view_receipt("e1", EntityType::Document), Uuid::nil())
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "db error");
}

// ============================================================================
// get_system_property_value unit tests
// ============================================================================

#[tokio::test]
async fn test_get_system_property_value_returns_value_when_exists() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .withf(|entity_id, entity_type, prop_id| {
            entity_id == "e1"
                && *entity_type == EntityType::Document
                && *prop_id == SystemPropertyKey::STATUS_UUID
        })
        .returning(|_, _, _| {
            Box::pin(async {
                Ok(Some(PropertyValue::SelectOption(vec![
                    StatusOption::COMPLETED_UUID,
                ])))
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_system_property_value(
            &view_receipt("e1", EntityType::Document),
            SystemPropertyKey::Status,
        )
        .await
        .unwrap();

    assert_eq!(
        result,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID
        ]))
    );
}

#[tokio::test]
async fn test_get_system_property_value_returns_none_when_not_attached() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let result = service
        .get_system_property_value(
            &view_receipt("e1", EntityType::Document),
            SystemPropertyKey::Status,
        )
        .await
        .unwrap();

    assert_eq!(result, None);
}

#[tokio::test]
async fn test_get_system_property_value_error_path() {
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("db error")) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .get_system_property_value(
            &view_receipt("e1", EntityType::Document),
            SystemPropertyKey::Status,
        )
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "db error");
}

// ============================================================================
// delete_entity_property unit tests
// ============================================================================

#[tokio::test]
async fn entity_property_event_delete_permission_failure_publishes_nothing() {
    let mut repo = MockPropertiesRepo::new();
    let entity_property_id = Uuid::from_u128(0xC3);

    repo.expect_lookup_entity_property().returning(move |_| {
        Box::pin(async move {
            Ok(Some(models_properties::EntityPropertyReference {
                entity_id: "other-entity".to_string(),
                entity_type: EntityType::Document,
                property_definition_id: Uuid::from_u128(0xA1),
            }))
        })
    });
    repo.expect_delete_entity_property().times(0);

    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let err = service
        .delete_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            entity_property_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(err, PropertiesErr::PermissionDenied));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn entity_property_event_delete_uses_lookup_snapshot_and_requested_id() {
    let mut repo = MockPropertiesRepo::new();
    let entity_property_id = Uuid::from_u128(0xC3);
    let property_definition_id = Uuid::from_u128(0xA1);

    repo.expect_lookup_entity_property().returning(move |_| {
        Box::pin(async move {
            Ok(Some(models_properties::EntityPropertyReference {
                entity_id: "doc1".to_string(),
                entity_type: EntityType::Document,
                property_definition_id,
            }))
        })
    });
    repo.expect_delete_entity_property()
        .withf(move |id| *id == entity_property_id)
        .returning(|_| Box::pin(async { Ok(()) }));

    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .delete_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            entity_property_id,
        )
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, "doc1");
    assert_eq!(published.envelope["event_type"], "entity_property.deleted");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "entity_property_id": entity_property_id,
            "entity_id": "doc1",
            "entity_type": "DOCUMENT",
            "property_definition_id": property_definition_id,
            "actor_user_id": caller_user_id(),
        })
    );
}

#[tokio::test]
async fn entity_property_event_delete_repository_failure_publishes_nothing() {
    let entity_property_id = Uuid::from_u128(0xE720);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_lookup_entity_property().return_once(|_| {
        Box::pin(async {
            Ok(Some(models_properties::EntityPropertyReference {
                entity_id: "doc1".to_string(),
                entity_type: EntityType::Document,
                property_definition_id: Uuid::from_u128(0xE721),
            }))
        })
    });
    repo.expect_delete_entity_property()
        .return_once(|_| Box::pin(async { Err(anyhow!("delete failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .delete_entity_property(
            &edit_receipt("doc1", EntityType::Document),
            entity_property_id,
        )
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn entity_property_event_required_property_failure_publishes_nothing() {
    let task_id = Uuid::from_u128(0xE722);
    let entity_property_id = Uuid::from_u128(0xE723);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_lookup_entity_property().return_once(move |_| {
        Box::pin(async move {
            Ok(Some(models_properties::EntityPropertyReference {
                entity_id: task_id.to_string(),
                entity_type: EntityType::Task,
                property_definition_id: SystemPropertyKey::STATUS_UUID,
            }))
        })
    });
    expect_task_storage(&mut repo, task_id);
    repo.expect_delete_entity_property().times(0);
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .delete_entity_property(
            &edit_receipt(&task_id.to_string(), EntityType::Task),
            entity_property_id,
        )
        .await;

    assert!(matches!(result, Err(PropertiesErr::RequiredProperty)));
    assert!(event_broker.events().is_empty());
}

// ============================================================================
// handle_task_assignee_permissions unit tests
// ============================================================================

#[tokio::test]
async fn test_handle_task_assignee_permissions_grants_permissions() {
    let repo = MockPropertiesRepo::new();
    let mut perm_service = MockPermissionService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let assignee_ids = vec![
        MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap(),
    ];

    perm_service
        .expect_grant_permissions_to_task()
        .withf(move |user_ids, task_id_param| {
            user_ids.len() == 2
                && user_ids
                    .contains(&MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap())
                && user_ids
                    .contains(&MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap())
                && task_id_param == task_id.to_string()
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    service
        .handle_task_assignee_permissions(task_id, &assignee_ids)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignee_permissions_empty_assignees() {
    let repo = MockPropertiesRepo::new();
    let perm_service = MockPermissionService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    // Should return Ok without calling permission service
    service
        .handle_task_assignee_permissions(task_id, &[])
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignee_permissions_no_service() {
    let repo = MockPropertiesRepo::new();
    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let assignee_ids = vec![MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()];

    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );

    let err = service
        .handle_task_assignee_permissions(task_id, &assignee_ids)
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::PermissionServiceNotConfigured
    ));
}

#[tokio::test]
async fn test_handle_task_assignee_permissions_error_propagates() {
    let repo = MockPropertiesRepo::new();
    let mut perm_service = MockPermissionService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let assignee_ids = vec![MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()];

    perm_service
        .expect_grant_permissions_to_task()
        .returning(|_, _| Box::pin(async { Err(anyhow!("permission error")) }));

    let service =
        PropertiesServiceImpl::new(repo, Some(perm_service), None::<MockNotificationService>);

    let err = service
        .handle_task_assignee_permissions(task_id, &assignee_ids)
        .await
        .unwrap_err();

    assert_eq!(err.to_string(), "permission error");
}

// ============================================================================
// handle_task_assignee_notifications unit tests
// ============================================================================

struct NotificationTestCase {
    task_id: Uuid,
    assigned_by: String,
    assignees: Vec<MacroUserIdStr<'static>>,
    existing_assignees: Vec<String>,
    expected_notification_count: usize,
    expected_recipient_ids: Option<Vec<String>>,
    notification_service_available: bool,
}

async fn check_notifications(test_case: NotificationTestCase) {
    let mut repo = MockPropertiesRepo::new();
    let mut notif_service = MockNotificationService::new();

    let task_id = test_case.task_id;
    let assigned_by = test_case.assigned_by.clone();
    let assignees = test_case.assignees.clone();
    let existing_assignees = test_case.existing_assignees.clone();

    // Mock: get current assignees
    repo.expect_get_entity_property_value()
        .withf(move |entity_id, entity_type, prop_id| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *prop_id == SystemPropertyKey::ASSIGNEES_UUID
        })
        .returning({
            let existing = existing_assignees.clone();
            move |_, _, _| {
                if existing.is_empty() {
                    Box::pin(async { Ok(None) })
                } else {
                    let refs: Vec<models_properties::shared::EntityReference> = existing
                        .iter()
                        .map(|id| models_properties::shared::EntityReference {
                            entity_type: EntityType::User,
                            entity_id: id.clone(),
                            specific_message_id: None,
                        })
                        .collect();
                    Box::pin(async { Ok(Some(PropertyValue::EntityRef(refs))) })
                }
            }
        });

    // Mock: send notifications (one batched call covering all new assignees)
    if test_case.notification_service_available && test_case.expected_notification_count > 0 {
        let expected_count = test_case.expected_notification_count;
        let expected_recipients = test_case.expected_recipient_ids.clone();
        let expected_assigned_by = assigned_by.clone();
        notif_service
            .expect_send_task_assigned()
            .times(1)
            .withf(move |notification| {
                notification.task_id == task_id
                    && notification.assigned_by.as_ref() == expected_assigned_by.as_str()
                    && notification.recipient_ids.len() == expected_count
                    && expected_recipients.as_ref().is_none_or(|expected| {
                        expected.iter().all(|id| {
                            notification
                                .recipient_ids
                                .iter()
                                .any(|r| r.as_ref() == id.as_str())
                        })
                    })
            })
            .returning(|_| Box::pin(async { Ok(()) }));
    }

    let service = if test_case.notification_service_available {
        PropertiesServiceImpl::new(repo, None::<MockPermissionService>, Some(notif_service))
    } else {
        PropertiesServiceImpl::new(
            repo,
            None::<MockPermissionService>,
            None::<MockNotificationService>,
        )
    };

    let assigned_by = MacroUserIdStr::parse_from_str(&assigned_by).unwrap();
    service
        .handle_task_assignee_notifications(task_id, &assignees, Some(&assigned_by))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_sends_to_new_assignees_only() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![
            MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user2@macro.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user3@macro.com").unwrap(), // existing, should not get notification
        ],
        existing_assignees: vec!["macro|user3@macro.com".to_string()],
        expected_notification_count: 2, // user1 and user2, but not user3 (existing) or assigner
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_filters_out_assigner() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![
            MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|assigner@macro.com").unwrap(),
        ],
        existing_assignees: vec![],
        expected_notification_count: 1, // only user1, not assigner
        expected_recipient_ids: Some(vec!["macro|user1@macro.com".to_string()]),
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_no_new_assignees() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
        existing_assignees: vec!["macro|user1@macro.com".to_string()],
        expected_notification_count: 0, // no new assignees
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_no_service() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
        existing_assignees: vec![],
        expected_notification_count: 0,
        expected_recipient_ids: None,
        notification_service_available: false,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_empty_assignees() {
    check_notifications(NotificationTestCase {
        task_id: Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
        assigned_by: "macro|assigner@macro.com".to_string(),
        assignees: vec![],
        existing_assignees: vec![],
        expected_notification_count: 0,
        expected_recipient_ids: None,
        notification_service_available: true,
    })
    .await;
}

#[tokio::test]
async fn test_handle_task_assignee_notifications_internal_write_skips() {
    // Internal (machine) writes have no assigning user and must not notify.
    let repo = MockPropertiesRepo::new();
    let mut notif_service = MockNotificationService::new();
    notif_service.expect_send_task_assigned().times(0);

    let service =
        PropertiesServiceImpl::new(repo, None::<MockPermissionService>, Some(notif_service));

    service
        .handle_task_assignee_notifications(
            Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc),
            &[MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap()],
            None,
        )
        .await
        .unwrap();
}

// ============================================================================
// handle_task_assignees_property integration tests
// ============================================================================

#[tokio::test]
async fn test_handle_task_assignees_property_calls_both_handlers() {
    let mut repo = MockPropertiesRepo::new();
    let mut perm_service = MockPermissionService::new();
    let mut notif_service = MockNotificationService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let entity_id = task_id.to_string();
    let assigned_by = "macro|assigner@macro.com".to_string();
    let assignees = [
        MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|user2@macro.com").unwrap(),
    ];

    let value = Some(
        models_properties::api::requests::SetPropertyValue::MultiEntityReference {
            references: assignees
                .iter()
                .map(|id| models_properties::shared::EntityReference {
                    entity_type: EntityType::User,
                    entity_id: id.to_string(),
                    specific_message_id: None,
                })
                .collect(),
        },
    );

    // Mock: no existing assignees
    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    // Mock: permissions should be granted to all assignees
    let entity_id_clone = entity_id.clone();
    perm_service
        .expect_grant_permissions_to_task()
        .times(1)
        .withf(move |user_ids, tid| user_ids.len() == 2 && tid == entity_id_clone)
        .returning(|_, _| Box::pin(async { Ok(()) }));

    // Mock: notifications should be sent to both new assignees in one batch
    notif_service
        .expect_send_task_assigned()
        .times(1)
        .withf(|notification| notification.recipient_ids.len() == 2)
        .returning(|_| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(repo, Some(perm_service), Some(notif_service));

    let assigned_by = MacroUserIdStr::parse_from_str(&assigned_by).unwrap();
    service
        .handle_task_assignees_property(&entity_id, value, Some(&assigned_by))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_handle_task_assignees_property_clearing_assignees() {
    let repo = MockPropertiesRepo::new();
    let perm_service = MockPermissionService::new();
    let notif_service = MockNotificationService::new();

    let task_id = Uuid::from_u128(0x12345678_1234_1234_1234_123456789abc);
    let entity_id = task_id.to_string();

    let service = PropertiesServiceImpl::new(repo, Some(perm_service), Some(notif_service));

    // Should return Ok without calling any handlers
    service
        .handle_task_assignees_property(
            &entity_id,
            None,
            Some(&MacroUserIdStr::parse_from_str("macro|assigner@macro.com").unwrap()),
        )
        .await
        .unwrap();
}

// ============================================================================
// add/remove_entity_property_option unit tests
// ============================================================================

fn multi_select_definition(id: Uuid, is_multi_select: bool) -> PropertyDefinition {
    PropertyDefinition {
        id,
        owner: models_properties::PropertyOwner::System,
        display_name: "Tags".to_string(),
        data_type: models_properties::DataType::SelectString,
        is_multi_select,
        specific_entity_type: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        is_system: false,
        is_metadata: false,
    }
}

#[tokio::test]
async fn entity_property_event_add_option_uses_full_mutation_snapshot() {
    let def_id = Uuid::from_u128(0xA1);
    let existing_option_id = Uuid::from_u128(0xB1);
    let added_option_id = Uuid::from_u128(0xB2);
    let entity_property_id = Uuid::from_u128(0xE730);
    let updated_at = event_timestamp();
    let mutation = EntityPropertyMutationSnapshot {
        property: entity_property_for_event(
            entity_property_id,
            "doc1",
            EntityType::Document,
            def_id,
            updated_at,
        ),
        value: Some(PropertyValue::SelectOption(vec![
            existing_option_id,
            added_option_id,
        ])),
        previous_value: None,
    };
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_add_entity_property_option()
        .withf(move |entity_id, entity_type, prop, opt| {
            entity_id == "doc1"
                && *entity_type == EntityType::Document
                && *prop == def_id
                && *opt == added_option_id
        })
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(mutation) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .add_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            added_option_id,
        )
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, "doc1");
    assert_eq!(published.envelope["event_type"], "entity_property.updated");
    assert_eq!(
        published.envelope["metadata"],
        serde_json::json!({
            "entity_property_id": entity_property_id,
            "entity_id": "doc1",
            "entity_type": "DOCUMENT",
            "property_definition_id": def_id,
            "actor_user_id": caller_user_id(),
            "previous_value": null,
            "value": {
                "type": "SelectOption",
                "value": [existing_option_id, added_option_id],
            },
            "updated_at": updated_at,
        })
    );
}

#[tokio::test]
async fn test_add_entity_property_option_rejects_single_select() {
    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, false))) })
    });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .add_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            Uuid::from_u128(0xB2),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn test_add_entity_property_option_rejects_invalid_option() {
    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    // Option does not belong to the property.
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(0) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .add_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            Uuid::from_u128(0xB2),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn entity_property_event_remove_option_uses_full_mutation_snapshot() {
    let def_id = Uuid::from_u128(0xA1);
    let removed_option_id = Uuid::from_u128(0xB2);
    let remaining_option_id = Uuid::from_u128(0xB3);
    let entity_property_id = Uuid::from_u128(0xE731);
    let updated_at = event_timestamp();
    let mutation = EntityPropertyMutationSnapshot {
        property: entity_property_for_event(
            entity_property_id,
            "doc1",
            EntityType::Document,
            def_id,
            updated_at,
        ),
        value: Some(PropertyValue::SelectOption(vec![remaining_option_id])),
        previous_value: None,
    };
    let mut repo = MockPropertiesRepo::new();
    repo.expect_remove_entity_property_option()
        .withf(move |entity_id, entity_type, prop, opt| {
            entity_id == "doc1"
                && *entity_type == EntityType::Document
                && *prop == def_id
                && *opt == removed_option_id
        })
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(Some(mutation)) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .remove_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            removed_option_id,
        )
        .await
        .unwrap();

    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, "doc1");
    assert_eq!(
        published.envelope["metadata"]["entity_property_id"],
        entity_property_id.to_string()
    );
    assert_eq!(
        published.envelope["metadata"]["updated_at"],
        updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    );
    assert_eq!(
        published.envelope["metadata"]["value"],
        serde_json::json!({
            "type": "SelectOption",
            "value": [remaining_option_id],
        })
    );
}

#[tokio::test]
async fn entity_property_event_remove_option_no_mutation_publishes_nothing() {
    let def_id = Uuid::from_u128(0xE732);
    let option_id = Uuid::from_u128(0xE733);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_remove_entity_property_option()
        .return_once(|_, _, _, _| Box::pin(async { Ok(None) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    service
        .remove_entity_property_option(
            &edit_receipt("doc1", EntityType::Document),
            def_id,
            option_id,
        )
        .await
        .unwrap();

    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn canonical_document_task_write_uses_task_storage_type() {
    let task_id = Uuid::from_u128(0xA11CE);
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::STATUS_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Status".to_string(),
                data_type: models_properties::DataType::SelectString,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_upsert_entity_property()
        .withf(move |entity_id, entity_type, property_id, _| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *property_id == SystemPropertyKey::STATUS_UUID
        })
        .returning(|entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move {
                Ok(EntityPropertyMutationSnapshot {
                    property,
                    value: None,
                    previous_value: None,
                })
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );
    let receipt = EditReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    let property = service
        .set_entity_property(
            &receipt,
            SystemPropertyKey::STATUS_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::SelectOption {
                    option_id: StatusOption::COMPLETED_UUID,
                },
            ),
        )
        .await
        .unwrap();

    assert_eq!(property.property.entity_type, EntityType::Task);
}

#[tokio::test]
async fn canonical_document_task_assignee_write_grants_permissions() {
    let task_id = Uuid::from_u128(0xA5516E);
    let assignee = MacroUserIdStr::parse_from_str("macro|assignee@test.com").unwrap();
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::ASSIGNEES_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Assignees".to_string(),
                data_type: models_properties::DataType::Entity,
                is_multi_select: true,
                specific_entity_type: Some(EntityType::User),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_upsert_entity_property()
        .withf(move |entity_id, entity_type, property_id, _| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *property_id == SystemPropertyKey::ASSIGNEES_UUID
        })
        .returning(|entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move {
                Ok(EntityPropertyMutationSnapshot {
                    property,
                    value: None,
                    previous_value: None,
                })
            })
        });

    let mut permission_service = MockPermissionService::new();
    let expected_assignee = assignee.clone();
    permission_service
        .expect_grant_permissions_to_task()
        .withf(move |user_ids, id| {
            user_ids == [expected_assignee.clone()] && id == task_id.to_string()
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let service = PropertiesServiceImpl::new(
        repo,
        Some(permission_service),
        None::<MockNotificationService>,
    );
    let receipt = EditReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    service
        .set_entity_property(
            &receipt,
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::MultiEntityReference {
                    references: vec![models_properties::EntityReference::new(
                        assignee.as_ref(),
                        EntityType::User,
                    )],
                },
            ),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn user_scoped_bot_assignee_write_notifies_as_the_acting_user() {
    let task_id = Uuid::from_u128(0xA5516F);
    let assignee = MacroUserIdStr::parse_from_str("macro|assignee@test.com").unwrap();
    let acting_user = caller_user_id();
    let bot_id = BotId::new_from_uuid(uuid::uuid!("00000000-0000-0000-0000-000000005759"));
    let bot_access = EditReceipt::dangerously_assert_bot(
        bot_id.into_storage_id(),
        BotReceiptScope::User {
            acting_user: acting_user.clone(),
        },
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_property_definition().returning(|_| {
        Box::pin(async {
            Ok(Some(PropertyDefinition {
                id: SystemPropertyKey::ASSIGNEES_UUID,
                owner: models_properties::PropertyOwner::System,
                display_name: "Assignees".to_string(),
                data_type: models_properties::DataType::Entity,
                is_multi_select: true,
                specific_entity_type: Some(EntityType::User),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                is_system: true,
                is_metadata: false,
            }))
        })
    });
    repo.expect_get_entity_property_value()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));
    repo.expect_upsert_entity_property().returning(
        |entity_id, entity_type, property_definition_id, _| {
            let property = entity_property(entity_id, entity_type, property_definition_id);
            Box::pin(async move {
                Ok(EntityPropertyMutationSnapshot {
                    property,
                    value: None,
                    previous_value: None,
                })
            })
        },
    );

    let mut permission_service = MockPermissionService::new();
    let expected_assignee = assignee.clone();
    permission_service
        .expect_grant_permissions_to_task()
        .withf(move |user_ids, id| {
            user_ids == [expected_assignee.clone()] && id == task_id.to_string()
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let mut notif_service = MockNotificationService::new();
    let expected_assigned_by = acting_user.clone();
    notif_service
        .expect_send_task_assigned()
        .times(1)
        .withf(move |notification| {
            notification.assigned_by.as_ref() == expected_assigned_by.as_ref()
                && notification.recipient_ids.len() == 1
        })
        .returning(|_| Box::pin(async { Ok(()) }));

    let service = PropertiesServiceImpl::new(repo, Some(permission_service), Some(notif_service));

    service
        .set_entity_property(
            &bot_access,
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(
                models_properties::api::requests::SetPropertyValue::MultiEntityReference {
                    references: vec![models_properties::EntityReference::new(
                        assignee.as_ref(),
                        EntityType::User,
                    )],
                },
            ),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn canonical_document_task_read_uses_task_storage_type() {
    let task_id = Uuid::from_u128(0xBEEF);
    let property_id = Uuid::from_u128(0xCAFE);
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .withf(move |ids| ids == [task_id])
        .returning(move |_| {
            Box::pin(async move { Ok(HashMap::from([(task_id, DocumentSubType::Task)])) })
        });
    repo.expect_get_entity_property_value()
        .withf(move |entity_id, entity_type, id| {
            entity_id == task_id.to_string()
                && *entity_type == EntityType::Task
                && *id == property_id
        })
        .returning(|_, _, _| Box::pin(async { Ok(Some(PropertyValue::Str("value".into()))) }));

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );
    let receipt = ViewReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &task_id.to_string(),
        AccessEntityType::Document,
    );

    assert_eq!(
        service
            .get_property_value(&receipt, property_id)
            .await
            .unwrap(),
        Some(PropertyValue::Str("value".into()))
    );
}

#[tokio::test]
async fn mixed_document_bulk_read_batches_subtypes_and_returns_canonical_keys() {
    let task_id = Uuid::from_u128(0x1001);
    let snippet_id = Uuid::from_u128(0x1002);
    let mut repo = MockPropertiesRepo::new();

    repo.expect_get_document_sub_types()
        .times(1)
        .withf(move |ids| ids.len() == 2 && ids.contains(&task_id) && ids.contains(&snippet_id))
        .returning(move |_| {
            Box::pin(async move {
                Ok(HashMap::from([
                    (task_id, DocumentSubType::Task),
                    (snippet_id, DocumentSubType::Snippet),
                ]))
            })
        });
    repo.expect_get_entity_properties_batch()
        .withf(move |references| {
            references.len() == 2
                && references.iter().any(|reference| {
                    reference.entity_id == task_id.to_string()
                        && reference.entity_type == EntityType::Task
                })
                && references.iter().any(|reference| {
                    reference.entity_id == snippet_id.to_string()
                        && reference.entity_type == EntityType::Document
                })
        })
        .returning(|references| {
            Box::pin(async move {
                Ok(references
                    .iter()
                    .map(|reference| {
                        (
                            crate::domain::model::EntityPropertiesKey::from(reference),
                            Vec::new(),
                        )
                    })
                    .collect())
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );
    let receipts = [
        ViewReceipt::dangerously_assert_authenticated_user(
            caller_user_id(),
            &task_id.to_string(),
            AccessEntityType::Document,
        ),
        ViewReceipt::dangerously_assert_authenticated_user(
            caller_user_id(),
            &snippet_id.to_string(),
            AccessEntityType::Document,
        ),
    ];

    let result = service
        .get_bulk_entity_properties(&receipts, Vec::new())
        .await
        .unwrap();

    assert!(
        result
            .keys()
            .all(|key| key.entity_type == AccessEntityType::Document)
    );
    assert!(
        result.contains_key(&crate::domain::model::PropertyTargetKey {
            entity_id: task_id.to_string(),
            entity_type: AccessEntityType::Document,
        })
    );
    assert!(
        result.contains_key(&crate::domain::model::PropertyTargetKey {
            entity_id: snippet_id.to_string(),
            entity_type: AccessEntityType::Document,
        })
    );
}

#[tokio::test]
async fn entity_properties_cleared_event_publishes_once_for_authenticated_and_internal_actors() {
    let cases = [
        (
            edit_receipt("doc1", EntityType::Document),
            serde_json::json!(caller_user_id()),
        ),
        (
            EditReceipt::dangerously_assert_internal_user("doc1", AccessEntityType::Document),
            serde_json::Value::Null,
        ),
    ];

    for (access, expected_actor) in cases {
        let mut repo = MockPropertiesRepo::new();
        repo.expect_delete_entity_properties()
            .withf(|entity| {
                entity.entity_id == "doc1" && entity.entity_type == EntityType::Document
            })
            .return_once(|_| Box::pin(async { Ok(()) }));
        let event_broker = RecordingEventBroker::default();
        let service = service_with_event_broker(repo, event_broker.clone());

        service.delete_entity_properties(&access).await.unwrap();

        let published = only_published_property_event(&event_broker);
        assert_eq!(published.topic, "macro.properties");
        assert_eq!(published.key, "doc1");
        assert_eq!(
            published.envelope["event_type"],
            "entity_properties.cleared"
        );
        assert_eq!(
            published.envelope["metadata"],
            serde_json::json!({
                "entity_id": "doc1",
                "entity_type": "DOCUMENT",
                "actor_user_id": expected_actor,
            })
        );
    }
}

#[tokio::test]
async fn entity_properties_cleared_event_repository_failure_publishes_nothing() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_delete_entity_properties()
        .return_once(|_| Box::pin(async { Err(anyhow!("clear failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let result = service
        .delete_entity_properties(&edit_receipt("doc1", EntityType::Document))
        .await;

    assert!(result.is_err());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn bulk_entity_property_event_publishes_every_property_snapshot() {
    use crate::domain::model::EntityPropertyOptionUpdate;

    let first_definition_id = Uuid::from_u128(0xB001);
    let second_definition_id = Uuid::from_u128(0xB002);
    let first_entity_property_id = Uuid::from_u128(0xB003);
    let second_entity_property_id = Uuid::from_u128(0xB004);
    let first_requested_option_id = Uuid::from_u128(0xB005);
    let second_requested_option_id = Uuid::from_u128(0xB006);
    let first_final_option_ids = vec![Uuid::from_u128(0xB007), first_requested_option_id];
    let second_final_option_ids = vec![Uuid::from_u128(0xB008), second_requested_option_id];

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .times(2)
        .returning(|property_definition_id| {
            Box::pin(async move { Ok(Some(multi_select_definition(property_definition_id, true))) })
        });
    repo.expect_count_valid_property_options()
        .times(2)
        .returning(|_, option_ids| {
            let option_count = option_ids.len() as i64;
            Box::pin(async move { Ok(option_count) })
        });
    let persisted_first_final_option_ids = first_final_option_ids.clone();
    let persisted_second_final_option_ids = second_final_option_ids.clone();
    repo.expect_bulk_update_entity_property_options()
        .return_once(move |_, _, _| {
            Box::pin(async move {
                Ok(vec![
                    entity_property_option_selection_for_event(
                        first_entity_property_id,
                        "doc1",
                        EntityType::Document,
                        first_definition_id,
                        persisted_first_final_option_ids,
                    ),
                    entity_property_option_selection_for_event(
                        second_entity_property_id,
                        "doc1",
                        EntityType::Document,
                        second_definition_id,
                        persisted_second_final_option_ids,
                    ),
                ])
            })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let selections = service
        .bulk_update_entity_property_options(
            &edit_receipt("doc1", EntityType::Document),
            vec![
                EntityPropertyOptionUpdate {
                    property_definition_id: first_definition_id,
                    add_option_ids: vec![first_requested_option_id],
                    remove_option_ids: Vec::new(),
                },
                EntityPropertyOptionUpdate {
                    property_definition_id: second_definition_id,
                    add_option_ids: vec![second_requested_option_id],
                    remove_option_ids: Vec::new(),
                },
            ],
        )
        .await
        .unwrap();

    assert_eq!(selections[0].option_ids, first_final_option_ids);
    assert_eq!(selections[1].option_ids, second_final_option_ids);

    let events = event_broker.events();
    assert_eq!(events.len(), 2);
    for event in &events {
        assert_eq!(event.topic, "macro.properties");
        assert_eq!(event.key, "doc1");
        assert_eq!(event.envelope["event_type"], "entity_property.updated");
        assert_eq!(
            event.envelope["metadata"]["actor_user_id"],
            caller_user_id().to_string()
        );
    }
    assert_eq!(
        events[0].envelope["metadata"],
        serde_json::json!({
            "entity_property_id": first_entity_property_id,
            "entity_id": "doc1",
            "entity_type": "DOCUMENT",
            "property_definition_id": first_definition_id,
            "actor_user_id": caller_user_id(),
            "previous_value": null,
            "value": {
                "type": "SelectOption",
                "value": first_final_option_ids,
            },
            "updated_at": event_timestamp(),
        })
    );
    assert_eq!(
        events[1].envelope["metadata"],
        serde_json::json!({
            "entity_property_id": second_entity_property_id,
            "entity_id": "doc1",
            "entity_type": "DOCUMENT",
            "property_definition_id": second_definition_id,
            "actor_user_id": caller_user_id(),
            "previous_value": null,
            "value": {
                "type": "SelectOption",
                "value": second_final_option_ids,
            },
            "updated_at": event_timestamp(),
        })
    );
}

#[tokio::test]
async fn bulk_entity_property_event_cross_entity_preserves_outcomes_and_source_actors() {
    use crate::domain::model::EntityOptionUpdateOutcome;

    let property_definition_id = Uuid::from_u128(0xB101);
    let requested_option_id = Uuid::from_u128(0xB102);
    let a_final_option_id = Uuid::from_u128(0xB103);
    let z_final_option_id = Uuid::from_u128(0xB104);
    let a_entity_property_id = Uuid::from_u128(0xB105);
    let z_entity_property_id = Uuid::from_u128(0xB106);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(property_definition_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .return_once(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_bulk_update_entity_property_options()
        .times(3)
        .returning(move |entity_id, _, _| match entity_id {
            "a-good" => Box::pin(async move {
                Ok(vec![entity_property_option_selection_for_event(
                    a_entity_property_id,
                    "a-good",
                    EntityType::Document,
                    property_definition_id,
                    vec![a_final_option_id],
                )])
            }),
            "m-failed" => Box::pin(async { Err(anyhow!("entity transaction failed")) }),
            "z-good" => Box::pin(async move {
                Ok(vec![entity_property_option_selection_for_event(
                    z_entity_property_id,
                    "z-good",
                    EntityType::Document,
                    property_definition_id,
                    vec![z_final_option_id],
                )])
            }),
            unexpected => panic!("unexpected entity {unexpected}"),
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let receipts = vec![
        edit_receipt_for_user("macro|actor-z@test.com", "z-good", EntityType::Document),
        edit_receipt_for_user(
            "macro|actor-failed@test.com",
            "m-failed",
            EntityType::Document,
        ),
        edit_receipt_for_user("macro|actor-a@test.com", "a-good", EntityType::Document),
    ];

    let outcomes = service
        .bulk_update_entities_property_options(
            &receipts,
            property_definition_id,
            vec![requested_option_id],
            Vec::new(),
        )
        .await
        .unwrap();

    assert!(matches!(
        &outcomes[0],
        EntityOptionUpdateOutcome::Applied { option_ids }
            if option_ids == &[z_final_option_id]
    ));
    assert!(matches!(
        &outcomes[1],
        EntityOptionUpdateOutcome::Failed { .. }
    ));
    assert!(matches!(
        &outcomes[2],
        EntityOptionUpdateOutcome::Applied { option_ids }
            if option_ids == &[a_final_option_id]
    ));

    // Input order is z, m, a, while lock order is a, m, z. Successful
    // transactions publish in lock order without disturbing response alignment.
    let events = event_broker.events();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].key, "a-good");
    assert_eq!(events[1].key, "z-good");
    assert_eq!(
        events[0].envelope["metadata"]["actor_user_id"],
        "macro|actor-a@test.com"
    );
    assert_eq!(
        events[1].envelope["metadata"]["actor_user_id"],
        "macro|actor-z@test.com"
    );
    assert_eq!(
        events[0].envelope["metadata"]["value"],
        serde_json::json!({
            "type": "SelectOption",
            "value": [a_final_option_id],
        })
    );
    assert_eq!(
        events[1].envelope["metadata"]["value"],
        serde_json::json!({
            "type": "SelectOption",
            "value": [z_final_option_id],
        })
    );
}

#[tokio::test]
async fn bulk_entity_property_event_cross_entity_invalid_type_does_not_publish() {
    use crate::domain::model::EntityOptionUpdateOutcome;

    let property_definition_id = SystemPropertyKey::STAGE_UUID;
    let requested_option_id = Uuid::from_u128(0xB201);
    let company_final_option_id = Uuid::from_u128(0xB202);
    let company_entity_property_id = Uuid::from_u128(0xB203);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(property_definition_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .return_once(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_bulk_update_entity_property_options()
        .times(1)
        .withf(|entity_id, _, _| entity_id == "company1")
        .return_once(move |_, _, _| {
            Box::pin(async move {
                Ok(vec![entity_property_option_selection_for_event(
                    company_entity_property_id,
                    "company1",
                    EntityType::Company,
                    property_definition_id,
                    vec![company_final_option_id],
                )])
            })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let receipts = vec![
        edit_receipt("doc1", EntityType::Document),
        edit_receipt("company1", EntityType::Company),
    ];

    let outcomes = service
        .bulk_update_entities_property_options(
            &receipts,
            property_definition_id,
            vec![requested_option_id],
            Vec::new(),
        )
        .await
        .unwrap();

    assert!(matches!(
        &outcomes[0],
        EntityOptionUpdateOutcome::Failed { .. }
    ));
    assert!(matches!(
        &outcomes[1],
        EntityOptionUpdateOutcome::Applied { option_ids }
            if option_ids == &[company_final_option_id]
    ));
    let published = only_published_property_event(&event_broker);
    assert_eq!(published.key, "company1");
    assert_eq!(published.envelope["metadata"]["entity_type"], "COMPANY");
}

#[tokio::test]
async fn bulk_entity_property_event_removal_only_no_row_does_not_publish() {
    use crate::domain::model::{EntityOptionUpdateOutcome, EntityPropertyOptionSelection};

    let property_definition_id = Uuid::from_u128(0xB301);
    let absent_option_id = Uuid::from_u128(0xB302);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(property_definition_id, true))) })
    });
    repo.expect_count_valid_property_options().never();
    repo.expect_bulk_update_entity_property_options()
        .return_once(move |_, _, _| {
            Box::pin(async move {
                Ok(vec![EntityPropertyOptionSelection {
                    property_definition_id,
                    option_ids: Vec::new(),
                    mutation: None,
                }])
            })
        });
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());
    let receipts = vec![edit_receipt("doc1", EntityType::Document)];

    let outcomes = service
        .bulk_update_entities_property_options(
            &receipts,
            property_definition_id,
            Vec::new(),
            vec![absent_option_id],
        )
        .await
        .unwrap();

    assert!(matches!(
        &outcomes[0],
        EntityOptionUpdateOutcome::Applied { option_ids } if option_ids.is_empty()
    ));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn test_bulk_update_entity_property_options_happy_path() {
    use crate::domain::model::{EntityPropertyOptionSelection, EntityPropertyOptionUpdate};

    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);
    let add_id = Uuid::from_u128(0xB2);
    let remove_id = Uuid::from_u128(0xB3);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    // Only the added option is validated; the removed one is not.
    repo.expect_count_valid_property_options()
        .withf(move |_, option_ids| option_ids == [add_id])
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_bulk_update_entity_property_options()
        .withf(move |entity_id, entity_type, updates| {
            entity_id == "doc1"
                && *entity_type == EntityType::Document
                && updates.len() == 1
                && updates[0].property_definition_id == def_id
                && updates[0].add_option_ids == [add_id]
                && updates[0].remove_option_ids == [remove_id]
        })
        .returning(move |_, _, _| {
            Box::pin(async move {
                Ok(vec![EntityPropertyOptionSelection {
                    property_definition_id: def_id,
                    option_ids: vec![add_id],
                    mutation: Some(entity_property_mutation(
                        "doc1",
                        EntityType::Document,
                        def_id,
                        Some(PropertyValue::SelectOption(vec![add_id])),
                    )),
                }])
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let selections = service
        .bulk_update_entity_property_options(
            &edit_receipt("doc1", EntityType::Document),
            vec![EntityPropertyOptionUpdate {
                property_definition_id: def_id,
                add_option_ids: vec![add_id],
                remove_option_ids: vec![remove_id],
            }],
        )
        .await
        .unwrap();

    assert_eq!(selections.len(), 1);
    assert_eq!(selections[0].property_definition_id, def_id);
    assert_eq!(selections[0].option_ids, vec![add_id]);
    let mutation = selections[0]
        .mutation
        .as_ref()
        .expect("persisted update should carry its mutation snapshot");
    assert_eq!(mutation.property.entity_id, "doc1");
    assert_eq!(
        mutation.value,
        Some(PropertyValue::SelectOption(vec![add_id]))
    );
}

#[tokio::test]
async fn test_bulk_update_entity_property_options_rejects_single_select() {
    use crate::domain::model::EntityPropertyOptionUpdate;

    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, false))) })
    });
    // No write should be attempted for an invalid batch.
    repo.expect_bulk_update_entity_property_options().never();

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .bulk_update_entity_property_options(
            &edit_receipt("doc1", EntityType::Document),
            vec![EntityPropertyOptionUpdate {
                property_definition_id: def_id,
                add_option_ids: vec![Uuid::from_u128(0xB2)],
                remove_option_ids: vec![],
            }],
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn test_bulk_update_entity_property_options_rejects_invalid_option() {
    use crate::domain::model::EntityPropertyOptionUpdate;

    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    // Added option does not belong to the property.
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(0) }));
    // A validation failure must abort before any persistence runs.
    repo.expect_bulk_update_entity_property_options().never();

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let err = service
        .bulk_update_entity_property_options(
            &edit_receipt("doc1", EntityType::Document),
            vec![EntityPropertyOptionUpdate {
                property_definition_id: def_id,
                add_option_ids: vec![Uuid::from_u128(0xB2)],
                remove_option_ids: vec![],
            }],
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn test_bulk_update_entity_property_options_dedupes_added_options() {
    use crate::domain::model::{EntityPropertyOptionSelection, EntityPropertyOptionUpdate};

    let mut repo = MockPropertiesRepo::new();
    let def_id = Uuid::from_u128(0xA1);
    let add_id = Uuid::from_u128(0xB2);

    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    // A repeated add id is deduped before the validity count, so the single
    // valid option is not miscounted as invalid.
    repo.expect_count_valid_property_options()
        .withf(move |_, option_ids| option_ids == [add_id])
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_bulk_update_entity_property_options()
        .returning(move |_, _, _| {
            Box::pin(async move {
                Ok(vec![EntityPropertyOptionSelection {
                    property_definition_id: def_id,
                    option_ids: vec![add_id],
                    mutation: None,
                }])
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    service
        .bulk_update_entity_property_options(
            &edit_receipt("doc1", EntityType::Document),
            vec![EntityPropertyOptionUpdate {
                property_definition_id: def_id,
                add_option_ids: vec![add_id, add_id],
                remove_option_ids: vec![],
            }],
        )
        .await
        .unwrap();
}

// ============================================================================
// Cross-entity bulk option updates - bulk_update_entities_property_options
// ============================================================================

#[tokio::test]
async fn test_bulk_update_entities_applies_delta_in_input_order() {
    use crate::domain::model::{EntityOptionUpdateOutcome, EntityPropertyOptionSelection};

    let def_id = Uuid::from_u128(0xA1);
    let add_id = Uuid::from_u128(0xB2);
    // Distinct stored marker per entity so alignment to input order is provable.
    let final_c = Uuid::from_u128(0xC0);
    let final_a = Uuid::from_u128(0xC1);
    let final_b = Uuid::from_u128(0xC2);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_get_document_sub_types()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_bulk_update_entity_property_options()
        .times(3)
        .returning(move |entity_id, _, _| {
            let final_id = match entity_id {
                "cid" => final_c,
                "aid" => final_a,
                "bid" => final_b,
                other => panic!("unexpected entity {other}"),
            };
            Box::pin(async move {
                Ok(vec![EntityPropertyOptionSelection {
                    property_definition_id: def_id,
                    option_ids: vec![final_id],
                    mutation: None,
                }])
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    // Input order (cid, aid, bid) differs from the sorted lock order (aid, bid,
    // cid); outcomes must still come back aligned to the input.
    let receipts = vec![
        edit_receipt("cid", EntityType::Document),
        edit_receipt("aid", EntityType::Document),
        edit_receipt("bid", EntityType::Document),
    ];
    let outcomes = service
        .bulk_update_entities_property_options(&receipts, def_id, vec![add_id], vec![])
        .await
        .unwrap();

    assert_eq!(outcomes.len(), 3);
    assert!(matches!(
        &outcomes[0],
        EntityOptionUpdateOutcome::Applied { option_ids } if *option_ids == vec![final_c]
    ));
    assert!(matches!(
        &outcomes[1],
        EntityOptionUpdateOutcome::Applied { option_ids } if *option_ids == vec![final_a]
    ));
    assert!(matches!(
        &outcomes[2],
        EntityOptionUpdateOutcome::Applied { option_ids } if *option_ids == vec![final_b]
    ));
}

#[tokio::test]
async fn test_bulk_update_entities_is_best_effort_on_per_entity_write_failure() {
    use crate::domain::model::{EntityOptionUpdateOutcome, EntityPropertyOptionSelection};

    let def_id = Uuid::from_u128(0xA1);
    let add_id = Uuid::from_u128(0xB2);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_get_document_sub_types()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    // One entity's write fails; the other must still be attempted and succeed.
    repo.expect_bulk_update_entity_property_options()
        .times(2)
        .returning(move |entity_id, _, _| {
            if entity_id == "doc-bad" {
                Box::pin(async { Err(anyhow!("write blew up")) })
            } else {
                Box::pin(async move {
                    Ok(vec![EntityPropertyOptionSelection {
                        property_definition_id: def_id,
                        option_ids: vec![add_id],
                        mutation: None,
                    }])
                })
            }
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let receipts = vec![
        edit_receipt("doc-good", EntityType::Document),
        edit_receipt("doc-bad", EntityType::Document),
    ];
    let outcomes = service
        .bulk_update_entities_property_options(&receipts, def_id, vec![add_id], vec![])
        .await
        .unwrap();

    assert!(matches!(
        &outcomes[0],
        EntityOptionUpdateOutcome::Applied { option_ids } if *option_ids == vec![add_id]
    ));
    assert!(matches!(
        &outcomes[1],
        EntityOptionUpdateOutcome::Failed { .. }
    ));
}

#[tokio::test]
async fn test_bulk_update_entities_fails_entity_that_rejects_property_type() {
    use crate::domain::model::{EntityOptionUpdateOutcome, EntityPropertyOptionSelection};

    // A company-only property (Stage) applies to a company but not a document.
    let def_id = SystemPropertyKey::STAGE_UUID;
    let add_id = Uuid::from_u128(0xB2);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(1) }));
    repo.expect_get_document_sub_types()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    // Only the company is a valid target, so exactly one write is attempted.
    repo.expect_bulk_update_entity_property_options()
        .times(1)
        .withf(|entity_id, _, _| entity_id == "company1")
        .returning(move |_, _, _| {
            Box::pin(async move {
                Ok(vec![EntityPropertyOptionSelection {
                    property_definition_id: def_id,
                    option_ids: vec![add_id],
                    mutation: None,
                }])
            })
        });

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let receipts = vec![
        edit_receipt("company1", EntityType::Company),
        edit_receipt("doc1", EntityType::Document),
    ];
    let outcomes = service
        .bulk_update_entities_property_options(&receipts, def_id, vec![add_id], vec![])
        .await
        .unwrap();

    assert!(matches!(
        &outcomes[0],
        EntityOptionUpdateOutcome::Applied { .. }
    ));
    assert!(matches!(
        &outcomes[1],
        EntityOptionUpdateOutcome::Failed { .. }
    ));
}

#[tokio::test]
async fn test_bulk_update_entities_rejects_single_select_wholesale() {
    let def_id = Uuid::from_u128(0xA1);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, false))) })
    });
    // A bad shared delta must abort before any entity is touched.
    repo.expect_bulk_update_entity_property_options().never();

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let receipts = vec![edit_receipt("doc1", EntityType::Document)];
    let err = service
        .bulk_update_entities_property_options(
            &receipts,
            def_id,
            vec![Uuid::from_u128(0xB2)],
            vec![],
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

#[tokio::test]
async fn test_bulk_update_entities_rejects_invalid_option_wholesale() {
    let def_id = Uuid::from_u128(0xA1);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition().returning(move |_| {
        Box::pin(async move { Ok(Some(multi_select_definition(def_id, true))) })
    });
    repo.expect_count_valid_property_options()
        .returning(|_, _| Box::pin(async { Ok(0) }));
    repo.expect_bulk_update_entity_property_options().never();

    let service = PropertiesServiceImpl::new(
        repo,
        Some(create_mock_permission_service()),
        None::<MockNotificationService>,
    );

    let receipts = vec![edit_receipt("doc1", EntityType::Document)];
    let err = service
        .bulk_update_entities_property_options(
            &receipts,
            def_id,
            vec![Uuid::from_u128(0xB2)],
            vec![],
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        crate::domain::error::PropertiesErr::Validation(_)
    ));
}

// ===== Sharing a personal label with the team =====

fn team_id() -> Uuid {
    Uuid::from_u128(0x7EA3)
}

/// A team-membership receipt for the test caller, minted without a check.
fn team_receipt() -> crate::domain::service::TeamReceipt {
    crate::domain::service::TeamReceipt::dangerously_assert_authenticated_user(
        caller_user_id(),
        &team_id().to_string(),
        AccessEntityType::Team,
    )
}

fn tag_definition(id: Uuid, owner: PropertyOwner) -> PropertyDefinition {
    let created_at = event_timestamp();
    PropertyDefinition {
        id,
        owner,
        display_name: "Tags".to_string(),
        data_type: DataType::Tag,
        is_multi_select: true,
        specific_entity_type: None,
        created_at,
        updated_at: created_at,
        is_system: false,
        is_metadata: false,
    }
}

fn personal_tag_definition(id: Uuid) -> PropertyDefinition {
    tag_definition(
        id,
        PropertyOwner::User {
            user_id: caller_user_id().to_string(),
        },
    )
}

fn team_tag_definition(id: Uuid) -> PropertyDefinition {
    tag_definition(id, PropertyOwner::Team { team_id: team_id() })
}

/// Wire up the reads every promote/merge does before it touches the tag sets:
/// the label being shared, the caller's tag set, and the team's.
fn expect_tag_sets(
    repo: &mut MockPropertiesRepo,
    option: PropertyOption,
    personal: PropertyDefinition,
    team: PropertyDefinition,
) {
    repo.expect_get_property_option()
        .return_once(move |_| Box::pin(async move { Ok(Some(option)) }));
    repo.expect_get_tag_definition()
        .return_once(move |_| Box::pin(async move { Ok(Some(personal)) }));
    repo.expect_get_or_create_tag_definition()
        .return_once(move |_| {
            Box::pin(async move {
                Ok(GetOrCreateTagDefinitionResult {
                    definition: team,
                    created: false,
                })
            })
        });
}

#[tokio::test]
async fn promote_tag_publishes_the_moved_option_and_every_retagged_entity() {
    let personal_definition_id = Uuid::from_u128(0x7A01);
    let team_definition_id = Uuid::from_u128(0x7A02);
    let option_id = Uuid::from_u128(0x7A03);

    let personal_option = property_option_for_event(
        option_id,
        personal_definition_id,
        0,
        PropertyOptionValue::String("bug-report".to_string()),
        Some("#ff0000"),
    );
    // The move keeps the option id and hands it to the team definition.
    let promoted_option = property_option_for_event(
        option_id,
        team_definition_id,
        3,
        PropertyOptionValue::String("bug-report".to_string()),
        Some("#ff0000"),
    );

    let mut repo = MockPropertiesRepo::new();
    expect_tag_sets(
        &mut repo,
        personal_option,
        personal_tag_definition(personal_definition_id),
        team_tag_definition(team_definition_id),
    );
    let expected_option = promoted_option.clone();
    repo.expect_promote_tag_option()
        .return_once(move |_, _, _| {
            Box::pin(async move {
                Ok(crate::domain::model::TagPromotionOutcome::Promoted(
                    crate::domain::model::TagRemapOutcome {
                        option: expected_option,
                        mutations: vec![
                            entity_property_mutation(
                                "doc1",
                                EntityType::Document,
                                team_definition_id,
                                Some(PropertyValue::SelectOption(vec![option_id])),
                            ),
                            entity_property_mutation(
                                "thread1",
                                EntityType::Thread,
                                team_definition_id,
                                Some(PropertyValue::SelectOption(vec![option_id])),
                            ),
                        ],
                    },
                ))
            })
        });

    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let option = service
        .promote_tag_option(&caller_user_id(), Some(&team_receipt()), option_id)
        .await
        .unwrap();
    assert_eq!(option.property_definition_id, team_definition_id);

    let events = event_broker.events();
    let event_types: Vec<_> = events
        .iter()
        .map(|event| event.envelope["event_type"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        event_types,
        vec![
            "property_option.updated",
            "entity_property.updated",
            "entity_property.updated",
        ],
        "search and Soup rebuild from one entity event per retagged entity"
    );
    assert_eq!(
        events[1].envelope["metadata"]["entity_id"], "doc1",
        "the entity events carry the entities, not the label"
    );
    assert_eq!(events[2].envelope["metadata"]["entity_id"], "thread1");
}

#[tokio::test]
async fn promote_tag_reports_the_colliding_team_label() {
    let personal_definition_id = Uuid::from_u128(0x7B01);
    let team_definition_id = Uuid::from_u128(0x7B02);
    let option_id = Uuid::from_u128(0x7B03);
    let conflict_id = Uuid::from_u128(0x7B04);

    let mut repo = MockPropertiesRepo::new();
    expect_tag_sets(
        &mut repo,
        property_option_for_event(
            option_id,
            personal_definition_id,
            0,
            PropertyOptionValue::String("Urgent".to_string()),
            Some("#ff0000"),
        ),
        personal_tag_definition(personal_definition_id),
        team_tag_definition(team_definition_id),
    );
    repo.expect_promote_tag_option()
        .return_once(move |_, _, _| {
            Box::pin(async move {
                Ok(crate::domain::model::TagPromotionOutcome::Conflict(
                    property_option_for_event(
                        conflict_id,
                        team_definition_id,
                        1,
                        PropertyOptionValue::String("urgent".to_string()),
                        Some("#00ff00"),
                    ),
                ))
            })
        });

    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let err = service
        .promote_tag_option(&caller_user_id(), Some(&team_receipt()), option_id)
        .await
        .unwrap_err();

    let PropertiesErr::ConflictingTeamLabel(conflict) = err else {
        panic!("expected the conflicting team label, got {err:?}");
    };
    assert_eq!(conflict.id, conflict_id);
    assert!(
        event_broker.events().is_empty(),
        "a rejected promotion changed nothing to publish"
    );
}

#[tokio::test]
async fn promote_tag_requires_a_team() {
    let personal_definition_id = Uuid::from_u128(0x7C01);
    let option_id = Uuid::from_u128(0x7C02);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_option().return_once(move |_| {
        Box::pin(async move {
            Ok(Some(property_option_for_event(
                option_id,
                personal_definition_id,
                0,
                PropertyOptionValue::String("bug-report".to_string()),
                Some("#ff0000"),
            )))
        })
    });
    repo.expect_get_tag_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(personal_tag_definition(personal_definition_id))) })
    });
    repo.expect_promote_tag_option().never();

    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );

    let err = service
        .promote_tag_option(&caller_user_id(), None, option_id)
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::TeamMembershipRequired));
}

#[tokio::test]
async fn promote_tag_rejects_a_label_from_another_tag_set() {
    let option_id = Uuid::from_u128(0x7D01);

    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_option().return_once(move |_| {
        Box::pin(async move {
            Ok(Some(property_option_for_event(
                option_id,
                // Somebody else's tag definition.
                Uuid::from_u128(0x7D02),
                0,
                PropertyOptionValue::String("not-mine".to_string()),
                Some("#ff0000"),
            )))
        })
    });
    repo.expect_get_tag_definition().return_once(move |_| {
        Box::pin(async move { Ok(Some(personal_tag_definition(Uuid::from_u128(0x7D03)))) })
    });
    repo.expect_promote_tag_option().never();

    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );

    let err = service
        .promote_tag_option(&caller_user_id(), Some(&team_receipt()), option_id)
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::OptionNotFound));
}

#[tokio::test]
async fn merge_tag_publishes_the_retired_label_and_every_retagged_entity() {
    let personal_definition_id = Uuid::from_u128(0x7E01);
    let team_definition_id = Uuid::from_u128(0x7E02);
    let option_id = Uuid::from_u128(0x7E03);
    let target_option_id = Uuid::from_u128(0x7E04);

    let mut repo = MockPropertiesRepo::new();
    expect_tag_sets(
        &mut repo,
        property_option_for_event(
            option_id,
            personal_definition_id,
            0,
            PropertyOptionValue::String("Urgent".to_string()),
            Some("#ff0000"),
        ),
        personal_tag_definition(personal_definition_id),
        team_tag_definition(team_definition_id),
    );
    repo.expect_merge_tag_option()
        .return_once(move |_, _, _, _| {
            Box::pin(async move {
                Ok(Some(crate::domain::model::TagRemapOutcome {
                    option: property_option_for_event(
                        target_option_id,
                        team_definition_id,
                        1,
                        PropertyOptionValue::String("urgent".to_string()),
                        Some("#00ff00"),
                    ),
                    mutations: vec![entity_property_mutation(
                        "doc1",
                        EntityType::Document,
                        team_definition_id,
                        Some(PropertyValue::SelectOption(vec![target_option_id])),
                    )],
                }))
            })
        });

    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let option = service
        .merge_tag_option(
            &caller_user_id(),
            Some(&team_receipt()),
            option_id,
            target_option_id,
        )
        .await
        .unwrap();
    assert_eq!(option.id, target_option_id, "the team label wins");

    let events = event_broker.events();
    let event_types: Vec<_> = events
        .iter()
        .map(|event| event.envelope["event_type"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        event_types,
        vec!["property_option.deleted", "entity_property.updated"]
    );
    assert_eq!(
        events[0].envelope["metadata"]["option_id"],
        option_id.to_string(),
        "the retired label is the personal one"
    );
}

#[tokio::test]
async fn merge_tag_rejects_a_target_outside_the_team_tag_set() {
    let personal_definition_id = Uuid::from_u128(0x7F01);
    let team_definition_id = Uuid::from_u128(0x7F02);
    let option_id = Uuid::from_u128(0x7F03);

    let mut repo = MockPropertiesRepo::new();
    expect_tag_sets(
        &mut repo,
        property_option_for_event(
            option_id,
            personal_definition_id,
            0,
            PropertyOptionValue::String("Urgent".to_string()),
            Some("#ff0000"),
        ),
        personal_tag_definition(personal_definition_id),
        team_tag_definition(team_definition_id),
    );
    repo.expect_merge_tag_option()
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(None) }));

    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let err = service
        .merge_tag_option(
            &caller_user_id(),
            Some(&team_receipt()),
            option_id,
            Uuid::from_u128(0x7F04),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::OptionNotFound));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn merge_tag_rejects_merging_a_label_into_itself() {
    let option_id = Uuid::from_u128(0x8003);

    // The guard runs before anything is read, so provisioning a team tag set
    // is not a side effect of a request that was never going to work.
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_option().never();
    repo.expect_get_or_create_tag_definition().never();
    repo.expect_merge_tag_option().never();

    let service = PropertiesServiceImpl::new(
        repo,
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    );

    let err = service
        .merge_tag_option(
            &caller_user_id(),
            Some(&team_receipt()),
            option_id,
            option_id,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, PropertiesErr::Validation(_)));
}
