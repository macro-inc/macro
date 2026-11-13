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
                owner: Some(PropertyOwner::Team {
                    team_id: uuid(TEAM_ID),
                }),
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
                    "owner": {
                        "scope": "team",
                        "team_id": TEAM_ID
                    },
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
                owner: Some(PropertyOwner::Team {
                    team_id: uuid(TEAM_ID),
                }),
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
                    "owner": {
                        "scope": "team",
                        "team_id": TEAM_ID
                    },
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
                owner: None,
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
                inherited_from_project: None,
                entity_property_id: uuid(ENTITY_PROPERTY_ID),
                entity_id: ENTITY_ID.to_string(),
                entity_type: EntityType::Document,
                property_definition_id: uuid(PROPERTY_DEFINITION_ID),
                actor_user_id: actor_user_id.clone(),
                actor: None,
                on_behalf_of: None,
                source: None,
                value: Some(PropertyValue::SelectOption(vec![uuid(OPTION_ID)])),
                previous_value: None,
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
                    "previous_value": null,
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
                actor: None,
                on_behalf_of: None,
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
                actor: None,
                on_behalf_of: None,
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
fn entity_property_updated_decodes_without_actor_fields() {
    let json = json!({
        "event_type": "entity_property.updated",
        "metadata": {
            "entity_property_id": ENTITY_PROPERTY_ID,
            "entity_id": ENTITY_ID,
            "entity_type": "DOCUMENT",
            "property_definition_id": PROPERTY_DEFINITION_ID,
            "actor_user_id": "macro|editor@acme.com",
            "value": null,
            "previous_value": null,
            "updated_at": UPDATED_AT
        }
    });
    let event: PropertyTopicEvent = serde_json::from_value(json).expect("decodable event");
    let PropertyTopicEvent::EntityPropertyUpdated(metadata) = event else {
        panic!("expected entity_property.updated");
    };
    assert_eq!(metadata.actor, None);
    assert_eq!(metadata.on_behalf_of, None);
    assert_eq!(
        metadata.actor_user_id,
        Some(user_id("macro|editor@acme.com"))
    );
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

mod exposure {
    use super::*;
    use macro_event_broker::exposure::{
        Audience, EntityType as MacroEntityType, Exposure, PublicEvent, Stage,
    };

    fn public(event: &PropertyTopicEvent) -> PublicEvent<'_, PropertyPublicEvent> {
        match event.exposure().unwrap() {
            Exposure::Public(public) => public,
            Exposure::Internal(reason) => panic!("expected public, got {reason}"),
        }
    }

    fn updated(entity_type: EntityType) -> PropertyTopicEvent {
        PropertyTopicEvent::EntityPropertyUpdated(EntityPropertyUpdatedMetadata {
            entity_property_id: uuid(ENTITY_PROPERTY_ID),
            entity_id: ENTITY_ID.to_owned(),
            entity_type,
            property_definition_id: uuid(PROPERTY_DEFINITION_ID),
            actor_user_id: Some(user_id("macro|editor@example.com")),
            actor: None,
            on_behalf_of: None,
            source: None,
            inherited_from_project: None,
            value: Some(PropertyValue::Bool(true)),
            previous_value: Some(PropertyValue::Bool(false)),
            updated_at: timestamp(UPDATED_AT),
        })
    }

    #[test]
    fn entity_property_events_reach_the_carrying_entity_in_preview() {
        let events = [
            updated(EntityType::Task),
            PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
                entity_id: ENTITY_ID.to_owned(),
                entity_type: EntityType::Task,
                actor_user_id: None,
                actor: None,
                on_behalf_of: None,
            }),
        ];
        for event in &events {
            let public = public(event);
            assert_eq!(
                public.audience,
                Audience::Entity {
                    entity_type: MacroEntityType::Document,
                    entity_id: ENTITY_ID.to_owned(),
                },
                "{}",
                public.name
            );
            assert_eq!(public.stage, Stage::Preview);
            assert_eq!(
                serde_json::to_value(public.payload.as_ref()).unwrap()["event_type"],
                public.name
            );
        }
    }

    #[test]
    fn updated_payload_carries_the_value_change() {
        let event = updated(EntityType::Thread);
        let public = public(&event);
        assert_eq!(
            public.audience,
            Audience::Entity {
                entity_type: MacroEntityType::EmailThread,
                entity_id: ENTITY_ID.to_owned(),
            }
        );
        assert_eq!(
            serde_json::to_value(public.payload.as_ref()).unwrap(),
            json!({
                "event_type": "entity_property.updated",
                "metadata": {
                    "entity_property_id": ENTITY_PROPERTY_ID,
                    "entity_type": "email_thread",
                    "entity_id": ENTITY_ID,
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor": "macro|editor@example.com",
                    "on_behalf_of": null,
                    "value": {"type": "Boolean", "value": true},
                    "previous_value": {"type": "Boolean", "value": false},
                    "updated_at": UPDATED_AT,
                },
            })
        );
    }

    #[test]
    fn properties_without_an_entity_audience_stay_internal() {
        for entity_type in [EntityType::CalendarEvent, EntityType::User] {
            assert!(matches!(
                updated(entity_type).exposure().unwrap(),
                Exposure::Internal(_)
            ));
        }
    }

    #[cfg(feature = "inbound")]
    #[test]
    fn public_payload_has_a_schema() {
        use utoipa::ToSchema as _;
        assert_eq!(PropertyPublicEvent::name(), "PropertyPublicEvent");
    }

    /// Personal tags are visible only to their owner, and the event cannot
    /// tell a tag from any other select, so select changes and removals stay
    /// internal until the producer says.
    #[test]
    fn possible_personal_tag_changes_stay_internal() {
        let PropertyTopicEvent::EntityPropertyUpdated(mut select) = updated(EntityType::Task)
        else {
            unreachable!()
        };
        select.value = Some(PropertyValue::SelectOption(vec![uuid(OPTION_ID)]));
        select.previous_value = None;
        let removed = PropertyTopicEvent::EntityPropertyDeleted(EntityPropertyDeletedMetadata {
            entity_property_id: uuid(ENTITY_PROPERTY_ID),
            entity_id: ENTITY_ID.to_owned(),
            entity_type: EntityType::Task,
            property_definition_id: uuid(PROPERTY_DEFINITION_ID),
            actor_user_id: None,
            actor: None,
            on_behalf_of: None,
        });
        for event in [PropertyTopicEvent::EntityPropertyUpdated(select), removed] {
            assert!(matches!(event.exposure().unwrap(), Exposure::Internal(_)));
        }
    }
}

