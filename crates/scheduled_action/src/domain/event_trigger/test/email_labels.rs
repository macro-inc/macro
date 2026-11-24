//! `email.labeled`: labels a thread gains, as mail arrives or later.

use super::*;

const LABEL: &str = "01900000-0000-7000-8000-0000000000b1";
const OTHER_INBOX_LABEL: &str = "01900000-0000-7000-8000-0000000000b2";

fn label() -> Uuid {
    Uuid::parse_str(LABEL).unwrap()
}

fn email_event(name: &str, metadata: Value) -> IncomingEvent {
    IncomingEvent {
        event_id: Uuid::parse_str(EVENT_ID).unwrap(),
        schema_version: 1,
        routine_id: None,
        payload: EventPayload::Email(
            serde_json::from_value(json!({ "event_type": name, "metadata": metadata })).unwrap(),
        ),
    }
}

fn received(labels_gained: &[&str]) -> IncomingEvent {
    email_event(
        "email.message_received",
        json!({
            "link_id": OTHER_ID, "owner": HUMAN, "message_id": OTHER_ID,
            "provider_message_id": "provider-msg", "thread_id": ENTITY_ID,
            "provider_thread_id": "provider-thread", "is_new_thread": false,
            "to_emails": [], "attachment_count": 0, "is_spam_or_trash": false,
            "labels_gained": labels_gained,
        }),
    )
}

fn labels_updated(labels_gained: &[&str], automated: bool) -> IncomingEvent {
    email_event(
        "email.thread_labels_updated",
        json!({
            "link_id": OTHER_ID, "owner": HUMAN, "actor": HUMAN, "thread_id": ENTITY_ID,
            "added": [{ "label_id": LABEL, "provider_label_id": "Label_1", "name": "Private name" }],
            "removed": [], "origin": "user_action", "labels_gained": labels_gained,
            "automated": automated,
        }),
    )
}

fn filters(value: Value) -> EventFilters {
    serde_json::from_value(value).unwrap()
}

fn matches(filters: &EventFilters, event: &EventReference) -> bool {
    filters.matches(event, DateTime::<Utc>::MIN_UTC)
}

#[test]
fn a_label_change_that_gains_a_label_is_an_email_label_event() {
    let event = labels_updated(&[LABEL], false).normalize().unwrap();
    assert_eq!(event.event_name(), EventName::EmailLabeled);
    assert_eq!(event.entity_type(), EventEntityType::EmailThread);
    assert_eq!(event.entity_id(), Some(Uuid::parse_str(ENTITY_ID).unwrap()));
    assert_eq!(event.message_id(), None);
    assert_eq!(event.labels_gained(), [label()]);
    // The run keeps ids, never label names.
    let run = filters(json!([{ "events": ["email.labeled"] }])).run_event(&event);
    assert_eq!(run.labels_gained(), [label()]);
    let stored = serde_json::to_string(&run).unwrap();
    assert!(!stored.contains("Private name"));
    assert_eq!(
        serde_json::from_str::<EventReference>(&stored).unwrap(),
        run
    );
}

#[test]
fn a_label_routine_can_watch_some_of_the_owners_inboxes() {
    const ELSEWHERE: &str = "01900000-0000-7000-8000-0000000000c1";
    let picking =
        |inbox: &str| filters(json!([{ "events": ["email.labeled"], "inboxes": [inbox] }]));
    let later = labels_updated(&[LABEL], false).normalize().unwrap();
    let arriving = received(&[LABEL]).normalize().unwrap();
    for event in [&later, &arriving] {
        assert!(matches(&picking(OTHER_ID), event));
        assert!(!matches(&picking(ELSEWHERE), event));
        assert!(picking(ELSEWHERE).turn_away_only_for_inbox(event, DateTime::<Utc>::MIN_UTC));
    }
    let both = filters(json!([{
        "events": ["email.labeled"], "inboxes": [OTHER_ID], "labels": [OTHER_INBOX_LABEL]
    }]));
    assert!(!matches(&both, &later));
}

#[test]
fn labels_the_thread_had_and_labels_a_program_added_start_nothing() {
    assert_eq!(
        labels_updated(&[], false).normalize(),
        Err(EventRejection::UnsupportedEvent)
    );
    assert_eq!(
        labels_updated(&[LABEL], true).normalize(),
        Err(EventRejection::UnsafeAttribution)
    );
    let mut by_routine = labels_updated(&[LABEL], false);
    by_routine.routine_id = Some(Uuid::now_v7());
    assert_eq!(by_routine.normalize(), Err(EventRejection::RoutineWrite));
}

#[test]
fn labels_reach_the_inbox_owner_and_its_delegates_only() {
    let event = labels_updated(&[LABEL], false);
    let owner = MacroUserIdStr::parse_from_str(HUMAN).unwrap();
    assert!(event.is_for_owner(&owner));
    assert!(
        !event.is_for_owner(&MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap())
    );
    assert_eq!(
        event.mail_inbox(),
        Some((&owner, Uuid::parse_str(OTHER_ID).unwrap()))
    );
}

