use super::super::{
    events::{InitiativeChange, InitiativeEventActor, InitiativeTopicEvent},
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

#[test]
fn attributed_lifecycle_changes_record_one_stable_row() {
    let change = InitiativeChange {
        initiative_id: id(1),
        attribution: actor(),
        occurred_at: time(),
    };
    let event_id = uuid::Uuid::from_u128(9);
    for (event, action) in [
        (InitiativeTopicEvent::Created(change.clone()), "created"),
        (InitiativeTopicEvent::Updated(change), "edited"),
    ] {
        let ingest = event.ingest(event_id);
        assert_eq!(ingest, event.ingest(event_id));
        let Ingest::Insert(rows) = ingest else {
            panic!("activities");
        };
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].entity_id, id(1).to_string());
        assert_eq!(rows[0].action.to_columns().0, action);
    }
}
