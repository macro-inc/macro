use attention_feed::{
    domain::{
        models::{Candidate, FeedNotification, FeedPosition, FeedRevision},
        ports::NotificationTransition,
    },
    test_support::*,
};
use model_entity::Entity;
use notification::domain::models::NotificationState;
use serde_json::json;

use super::*;

const CHANNEL: u128 = 0xC0;
const ROOT: u128 = 0x7A;
const DOC: u128 = 0xD0;
const MAIL: u128 = 0xE0;
const ARCHIVED: u128 = 0xE1;

type Service = NotificationInboxServiceImpl<
    FakeSource<&'static str>,
    FakeNotifications,
    FakeMail,
    FakeSignals,
>;

/// The service with handles on its fakes.
struct Harness {
    service: Service,
    source: FakeSource<&'static str>,
    notifications: FakeNotifications,
    mail: FakeMail,
    signals: FakeSignals,
}

fn harness(items: Vec<Candidate<&'static str>>, notifications: Vec<FeedNotification>) -> Harness {
    let source = FakeSource::with(items);
    let notifications = FakeNotifications::with(notifications);
    let mail = FakeMail::default();
    let signals = FakeSignals::default();
    Harness {
        service: NotificationInboxServiceImpl::new(
            source.clone(),
            notifications.clone(),
            mail.clone(),
            signals.clone(),
        ),
        source,
        notifications,
        mail,
        signals,
    }
}

fn key(entity: Entity<'static>) -> FeedKey {
    FeedKey::new(entity)
}

fn channel() -> FeedKey {
    key(entity(EntityType::Channel, CHANNEL))
}

fn row(group: &FeedKey, slot: &str) -> InboxRowId {
    InboxRowId {
        group: group.clone(),
        slot: slot.to_string(),
    }
}

fn thread_slot() -> String {
    format!("thread:{}", uuid(ROOT))
}

fn query(row_types: Vec<InboxRowType>) -> InboxQuery {
    InboxQuery {
        scope: InboxScope {
            row_types,
            ..Default::default()
        },
        limit: 50,
        after: None,
    }
}

fn document_mention(id: u128, message: u128, minute: u32) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, CHANNEL),
        "document_mention",
        json!({
            "documentName": "Plan",
            "owner": "macro|other@example.com",
            "messageId": uuid(message),
            "messageContent": "see doc",
            "channelType": "public",
        }),
        minute,
        NotificationState::Unseen,
    )
}

/// A channel with a top-level message and a mention thread, an inbox email
/// thread, an archived one, and a document whose only notification is a
/// call (no row).
fn inbox() -> Harness {
    let inbox_mail = MailFacts {
        inbox_visible: true,
        is_read: false,
    };
    let archived_mail = MailFacts {
        inbox_visible: false,
        is_read: true,
    };
    harness(
        vec![
            candidate("channel", channel().into_entity(), Some(9), None),
            mail_candidate("mail", MAIL, Some(7), None, inbox_mail),
            mail_candidate("archived", ARCHIVED, Some(6), None, archived_mail),
            candidate("doc", entity(EntityType::Document, DOC), Some(5), None),
        ],
        vec![
            channel_send(1, CHANNEL, 0x100, 2),
            channel_mention(2, CHANNEL, ROOT, None, 8),
            document_mention(3, ROOT, 8),
            channel_reply(4, CHANNEL, ROOT, 0x101, 9),
            new_email(5, MAIL, 7, NotificationState::Unseen),
            new_email(6, ARCHIVED, 6, NotificationState::Unseen),
            notification(
                7,
                entity(EntityType::Document, DOC),
                "call_started",
                json!({ "callId": uuid(0x99), "channelType": "public" }),
                5,
                NotificationState::Unseen,
            ),
        ],
    )
}

#[tokio::test]
async fn a_page_lists_groups_with_their_rows_newest_first() {
    let harness = inbox();
    let page = harness
        .service
        .page(viewer(), query(Vec::new()))
        .await
        .unwrap();

    let groups: Vec<_> = page.entries.iter().map(|entry| entry.entity).collect();
    // The archived thread and the document with nothing to show list nothing.
    assert_eq!(groups, vec!["channel", "mail"]);
    let channel_entry = &page.entries[0];
    assert_eq!(channel_entry.group, channel());
    assert_eq!(channel_entry.sort_at, at(9));
    let rows: Vec<_> = channel_entry
        .rows
        .iter()
        .map(|row| (row.id.slot.clone(), row.row_type))
        .collect();
    assert_eq!(
        rows,
        vec![
            (thread_slot(), InboxRowType::ChannelMention),
            ("top_level".to_string(), InboxRowType::ChannelMessages),
        ]
    );
    assert_eq!(page.entries[1].rows[0].row_type, InboxRowType::Email);
    assert!(page.entries[1].rows[0].unseen);
}