mod definition_exposure {
    use super::*;
    use macro_event_broker::exposure::{
        Audience, EntityRef, EntityType as MacroEntityType, Exposure, MinTeamRole,
        PublicEntityType, PublicEvent, Stage,
    };

    fn public(event: &PropertyTopicEvent) -> PublicEvent<'_, PropertyPublicEvent> {
        match event.exposure().unwrap() {
            Exposure::Public(public) => public,
            Exposure::Internal(reason) => panic!("expected public, got {reason}"),
        }
    }

    fn created(owner: PropertyOwner) -> PropertyTopicEvent {
        PropertyTopicEvent::Created(PropertyCreatedMetadata {
            property_definition_id: uuid(PROPERTY_DEFINITION_ID),
            actor_user_id: Some(user_id("macro|creator@example.com")),
            owner,
            display_name: "Priority".to_string(),
            data_type: DataType::SelectString,
            is_multi_select: false,
            specific_entity_type: None,
            created_at: timestamp(CREATED_AT),
        })
    }

    fn option_deleted(owner: Option<PropertyOwner>) -> PropertyTopicEvent {
        PropertyTopicEvent::OptionDeleted(PropertyOptionDeletedMetadata {
            option_id: uuid(OPTION_ID),
            property_definition_id: uuid(PROPERTY_DEFINITION_ID),
            owner,
            actor_user_id: Some(user_id("macro|creator@example.com")),
            value: PropertyOptionValue::String("Retired".to_string()),
        })
    }

    #[test]
    fn the_definition_owner_decides_the_audience() {
        let team_id = uuid(TEAM_ID);
        let cases = [
            (
                PropertyOwner::User {
                    user_id: "macro|owner@example.com".to_string(),
                },
                Audience::Owner {
                    user_id: user_id("macro|owner@example.com"),
                },
            ),
            (
                PropertyOwner::Team { team_id },
                Audience::Team {
                    team_id,
                    min_role: MinTeamRole::Member,
                },
            ),
            (
                PropertyOwner::Database {
                    database_id: team_id,
                },
                Audience::Entity {
                    entity_type: MacroEntityType::Database,
                    entity_id: TEAM_ID.to_string(),
                },
            ),
        ];
        for (owner, audience) in cases {
            for event in [created(owner.clone()), option_deleted(Some(owner))] {
                let public = public(&event);
                assert_eq!(public.audience, audience, "{}", public.name);
                assert_eq!(public.stage, Stage::Preview);
                assert_eq!(
                    public.entity,
                    EntityRef::new(PublicEntityType::Property, PROPERTY_DEFINITION_ID)
                );
            }
        }
    }

    #[test]
    fn system_definitions_and_options_without_an_owner_stay_internal() {
        for event in [
            created(PropertyOwner::System),
            option_deleted(Some(PropertyOwner::System)),
            option_deleted(None),
        ] {
            assert!(matches!(event.exposure().unwrap(), Exposure::Internal(_)));
        }
    }

    #[test]
    fn a_malformed_user_owner_is_rejected() {
        let event = created(PropertyOwner::User {
            user_id: "not-a-user".to_string(),
        });
        assert!(event.exposure().is_err());
    }

    #[test]
    fn every_definition_and_option_variant_is_public_under_its_own_name() {
        for (event, wire) in topic_events(Some(user_id("macro|actor@example.com"))) {
            let name = wire["event_type"].as_str().unwrap();
            if !(name.starts_with("property.") || name.starts_with("property_option.")) {
                continue;
            }
            let expected_public = name != "property_option.deleted";
            match event.exposure().unwrap() {
                Exposure::Public(public) => {
                    assert!(expected_public, "{name}");
                    assert_eq!(public.name, name);
                    assert_eq!(
                        serde_json::to_value(public.payload.as_ref()).unwrap()["event_type"],
                        name
                    );
                }
                // The deleted-option fixture predates owners on options.
                Exposure::Internal(_) => assert!(!expected_public, "{name}"),
            }
        }
    }

    #[test]
    fn public_bodies_are_thin() {
        assert_eq!(
            serde_json::to_value(
                public(&created(PropertyOwner::Team {
                    team_id: uuid(TEAM_ID)
                }))
                .payload
                .as_ref()
            )
            .unwrap(),
            json!({
                "event_type": "property.created",
                "metadata": {
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "owner": { "scope": "team", "team_id": TEAM_ID },
                    "display_name": "Priority",
                    "data_type": "SELECT_STRING",
                    "is_multi_select": false,
                    "actor": "macro|creator@example.com",
                    "created_at": CREATED_AT
                }
            })
        );
        let option = PropertyTopicEvent::OptionUpdated(PropertyOptionUpdatedMetadata {
            option_id: uuid(OPTION_ID),
            property_definition_id: uuid(PROPERTY_DEFINITION_ID),
            owner: Some(PropertyOwner::Team {
                team_id: uuid(TEAM_ID),
            }),
            actor_user_id: None,
            value: PropertyOptionValue::String("High".to_string()),
            color: Some("#FF0000".to_string()),
            display_order: 3,
        });
        assert_eq!(
            serde_json::to_value(public(&option).payload.as_ref()).unwrap(),
            json!({
                "event_type": "property_option.updated",
                "metadata": {
                    "option_id": OPTION_ID,
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor": null,
                    "value": { "type": "string", "value": "High" },
                    "color": "#FF0000",
                    "display_order": 3
                }
            })
        );
        assert_eq!(
            serde_json::to_value(
                public(&option_deleted(Some(PropertyOwner::Team {
                    team_id: uuid(TEAM_ID)
                })))
                .payload
                .as_ref()
            )
            .unwrap(),
            json!({
                "event_type": "property_option.deleted",
                "metadata": {
                    "option_id": OPTION_ID,
                    "property_definition_id": PROPERTY_DEFINITION_ID,
                    "actor": "macro|creator@example.com"
                }
            })
        );
    }

    #[test]
    fn option_events_without_an_owner_still_decode() {
        let event: PropertyTopicEvent = serde_json::from_value(json!({
            "event_type": "property_option.deleted",
            "metadata": {
                "option_id": OPTION_ID,
                "property_definition_id": PROPERTY_DEFINITION_ID,
                "actor_user_id": null,
                "value": { "type": "string", "value": "Retired" }
            }
        }))
        .unwrap();
        let PropertyTopicEvent::OptionDeleted(metadata) = event else {
            panic!("expected property_option.deleted");
        };
        assert_eq!(metadata.owner, None);
    }
}
