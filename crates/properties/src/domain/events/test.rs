use macro_event_broker::{Event, MacroEvent};
use macro_event_topics::{MacroPropertiesTopic, Topic};
use serde_json::{Value, json};

use super::*;

const PROPERTY_DEFINITION_ID: &str = "6e95d5f0-2bb8-4c0a-ae01-197301fdb56e";
const OPTION_ID: &str = "8a123d67-074f-4666-b3aa-214f99e7eb85";
const ENTITY_PROPERTY_ID: &str = "bb672788-40c1-47d1-a2e1-565d20fe40ef";
const TEAM_ID: &str = "94badb72-b7f7-46e4-89fb-497527836152";
const ENTITY_ID: &str = "document-bare-id";
const EVENT_ID: &str = "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f";
const CREATED_AT: &str = "2026-07-27T18:30:00Z";
const UPDATED_AT: &str = "2026-07-27T18:45:00Z";

fn uuid(value: &str) -> Uuid {
    Uuid::parse_str(value).expect("valid uuid")
}

fn timestamp(value: &str) -> DateTime<Utc> {
    value.parse().expect("valid timestamp")
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn topic_events(
    actor_user_id: Option<MacroUserIdStr<'static>>,
) -> Vec<(PropertyTopicEvent, Value)> {
    let actor_json = serde_json::to_value(&actor_user_id).expect("serializable actor");

    vec![
        (
            PropertyTopicEvent::Created(PropertyCreatedMetadata {
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                owner: PropertyOwner::User {
                    user_id: "macro|owner@acme.com".to_string(),
                },
                display_name: "Related task".to_string(),
                data_type: DataType::Entity,
                is_multi_select: false,
                specific_entity_type: Some(EntityType::Task),
                created_at: timestamp(CREATED_AT),
            }),
            json!({
                "event_type": "property.created",
                "metadata": {
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone(),
                    "owner": {
                        "scope": "user",
                        "user_id": "macro|owner@acme.com"
                    },
                    "display_name": "Related task",
                    "data_type": "ENTITY",
                    "is_multi_select": false,
                    "specific_entity_type": "TASK",
                    "created_at": CREATED_AT
                }
            }),
        ),
        (
            PropertyTopicEvent::Deleted(PropertyDeletedMetadata {
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                owner: PropertyOwner::Team {
                    team_id: uuid(TEAM_ID),
                },
                display_name: "Priority".to_string(),
                data_type: DataType::SelectString,
            }),
            json!({
                "event_type": "property.deleted",
                "metadata": {
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone(),
                    "owner": {
                        "scope": "team",
                        "team_id": TEAM_ID
                    },
                    "display_name": "Priority",
                    "data_type": "SELECT_STRING"
                }
            }),
        ),
        (
            PropertyTopicEvent::OptionCreated(PropertyOptionCreatedMetadata {
                option_id: uuid(OPTION_ID),
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                value: PropertyOptionValue::String("High".to_string()),
                color: Some("#FF0000".to_string()),
                display_order: 10,
            }),
            json!({
                "event_type": "property_option.created",
                "metadata": {
                    "option_id": OPTION_ID,
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone(),
                    "value": {
                        "type": "string",
                        "value": "High"
                    },
                    "color": "#FF0000",
                    "display_order": 10
                }
            }),
        ),
        (
            PropertyTopicEvent::OptionUpdated(PropertyOptionUpdatedMetadata {
                option_id: uuid(OPTION_ID),
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                value: PropertyOptionValue::Number(42.5),
                color: None,
                display_order: 20,
            }),
            json!({
                "event_type": "property_option.updated",
                "metadata": {
                    "option_id": OPTION_ID,
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone(),
                    "value": {
                        "type": "number",
                        "value": 42.5
                    },
                    "color": null,
                    "display_order": 20
                }
            }),
        ),
        (
            PropertyTopicEvent::OptionDeleted(PropertyOptionDeletedMetadata {
                option_id: uuid(OPTION_ID),
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                value: PropertyOptionValue::String("Retired".to_string()),
            }),
            json!({
                "event_type": "property_option.deleted",
                "metadata": {
                    "option_id": OPTION_ID,
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone(),
                    "value": {
                        "type": "string",
                        "value": "Retired"
                    }
                }
            }),
        ),
        (
            PropertyTopicEvent::EntityPropertyUpdated(EntityPropertyUpdatedMetadata {
                entity_property_id: uuid(ENTITY_PROPERTY_ID),
                entity_id: ENTITY_ID.to_string(),
                entity_type: EntityType::Document,
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                value: Some(PropertyValue::SelectOption(vec![uuid(OPTION_ID)])),
                updated_at: timestamp(UPDATED_AT),
            }),
            json!({
                "event_type": "entity_property.updated",
                "metadata": {
                    "entity_property_id": ENTITY_PROPERTY_ID,
                    "entity_id": ENTITY_ID,
                    "entity_type": "DOCUMENT",
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone(),
                    "value": {
                        "type": "SelectOption",
                        "value": [OPTION_ID]
                    },
                    "updated_at": UPDATED_AT
                }
            }),
        ),
        (
            PropertyTopicEvent::EntityPropertyDeleted(EntityPropertyDeletedMetadata {
                entity_property_id: uuid(ENTITY_PROPERTY_ID),
                entity_id: ENTITY_ID.to_string(),
                entity_type: EntityType::Document,
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
            }),
            json!({
                "event_type": "entity_property.deleted",
                "metadata": {
                    "entity_property_id": ENTITY_PROPERTY_ID,
                    "entity_id": ENTITY_ID,
                    "entity_type": "DOCUMENT",
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor_user_id": actor_json.clone()
                }
            }),
        ),
        (
            PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
                entity_id: ENTITY_ID.to_string(),
                entity_type: EntityType::Document,
                actor_user_id,
            }),
            json!({
                "event_type": "entity_properties.cleared",
                "metadata": {
                    "entity_id": ENTITY_ID,
                    "entity_type": "DOCUMENT",
                    "actor_user_id": actor_json
                }
            }),
        ),
    ]
}