#[tokio::test]
async fn a_page_reads_filed_entity_candidates_without_own_work() {
    let harness = inbox();
    harness
        .service
        .page(viewer(), query(Vec::new()))
        .await
        .unwrap();
    let requests = harness.source.requests.lock().unwrap();
    assert_eq!(requests[0].keying, CandidateKeying::FiledEntity);
    assert!(!requests[0].own_work);
    assert_eq!(requests[0].types, policy::CANDIDATE_TYPES.to_vec());
}

#[tokio::test]
async fn row_types_narrow_the_rows_and_drop_groups_without_any() {
    let harness = inbox();
    let page = harness
        .service
        .page(viewer(), query(vec![InboxRowType::ChannelMessages]))
        .await
        .unwrap();
    assert_eq!(page.entries.len(), 1);
    let rows = &page.entries[0].rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, row(&channel(), "top_level"));
}

#[tokio::test]
async fn done_acknowledges_what_a_row_shows_and_hides_up_to_its_revision() {
    let harness = inbox();
    let thread = row(&channel(), &thread_slot());

    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![InboxRowTarget {
                id: thread.clone(),
                // Observed before the reply arrived.
                revision: Some(FeedRevision {
                    attention_through: Some(at(8)),
                }),
            }],
        )
        .await
        .unwrap();

    assert_eq!(outcome.rows, vec![thread]);
    // The mention and the document chip it speaks for; not the later reply,
    // and nothing from the channel's top-level row.
    assert_eq!(outcome.receipt.notification_ids, vec![uuid(2), uuid(3)]);
    assert_eq!(
        harness.notifications.state_of(uuid(4)),
        NotificationState::Unseen
    );
    assert_eq!(
        harness.notifications.state_of(uuid(1)),
        NotificationState::Unseen
    );
    assert!(harness.mail.calls.lock().unwrap().is_empty());
    assert_eq!(
        *harness.signals.calls.lock().unwrap(),
        vec![vec![channel().into_entity()]]
    );
}

#[tokio::test]
async fn done_on_an_email_row_archives_its_thread() {
    let harness = inbox();
    let thread = key(entity(EntityType::EmailThread, MAIL));
    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![InboxRowTarget {
                id: row(&thread, "email"),
                revision: None,
            }],
        )
        .await
        .unwrap();
    assert_eq!(outcome.receipt.notification_ids, vec![uuid(5)]);
    assert_eq!(outcome.receipt.archived_threads, vec![uuid(MAIL)]);
    assert_eq!(
        *harness.mail.calls.lock().unwrap(),
        vec![(uuid(MAIL), true)]
    );
}

#[tokio::test]
async fn done_from_before_newer_mail_keeps_the_thread_in_the_inbox() {
    let harness = harness(
        vec![mail_candidate(
            "mail",
            MAIL,
            Some(8),
            None,
            MailFacts {
                inbox_visible: true,
                is_read: false,
            },
        )],
        vec![
            new_email(5, MAIL, 7, NotificationState::Unseen),
            new_email(6, MAIL, 8, NotificationState::Unseen),
        ],
    );
    let thread = key(entity(EntityType::EmailThread, MAIL));

    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![InboxRowTarget {
                id: row(&thread, "email"),
                // Observed before the second email arrived.
                revision: Some(FeedRevision {
                    attention_through: Some(at(7)),
                }),
            }],
        )
        .await
        .unwrap();

    assert_eq!(outcome.receipt.notification_ids, vec![uuid(5)]);
    assert!(outcome.receipt.archived_threads.is_empty());
    assert!(harness.mail.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn done_on_rows_that_are_gone_acknowledges_nothing() {
    let harness = inbox();
    let gone = row(&channel(), "thread:nope");
    let foreign = row(&key(entity(EntityType::Document, 0xF0)), "top_level");
    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![
                InboxRowTarget {
                    id: gone.clone(),
                    revision: None,
                },
                InboxRowTarget {
                    id: foreign.clone(),
                    revision: None,
                },
                InboxRowTarget {
                    id: gone.clone(),
                    revision: None,
                },
            ],
        )
        .await
        .unwrap();
    assert_eq!(outcome.rows, vec![gone, foreign]);
    assert!(outcome.receipt.notification_ids.is_empty());
    assert!(harness.notifications.transitions.lock().unwrap().is_empty());
}

