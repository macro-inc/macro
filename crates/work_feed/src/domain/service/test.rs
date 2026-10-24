use attention_feed::{
    domain::{
        models::{Candidate, FeedNotification, FeedPosition, FeedRevision, MailFacts},
        ports::NotificationTransition,
    },
    test_support::*,
};
use model_entity::Entity;
use notification::domain::models::NotificationState;

use super::*;
use crate::domain::models::{WorkFeedItemType, WorkFeedMode, WorkFeedStackKind};

const DOC: u128 = 0xD0;
const OTHER_DOC: u128 = 0xD1;
const CHANNEL: u128 = 0xC0;
const THREAD: u128 = 0x70;
const MAIL: u128 = 0xE0;
const SENT_MAIL: u128 = 0xE1;

type Service =
    WorkFeedServiceImpl<FakeSource<&'static str>, FakeNotifications, FakeMail, FakeSignals>;

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
        service: WorkFeedServiceImpl::new(
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

fn query() -> WorkFeedQuery {
    WorkFeedQuery {
        scope: WorkFeedScope {
            mode: WorkFeedMode::Work,
            types: Vec::new(),
            include_snippets: false,
        },
        limit: 50,
        after: None,
    }
}

fn key(entity: Entity<'static>) -> FeedKey {
    FeedKey::new(entity)
}

fn done_calls(notifications: &FakeNotifications) -> Vec<(Vec<Uuid>, NotificationTransition)> {
    notifications.transitions.lock().unwrap().clone()
}

#[tokio::test]
async fn page_assembles_stacked_items_in_feed_order() {
    let mut thread = candidate(
        "thread",
        entity(EntityType::ChannelMessage, THREAD),
        Some(6),
        None,
    );
    thread.facts.thread_channel = Some(uuid(CHANNEL));
    let harness = harness(
        vec![
            candidate("doc", entity(EntityType::Document, DOC), Some(5), Some(9)),
            thread,
            // The channel's only notification belongs to the thread.
            candidate(
                "channel",
                entity(EntityType::Channel, CHANNEL),
                Some(6),
                None,
            ),
            mail_candidate(
                "mail",
                MAIL,
                Some(4),
                None,
                MailFacts {
                    inbox_visible: true,
                    is_read: false,
                },
            ),
            mail_candidate(
                "sent",
                SENT_MAIL,
                None,
                Some(3),
                MailFacts {
                    inbox_visible: false,
                    is_read: true,
                },
            ),
        ],
        vec![
            doc_comment(1, DOC, 0xA0, 0xA0, 5),
            channel_reply(2, CHANNEL, THREAD, 0x71, 6),
            new_email(3, MAIL, 4, NotificationState::Seen),
            // Outside the inbox, mail attention no longer counts.
            new_email(4, SENT_MAIL, 2, NotificationState::Unseen),
        ],
    );

    let page = harness.service.page(viewer(), query()).await.unwrap();
    let labels: Vec<_> = page.entries.iter().map(|e| e.item.entity).collect();
    assert_eq!(labels, vec!["doc", "thread", "mail", "sent"]);

    // doc-A: own work is newer, but its older comment keeps it unseen.
    let doc = &page.entries[0].item;
    assert_eq!(doc.primary, WorkFeedPrimaryReason::OwnWork);
    assert_eq!(doc.state, WorkFeedItemState::Unseen);
    assert_eq!(doc.attention_at, Some(at(5)));
    assert_eq!(doc.touched_at, Some(at(9)));
    assert_eq!(page.entries[0].sort_at, at(9));
    assert_eq!(doc.stacks[0].kind, WorkFeedStackKind::Comments);

    let thread = &page.entries[1].item;
    assert_eq!(
        thread.primary,
        WorkFeedPrimaryReason::Attention { stack: 0 }
    );
    assert_eq!(thread.stacks[0].kind, WorkFeedStackKind::ChannelThread);

    // Unread mail is unseen even when its notification was seen.
    assert_eq!(page.entries[2].item.state, WorkFeedItemState::Unseen);

    let sent = &page.entries[3].item;
    assert!(sent.notifications.is_empty());
    assert_eq!(sent.state, WorkFeedItemState::Seen);
    assert_eq!(sent.primary, WorkFeedPrimaryReason::OwnWork);

    // The thread and its channel share one notification load.
    let loads = harness.notifications.loads.lock().unwrap();
    assert_eq!(loads.len(), 1);
    assert_eq!(
        loads[0]
            .iter()
            .filter(|e| e.entity_type == EntityType::Channel)
            .count(),
        1
    );
}

#[tokio::test]
async fn page_refills_after_items_with_no_reason_left() {
    let mut thread = candidate(
        "thread",
        entity(EntityType::ChannelMessage, THREAD),
        Some(6),
        None,
    );
    thread.facts.thread_channel = Some(uuid(CHANNEL));
    let harness = harness(
        vec![
            thread,
            // Its only notification belongs to the thread: no item.
            candidate(
                "channel",
                entity(EntityType::Channel, CHANNEL),
                Some(5),
                None,
            ),
            candidate("doc", entity(EntityType::Document, DOC), None, Some(4)),
        ],
        vec![channel_reply(1, CHANNEL, THREAD, 0x71, 6)],
    );
    let mut query = query();
    query.limit = 2;

    let page = harness.service.page(viewer(), query).await.unwrap();
    let labels: Vec<_> = page.entries.iter().map(|e| e.item.entity).collect();
    assert_eq!(labels, vec!["thread", "doc"]);
    assert_eq!(harness.source.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn page_forwards_scope_and_cursor_to_the_source() {
    let harness = harness(
        vec![candidate(
            "doc",
            entity(EntityType::Document, DOC),
            None,
            Some(9),
        )],
        Vec::new(),
    );
    let mut query = query();
    query.scope.mode = WorkFeedMode::Attention;
    query.scope.types = vec![WorkFeedItemType::Email, WorkFeedItemType::ChannelThread];
    query.after = Some(FeedPosition {
        sort_at: at(30),
        entity_id: "x".to_string(),
    });
    harness.service.page(viewer(), query).await.unwrap();

    let requests = harness.source.requests.lock().unwrap();
    assert!(!requests[0].own_work);
    assert_eq!(requests[0].keying, CandidateKeying::ThreadScoped);
    assert_eq!(
        requests[0].types,
        vec![EntityType::EmailThread, EntityType::ChannelMessage]
    );
    assert_eq!(requests[0].after.as_ref().unwrap().sort_at, at(30));
    assert!(requests[0].only.is_none());
}

#[tokio::test]
async fn recompute_upserts_present_items_and_removes_missing_ones() {
    let harness = harness(
        vec![candidate(
            "doc",
            entity(EntityType::Document, DOC),
            None,
            Some(9),
        )],
        Vec::new(),
    );
    let changes = harness
        .service
        .recompute(
            viewer(),
            query().scope,
            vec![
                key(entity(EntityType::Document, DOC)),
                key(entity(EntityType::Document, OTHER_DOC)),
                key(entity(EntityType::Document, DOC)),
            ],
        )
        .await
        .unwrap();

    assert_eq!(changes.len(), 2);
    assert!(matches!(&changes[0], WorkFeedChange::Upserted(entry) if entry.item.entity == "doc"));
    assert!(
        matches!(&changes[1], WorkFeedChange::Removed(removed) if *removed == key(entity(EntityType::Document, OTHER_DOC)))
    );
}

#[tokio::test]
async fn done_acknowledges_only_what_was_observed() {
    let harness = harness(
        vec![candidate(
            "doc",
            entity(EntityType::Document, DOC),
            Some(8),
            Some(9),
        )],
        vec![
            doc_comment(1, DOC, 0xA0, 0xA0, 5),
            // Arrived after the caller looked at the item.
            doc_comment(2, DOC, 0xB0, 0xB0, 8),
        ],
    );
    let doc = key(entity(EntityType::Document, DOC));

    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![WorkFeedDoneTarget {
                key: doc.clone(),
                revision: Some(FeedRevision {
                    attention_through: Some(at(6)),
                }),
            }],
        )
        .await
        .unwrap();

    assert_eq!(outcome.items, vec![doc.clone()]);
    assert_eq!(outcome.receipt.notification_ids, vec![uuid(1)]);
    assert_eq!(
        harness.notifications.state_of(uuid(1)),
        NotificationState::Done
    );
    assert_eq!(
        harness.notifications.state_of(uuid(2)),
        NotificationState::Unseen
    );
    assert!(outcome.receipt.archived_threads.is_empty());
    // Every session of the viewer is told the item changed.
    assert_eq!(
        *harness.signals.calls.lock().unwrap(),
        vec![vec![doc.entity().clone()]]
    );
}

#[tokio::test]
async fn done_without_a_revision_completes_everything_current() {
    let inbox = MailFacts {
        inbox_visible: true,
        is_read: true,
    };
    let sent = MailFacts {
        inbox_visible: false,
        is_read: true,
    };
    let harness = harness(
        vec![
            mail_candidate("mail", MAIL, Some(4), None, inbox),
            mail_candidate("sent", SENT_MAIL, None, Some(3), sent),
        ],
        vec![new_email(1, MAIL, 4, NotificationState::Unseen)],
    );

    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![
                WorkFeedDoneTarget {
                    key: key(entity(EntityType::EmailThread, MAIL)),
                    revision: None,
                },
                WorkFeedDoneTarget {
                    key: key(entity(EntityType::EmailThread, SENT_MAIL)),
                    revision: None,
                },
            ],
        )
        .await
        .unwrap();

    assert_eq!(outcome.receipt.notification_ids, vec![uuid(1)]);
    // Only the inbox thread is archived; the sent thread is own work, which
    // done leaves alone.
    assert_eq!(
        *harness.mail.calls.lock().unwrap(),
        vec![(uuid(MAIL), true)]
    );
    assert_eq!(outcome.receipt.archived_threads, vec![uuid(MAIL)]);
}

#[tokio::test]
async fn done_leaves_own_work_alone() {
    let harness = harness(
        vec![candidate(
            "doc",
            entity(EntityType::Document, DOC),
            None,
            Some(9),
        )],
        Vec::new(),
    );
    let doc = key(entity(EntityType::Document, DOC));
    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![WorkFeedDoneTarget {
                key: doc.clone(),
                revision: None,
            }],
        )
        .await
        .unwrap();

    // Nothing to acknowledge: the item keeps its own-work reason.
    assert_eq!(outcome.items, vec![doc]);
    assert!(outcome.receipt.notification_ids.is_empty());
    assert!(done_calls(&harness.notifications).is_empty());
    assert!(harness.mail.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn done_on_an_item_already_gone_changes_nothing() {
    let harness = harness(Vec::new(), Vec::new());
    let gone = key(entity(EntityType::Document, DOC));
    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![WorkFeedDoneTarget {
                key: gone.clone(),
                revision: None,
            }],
        )
        .await
        .unwrap();
    assert_eq!(outcome.items, vec![gone]);
    assert_eq!(outcome.receipt.notification_ids, Vec::<Uuid>::new());
    assert!(done_calls(&harness.notifications).is_empty());
}

#[tokio::test]
async fn undo_reverses_exactly_one_done() {
    let inbox = MailFacts {
        inbox_visible: true,
        is_read: true,
    };
    let harness = harness(
        vec![
            candidate("doc", entity(EntityType::Document, DOC), Some(5), Some(9)),
            mail_candidate("mail", MAIL, Some(4), None, inbox),
        ],
        vec![
            doc_comment(1, DOC, 0xA0, 0xA0, 5),
            new_email(2, MAIL, 4, NotificationState::Unseen),
        ],
    );
    let doc = key(entity(EntityType::Document, DOC));
    let mail = key(entity(EntityType::EmailThread, MAIL));
    let outcome = harness
        .service
        .mark_done(
            viewer(),
            vec![
                WorkFeedDoneTarget {
                    key: doc.clone(),
                    revision: None,
                },
                WorkFeedDoneTarget {
                    key: mail.clone(),
                    revision: None,
                },
            ],
        )
        .await
        .unwrap();

    let receipt = DoneReceipt::decode(&outcome.receipt.encode()).unwrap();
    let changes = harness
        .service
        .undo_done(viewer(), query().scope, receipt)
        .await
        .unwrap();

    // Undone notifications come back seen.
    assert_eq!(
        harness.notifications.state_of(uuid(1)),
        NotificationState::Seen
    );
    assert_eq!(
        harness.notifications.state_of(uuid(2)),
        NotificationState::Seen
    );
    assert_eq!(
        *harness.mail.calls.lock().unwrap(),
        vec![(uuid(MAIL), true), (uuid(MAIL), false)]
    );
    assert_eq!(changes.len(), 2);
    assert!(
        changes
            .iter()
            .all(|change| matches!(change, WorkFeedChange::Upserted(_)))
    );
}
