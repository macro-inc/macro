use super::super::{
    events::{
        InitiativeChange, InitiativeEventActor, InitiativeTasksChanged, InitiativeTopicEvent,
        TaskMembershipChange,
    },
    models::InitiativeId,
};
use activity::{ActivitySource, Actor, Ingest};
use chrono::{TimeZone, Utc};

fn id(value: u128) -> InitiativeId {
    InitiativeId::from_uuid(uuid::Uuid::from_u128(value))
}
fn actor() -> Option<InitiativeEventActor> {
    Some(InitiativeEventActor {
        actor: Actor::try_from("macro|teo@macro.com".to_string()).unwrap(),
        on_behalf_of: None,
    })
}
fn time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 22, 12, 0, 0).unwrap()
}

#[test]
fn moves_record_source_and_destination_with_stable_ids() {
    let event = InitiativeTopicEvent::TasksChanged(InitiativeTasksChanged {
        attribution: actor(),
        occurred_at: time(),
        changes: vec![TaskMembershipChange {
            task_id: "task-1".into(),
            from: Some(id(1)),
            to: Some(id(2)),
        }],
    });
    let event_id = uuid::Uuid::from_u128(9);
    let rows = event.ingest(event_id);
    assert_eq!(rows, event.ingest(event_id));
    let Ingest::Insert(rows) = rows else {
        panic!("activities");
    };
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].entity_id, id(1).to_string());
    assert_eq!(rows[0].action.to_columns().0, "task_removed");
    assert_eq!(rows[1].entity_id, id(2).to_string());
    assert_eq!(rows[1].action.to_columns().0, "task_added");
    assert_ne!(rows[0].id, rows[1].id);
}

#[test]
fn repeated_assignment_is_not_new_activity() {
    let event = InitiativeTopicEvent::TasksChanged(InitiativeTasksChanged {
        attribution: actor(),
        occurred_at: time(),
        changes: vec![TaskMembershipChange {
            task_id: "task-1".into(),
            from: Some(id(1)),
            to: Some(id(1)),
        }],
    });
    assert_eq!(event.ingest(uuid::Uuid::from_u128(9)), Ingest::Ignore);
}

#[test]
fn unattributable_mutations_are_ignored_but_purges_are_applied() {
    let change = InitiativeChange {
        initiative_id: id(1),
        attribution: None,
        occurred_at: time(),
    };
    assert_eq!(
        InitiativeTopicEvent::Created(change).ingest(uuid::Uuid::from_u128(9)),
        Ingest::Ignore
    );
    assert_eq!(
        InitiativeTopicEvent::Purged {
            initiative_id: id(1)
        }
        .ingest(uuid::Uuid::from_u128(9)),
        Ingest::Purge(vec![(activity::EntityType::Initiative, id(1).to_string())])
    );
}
