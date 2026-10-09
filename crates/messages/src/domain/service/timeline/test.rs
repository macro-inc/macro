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

fn message(id: u128) -> MessageListItem {
    let at = activity(id).occurred_at;
    let id = Uuid::from_u128(id);
    MessageListItem {
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
    }
}

/// Page ids in server order.
fn ids(page: &MessageTimelinePage) -> Vec<u128> {
    page.entries
        .iter()
        .map(|entry| entry.position().1.as_u128())
        .collect()
}

fn roots(items: Vec<MessageListItem>, more: bool) -> MessagePage {
    let cursor = |item: &MessageListItem| MessageCursor {
        created_at: item.message.created_at,
        id: item.message.id,
    };
    MessagePage {
        next_cursor: more.then(|| cursor(items.last().unwrap())),
        previous_cursor: more.then(|| cursor(items.first().unwrap())),
        items,
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
    assert_eq!(ids(&result), [5, 4, 3]);
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
    assert_eq!(ids(&result), [2, 1]);
    assert_eq!(result.next_cursor.unwrap().id.as_u128(), 1);
    assert_eq!(result.previous_cursor.unwrap().id.as_u128(), 2);
}

#[test]
fn activity_only_pages_can_continue_without_messages() {
    let query = MessageTimelineQuery {
        limit: Some(1),
        ..Default::default()
    };
    let result = merge(roots(vec![], false), vec![activity(1), activity(2)], &query);
    assert!(matches!(
        result.entries[..],
        [MessageTimelineEntry::Activity { .. }]
    ));
    assert_eq!(ids(&result), [2]);
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
    assert_eq!(ids(&result), [1]);
    assert!(result.next_cursor.is_none());
}

#[test]
fn response_tags_each_entry_with_its_kind() {
    let response = merge(
        roots(vec![message(2)], false),
        vec![activity(1), activity(3)],
        &MessageTimelineQuery::default(),
    );
    let json = serde_json::to_value(response).unwrap();
    let entries = json["entries"].as_array().unwrap();
    let shape: Vec<_> = entries
        .iter()
        .map(|entry| {
            let kind = entry["type"].as_str().unwrap();
            (
                kind.to_owned(),
                entry[kind]["id"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        shape,
        [
            ("activity".to_owned(), Uuid::from_u128(3).to_string()),
            ("message".to_owned(), Uuid::from_u128(2).to_string()),
            ("activity".to_owned(), Uuid::from_u128(1).to_string()),
        ]
    );
    assert_eq!(entries[1]["message"]["thread"]["reply_count"], 0);
}
