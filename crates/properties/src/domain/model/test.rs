use super::*;

const STORAGE_TYPES: [EntityType; 10] = [
    EntityType::CalendarEvent,
    EntityType::CallRecord,
    EntityType::Channel,
    EntityType::Chat,
    EntityType::Company,
    EntityType::Document,
    EntityType::Project,
    EntityType::Task,
    EntityType::Thread,
    EntityType::User,
];

#[test]
fn every_storage_type_round_trips_through_its_canonical_type() {
    for storage in STORAGE_TYPES {
        let expected = match storage {
            EntityType::Task => EntityType::Document,
            other => other,
        };
        assert_eq!(
            storage_entity_type(canonical_entity_type(storage)),
            Some(expected),
            "{storage:?}"
        );
    }
}

#[test]
fn email_thread_is_the_canonical_type_for_thread_storage() {
    assert_eq!(
        canonical_entity_type(EntityType::Thread),
        AccessEntityType::EmailThread
    );
    assert_eq!(
        storage_entity_type(AccessEntityType::EmailThread),
        Some(EntityType::Thread)
    );
}

#[test]
fn canonical_types_without_properties_storage_map_to_none() {
    for unsupported in [
        AccessEntityType::ChannelMessage,
        AccessEntityType::Team,
        AccessEntityType::ForeignEntity,
        AccessEntityType::StaticFile,
        AccessEntityType::CrmContact,
        AccessEntityType::Reminder,
        AccessEntityType::Skill,
        AccessEntityType::AgentSession,
    ] {
        assert_eq!(storage_entity_type(unsupported), None, "{unsupported:?}");
    }
}
