//! Time logged is derived from time entries: every value mutator refuses it
//! before touching storage, for every caller, including internal ones.

use super::*;
use crate::domain::model::EntityPropertyOptionUpdate;
use models_properties::api::requests::SetPropertyValue;

const TIME_LOGGED: Uuid = SystemPropertyKey::TIME_LOGGED_UUID;

fn refused(error: PropertiesErr) -> bool {
    matches!(error, PropertiesErr::Validation(message) if message.starts_with("Time logged is the sum"))
}

fn untouched_repo() -> MockPropertiesRepo {
    MockPropertiesRepo::new()
}

#[tokio::test]
async fn set_entity_property_refuses_time_logged() {
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(untouched_repo(), event_broker.clone());

    let error = service
        .set_entity_property(
            &edit_receipt("task-1", EntityType::Task),
            TIME_LOGGED,
            Some(SetPropertyValue::Number { value: 600.0 }),
        )
        .await
        .unwrap_err();

    assert!(refused(error));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn set_entity_property_with_source_refuses_time_logged_for_internal_callers() {
    let service = service_with_event_broker(untouched_repo(), RecordingEventBroker::default());

    let error = service
        .set_entity_property_with_source(
            &EditReceipt::dangerously_assert_internal_user(
                "task-1",
                canonical_entity_type(EntityType::Task),
            ),
            TIME_LOGGED,
            None,
            None,
        )
        .await
        .unwrap_err();

    assert!(refused(error));
}

#[tokio::test]
async fn add_entity_property_option_refuses_time_logged() {
    let service = service_with_event_broker(untouched_repo(), RecordingEventBroker::default());

    let error = service
        .add_entity_property_option(
            &edit_receipt("task-1", EntityType::Task),
            TIME_LOGGED,
            Uuid::from_u128(0x51),
        )
        .await
        .unwrap_err();

    assert!(refused(error));
}

#[tokio::test]
async fn remove_entity_property_option_refuses_time_logged() {
    let service = service_with_event_broker(untouched_repo(), RecordingEventBroker::default());

    let error = service
        .remove_entity_property_option(
            &edit_receipt("task-1", EntityType::Task),
            TIME_LOGGED,
            Uuid::from_u128(0x51),
        )
        .await
        .unwrap_err();

    assert!(refused(error));
}

#[tokio::test]
async fn bulk_update_entity_property_options_refuses_time_logged_among_other_updates() {
    let service = service_with_event_broker(untouched_repo(), RecordingEventBroker::default());

    let error = service
        .bulk_update_entity_property_options(
            &edit_receipt("task-1", EntityType::Task),
            vec![
                EntityPropertyOptionUpdate {
                    property_definition_id: Uuid::from_u128(0xA1),
                    add_option_ids: vec![Uuid::from_u128(0x51)],
                    remove_option_ids: Vec::new(),
                },
                EntityPropertyOptionUpdate {
                    property_definition_id: TIME_LOGGED,
                    add_option_ids: vec![Uuid::from_u128(0x52)],
                    remove_option_ids: Vec::new(),
                },
            ],
        )
        .await
        .unwrap_err();

    assert!(refused(error));
}

#[tokio::test]
async fn bulk_update_entities_property_options_refuses_time_logged() {
    let service = service_with_event_broker(untouched_repo(), RecordingEventBroker::default());

    let error = service
        .bulk_update_entities_property_options(
            &[
                edit_receipt("task-1", EntityType::Task),
                edit_receipt("task-2", EntityType::Task),
            ],
            TIME_LOGGED,
            vec![Uuid::from_u128(0x51)],
            Vec::new(),
        )
        .await
        .unwrap_err();

    assert!(refused(error));
}

#[tokio::test]
async fn delete_entity_property_refuses_time_logged() {
    let entity_property_id = Uuid::from_u128(0xC7);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_lookup_entity_property()
        .times(1)
        .returning(move |_| {
            Box::pin(async move {
                Ok(Some(models_properties::EntityPropertyReference {
                    entity_id: "task-1".to_string(),
                    entity_type: EntityType::Task,
                    property_definition_id: TIME_LOGGED,
                }))
            })
        });
    repo.expect_delete_entity_property().times(0);
    let event_broker = RecordingEventBroker::default();
    let service = service_with_event_broker(repo, event_broker.clone());

    let error = service
        .delete_entity_property(
            &edit_receipt("task-1", EntityType::Task),
            entity_property_id,
        )
        .await
        .unwrap_err();

    assert!(refused(error));
    assert!(event_broker.events().is_empty());
}
