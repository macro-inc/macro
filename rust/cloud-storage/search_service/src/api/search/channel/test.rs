use opensearch_client::search::model::Highlight;

use super::*;

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_channel() {
    let channel_uuid = "550e8400-e29b-41d4-a716-446655440000";
    let search_results = vec![
        opensearch_client::search::channels::ChannelMessageSearchResponse {
            channel_id: channel_uuid.to_string(),
            channel_name: Some("Test Channel".to_string()),
            channel_type: "public".to_string(),
            org_id: Some(123),
            message_id: "msg1".to_string(),
            thread_id: Some("thread1".to_string()),
            sender_id: "user1".to_string(),
            mentions: vec!["@user2".to_string()],
            created_at: 1234567890,
            updated_at: 1234567891,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Test message content".to_string()],
            },
        },
    ];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        Uuid::parse_str(channel_uuid).unwrap(),
        create_channel_history(channel_uuid),
    );

    let result = construct_search_result(search_results, channel_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.channel_id, channel_uuid);
    assert_eq!(result[0].extra.id, channel_uuid);
    assert_eq!(
        result[0].extra.channel_name,
        Some("Test Channel".to_string())
    );
    assert_eq!(result[0].extra.name, Some("Test Channel".to_string()));
    assert_eq!(result[0].extra.channel_message_search_results.len(), 1);
    assert_eq!(
        result[0].extra.channel_message_search_results[0].message_id,
        "msg1"
    );
    assert_eq!(
        result[0].extra.channel_message_search_results[0].sender_id,
        "user1"
    );
    assert_eq!(
        result[0].extra.channel_message_search_results[0].thread_id,
        Some("thread1".to_string())
    );
}

#[test]
fn test_construct_search_result_multiple_messages_same_channel() {
    let channel_uuid = "550e8400-e29b-41d4-a716-446655440001";
    let search_results = vec![
        opensearch_client::search::channels::ChannelMessageSearchResponse {
            channel_id: channel_uuid.to_string(),
            channel_name: Some("Test Channel".to_string()),
            channel_type: "public".to_string(),
            org_id: Some(123),
            message_id: "msg1".to_string(),
            thread_id: Some("thread1".to_string()),
            sender_id: "user1".to_string(),
            mentions: vec![],
            created_at: 1234567890,
            updated_at: 1234567891,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["First message".to_string()],
            },
        },
        opensearch_client::search::channels::ChannelMessageSearchResponse {
            channel_id: channel_uuid.to_string(),
            channel_name: Some("Test Channel".to_string()),
            channel_type: "public".to_string(),
            org_id: Some(123),
            message_id: "msg2".to_string(),
            thread_id: Some("thread2".to_string()),
            sender_id: "user2".to_string(),
            mentions: vec!["@user1".to_string()],
            created_at: 1234567892,
            updated_at: 1234567893,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Second message".to_string()],
            },
        },
    ];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        Uuid::parse_str(channel_uuid).unwrap(),
        create_channel_history(channel_uuid),
    );

    let result = construct_search_result(search_results, channel_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.channel_id, channel_uuid);
    assert_eq!(result[0].extra.id, channel_uuid);
    assert_eq!(result[0].extra.name, Some("Test Channel".to_string()));
    assert_eq!(result[0].extra.channel_message_search_results.len(), 2);

    let message_ids: Vec<String> = result[0]
        .extra
        .channel_message_search_results
        .iter()
        .map(|r| r.message_id.clone())
        .collect();
    assert!(message_ids.contains(&"msg1".to_string()));
    assert!(message_ids.contains(&"msg2".to_string()));

    let sender_ids: Vec<String> = result[0]
        .extra
        .channel_message_search_results
        .iter()
        .map(|r| r.sender_id.clone())
        .collect();
    assert!(sender_ids.contains(&"user1".to_string()));
    assert!(sender_ids.contains(&"user2".to_string()));
}

#[test]
fn test_construct_search_result_filters_messages_without_content() {
    let channel_uuid = "550e8400-e29b-41d4-a716-446655440002";
    let search_results = vec![
        opensearch_client::search::channels::ChannelMessageSearchResponse {
            channel_id: channel_uuid.to_string(),
            channel_name: Some("Test Channel".to_string()),
            channel_type: "public".to_string(),
            org_id: Some(123),
            message_id: "msg1".to_string(),
            thread_id: Some("thread1".to_string()),
            sender_id: "user1".to_string(),
            mentions: vec![],
            created_at: 1234567890,
            updated_at: 1234567891,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Message with content".to_string()],
            },
        },
        opensearch_client::search::channels::ChannelMessageSearchResponse {
            channel_id: channel_uuid.to_string(),
            channel_name: Some("Test Channel".to_string()),
            channel_type: "public".to_string(),
            org_id: Some(123),
            message_id: "msg2".to_string(),
            thread_id: Some("thread2".to_string()),
            sender_id: "user2".to_string(),
            mentions: vec![],
            created_at: 1234567892,
            updated_at: 1234567893,
            score: None,
            highlight: Highlight::default(),
        },
    ];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        Uuid::parse_str(channel_uuid).unwrap(),
        create_channel_history(channel_uuid),
    );

    let result = construct_search_result(search_results, channel_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.channel_message_search_results.len(), 2);
    assert_eq!(
        result[0].extra.channel_message_search_results[0].message_id,
        "msg1"
    );
}