#[tokio::test]
async fn done_on_one_notification_leaves_the_rest_of_the_stack() {
    let harness = inbox();
    let thread = row(&channel(), &thread_slot());
    let outcome = harness
        .service
        .mark_notification_done(viewer(), InboxScope::default(), thread.clone(), uuid(4))
        .await
        .unwrap();

    // The reply alone: the mention and the document chip it speaks for stay.
    assert_eq!(outcome.receipt.notification_ids, vec![uuid(4)]);
    let [InboxChange::Upserted(entry)] = outcome.changes.as_slice() else {
        panic!("expected the channel's group back");
    };
    let shown = &entry
        .rows
        .iter()
        .find(|candidate| candidate.id == thread)
        .unwrap()
        .notifications;
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0].notification_id, uuid(2));
}

#[tokio::test]
async fn done_on_one_notification_takes_the_hidden_ones_it_speaks_for() {
    let harness = inbox();
    let thread = row(&channel(), &thread_slot());
    let outcome = harness
        .service
        .mark_notification_done(viewer(), InboxScope::default(), thread, uuid(2))
        .await
        .unwrap();

    // The mention, and the document chip about the same message.
    assert_eq!(outcome.receipt.notification_ids, vec![uuid(2), uuid(3)]);
    assert_eq!(
        harness.notifications.state_of(uuid(4)),
        NotificationState::Unseen
    );
}

#[tokio::test]
async fn done_on_a_rows_last_notification_completes_the_row() {
    let harness = harness(
        vec![
            candidate("channel", channel().into_entity(), Some(9), None),
            mail_candidate(
                "mail",
                MAIL,
                Some(7),
                None,
                MailFacts {
                    inbox_visible: true,
                    is_read: false,
                },
            ),
        ],
        vec![
            channel_send(1, CHANNEL, 0x100, 2),
            // Noise the top-level row hides, about no message.
            notification(
                2,
                channel().into_entity(),
                "call_started",
                json!({ "callId": uuid(0x99), "channelType": "public" }),
                1,
                NotificationState::Unseen,
            ),
            new_email(3, MAIL, 7, NotificationState::Unseen),
        ],
    );

    let channel_done = harness
        .service
        .mark_notification_done(
            viewer(),
            InboxScope::default(),
            row(&channel(), "top_level"),
            uuid(1),
        )
        .await
        .unwrap();
    assert_eq!(
        channel_done.receipt.notification_ids,
        vec![uuid(1), uuid(2)]
    );
    assert!(matches!(
        channel_done.changes.as_slice(),
        [InboxChange::Removed(_)]
    ));

    let thread = key(entity(EntityType::EmailThread, MAIL));
    let mail_done = harness
        .service
        .mark_notification_done(
            viewer(),
            InboxScope::default(),
            row(&thread, "email"),
            uuid(3),
        )
        .await
        .unwrap();
    assert_eq!(mail_done.receipt.archived_threads, vec![uuid(MAIL)]);
}

