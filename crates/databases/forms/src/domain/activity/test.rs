use ::activity::{Action, activity_id};
use chrono::{TimeZone as _, Utc};
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::events::{
    Attribution as EventAttribution, FormChangedMetadata, FormCreatedMetadata, FormPurgedMetadata,
    FormRenamedMetadata, FormResponseSubmittedMetadata,
};
use crate::domain::models::{DatabaseId, FormResponseId, RowId};

const FORM_ID: &str = "0199b1a2-0000-7000-8000-000000000f01";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: FormTopicEvent) -> Event<FormTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

#[test]
fn created_maps_to_a_created_activity_of_the_creator_at_creation_time() {
    let created_at = Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap();
    let event = envelope(FormTopicEvent::Created(FormCreatedMetadata {
        form_id: FORM_ID.parse().unwrap(),
        database_id: DatabaseId::from_uuid(Uuid::from_u128(0xdb)),
        owner: user("macro|creator@example.com"),
        name: "Q4 offsite RSVP".to_string(),
        created_at,
        attribution: EventAttribution::user(user("macro|creator@example.com")),
    }));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("a creation is activity");
    };
    assert_eq!(activities.len(), 1);
    let activity = &activities[0];
    assert_eq!(activity.action, Action::Created);
    assert_eq!(activity.entity_type, EntityType::Form);
    assert_eq!(activity.entity_id, FORM_ID);
    assert_eq!(activity.subject_id, "macro|creator@example.com");
    assert_eq!(activity.occurred_at, created_at);
    assert_eq!(activity.id, activity_id(event.event_id, 0));
}

#[test]
fn renames_restores_and_sharing_are_edits_and_a_signed_in_response_is_responded() {
    let submitted_at = Utc.with_ymd_and_hms(2026, 9, 2, 8, 30, 0).unwrap();
    let events = [
        FormTopicEvent::Renamed(FormRenamedMetadata {
            form_id: FORM_ID.parse().unwrap(),
            attribution: Some(EventAttribution::user(user("macro|editor@example.com"))),
            name: "Renamed".to_string(),
        }),
        FormTopicEvent::Restored(FormChangedMetadata {
            form_id: FORM_ID.parse().unwrap(),
            attribution: Some(EventAttribution::user(user("macro|editor@example.com"))),
        }),
        FormTopicEvent::SharingChanged(FormChangedMetadata {
            form_id: FORM_ID.parse().unwrap(),
            attribution: Some(EventAttribution::user(user("macro|editor@example.com"))),
        }),
    ];
    for event in events {
        let envelope = envelope(event);
        let Ingest::Insert(activities) = envelope.event.ingest(envelope.event_id) else {
            panic!("an attributed change is activity");
        };
        assert_eq!(activities[0].action, Action::Edited);
        assert_eq!(activities[0].subject_id, "macro|editor@example.com");
    }

    let response = envelope(FormTopicEvent::ResponseSubmitted(
        FormResponseSubmittedMetadata {
            form_id: FORM_ID.parse().unwrap(),
            response_id: FormResponseId::from_uuid(Uuid::from_u128(0xe1)),
            respondent: Some(user("macro|respondent@example.com")),
            row_id: Some(RowId::from_uuid(Uuid::from_u128(0x40))),
            submitted_at,
        },
    ));
    let Ingest::Insert(activities) = response.event.ingest(response.event_id) else {
        panic!("a signed-in response is activity");
    };
    assert_eq!(activities.len(), 1);
    assert_eq!(activities[0].action, Action::Responded);
    assert_eq!(activities[0].actor.as_ref(), "macro|respondent@example.com");
    assert_eq!(activities[0].subject_id, "macro|respondent@example.com");
    assert_eq!(activities[0].entity_type, EntityType::Form);
    assert_eq!(activities[0].occurred_at, submitted_at);
}

#[test]
fn anonymous_responses_and_internal_changes_are_not_activity_and_purges_purge() {
    let anonymous = envelope(FormTopicEvent::ResponseSubmitted(
        FormResponseSubmittedMetadata {
            form_id: FORM_ID.parse().unwrap(),
            response_id: FormResponseId::from_uuid(Uuid::from_u128(0xe2)),
            respondent: None,
            row_id: Some(RowId::from_uuid(Uuid::from_u128(0x41))),
            submitted_at: Utc.with_ymd_and_hms(2026, 9, 2, 8, 30, 0).unwrap(),
        },
    ));
    assert_eq!(anonymous.event.ingest(anonymous.event_id), Ingest::Ignore);

    let internal = envelope(FormTopicEvent::Trashed(FormChangedMetadata {
        form_id: FORM_ID.parse().unwrap(),
        attribution: None,
    }));
    assert_eq!(internal.event.ingest(internal.event_id), Ingest::Ignore);

    let purged = envelope(FormTopicEvent::Purged(FormPurgedMetadata {
        form_id: FORM_ID.parse().unwrap(),
    }));
    assert_eq!(
        purged.event.ingest(purged.event_id),
        Ingest::Purge(vec![(EntityType::Form, FORM_ID.to_string())])
    );
}
