use super::*;
use crate::domain::{
    models::{CountedReaction, MessageAttachment, ThreadReplyRow, TopLevelMessageRow},
    ports::MockChannelMessagesRepo,
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
        thread_reply_count: 0,
        latest_reply_at: None,
    }
}

fn empty_repo() -> MockChannelMessagesRepo {
    let mut repo = MockChannelMessagesRepo::new();
    repo.expect_get_top_level_messages()
        .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
    repo.expect_get_thread_previews()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo
}

#[tokio::test]
async fn returns_empty_page_for_no_messages() {
    let svc = ChannelMessagesServiceImpl::new(empty_repo());
    let page = svc
        .get_channel_messages(Uuid::nil(), Query::Sort(CreatedAt, ()), 50)
        .await
        .unwrap();

    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn returns_messages_with_thread_info() {
    let parent_id = Uuid::new_v4();
    let reply_id = Uuid::new_v4();
    let row = TopLevelMessageRow {
        thread_reply_count: 5,
        latest_reply_at: Some(Utc::now()),
        ..make_row(parent_id, 10)
    };

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
        .returning(move |_, _, _| {
            let r = row_clone.clone();
            Box::pin(async move { Ok(vec![r]) })
        });

    let reply_clone = reply_row.clone();
    repo.expect_get_thread_previews().returning(move |_, _| {
        let mut map = HashMap::new();
        map.insert(parent_id, vec![reply_clone.clone()]);
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
        created_at: Utc::now(),
    };
    let attachment_clone = attachment.clone();
    repo.expect_get_attachments_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        map.insert(parent_id, vec![attachment_clone.clone()]);
        Box::pin(async move { Ok(map) })
    });

    let svc = ChannelMessagesServiceImpl::new(repo);
    let page = svc
        .get_channel_messages(Uuid::nil(), Query::Sort(CreatedAt, ()), 50)
        .await
        .unwrap();

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
        .withf(|_, _, limit| *limit == 100)
        .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
    repo.expect_get_thread_previews()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelMessagesServiceImpl::new(repo);
    let page = svc
        .get_channel_messages(Uuid::nil(), Query::Sort(CreatedAt, ()), 200)
        .await
        .unwrap();

    assert!(page.items.is_empty());
}
