use super::*;
use opensearch_client::search::model::Highlight;
use sqlx::types::chrono;

fn create_test_response(
    chat_id: &str,
    chat_message_id: &str,
    user_id: &str,
    content: Option<Vec<String>>,
) -> opensearch_client::search::chats::ChatSearchResponse {
    opensearch_client::search::chats::ChatSearchResponse {
        chat_id: chat_id.to_string(),
        chat_message_id: chat_message_id.to_string(),
        user_id: user_id.to_string(),
        role: "user".to_string(),
        updated_at: 1234567890,
        title: "Test Chat".to_string(),
        highlight: Highlight {
            name: None,
            content: content.unwrap_or_default(),
        },
    }
}

#[test]
fn test_empty_input() {
    let input = vec![];
    let result = construct_search_result(input, HashMap::new()).unwrap();
    assert_eq!(result.len(), 0);
}

#[test]
fn test_single_chat_with_content() {
    let input = vec![create_test_response(
        "chat_1",
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];
    let result = construct_search_result(input, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.chat_id, "chat_1");
    assert_eq!(result[0].extra.id, "chat_1");
    assert_eq!(result[0].extra.user_id, "user_1");
    assert_eq!(result[0].extra.owner_id, "user_1");
    assert_eq!(result[0].extra.name, "Test Chat");
    assert_eq!(result[0].extra.chat_search_results.len(), 1);
    assert_eq!(
        result[0].extra.chat_search_results[0].chat_message_id,
        "msg_1"
    );
    assert_eq!(
        result[0].extra.chat_search_results[0].highlight.content,
        vec!["hello world"]
    );
}

#[test]
fn test_single_chat_without_content() {
    let input = vec![create_test_response("chat_1", "msg_1", "user_1", None)];
    let result = construct_search_result(input, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.chat_id, "chat_1");
    assert_eq!(result[0].extra.id, "chat_1");
    assert_eq!(result[0].extra.user_id, "user_1");
    assert_eq!(result[0].extra.owner_id, "user_1");
    assert_eq!(result[0].extra.name, "Test Chat");
    assert_eq!(result[0].extra.chat_search_results.len(), 1);
}

#[test]
fn test_single_chat_multiple_messages() {
    let input = vec![
        create_test_response("chat_1", "msg_1", "user_1", Some(vec!["hello".to_string()])),
        create_test_response("chat_1", "msg_2", "user_1", Some(vec!["world".to_string()])),
    ];
    let result = construct_search_result(input, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.chat_id, "chat_1");
    assert_eq!(result[0].extra.id, "chat_1");
    assert_eq!(result[0].extra.chat_search_results.len(), 2);

    // Check both messages are present
    let message_ids: Vec<&String> = result[0]
        .extra
        .chat_search_results
        .iter()
        .map(|r| &r.chat_message_id)
        .collect();
    assert!(message_ids.contains(&&"msg_1".to_string()));
    assert!(message_ids.contains(&&"msg_2".to_string()));
}

#[test]
fn test_multiple_chats() {
    let input = vec![
        create_test_response("chat_1", "msg_1", "user_1", Some(vec!["hello".to_string()])),
        create_test_response("chat_2", "msg_2", "user_2", Some(vec!["world".to_string()])),
    ];
    let result = construct_search_result(input, HashMap::new()).unwrap();

    assert_eq!(result.len(), 2);

    // Check both chats are present
    let chat_ids: Vec<&String> = result.iter().map(|r| &r.extra.id).collect();
    assert!(chat_ids.contains(&&"chat_1".to_string()));
    assert!(chat_ids.contains(&&"chat_2".to_string()));

    // Each chat should have one message
    for chat in &result {
        assert_eq!(chat.extra.chat_search_results.len(), 1);
    }
}

#[test]
fn test_mixed_content_presence() {
    let input = vec![
        create_test_response(
            "chat_1",
            "msg_1",
            "user_1",
            Some(vec!["visible".to_string()]),
        ),
        create_test_response("chat_1", "msg_2", "user_1", None), // No content
        create_test_response(
            "chat_1",
            "msg_3",
            "user_1",
            Some(vec!["also visible".to_string()]),
        ),
    ];
    let result = construct_search_result(input, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.chat_id, "chat_1");
    assert_eq!(result[0].extra.id, "chat_1");
    assert_eq!(result[0].extra.chat_search_results.len(), 3); // Only messages with content

    let contents: Vec<&Vec<String>> = result[0]
        .extra
        .chat_search_results
        .iter()
        .map(|r| &r.highlight.content)
        .collect();
    assert!(contents.contains(&&vec!["visible".to_string()]));
    assert!(contents.contains(&&vec!["also visible".to_string()]));
}

#[test]
fn test_user_id_taken_from_first_result() {
    let input = vec![
        create_test_response(
            "chat_1",
            "msg_1",
            "user_first",
            Some(vec!["content1".to_string()]),
        ),
        create_test_response(
            "chat_1",
            "msg_2",
            "user_second",
            Some(vec!["content2".to_string()]),
        ),
    ];
    let result = construct_search_result(input, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    // user_id should come from the first result (base_search_result)
    assert_eq!(result[0].extra.user_id, "user_first");
    assert_eq!(result[0].extra.chat_search_results.len(), 2);
}

#[test]
fn test_chat_history_timestamps() {
    // Create a test response
    let input = vec![create_test_response(
        "chat_1",
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock chat history with known timestamps
    let mut chat_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = ChatHistoryInfo {
        item_id: "chat_1".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
    };

    chat_histories.insert("chat_1".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, chat_histories).unwrap();

    // Verify that timestamps were copied from the chat history
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].created_at, now.timestamp());
    assert_eq!(result[0].updated_at, now.timestamp());
    assert_eq!(result[0].viewed_at, Some(now.timestamp()));
}

#[test]
fn test_chat_history_missing_entry() {
    // Create a test response for a chat that doesn't have history
    let input = vec![create_test_response(
        "chat_missing",
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock chat history that doesn't contain the chat_id
    let mut chat_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = ChatHistoryInfo {
        item_id: "different_chat".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None,
        project_id: Some("project_1".to_string()),
    };

    chat_histories.insert("different_chat".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, chat_histories).unwrap();

    // Verify that default timestamps were used
    assert_eq!(result.len(), 1);

    // Default values from ChatHistoryInfo::default()
    let default_time = chrono::DateTime::<chrono::Utc>::default().timestamp();
    assert_eq!(result[0].created_at, default_time);
    assert_eq!(result[0].updated_at, default_time);
    assert_eq!(result[0].viewed_at, None);
}

#[test]
fn test_chat_history_null_viewed_at() {
    // Create a test response
    let input = vec![create_test_response(
        "chat_1",
        "msg_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock chat history with null viewed_at
    let mut chat_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = ChatHistoryInfo {
        item_id: "chat_1".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None, // This user has never viewed this chat
        project_id: Some("project_1".to_string()),
    };

    chat_histories.insert("chat_1".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, chat_histories).unwrap();

    // Verify that timestamps were copied correctly and viewed_at is None
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].created_at, now.timestamp());
    assert_eq!(result[0].updated_at, now.timestamp());
    assert_eq!(result[0].viewed_at, None);
}
