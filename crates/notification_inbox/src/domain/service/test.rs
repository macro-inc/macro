use attention_feed::{
    domain::{
        models::{Candidate, FeedNotification, FeedRevision},
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
        scope: InboxScope { row_types },
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
async fn undo_restores_a_done_and_recomputes_its_groups() {
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
    assert_eq!(
        harness.notifications.state_of(uuid(1)),
        NotificationState::Seen
    );
    assert_eq!(changes.len(), 1);
    let InboxChange::Upserted(entry) = &changes[0] else {
        panic!("the channel comes back");
    };
    assert_eq!(entry.rows.len(), 2);
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
