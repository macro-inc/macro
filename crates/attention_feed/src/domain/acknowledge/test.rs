use model_entity::EntityType;
use notification::domain::models::NotificationState;

use super::*;
use crate::test_support::*;

const DOC: u128 = 0xD0;
const MAIL: u128 = 0xE0;

type Subject = Acknowledger<FakeNotifications, FakeMail, FakeSignals>;

fn acknowledger(notifications: &FakeNotifications) -> (Subject, FakeMail, FakeSignals) {
    let mail = FakeMail::default();
    let signals = FakeSignals::default();
    (
        Acknowledger::new(notifications.clone(), mail.clone(), signals.clone()),
        mail,
        signals,
    )
}

fn key(entity_type: EntityType, id: u128) -> FeedKey {
    FeedKey::new(entity(entity_type, id))
}

#[tokio::test]
async fn acknowledge_completes_each_notification_once_and_archives_mail() {
    let notifications = FakeNotifications::with(vec![
        doc_comment(1, DOC, 0xA0, 0xA0, 5),
        doc_comment(2, DOC, 0xB0, 0xB0, 6),
        new_email(3, MAIL, 4, NotificationState::Unseen),
    ]);
    let (acknowledger, mail, signals) = acknowledger(&notifications);
    let doc = key(EntityType::Document, DOC);
    let thread = key(EntityType::EmailThread, MAIL);

    let receipt = acknowledger
        .acknowledge(
            &viewer(),
            vec![
                Acknowledgment {
                    key: doc.clone(),
                    notification_ids: vec![uuid(1), uuid(2)],
                    archive_thread: None,
                },
                // A second part of the same entry, overlapping the first.
                Acknowledgment {
                    key: doc.clone(),
                    notification_ids: vec![uuid(2)],
                    archive_thread: None,
                },
                Acknowledgment {
                    key: thread.clone(),
                    notification_ids: vec![uuid(3)],
                    archive_thread: Some(uuid(MAIL)),
                },
            ],
        )
        .await
        .unwrap();

    assert_eq!(receipt.keys, vec![doc.id(), thread.id()]);
    assert_eq!(receipt.notification_ids, vec![uuid(1), uuid(2), uuid(3)]);
    assert_eq!(receipt.archived_threads, vec![uuid(MAIL)]);
    assert_eq!(
        *notifications.transitions.lock().unwrap(),
        vec![(
            vec![uuid(1), uuid(2), uuid(3)],
            NotificationTransition::Done
        )]
    );
    assert_eq!(*mail.calls.lock().unwrap(), vec![(uuid(MAIL), true)]);
    assert_eq!(
        *signals.calls.lock().unwrap(),
        vec![vec![doc.entity().clone(), thread.entity().clone()]]
    );
}

#[tokio::test]
async fn acknowledging_nothing_still_reports_the_keys() {
    let notifications = FakeNotifications::default();
    let (acknowledger, mail, _) = acknowledger(&notifications);
    let gone = key(EntityType::Document, DOC);
    let receipt = acknowledger
        .acknowledge(
            &viewer(),
            vec![Acknowledgment {
                key: gone.clone(),
                notification_ids: Vec::new(),
                archive_thread: None,
            }],
        )
        .await
        .unwrap();
    assert_eq!(receipt.feed_keys(), vec![gone]);
    assert!(receipt.notification_ids.is_empty());
    assert!(notifications.transitions.lock().unwrap().is_empty());
    assert!(mail.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn undo_reverses_exactly_one_receipt() {
    let notifications = FakeNotifications::with(vec![
        doc_comment(1, DOC, 0xA0, 0xA0, 5),
        new_email(2, MAIL, 4, NotificationState::Unseen),
    ]);
    let (acknowledger, mail, signals) = acknowledger(&notifications);
    let receipt = acknowledger
        .acknowledge(
            &viewer(),
            vec![
                Acknowledgment {
                    key: key(EntityType::Document, DOC),
                    notification_ids: vec![uuid(1)],
                    archive_thread: None,
                },
                Acknowledgment {
                    key: key(EntityType::EmailThread, MAIL),
                    notification_ids: vec![uuid(2)],
                    archive_thread: Some(uuid(MAIL)),
                },
            ],
        )
        .await
        .unwrap();

    let keys = acknowledger
        .undo(&viewer(), &DoneReceipt::decode(&receipt.encode()).unwrap())
        .await
        .unwrap();

    assert_eq!(
        keys,
        vec![
            key(EntityType::Document, DOC),
            key(EntityType::EmailThread, MAIL)
        ]
    );
    // Undone notifications come back seen.
    assert_eq!(notifications.state_of(uuid(1)), NotificationState::Seen);
    assert_eq!(notifications.state_of(uuid(2)), NotificationState::Seen);
    assert_eq!(
        *mail.calls.lock().unwrap(),
        vec![(uuid(MAIL), true), (uuid(MAIL), false)]
    );
    assert_eq!(signals.calls.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn seen_never_reopens_done_notifications() {
    let done = with_state(&doc_comment(1, DOC, 0xA0, 0xA0, 5), NotificationState::Done);
    let notifications = FakeNotifications::with(vec![done, doc_comment(2, DOC, 0xB0, 0xB0, 6)]);
    let (acknowledger, _, signals) = acknowledger(&notifications);
    let doc = key(EntityType::Document, DOC);

    let changed = acknowledger
        .mark_seen(
            &viewer(),
            std::slice::from_ref(&doc),
            vec![uuid(1), uuid(2), uuid(2)],
        )
        .await
        .unwrap();

    assert_eq!(changed, vec![uuid(2)]);
    assert_eq!(notifications.state_of(uuid(1)), NotificationState::Done);
    assert_eq!(notifications.state_of(uuid(2)), NotificationState::Seen);
    assert_eq!(
        *notifications.transitions.lock().unwrap(),
        vec![(vec![uuid(1), uuid(2)], NotificationTransition::Seen)]
    );
    assert_eq!(
        *signals.calls.lock().unwrap(),
        vec![vec![doc.entity().clone()]]
    );
}

#[tokio::test]
async fn seeing_nothing_changes_nothing() {
    let notifications = FakeNotifications::default();
    let (acknowledger, _, signals) = acknowledger(&notifications);
    let changed = acknowledger
        .mark_seen(&viewer(), &[], Vec::new())
        .await
        .unwrap();
    assert!(changed.is_empty());
    assert!(signals.calls.lock().unwrap().is_empty());
}
