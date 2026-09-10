use super::*;

fn dt(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap()
}

fn reply(seconds: i64) -> Message {
    Message {
        id: Uuid::new_v4(),
        parent: messages::domain::models::MessageParent::Channel(Uuid::nil()),
        thread_id: Some(Uuid::from_u128(1)),
        sender_id: "macro|reply@example.com".to_owned().try_into().unwrap(),
        triggered_by: None,
        bot_profile: None,
        imported_author: None,
        mentions: vec![],
        content: "reply".into(),
        created_at: dt(seconds),
        updated_at: dt(seconds),
        edited_at: None,
        deleted_at: None,
        reactions: vec![],
        attachments: vec![],
    }
}
fn message_with_thread(reply_count: i64, preview: Vec<Message>) -> MessageListItem {
    let mut message = reply(1);
    message.thread_id = None;
    let state = messages::domain::models::ThreadState {
        root_id: message.id,
        user_id: message.sender_id.as_ref().into(),
        created_at: dt(1),
        updated_at: dt(1),
        resolved: false,
        deleted_at: None,
        anchor: None,
    };
    MessageListItem {
        message,
        state,
        thread: messages::domain::ports::MessageThreadPreview {
            reply_count,
            latest_reply_at: None,
            preview,
        },
    }
}

#[test]
fn omitted_reply_count_includes_hidden_previews_when_preview_is_disabled() {
    let message = message_with_thread(5, vec![reply(2), reply(3), reply(4)]);

    let tool_message = ToolChannelMessage::from_message(message, Uuid::nil(), false, 4_000);

    assert!(tool_message.thread.preview.is_none());
    assert_eq!(tool_message.thread.omitted_reply_count, 5);
}

#[test]
fn omitted_reply_count_excludes_included_previews_when_preview_is_enabled() {
    let message = message_with_thread(5, vec![reply(2), reply(3), reply(4)]);

    let tool_message = ToolChannelMessage::from_message(message, Uuid::nil(), true, 4_000);

    assert_eq!(tool_message.thread.preview.as_ref().unwrap().len(), 3);
    assert_eq!(tool_message.thread.omitted_reply_count, 2);
}
