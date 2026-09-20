use super::*;
use chrono::DateTime;

fn activity(id: u128) -> TimelineActivity {
    TimelineActivity {
        id: Uuid::from_u128(id),
        actor_id: "macro|author@example.com".into(),
        occurred_at: DateTime::from_timestamp(1_000, 0).unwrap(),
        action: "picture_changed".into(),
        payload: None,
    }
}

fn message(id: u128) -> MessageTimelineEntry {
    let at = activity(id).occurred_at;
    let id = Uuid::from_u128(id);
    MessageTimelineEntry::Message {
        message: Box::new(MessageListItem {
            message: Message {
                id,
                parent: MessageParent::Channel(Uuid::from_u128(100)),
                thread_id: None,
                sender_id: ChannelSender::try_from("macro|author@example.com".to_owned()).unwrap(),
                bot_profile: None,
                mentions: vec![],
                imported_author: None,
                triggered_by: None,
                content: "hello".into(),
                created_at: at,
                updated_at: at,
                edited_at: None,
                deleted_at: None,
                attachments: vec![],
                reactions: vec![],
            },
            state: ThreadState {
                root_id: id,
                user_id: "macro|author@example.com".into(),
                resolved: false,
                anchor: None,
                created_at: at,
                updated_at: at,
                deleted_at: None,
            },
            thread: MessageThreadPreview {
                reply_count: 0,
                latest_reply_at: None,
                preview: vec![],
            },
        }),
    }
}

#[test]
fn mixed_pages_share_uuid_ties_and_bounds() {
    let messages = roots(vec![message(2), message(4)], false);
    let query = MessageTimelineQuery {
        limit: Some(3),
        ..Default::default()
    };
    let result = merge(
        messages,
        vec![activity(1), activity(3), activity(5)],
        &query,
    );
    assert_eq!(
        result
            .entries
            .iter()
            .map(|entry| entry.position().1.as_u128())
            .collect::<Vec<_>>(),
        [5, 4, 3]
    );
    assert_eq!(result.next_cursor.unwrap().id.as_u128(), 3);
    assert!(result.previous_cursor.is_none());
}

#[test]
fn forward_page_keeps_nearest_items_and_returns_newest_first() {
    let query = MessageTimelineQuery {
        limit: Some(2),
        direction: MessageDirection::Newer,
        cursor: Some(MessageCursor {
            id: Uuid::nil(),
            created_at: activity(1).occurred_at,
        }),
        ..Default::default()
    };
    let result = merge(
        roots(vec![message(2), message(4)], true),
        vec![activity(1), activity(3)],
        &query,
    );
    assert_eq!(result.next_cursor.unwrap().id.as_u128(), 1);
    assert_eq!(result.previous_cursor.unwrap().id.as_u128(), 2);
    assert_eq!(
        result
            .entries
            .iter()
            .map(|entry| entry.position().1.as_u128())
            .collect::<Vec<_>>(),
        [2, 1]
    );
}

#[test]
fn activity_only_pages_can_continue_without_messages() {
    let query = MessageTimelineQuery {
        limit: Some(1),
        ..Default::default()
    };
    let result = merge(roots(vec![], false), vec![activity(1), activity(2)], &query);
    assert!(matches!(
        result.entries[0],
        MessageTimelineEntry::Activity { .. }
    ));
    assert_eq!(result.entries[0].position().1.as_u128(), 2);
    assert_eq!(result.next_cursor.unwrap().id.as_u128(), 2);
}

#[test]
fn message_source_lookahead_survives_full_merged_page() {
    let query = MessageTimelineQuery {
        limit: Some(1),
        ..Default::default()
    };
    let result = merge(roots(vec![message(2)], true), vec![], &query);
    assert_eq!(result.next_cursor.unwrap().id.as_u128(), 2);
}

#[test]
fn exhausted_activity_only_page_has_no_next_cursor() {
    let query = MessageTimelineQuery {
        limit: Some(2),
        ..Default::default()
    };
    let result = merge(roots(vec![], false), vec![activity(1)], &query);
    assert_eq!(result.entries.len(), 1);
    assert!(result.next_cursor.is_none());
}

fn roots(entries: Vec<MessageTimelineEntry>, more: bool) -> MessageRootPage {
    MessageRootPage {
        next_cursor: more.then(|| entries.last().unwrap().cursor()),
        previous_cursor: more.then(|| entries.first().unwrap().cursor()),
        items: entries
            .into_iter()
            .map(|entry| match entry {
                MessageTimelineEntry::Message { message } => *message,
                MessageTimelineEntry::Activity { .. } => panic!("repository only returns messages"),
            })
            .collect(),
    }
}

#[test]
fn response_serializes_one_ordered_discriminated_list() {
    let response = merge(
        roots(vec![message(2)], false),
        vec![activity(1), activity(3)],
        &MessageTimelineQuery::default(),
    );
    let json = serde_json::to_value(response).unwrap();
    assert!(json.get("items").is_none());
    assert!(json.get("activities").is_none());
    let entries = json["entries"].as_array().unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["activity", "message", "activity"]
    );
    assert_eq!(entries[0]["activity"]["id"], Uuid::from_u128(3).to_string());
    assert_eq!(entries[1]["message"]["id"], Uuid::from_u128(2).to_string());
}
