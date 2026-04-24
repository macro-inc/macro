use super::*;
use crate::domain::{
    models::{
        ChannelMessageFilters, CountedReaction, MessageAttachment, MessagePageDirection,
        ThreadData, ThreadReplyRow, TopLevelMessageRow,
    },
    ports::{MockChannelMessagesRepo, TopLevelMessagesQueryResult},
};
use chrono::Utc;
use std::collections::HashMap;

fn make_row(id: Uuid, minutes_ago: i64) -> TopLevelMessageRow {
    let now = Utc::now();
    TopLevelMessageRow {
        id,
        channel_id: Uuid::nil(),
        sender_id: "user_1".into(),
        content: format!("msg {minutes_ago}"),
        created_at: now - chrono::Duration::minutes(minutes_ago),
        updated_at: now - chrono::Duration::minutes(minutes_ago),
        edited_at: None,
        deleted_at: None,
    }
}

fn empty_repo() -> MockChannelMessagesRepo {
    let mut repo = MockChannelMessagesRepo::new();
    repo.expect_get_top_level_messages()
        .returning(|_, _, _, _, _| {
            Box::pin(async {
                Ok(TopLevelMessagesQueryResult {
                    rows: vec![],
                    has_more_newer: false,
                })
            })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_channel_attachments()
        .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
    repo.expect_get_channel_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo.expect_resolve_top_level_parent()
        .returning(|_, _| Box::pin(async { Ok(None) }));
    repo.expect_get_top_level_messages_around()
        .returning(|_, _, _, _| Box::pin(async { Ok((vec![], vec![])) }));
    repo.expect_get_thread_replies()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo
}

#[tokio::test]
async fn returns_empty_page_for_no_messages() {
    let svc = ChannelMessagesServiceImpl::new(empty_repo());
    let result = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &ChannelMessageFilters::default(),
        )
        .await
        .unwrap();
    let page = result.page;

    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn returns_messages_with_thread_info() {
    let parent_id = Uuid::new_v4();
    let reply_id = Uuid::new_v4();
    let row = make_row(parent_id, 10);
    let latest_reply = Utc::now();

    let reply_row = ThreadReplyRow {
        id: reply_id,
        thread_id: parent_id,
        sender_id: "user_2".into(),
        content: "reply".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };

    let mut repo = MockChannelMessagesRepo::new();

    let row_clone = row.clone();
    repo.expect_get_top_level_messages()
        .returning(move |_, _, _, _, _| {
            let r = row_clone.clone();
            Box::pin(async move {
                Ok(TopLevelMessagesQueryResult {
                    rows: vec![r],
                    has_more_newer: false,
                })
            })
        });

    let reply_clone = reply_row.clone();
    repo.expect_get_thread_data().returning(move |_, _| {
        let mut map = HashMap::new();
        map.insert(
            parent_id,
            ThreadData {
                reply_count: 5,
                latest_reply_at: Some(latest_reply),
                preview_replies: vec![reply_clone.clone()],
            },
        );
        Box::pin(async move { Ok(map) })
    });

    let reaction = CountedReaction {
        emoji: "👍".into(),
        users: vec!["user_3".into()],
    };
    let reaction_clone = reaction.clone();
    repo.expect_get_reactions_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<CountedReaction>> = HashMap::new();
        map.insert(parent_id, vec![reaction_clone.clone()]);
        Box::pin(async move { Ok(map) })
    });

    let attachment = MessageAttachment {
        id: Uuid::new_v4(),
        entity_type: "document".into(),
        entity_id: "doc_1".into(),
        width: None,
        height: None,
        created_at: Utc::now(),
    };
    let attachment_clone = attachment.clone();
    repo.expect_get_attachments_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        map.insert(parent_id, vec![attachment_clone.clone()]);
        Box::pin(async move { Ok(map) })
    });

    let svc = ChannelMessagesServiceImpl::new(repo);
    let result = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &ChannelMessageFilters::default(),
        )
        .await
        .unwrap();
    let page = result.page;

    assert_eq!(page.items.len(), 1);
    let msg = &page.items[0];
    assert_eq!(msg.thread.reply_count, 5);
    assert_eq!(msg.thread.preview.len(), 1);
    assert_eq!(msg.reactions.len(), 1);
    assert_eq!(msg.attachments.len(), 1);
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn clamps_limit() {
    let mut repo = MockChannelMessagesRepo::new();
    repo.expect_get_top_level_messages()
        .withf(|_, _, _, limit, _| *limit == 100)
        .returning(|_, _, _, _, _| {
            Box::pin(async {
                Ok(TopLevelMessagesQueryResult {
                    rows: vec![],
                    has_more_newer: false,
                })
            })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelMessagesServiceImpl::new(repo);
    let result = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            200,
            &ChannelMessageFilters::default(),
        )
        .await
        .unwrap();
    let page = result.page;

    assert!(page.items.is_empty());
}

#[tokio::test]
async fn returns_empty_attachments_page() {
    let svc = ChannelMessagesServiceImpl::new(empty_repo());
    let page = svc
        .get_channel_attachments(Uuid::nil(), Query::Sort(CreatedAt, ()), 50)
        .await
        .unwrap();

    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn returns_empty_participants_list() {
    let svc = ChannelMessagesServiceImpl::new(empty_repo());
    let participants = svc.get_channel_participants(Uuid::nil()).await.unwrap();

    assert!(participants.is_empty());
}

// --- center_window tests ---

#[test]
fn center_window_balanced() {
    // 5 before, anchor, 5 after, limit=7 → half=3 before, 3 after
    let before: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), -i)).collect();

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 7);
    assert_eq!(result.len(), 7);
    assert!(result.has_more_newer);
    // First 3 are from after (reversed = newest-first), then anchor, then 3 from before
    assert_eq!(result[0].id, after[2].id);
    assert_eq!(result[1].id, after[1].id);
    assert_eq!(result[2].id, after[0].id);
    assert_eq!(result[3].id, anchor.id);
    assert_eq!(result[4].id, before[0].id);
    assert_eq!(result[5].id, before[1].id);
    assert_eq!(result[6].id, before[2].id);
}

