//! Whatever writes them, a start date never lands after the due date.

use super::*;
use models_properties::api::requests::SetPropertyValue;
use models_properties::shared::DateValue;

type RecordedPropertyWrites = Arc<Mutex<Vec<(Uuid, Option<PropertyValue>)>>>;

fn date_definition(id: Uuid, display_name: &str) -> PropertyDefinition {
    PropertyDefinition {
        id,
        owner: PropertyOwner::System,
        display_name: display_name.into(),
        data_type: DataType::Date,
        is_multi_select: false,
        specific_entity_type: None,
        created_at: event_timestamp(),
        updated_at: event_timestamp(),
        is_system: true,
        is_metadata: false,
    }
}

fn at(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&chrono::Utc)
}

fn day(value: &str) -> PropertyValue {
    PropertyValue::Date(DateValue::new(at(value)))
}

fn timed(value: &str) -> PropertyValue {
    PropertyValue::Date(DateValue::with_time(at(value)))
}

/// A repo over one initiative holding `stored` for the date it is not writing,
/// which records the values written for each definition.
fn repo_with(
    written: Uuid,
    other: Uuid,
    stored: Option<PropertyValue>,
    writes: RecordedPropertyWrites,
) -> MockPropertiesRepo {
    let mut repo = MockPropertiesRepo::new();
    let name = if written == SystemPropertyKey::START_DATE_UUID {
        "Start Date"
    } else {
        "Due Date"
    };
    let definition = date_definition(written, name);
    repo.expect_get_property_definition()
        .return_once(move |_| Box::pin(async move { Ok(Some(definition)) }));
    repo.expect_get_entity_property_value()
        .withf(move |_, kind, definition| *kind == EntityType::Initiative && *definition == other)
        .return_once(move |_, _, _| Box::pin(async move { Ok(stored) }));
    repo.expect_upsert_entity_property()
        .returning(move |id, kind, definition, value| {
            writes.lock().unwrap().push((definition, value.clone()));
            let snapshot = entity_property_mutation(id, kind, definition, value);
            Box::pin(async move { Ok(snapshot) })
        });
    repo
}

async fn write(
    written: Uuid,
    other: Uuid,
    stored: Option<PropertyValue>,
    value: SetPropertyValue,
) -> (Vec<(Uuid, Option<PropertyValue>)>, usize) {
    let writes = Arc::new(Mutex::new(Vec::new()));
    let events = RecordingEventBroker::default();
    let service = service_with_event_broker(
        repo_with(written, other, stored, writes.clone()),
        events.clone(),
    );
    service
        .set_entity_property(
            &edit_receipt("project-1", EntityType::Initiative),
            written,
            Some(value),
        )
        .await
        .unwrap();
    let writes = writes.lock().unwrap().clone();
    (writes, events.events().len())
}

const START: Uuid = SystemPropertyKey::START_DATE_UUID;
const DUE: Uuid = SystemPropertyKey::DUE_DATE_UUID;

#[tokio::test]
async fn a_start_the_day_after_a_due_date_held_at_its_end_is_moved_to_it() {
    let (writes, _) = write(
        START,
        DUE,
        Some(day("2026-11-28T07:59:59.999Z")),
        SetPropertyValue::Date {
            value: at("2026-11-28T08:00:00Z"),
            has_time: false,
        },
    )
    .await;

    assert_eq!(writes, [(START, Some(day("2026-11-28T07:59:59.999Z")))]);
}

#[tokio::test]
async fn a_start_after_the_due_date_is_stored_as_the_due_date() {
    let (writes, events) = write(
        START,
        DUE,
        Some(day("2026-11-27T08:00:00Z")),
        SetPropertyValue::Date {
            value: at("2026-11-30T08:00:00Z"),
            has_time: false,
        },
    )
    .await;

    assert_eq!(writes, [(START, Some(day("2026-11-27T08:00:00Z")))]);
    assert_eq!(events, 1);
}

#[tokio::test]
async fn a_start_on_or_before_the_due_date_or_with_none_is_stored_as_set() {
    for (due, start) in [
        (Some(day("2026-11-27T08:00:00Z")), "2026-11-27T08:00:00Z"),
        (Some(day("2026-11-27T08:00:00Z")), "2026-11-23T08:00:00Z"),
        // A due date picked as a suggestion is held at the end of its day.
        (
            Some(day("2026-11-28T07:59:59.999Z")),
            "2026-11-27T08:00:00Z",
        ),
        (None, "2026-11-30T08:00:00Z"),
    ] {
        let (writes, _) = write(
            START,
            DUE,
            due,
            SetPropertyValue::Date {
                value: at(start),
                has_time: false,
            },
        )
        .await;

        assert_eq!(writes, [(START, Some(day(start)))]);
    }
}

#[tokio::test]
async fn a_due_date_before_the_start_pulls_the_start_back_first() {
    let (writes, events) = write(
        DUE,
        START,
        Some(day("2026-11-23T08:00:00Z")),
        SetPropertyValue::Date {
            value: at("2026-11-20T08:00:00Z"),
            has_time: false,
        },
    )
    .await;

    assert_eq!(
        writes,
        [
            (START, Some(day("2026-11-20T08:00:00Z"))),
            (DUE, Some(day("2026-11-20T08:00:00Z"))),
        ]
    );
    assert_eq!(events, 2);
}

#[tokio::test]
async fn a_due_date_on_or_after_the_start_leaves_the_start_alone() {
    for start in [
        Some(day("2026-11-23T08:00:00Z")),
        Some(day("2026-11-27T08:00:00Z")),
        None,
    ] {
        let (writes, events) = write(
            DUE,
            START,
            start,
            SetPropertyValue::Date {
                value: at("2026-11-27T08:00:00Z"),
                has_time: false,
            },
        )
        .await;

        assert_eq!(writes, [(DUE, Some(day("2026-11-27T08:00:00Z")))]);
        assert_eq!(events, 1);
    }
}

#[tokio::test]
async fn a_due_time_earlier_than_the_start_time_pulls_the_start_to_it() {
    let (writes, _) = write(
        DUE,
        START,
        Some(timed("2026-11-24T22:00:00Z")),
        SetPropertyValue::Date {
            value: at("2026-11-24T19:00:00Z"),
            has_time: true,
        },
    )
    .await;

    assert_eq!(
        writes,
        [
            (START, Some(timed("2026-11-24T19:00:00Z"))),
            (DUE, Some(timed("2026-11-24T19:00:00Z"))),
        ]
    );
}

#[tokio::test]
async fn clearing_the_due_date_keeps_the_start() {
    let writes = Arc::new(Mutex::new(Vec::new()));
    let mut repo = MockPropertiesRepo::new();
    let definition = date_definition(DUE, "Due Date");
    repo.expect_get_property_definition()
        .return_once(move |_| Box::pin(async move { Ok(Some(definition)) }));
    repo.expect_get_entity_property_value().times(0);
    let recorded = writes.clone();
    repo.expect_upsert_entity_property()
        .returning(move |id, kind, definition, value| {
            recorded.lock().unwrap().push((definition, value.clone()));
            let snapshot = entity_property_mutation(id, kind, definition, value);
            Box::pin(async move { Ok(snapshot) })
        });
    let service = service_with_event_broker(repo, RecordingEventBroker::default());

    service
        .set_entity_property(
            &edit_receipt("project-1", EntityType::Initiative),
            DUE,
            None,
        )
        .await
        .unwrap();

    assert_eq!(*writes.lock().unwrap(), [(DUE, None)]);
}