#[test]
fn a_label_routine_runs_on_mail_that_arrives_with_one_of_its_labels() {
    let any = filters(json!([{ "events": ["email.labeled"] }]));
    let chosen = filters(json!([{ "events": ["email.labeled"], "labels": [LABEL] }]));
    let other = filters(json!([{ "events": ["email.labeled"], "labels": [OTHER_INBOX_LABEL] }]));
    let receipts = filters(json!([{ "events": ["email.message_received"] }]));

    let labeled_mail = received(&[LABEL]).normalize().unwrap();
    assert_eq!(labeled_mail.event_name(), EventName::EmailMessageReceived);
    assert!(matches(&any, &labeled_mail));
    assert!(matches(&chosen, &labeled_mail));
    assert!(!matches(&other, &labeled_mail));
    assert!(matches(&receipts, &labeled_mail));

    let plain_mail = received(&[]).normalize().unwrap();
    assert!(!matches(&any, &plain_mail));
    assert!(matches(&receipts, &plain_mail));

    let added_later = labels_updated(&[LABEL], false).normalize().unwrap();
    assert!(matches(&chosen, &added_later));
    assert!(!matches(&other, &added_later));
    assert!(!matches(&receipts, &added_later));
}

#[test]
fn a_label_routine_runs_labeled_mail_as_a_label_event() {
    let mail = received(&[LABEL]).normalize().unwrap();

    let labels_only = filters(json!([{ "events": ["email.labeled"] }]));
    let run = labels_only.run_event(&mail);
    assert_eq!(run.event_name(), EventName::EmailLabeled);
    assert_eq!(run.message_id(), mail.message_id());
    assert_eq!(run.labels_gained(), [label()]);
    assert_eq!(run.event_id(), mail.event_id());
    let stored = serde_json::to_string(&run).unwrap();
    assert_eq!(
        serde_json::from_str::<EventReference>(&stored).unwrap(),
        run
    );

    // A routine watching new mail as well runs it as new mail, which keeps
    // no labels: code from before them can't read a run that does.
    let both = filters(json!([
        { "events": ["email.message_received"] },
        { "events": ["email.labeled"] },
    ]));
    let receipt = both.run_event(&mail);
    assert_eq!(receipt.event_name(), EventName::EmailMessageReceived);
    let kept = serde_json::to_value(&receipt).unwrap();
    assert!(kept.get("labels_gained").is_none());
}

#[test]
fn only_a_filter_of_email_labeled_alone_takes_labels() {
    let parse = |filter: Value| serde_json::from_value::<EventFilter>(filter);
    assert!(parse(json!({ "events": ["email.labeled"], "labels": [LABEL] })).is_ok());
    assert!(
        parse(json!({ "events": ["email.labeled"], "labels": [LABEL], "condition": "Is it an invoice?" }))
            .is_ok()
    );
    assert!(parse(json!({ "events": ["email.message_received"], "labels": [LABEL] })).is_err());
    assert!(
        parse(json!({ "events": ["email.labeled", "email.message_received"], "labels": [LABEL] }))
            .is_err()
    );
    assert!(parse(json!({ "events": ["email.labeled"], "labels": [] })).is_err());
    let too_many: Vec<Uuid> = (0..101).map(|_| Uuid::now_v7()).collect();
    assert!(parse(json!({ "events": ["email.labeled"], "labels": too_many })).is_err());
    // Equal selectors compare equal.
    let first =
        parse(json!({ "events": ["email.labeled"], "labels": [OTHER_INBOX_LABEL, LABEL, LABEL] }))
            .unwrap();
    let second =
        parse(json!({ "events": ["email.labeled"], "labels": [LABEL, OTHER_INBOX_LABEL] }))
            .unwrap();
    assert_eq!(first, second);
}

#[test]
fn stored_label_events_must_carry_their_labels() {
    let parse = |value: Value| serde_json::from_value::<EventReference>(value);
    let base = json!({ "event_id": EVENT_ID, "entity_id": ENTITY_ID, "message_id": null });
    let with = |mut value: Value, fields: Value| {
        value
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        value
    };
    assert!(
        parse(with(
            base.clone(),
            json!({ "event_name": "email.labeled", "labels_gained": [LABEL] })
        ))
        .is_ok()
    );
    assert!(parse(with(base.clone(), json!({ "event_name": "email.labeled" }))).is_err());
    assert!(
        parse(with(
            base,
            json!({ "event_name": "document.created", "labels_gained": [LABEL] })
        ))
        .is_err()
    );
}

#[test]
fn a_shared_label_routine_drops_the_owners_labels_and_inboxes() {
    let trigger: ActionTrigger = serde_json::from_value(json!({
        "type": "events",
        "filters": [
            { "events": ["email.labeled"], "labels": [LABEL], "inboxes": [OTHER_ID] },
            { "events": ["email.labeled"], "labels": [OTHER_INBOX_LABEL] },
        ]
    }))
    .unwrap();
    let any_label: ActionTrigger = serde_json::from_value(json!({
        "type": "events", "filters": [{ "events": ["email.labeled"] }]
    }))
    .unwrap();
    assert_eq!(trigger.without_owners_mail(), any_label);
}