#[test]
fn center_window_near_oldest_edge() {
    // Only 1 before, anchor, 10 after, limit=7 → 1 before, 5 after
    let before = vec![make_row(Uuid::new_v4(), 1)];
    let anchor = make_row(Uuid::new_v4(), 0);
    let after: Vec<_> = (1..=10).map(|i| make_row(Uuid::new_v4(), -i)).collect();

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 7);
    assert_eq!(result.len(), 7);
    assert!(result.has_more_newer);
    assert_eq!(result[5].id, anchor.id);
    assert_eq!(result[6].id, before[0].id);
    // First 5 are after (reversed)
    for i in 0..5 {
        assert_eq!(result[i].id, after[4 - i].id);
    }
}

#[test]
fn center_window_near_newest_edge() {
    // 10 before, anchor, only 1 after, limit=7 → 5 before, 1 after
    let before: Vec<_> = (1..=10).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after = vec![make_row(Uuid::new_v4(), -1)];

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 7);
    assert_eq!(result.len(), 7);
    assert!(!result.has_more_newer);
    assert_eq!(result[0].id, after[0].id);
    assert_eq!(result[1].id, anchor.id);
    for i in 0..5 {
        assert_eq!(result[2 + i].id, before[i].id);
    }
}

#[test]
fn center_window_small_channel() {
    // 2 before, anchor, 1 after, limit=10 → returns all 4
    let before: Vec<_> = (1..=2).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after = vec![make_row(Uuid::new_v4(), -1)];

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 10);
    assert_eq!(result.len(), 4);
    assert!(!result.has_more_newer);
    assert_eq!(result[0].id, after[0].id);
    assert_eq!(result[1].id, anchor.id);
    assert_eq!(result[2].id, before[0].id);
    assert_eq!(result[3].id, before[1].id);
}

#[test]
fn center_window_limit_one() {
    let before: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), -i)).collect();

    let result = center_window(before, anchor.clone(), after, 1);
    assert_eq!(result.len(), 1);
    assert!(result.has_more_newer);
    assert_eq!(result[0].id, anchor.id);
}

// --- get_channel_messages_around tests ---