fn create_test_channel_response(
    channel_id: &str,
    message_id: &str,
    sender_id: &str,
    content: Option<Vec<String>>,
) -> opensearch_client::search::channels::ChannelMessageSearchResponse {
    opensearch_client::search::channels::ChannelMessageSearchResponse {
        channel_id: channel_id.to_string(),
        channel_name: Some("Test Channel".to_string()),
        channel_type: "public".to_string(),
        org_id: Some(123),
        message_id: message_id.to_string(),
        thread_id: Some("thread1".to_string()),
        sender_id: sender_id.to_string(),
        mentions: vec![],
        created_at: 1234567890,
        updated_at: 1234567891,
        score: None,
        highlight: Highlight {
            name: None,
            content: content.unwrap_or_default(),
        },
    }
}

fn create_channel_history(channel_id: &str) -> ChannelHistoryInfo {
    let now = chrono::Utc::now();
    let channel_uuid = Uuid::parse_str(channel_id).unwrap_or_else(|_| Uuid::new_v4());
    ChannelHistoryInfo {
        item_id: channel_uuid,
        created_at: now,
        updated_at: now,
        viewed_at: None,
        interacted_at: None,
    }
}

#[test]
fn test_channel_history_timestamps() {
    // Create a mock channel history with known timestamps
    let mut channel_histories = HashMap::new();
    let now = chrono::Utc::now();
    let channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440001").unwrap();

    let history = ChannelHistoryInfo {
        item_id: channel_uuid,
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        interacted_at: Some(now),
    };

    channel_histories.insert(channel_uuid, history);

    // Create a test response with the UUID
    let input = vec![create_test_channel_response(
        &channel_uuid.to_string(),
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Call the function under test
    let result = construct_search_result(input, channel_histories).unwrap();

    // Verify that timestamps were copied from the channel history
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.created_at, now.timestamp());
    assert_eq!(metadata.updated_at, now.timestamp());
    assert_eq!(metadata.viewed_at, Some(now.timestamp()));
    assert_eq!(metadata.interacted_at, Some(now.timestamp()));
}

#[test]
fn test_channel_history_missing_entry() {
    // Create a test response for a channel that doesn't have history
    let missing_channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440002").unwrap();
    let input = vec![create_test_channel_response(
        &missing_channel_uuid.to_string(),
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock channel history that doesn't contain the channel_id
    let mut channel_histories = HashMap::new();
    let now = chrono::Utc::now();
    let different_channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440003").unwrap();

    let history = ChannelHistoryInfo {
        item_id: different_channel_uuid,
        created_at: now,
        updated_at: now,
        viewed_at: None,
        interacted_at: None,
    };

    channel_histories.insert(different_channel_uuid, history);

    // Call the function under test
    let result = construct_search_result(input, channel_histories).unwrap();

    // Channels without history info should still be returned but with None metadata
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_none());
}

#[test]
fn test_channel_history_null_viewed_at() {
    // Create a test response
    let channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440004").unwrap();
    let input = vec![create_test_channel_response(
        &channel_uuid.to_string(),
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock channel history with null viewed_at
    let mut channel_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = ChannelHistoryInfo {
        item_id: channel_uuid,
        created_at: now,
        updated_at: now,
        viewed_at: None,     // This user has never viewed this channel
        interacted_at: None, // This user has never interacted with this channel
    };

    channel_histories.insert(channel_uuid, history);

    // Call the function under test
    let result = construct_search_result(input, channel_histories).unwrap();

    // Verify that timestamps were copied correctly and viewed_at is None
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.created_at, now.timestamp());
    assert_eq!(metadata.updated_at, now.timestamp());
    assert!(metadata.viewed_at.is_none());
    assert!(metadata.interacted_at.is_none());
}

#[test]
fn test_channel_history_invalid_uuid() {
    // Create a test response with an invalid UUID
    let input = vec![create_test_channel_response(
        "invalid-uuid",
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock channel history
    let channel_histories = HashMap::new();

    // Call the function under test
    let result = construct_search_result(input, channel_histories).unwrap();

    // Channels with invalid UUIDs should still be returned but with None metadata
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_none());
}