#[tokio::test]
async fn done_on_one_email_of_a_thread_keeps_the_thread_in_the_inbox() {
    let harness = harness(
        vec![mail_candidate(
            "mail",
            MAIL,
            Some(7),
            None,
            MailFacts {
                inbox_visible: true,
                is_read: false,
            },
        )],
        vec![
            new_email(1, MAIL, 6, NotificationState::Unseen),
            new_email(2, MAIL, 7, NotificationState::Unseen),
        ],
    );
    let thread = key(entity(EntityType::EmailThread, MAIL));
    let outcome = harness
        .service
        .mark_notification_done(
            viewer(),
            InboxScope::default(),
            row(&thread, "email"),
            uuid(2),
        )
        .await
        .unwrap();

    assert_eq!(outcome.receipt.notification_ids, vec![uuid(2)]);
    assert!(outcome.receipt.archived_threads.is_empty());
    assert!(harness.mail.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn done_on_a_notification_the_row_no_longer_shows_acknowledges_nothing() {
    let harness = inbox();
    let outcome = harness
        .service
        .mark_notification_done(
            viewer(),
            InboxScope::default(),
            row(&channel(), &thread_slot()),
            uuid(0xFFF),
        )
        .await
        .unwrap();

    assert!(outcome.receipt.notification_ids.is_empty());
}

fn clear_request(scope: InboxScope) -> InboxClearRequest {
    InboxClearRequest {
        scope,
        since: None,
        limit: 50,
        after: None,
    }
}

#[tokio::test]
async fn clear_marks_every_row_done_without_archiving_mail() {
    let harness = inbox();
    let outcome = harness
        .service
        .clear(viewer(), clear_request(InboxScope::default()))
        .await
        .unwrap();

    // The channel's thread and top level, and the inbox email thread.
    assert_eq!(outcome.rows, 3);
    let mut cleared = outcome.receipt.notification_ids.clone();
    cleared.sort();
    assert_eq!(cleared, vec![uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]);
    assert!(outcome.receipt.archived_threads.is_empty());
    assert!(harness.mail.calls.lock().unwrap().is_empty());
    assert!(outcome.next.is_none());
}

#[tokio::test]
async fn clear_takes_only_the_rows_the_request_names() {
    let harness = inbox();
    let outcome = harness
        .service
        .clear(
            viewer(),
            InboxClearRequest {
                // Channel rows only, and only what arrived at minute 8 or later.
                since: Some(at(8)),
                ..clear_request(InboxScope {
                    row_types: vec![InboxRowType::ChannelMention, InboxRowType::ChannelMessages],
                    ..Default::default()
                })
            },
        )
        .await
        .unwrap();

    // The mention thread, with the document chip it hides; not the
    // top-level message from minute 2, nor the email.
    assert_eq!(outcome.rows, 1);
    let mut cleared = outcome.receipt.notification_ids.clone();
    cleared.sort();
    assert_eq!(cleared, vec![uuid(2), uuid(3), uuid(4)]);
    assert_eq!(
        harness.notifications.state_of(uuid(1)),
        NotificationState::Unseen
    );
    assert_eq!(
        harness.notifications.state_of(uuid(5)),
        NotificationState::Unseen
    );
}

#[tokio::test]
async fn clear_of_unread_rows_leaves_read_ones() {
    let harness = harness(
        vec![
            candidate("doc", entity(EntityType::Document, DOC), Some(9), None),
            candidate("channel", channel().into_entity(), Some(5), None),
        ],
        vec![
            notification(
                1,
                entity(EntityType::Document, DOC),
                "task_assigned",
                json!({ "taskId": "task-1", "assignedBy": "macro|other@example.com", "taskName": "Plan" }),
                9,
                NotificationState::Seen,
            ),
            channel_send(2, CHANNEL, 0x100, 5),
        ],
    );
    let outcome = harness
        .service
        .clear(
            viewer(),
            clear_request(InboxScope {
                unread_only: true,
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert_eq!(outcome.receipt.notification_ids, vec![uuid(2)]);
}

#[tokio::test]
async fn clear_since_a_time_ends_at_the_first_older_group() {
    let harness = inbox();
    let request = InboxClearRequest {
        since: Some(at(8)),
        limit: 1,
        ..clear_request(InboxScope::default())
    };
    let first = harness
        .service
        .clear(viewer(), request.clone())
        .await
        .unwrap();
    assert_eq!(first.rows, 1);
    assert!(first.next.is_some());

    let second = harness
        .service
        .clear(
            viewer(),
            InboxClearRequest {
                after: first.next,
                ..request
            },
        )
        .await
        .unwrap();
    // The email thread is older than the cutoff: nothing more to clear.
    assert_eq!(second.rows, 0);
    assert!(second.receipt.notification_ids.is_empty());
    assert!(second.next.is_none());
}

#[tokio::test]
async fn undo_restores_a_done_as_it_was_and_recomputes_its_groups() {
    let harness = inbox();
    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![InboxRowTarget {
                id: row(&channel(), "top_level"),
                revision: None,
            }],
        )
        .await
        .unwrap();
    assert_eq!(outcome.receipt.notification_ids, vec![uuid(1)]);

    let changes = harness
        .service
        .undo_done(
            viewer(),
            InboxScope::default(),
            DoneReceipt::decode(&outcome.receipt.encode()).unwrap(),
        )
        .await
        .unwrap();
    // It was unseen before the done, so it comes back unseen.
    assert_eq!(
        harness.notifications.state_of(uuid(1)),
        NotificationState::Unseen
    );
    assert_eq!(changes.len(), 1);
    let InboxChange::Upserted(entry) = &changes[0] else {
        panic!("the channel comes back");
    };
    assert_eq!(entry.rows.len(), 2);
    assert!(entry.rows.iter().all(|row| row.unseen));
}

#[tokio::test]
async fn undo_brings_seen_notifications_back_seen_and_unseen_ones_unseen() {
    let harness = inbox();
    harness
        .service
        .mark_seen(
            viewer(),
            InboxScope::default(),
            vec![row(&channel(), &thread_slot())],
        )
        .await
        .unwrap();
    let outcome = harness
        .service
        .clear(viewer(), clear_request(InboxScope::default()))
        .await
        .unwrap();

    harness
        .service
        .undo_done(viewer(), InboxScope::default(), outcome.receipt)
        .await
        .unwrap();

    // The thread was read before the clear; the top level and the email
    // were not.
    for id in [uuid(2), uuid(3), uuid(4)] {
        assert_eq!(harness.notifications.state_of(id), NotificationState::Seen);
    }
    for id in [uuid(1), uuid(5)] {
        assert_eq!(
            harness.notifications.state_of(id),
            NotificationState::Unseen
        );
    }
}

#[tokio::test]
async fn seen_reads_a_rows_shown_and_hidden_notifications() {
    let harness = inbox();
    let changes = harness
        .service
        .mark_seen(
            viewer(),
            InboxScope::default(),
            vec![row(&channel(), &thread_slot())],
        )
        .await
        .unwrap();

    let transitions = harness.notifications.transitions.lock().unwrap().clone();
    assert_eq!(transitions.len(), 1);
    let (mut seen, transition) = transitions[0].clone();
    seen.sort();
    assert_eq!(transition, NotificationTransition::Seen);
    assert_eq!(seen, vec![uuid(2), uuid(3), uuid(4)]);

    let InboxChange::Upserted(entry) = &changes[0] else {
        panic!("the channel stays listed");
    };
    let thread = entry
        .rows
        .iter()
        .find(|row| row.id.slot == thread_slot())
        .unwrap();
    assert!(!thread.unseen);
    let top_level = entry
        .rows
        .iter()
        .find(|row| row.id.slot == "top_level")
        .unwrap();
    assert!(top_level.unseen, "other rows keep their state");
}

#[tokio::test]
async fn recompute_removes_groups_with_no_matching_row() {
    let harness = inbox();
    let doc = key(entity(EntityType::Document, DOC));
    let changes = harness
        .service
        .recompute(
            viewer(),
            InboxScope::default(),
            vec![channel(), doc.clone(), channel()],
        )
        .await
        .unwrap();
    assert_eq!(changes.len(), 2);
    assert!(matches!(&changes[0], InboxChange::Upserted(entry) if entry.group == channel()));
    assert!(matches!(&changes[1], InboxChange::Removed(removed) if *removed == doc));
}

fn unread() -> InboxScope {
    InboxScope {
        unread_only: true,
        ..Default::default()
    }
}

fn unread_query(limit: u16, after: Option<FeedPosition>) -> InboxQuery {
    InboxQuery {
        scope: unread(),
        limit,
        after,
    }
}

/// Mail read by its own state: one thread with an unread message whose
/// notification was seen, one read thread whose notification wasn't; a
/// channel whose thread is read and top level unread; a read document task.
fn mostly_read() -> Harness {
    let unread_mail = MailFacts {
        inbox_visible: true,
        is_read: false,
    };
    let read_mail = MailFacts {
        inbox_visible: true,
        is_read: true,
    };
    let mut seen_reply = channel_reply(4, CHANNEL, ROOT, 0x101, 9);
    std::sync::Arc::make_mut(&mut seen_reply).state = NotificationState::Seen;
    harness(
        vec![
            candidate("doc", entity(EntityType::Document, DOC), Some(10), None),
            candidate("channel", channel().into_entity(), Some(9), None),
            mail_candidate("unread mail", MAIL, Some(7), None, unread_mail),
            mail_candidate("read mail", ARCHIVED, Some(6), None, read_mail),
        ],
        vec![
            notification(
                1,
                entity(EntityType::Document, DOC),
                "task_assigned",
                json!({ "taskId": "task-1", "assignedBy": "macro|other@example.com", "taskName": "Plan" }),
                10,
                NotificationState::Seen,
            ),
            channel_send(2, CHANNEL, 0x100, 2),
            seen_reply,
            new_email(5, MAIL, 7, NotificationState::Seen),
            new_email(6, ARCHIVED, 6, NotificationState::Unseen),
        ],
    )
}

#[tokio::test]
async fn an_unread_page_lists_only_unread_rows_by_each_rows_rule() {
    let harness = mostly_read();
    let page = harness
        .service
        .page(viewer(), unread_query(50, None))
        .await
        .unwrap();

    let listed: Vec<_> = page
        .entries
        .iter()
        .map(|entry| {
            let slots: Vec<_> = entry.rows.iter().map(|row| row.id.slot.clone()).collect();
            (entry.entity, slots)
        })
        .collect();
    // The read task and the read thread are left out; mail follows its own
    // read state, not whether its notification was seen.
    assert_eq!(
        listed,
        vec![
            ("channel", vec!["top_level".to_string()]),
            ("unread mail", vec!["email".to_string()]),
        ]
    );
    assert!(
        page.entries
            .iter()
            .flat_map(|entry| &entry.rows)
            .all(|row| row.unseen)
    );
}

#[tokio::test]
async fn unread_pages_and_cursors_cover_unread_groups_only() {
    let harness = mostly_read();
    let first = harness
        .service
        .page(viewer(), unread_query(1, None))
        .await
        .unwrap();
    assert_eq!(
        first
            .entries
            .iter()
            .map(|entry| entry.entity)
            .collect::<Vec<_>>(),
        vec!["channel"],
        "the read document before it doesn't take the page's one place"
    );
    let second = harness
        .service
        .page(viewer(), unread_query(1, first.next))
        .await
        .unwrap();
    assert_eq!(
        second
            .entries
            .iter()
            .map(|entry| entry.entity)
            .collect::<Vec<_>>(),
        vec!["unread mail"]
    );
    if let Some(after) = second.next {
        let third = harness
            .service
            .page(viewer(), unread_query(1, Some(after)))
            .await
            .unwrap();
        assert!(third.entries.is_empty(), "the read mail never lists");
        assert!(third.next.is_none());
    }
}

#[tokio::test]
async fn reading_a_row_takes_it_out_of_an_unread_inbox() {
    let harness = inbox();
    let changes = harness
        .service
        .mark_seen(viewer(), unread(), vec![row(&channel(), &thread_slot())])
        .await
        .unwrap();
    let InboxChange::Upserted(entry) = &changes[0] else {
        panic!("the channel's top level is still unread");
    };
    let slots: Vec<_> = entry.rows.iter().map(|row| row.id.slot.clone()).collect();
    assert_eq!(slots, vec!["top_level".to_string()]);

    let changes = harness
        .service
        .mark_seen(viewer(), unread(), vec![row(&channel(), "top_level")])
        .await
        .unwrap();
    assert!(matches!(&changes[0], InboxChange::Removed(removed) if *removed == channel()));
}

#[tokio::test]
async fn new_activity_brings_a_read_row_back_into_an_unread_inbox() {
    let harness = mostly_read();
    let doc = key(entity(EntityType::Document, DOC));
    let changes = harness
        .service
        .recompute(viewer(), unread(), vec![doc.clone()])
        .await
        .unwrap();
    assert!(matches!(&changes[0], InboxChange::Removed(removed) if *removed == doc));

    harness
        .notifications
        .by_entity
        .lock()
        .unwrap()
        .get_mut(doc.entity())
        .unwrap()
        .push(notification(
            8,
            entity(EntityType::Document, DOC),
            "task_assigned",
            json!({ "taskId": "task-1", "assignedBy": "macro|other@example.com", "taskName": "Plan" }),
            11,
            NotificationState::Unseen,
        ));
    let changes = harness
        .service
        .recompute(viewer(), unread(), vec![doc.clone()])
        .await
        .unwrap();
    let InboxChange::Upserted(entry) = &changes[0] else {
        panic!("the task is unread again");
    };
    assert!(entry.rows.iter().all(|row| row.unseen));
}