#[tokio::test]
async fn around_message_not_found() {
    let svc = ChannelMessagesServiceImpl::new(empty_repo());
    let message_id = Uuid::new_v4();

    let err = svc
        .get_channel_messages_around(Uuid::nil(), message_id, 50)
        .await
        .unwrap_err();

    assert!(
        matches!(err, ChannelMessagesErr::MessageNotFound(id) if id == message_id),
        "expected MessageNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn around_resolves_and_hydrates() {
    let anchor = make_row(Uuid::new_v4(), 0);
    let before_row = make_row(Uuid::new_v4(), 1);
    let after_row = make_row(Uuid::new_v4(), -1);

    let anchor_clone = anchor.clone();
    let before_clone = before_row.clone();
    let after_clone = after_row.clone();

    let mut repo = MockChannelMessagesRepo::new();

    repo.expect_resolve_top_level_parent()
        .returning(move |_, _| {
            let a = anchor_clone.clone();
            Box::pin(async move { Ok(Some(a)) })
        });
    repo.expect_get_top_level_messages_around()
        .returning(move |_, _, _, _| {
            let b = vec![before_clone.clone()];
            let a = vec![after_clone.clone()];
            Box::pin(async move { Ok((b, a)) })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelMessagesServiceImpl::new(repo);
    let result = svc
        .get_channel_messages_around(Uuid::nil(), anchor.id, 50)
        .await
        .unwrap();
    let page = result.page;

    assert!(!result.has_more_newer);
    assert_eq!(page.items.len(), 3);
    // DESC order: after, anchor, before
    assert_eq!(page.items[0].id, after_row.id);
    assert_eq!(page.items[1].id, anchor.id);
    assert_eq!(page.items[2].id, before_row.id);
}

#[tokio::test]
async fn thread_replies_message_not_found() {
    let svc = ChannelMessagesServiceImpl::new(empty_repo());
    let message_id = Uuid::new_v4();

    let err = svc
        .get_thread_replies(Uuid::nil(), message_id)
        .await
        .unwrap_err();

    assert!(
        matches!(err, ChannelMessagesErr::MessageNotFound(id) if id == message_id),
        "expected MessageNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn thread_replies_resolve_and_hydrate() {
    let parent = make_row(Uuid::new_v4(), 0);
    let reply_1 = ThreadReplyRow {
        id: Uuid::new_v4(),
        thread_id: parent.id,
        sender_id: "macro|user-a@test.com".into(),
        content: "reply 1".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };
    let reply_2 = ThreadReplyRow {
        id: Uuid::new_v4(),
        thread_id: parent.id,
        sender_id: "macro|user-b@test.com".into(),
        content: "reply 2".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };

    let parent_clone = parent.clone();
    let reply_1_clone = reply_1.clone();
    let reply_2_clone = reply_2.clone();

    let mut repo = MockChannelMessagesRepo::new();

    repo.expect_resolve_top_level_parent()
        .returning(move |_, _| {
            let p = parent_clone.clone();
            Box::pin(async move { Ok(Some(p)) })
        });
    repo.expect_get_thread_replies().returning(move |_| {
        let replies = vec![reply_1_clone.clone(), reply_2_clone.clone()];
        Box::pin(async move { Ok(replies) })
    });
    repo.expect_get_reactions_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<CountedReaction>> = HashMap::new();
        map.insert(
            reply_1.id,
            vec![CountedReaction {
                emoji: "👍".into(),
                users: vec!["macro|user-c@test.com".into()],
            }],
        );
        Box::pin(async move { Ok(map) })
    });
    repo.expect_get_attachments_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        map.insert(
            reply_2.id,
            vec![MessageAttachment {
                id: Uuid::new_v4(),
                entity_type: "document".into(),
                entity_id: "doc-1".into(),
                width: None,
                height: None,
                created_at: Utc::now(),
            }],
        );
        Box::pin(async move { Ok(map) })
    });

    let svc = ChannelMessagesServiceImpl::new(repo);
    let replies = svc
        .get_thread_replies(Uuid::nil(), reply_1.id)
        .await
        .unwrap();

    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0].id, reply_1.id);
    assert_eq!(replies[0].reactions.len(), 1);
    assert_eq!(replies[0].attachments.len(), 0);
    assert_eq!(replies[1].id, reply_2.id);
    assert_eq!(replies[1].reactions.len(), 0);
    assert_eq!(replies[1].attachments.len(), 1);
}