fn macro_events() -> Vec<(PropertyMacroEvent, &'static str)> {
    topic_events(Some(user_id("macro|editor@acme.com")))
        .into_iter()
        .map(|(event, _)| match event {
            PropertyTopicEvent::Created(metadata) => (
                PropertyMacroEvent::created(metadata),
                PROPERTY_DEFINITION_ID,
            ),
            PropertyTopicEvent::Deleted(metadata) => (
                PropertyMacroEvent::deleted(metadata),
                PROPERTY_DEFINITION_ID,
            ),
            PropertyTopicEvent::OptionCreated(metadata) => (
                PropertyMacroEvent::property_option_created(metadata),
                PROPERTY_DEFINITION_ID,
            ),
            PropertyTopicEvent::OptionUpdated(metadata) => (
                PropertyMacroEvent::property_option_updated(metadata),
                PROPERTY_DEFINITION_ID,
            ),
            PropertyTopicEvent::OptionDeleted(metadata) => (
                PropertyMacroEvent::property_option_deleted(metadata),
                PROPERTY_DEFINITION_ID,
            ),
            PropertyTopicEvent::EntityPropertyUpdated(metadata) => (
                PropertyMacroEvent::entity_property_updated(metadata),
                ENTITY_ID,
            ),
            PropertyTopicEvent::EntityPropertyDeleted(metadata) => (
                PropertyMacroEvent::entity_property_deleted(metadata),
                ENTITY_ID,
            ),
            PropertyTopicEvent::EntityPropertiesCleared(metadata) => (
                PropertyMacroEvent::entity_properties_cleared(metadata),
                ENTITY_ID,
            ),
        })
        .collect()
}

#[test]
fn every_variant_has_exact_json_envelope() {
    let event_id = uuid(EVENT_ID);

    for (event, expected_payload) in topic_events(Some(user_id("macro|editor@acme.com"))) {
        let mut expected = expected_payload;
        let object = expected.as_object_mut().expect("expected object");
        object.insert("event_id".to_string(), json!(EVENT_ID));
        object.insert("schema_version".to_string(), json!(1));

        assert_eq!(
            serde_json::to_value(Event::with_event_id(event_id, event))
                .expect("serializable event"),
            expected
        );
    }
}

#[test]
fn every_variant_round_trips() {
    for (original, expected_key) in macro_events() {
        let payload = serde_json::to_vec(original.event()).expect("serializable event");
        let decoded =
            PropertyMacroEvent::decode(original.key(), &payload).expect("decodable event");

        assert_eq!(decoded.key(), expected_key);
        assert_eq!(decoded.event(), original.event());
        assert_eq!(decoded.topic(), MacroPropertiesTopic::TOPIC_STR);
        assert_eq!(decoded.topic(), "macro.properties");
    }
}

#[test]
fn constructors_use_exact_bare_keys_topic_and_schema_version() {
    for (event, expected_key) in macro_events() {
        assert_eq!(event.key(), expected_key);
        assert_eq!(event.topic(), "macro.properties");
        assert_eq!(event.event().schema_version, 1);
    }
}

#[test]
fn every_variant_supports_a_null_actor() {
    for (event, expected) in topic_events(None) {
        let serialized = serde_json::to_value(&event).expect("serializable event");

        assert_eq!(serialized, expected);
        assert_eq!(serialized["metadata"]["actor_user_id"], Value::Null);
        assert_eq!(
            serde_json::from_value::<PropertyTopicEvent>(serialized).expect("decodable event"),
            event
        );
    }
}

#[test]
fn shared_owner_and_value_types_keep_exact_wire_representations() {
    let owner_representations = [
        (
            PropertyOwner::User {
                user_id: "macro|owner@acme.com".to_string(),
            },
            json!({"scope": "user", "user_id": "macro|owner@acme.com"}),
        ),
        (
            PropertyOwner::Team {
                team_id: uuid(TEAM_ID),
            },
            json!({"scope": "team", "team_id": TEAM_ID}),
        ),
        (PropertyOwner::System, json!({"scope": "system"})),
    ];

    for (owner, expected) in owner_representations {
        assert_eq!(serde_json::to_value(owner).unwrap(), expected);
    }

    assert_eq!(
        serde_json::to_value(PropertyOptionValue::String("High".to_string())).unwrap(),
        json!({"type": "string", "value": "High"})
    );
    assert_eq!(
        serde_json::to_value(PropertyOptionValue::Number(42.5)).unwrap(),
        json!({"type": "number", "value": 42.5})
    );
    assert_eq!(
        serde_json::to_value(PropertyValue::SelectOption(vec![uuid(OPTION_ID)])).unwrap(),
        json!({"type": "SelectOption", "value": [OPTION_ID]})
    );
    assert_eq!(
        serde_json::to_value(PropertyValue::Str("free text".to_string())).unwrap(),
        json!({"type": "String", "value": "free text"})
    );
}
