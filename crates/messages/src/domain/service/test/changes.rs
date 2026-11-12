use super::*;
use crate::domain::changes::{ChannelChange, ChannelChangeKind, ChannelMessageChange};

#[tokio::test]
async fn channel_changes_pages_log_rows_and_coalesces_current_states() {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
    repo.message.content = "Current content after every logged edit".to_owned();
    repo.change_log.seq = 250;
    repo.change_log.changes = (1..=250)
        .map(|seq| ChannelChange {
            seq,
            kind: ChannelChangeKind::Message(repo.message.id),
        })
        .collect();
    repo.changed_messages = vec![ChannelMessageChange::Root {
        message: Box::new(MessageListItem {
            message: repo.message.clone(),
            state: repo.state.clone(),
            thread: MessageThreadPreview {
                reply_count: 0,
                latest_reply_at: None,
                preview: Vec::new(),
            },
        }),
        call: None,
    }];
    let service = MessageService::new(repo.clone(), Events::default());
    let first = service
        .channel_changes(
            channel_access().try_into_requirement().unwrap(),
            Uuid::from_u128(20),
            0,
        )
        .await
        .unwrap();
    assert_eq!(first.seq, 200);
    assert!(first.has_more && !first.reset_required);
    assert_eq!(first.messages.len(), 1);
    assert_eq!(
        *repo.change_reads.lock().unwrap(),
        vec![vec![repo.message.id]]
    );
    let second = service
        .channel_changes(
            channel_access().try_into_requirement().unwrap(),
            Uuid::from_u128(20),
            first.seq,
        )
        .await
        .unwrap();
    assert_eq!(second.seq, 250);
    assert!(!second.has_more && !second.reset_required);
    assert_eq!(second.messages.len(), 1);
    let ChannelMessageChange::Root { message, .. } = &second.messages[0] else {
        panic!("expected root")
    };
    assert_eq!(message.message.content, repo.message.content);
}

#[tokio::test]
async fn channel_changes_resets_before_hydration_even_for_a_reset_after_the_first_page() {
    for (counter, floor, after, reset_at) in [
        (300, 0, 0, Some(250)),
        (1001, 0, 0, None),
        (300, 10, 9, None),
    ] {
        let mut repo = fixture();
        repo.change_log.seq = counter;
        repo.change_log.floor = floor;
        repo.change_log.changes = (after + 1..=counter)
            .map(|seq| ChannelChange {
                seq,
                kind: if Some(seq) == reset_at {
                    ChannelChangeKind::Reset
                } else {
                    ChannelChangeKind::Message(repo.message.id)
                },
            })
            .collect();
        let service = MessageService::new(repo.clone(), Events::default());
        let page = service
            .channel_changes(
                channel_access().try_into_requirement().unwrap(),
                Uuid::from_u128(20),
                after,
            )
            .await
            .unwrap();
        assert!(page.reset_required);
        assert_eq!(page.seq, counter);
        assert!(!page.has_more);
        assert!(
            page.messages.is_empty() && page.activities.is_empty() && page.removed_ids.is_empty()
        );
        assert!(repo.change_reads.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn channel_changes_keep_tombstones_reply_roots_and_report_hard_deletes() {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
    repo.message.deleted_at = Some(Utc::now());
    let mut reply = reply_from(&repo.message, 2, "macro|author@example.com");
    reply.deleted_at = Some(Utc::now());
    let activity = activity::domain::timeline::TimelineActivity {
        id: Uuid::from_u128(3),
        actor_id: "macro|author@example.com".to_owned(),
        occurred_at: Utc::now(),
        action: "picture_changed".to_owned(),
        payload: None,
    };
    repo.change_log.seq = 4;
    repo.change_log.changes = vec![
        ChannelChange {
            seq: 1,
            kind: ChannelChangeKind::Message(reply.id),
        },
        ChannelChange {
            seq: 2,
            kind: ChannelChangeKind::Message(Uuid::from_u128(40)),
        },
        ChannelChange {
            seq: 3,
            kind: ChannelChangeKind::Activity(activity.id),
        },
        ChannelChange {
            seq: 4,
            kind: ChannelChangeKind::Activity(Uuid::from_u128(50)),
        },
    ];
    repo.changed_messages = vec![
        ChannelMessageChange::Root {
            message: Box::new(MessageListItem {
                message: repo.message.clone(),
                state: repo.state.clone(),
                thread: MessageThreadPreview {
                    reply_count: 0,
                    latest_reply_at: None,
                    preview: Vec::new(),
                },
            }),
            call: None,
        },
        ChannelMessageChange::Reply {
            message: reply.clone(),
        },
    ];
    let service = MessageService::new(repo.clone(), Events::default())
        .with_activity(TimelineFacts(vec![activity.clone()]));
    let page = service
        .channel_changes(
            channel_access().try_into_requirement().unwrap(),
            Uuid::from_u128(20),
            0,
        )
        .await
        .unwrap();
    assert_eq!(page.seq, 4);
    assert_eq!(
        page.messages
            .iter()
            .map(ChannelMessageChange::id)
            .collect::<Vec<_>>(),
        vec![repo.message.id, reply.id]
    );
    assert_eq!(
        page.activities.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![activity.id]
    );
    assert_eq!(
        page.removed_ids,
        vec![Uuid::from_u128(40), Uuid::from_u128(50)]
    );
    let ChannelMessageChange::Reply { message } = &page.messages[1] else {
        panic!("expected reply")
    };
    assert!(message.deleted_at.is_some());
}

#[tokio::test]
async fn channel_changes_requires_the_same_channel_capability_as_timeline() {
    let service = MessageService::new(fixture(), Events::default());
    assert!(matches!(
        service
            .channel_changes(
                channel_access().try_into_requirement().unwrap(),
                Uuid::from_u128(21),
                0
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .channel_changes(
                access("macro|author@example.com", "doc", AccessLevel::Comment)
                    .try_into_requirement()
                    .unwrap(),
                Uuid::from_u128(20),
                0
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .channel_changes(
                channel_access().try_into_requirement().unwrap(),
                Uuid::from_u128(20),
                -1
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    let service = MessageService::new(
        StrictRepo {
            inner: fixture(),
            parent_exists: false,
        },
        Events::default(),
    );
    assert!(matches!(
        service
            .channel_changes(
                channel_access().try_into_requirement().unwrap(),
                Uuid::from_u128(20),
                0
            )
            .await,
        Err(MessageError::NotFound)
    ));
}

#[tokio::test]
async fn channel_changes_resolve_current_call_status_and_missing_records() {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
    repo.message.kind = MessageKind::CallRoot;
    repo.change_log.seq = 1;
    repo.change_log.changes = vec![ChannelChange {
        seq: 1,
        kind: ChannelChangeKind::Message(repo.message.id),
    }];
    repo.changed_messages = vec![ChannelMessageChange::Root {
        message: Box::new(MessageListItem {
            message: repo.message.clone(),
            state: repo.state.clone(),
            thread: MessageThreadPreview {
                reply_count: 0,
                latest_reply_at: None,
                preview: Vec::new(),
            },
        }),
        call: None,
    }];
    for expected in [
        CallEntryStatus::RecordDeleted,
        CallEntryStatus::Ended {
            ended_at: Utc::now(),
            duration_ms: 5_000,
        },
    ] {
        if let CallEntryStatus::Ended { .. } = expected {
            repo.call_statuses.insert(repo.message.id, expected);
        }
        let service = MessageService::new(repo.clone(), Events::default());
        let page = service
            .channel_changes(
                channel_access().try_into_requirement().unwrap(),
                Uuid::from_u128(20),
                0,
            )
            .await
            .unwrap();
        let ChannelMessageChange::Root { call, .. } = &page.messages[0] else {
            panic!("expected call root")
        };
        assert_eq!(*call, Some(expected));
    }
}
