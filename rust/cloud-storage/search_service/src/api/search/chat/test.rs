use super::*;
use macro_db_client::chat::get::ChatHistoryInfo;
use models_opensearch::SearchEntityType;
use opensearch_client::search::model::Highlight;
use sqlx::types::chrono;

fn create_test_response(
    chat_id: &str,
    chat_message_id: &str,
    content: Option<Vec<String>>,
) -> opensearch_client::search::model::SearchHit {
    opensearch_client::search::model::SearchHit {
        entity_id: chat_id.parse().unwrap(),
        entity_type: SearchEntityType::Chats,
        goto: Some(opensearch_client::search::model::SearchGotoContent::Chats(
            opensearch_client::search::model::SearchGotoChat {
                chat_message_id: chat_message_id.parse().unwrap(),
                role: "user".to_string(),
            },
        )),
        score: None,
        highlight: Highlight {
            name: None,
            content: content.unwrap_or_default(),
            ..Default::default()
        },
        updated_at: None,
    }
}

fn create_chat_history(chat_id: &str) -> macro_db_client::chat::get::ChatHistoryInfo {
    let now = chrono::Utc::now();
    macro_db_client::chat::get::ChatHistoryInfo {
        item_id: chat_id.to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None,
        project_id: None,
        user_id: "user_1".to_string(),
        name: "name".to_string(),
        deleted_at: None,
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
        "11111111-1111-1111-1111-111111111111",
        "11111111-1111-1111-1111-111111111111",
        Some(vec!["hello world".to_string()]),
    )];

    let mut chat_histories = HashMap::new();
    let now = chrono::Utc::now();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        macro_db_client::chat::get::ChatHistoryInfo {
            item_id: "11111111-1111-1111-1111-111111111111".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            user_id: "user_1".to_string(),
            name: "name".to_string(),
            deleted_at: None,
        },
    );

    let result = construct_search_result(input, chat_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].extra.chat_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(result[0].extra.user_id, "user_1");
    assert_eq!(result[0].extra.owner_id, "user_1");
    assert_eq!(result[0].extra.name, "name");
    assert_eq!(result[0].extra.chat_search_results.len(), 1);
    assert_eq!(
        result[0].extra.chat_search_results[0]
            .chat_message_id
            .as_ref()
            .unwrap()
            .to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.chat_search_results[0].highlight.content,
        vec!["hello world"]
    );
}

#[test]
fn test_single_chat_without_content() {
    let input = vec![create_test_response(
        "11111111-1111-1111-1111-111111111111",
        "11111111-1111-1111-1111-111111111111",
        None,
    )];

    let mut chat_histories = HashMap::new();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        create_chat_history("11111111-1111-1111-1111-111111111111"),
    );

    let result = construct_search_result(input, chat_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].extra.chat_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(result[0].extra.user_id, "user_1");
    assert_eq!(result[0].extra.owner_id, "user_1");
    assert_eq!(result[0].extra.name, "name");
    assert_eq!(result[0].extra.chat_search_results.len(), 1);
}

#[test]
fn test_single_chat_multiple_messages() {
    let input = vec![
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111",
            Some(vec!["hello".to_string()]),
        ),
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
            Some(vec!["world".to_string()]),
        ),
    ];

    let mut chat_histories = HashMap::new();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        create_chat_history("11111111-1111-1111-1111-111111111111"),
    );

    let result = construct_search_result(input, chat_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].extra.chat_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(result[0].extra.chat_search_results.len(), 2);

    // Check both messages are present
    let message_ids: Vec<&Uuid> = result[0]
        .extra
        .chat_search_results
        .iter()
        .map(|r| r.chat_message_id.as_ref().unwrap())
        .collect();
    assert!(message_ids.contains(&&"11111111-1111-1111-1111-111111111111".parse().unwrap()));
    assert!(message_ids.contains(&&"22222222-2222-2222-2222-222222222222".parse().unwrap()));
}

#[test]
fn test_multiple_chats() {
    let input = vec![
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111",
            Some(vec!["hello".to_string()]),
        ),
        create_test_response(
            "22222222-2222-2222-2222-222222222222",
            "22222222-2222-2222-2222-222222222222",
            Some(vec!["world".to_string()]),
        ),
    ];

    let mut chat_histories = HashMap::new();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        create_chat_history("11111111-1111-1111-1111-111111111111"),
    );
    chat_histories.insert(
        "22222222-2222-2222-2222-222222222222".to_string(),
        create_chat_history("22222222-2222-2222-2222-222222222222"),
    );

    let result = construct_search_result(input, chat_histories).unwrap();

    assert_eq!(result.len(), 2);

    // Check both chats are present
    let chat_ids: Vec<&Uuid> = result.iter().map(|r| &r.extra.id).collect();
    assert!(chat_ids.contains(&&"11111111-1111-1111-1111-111111111111".parse().unwrap()));
    assert!(chat_ids.contains(&&"22222222-2222-2222-2222-222222222222".parse().unwrap()));

    // Each chat should have one message
    for chat in &result {
        assert_eq!(chat.extra.chat_search_results.len(), 1);
    }
}

#[test]
fn test_mixed_content_presence() {
    let input = vec![
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111",
            Some(vec!["visible".to_string()]),
        ),
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
            None,
        ), // No content
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "33333333-3333-3333-3333-333333333333",
            Some(vec!["also visible".to_string()]),
        ),
    ];

    let mut chat_histories = HashMap::new();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        create_chat_history("11111111-1111-1111-1111-111111111111"),
    );

    let result = construct_search_result(input, chat_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].extra.chat_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
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
            "11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111",
            Some(vec!["content1".to_string()]),
        ),
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
            Some(vec!["content2".to_string()]),
        ),
    ];

    let mut chat_histories = HashMap::new();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        create_chat_history("11111111-1111-1111-1111-111111111111"),
    );

    let result = construct_search_result(input, chat_histories).unwrap();

    assert_eq!(result.len(), 1);
    // user_id should come from the first result (base_search_result)
    assert_eq!(result[0].extra.user_id, "user_1");
    assert_eq!(result[0].extra.chat_search_results.len(), 2);
}

#[test]
fn test_chat_history_timestamps() {
    // Create a test response
    let input = vec![create_test_response(
        "11111111-1111-1111-1111-111111111111",
        "11111111-1111-1111-1111-111111111111",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock chat history with known timestamps
    let mut chat_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = ChatHistoryInfo {
        item_id: "11111111-1111-1111-1111-111111111111".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    chat_histories.insert("11111111-1111-1111-1111-111111111111".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, chat_histories).unwrap();

    // Verify that timestamps were copied from the chat history
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].metadata.as_ref().unwrap().created_at,
        now.timestamp()
    );
    assert_eq!(
        result[0].metadata.as_ref().unwrap().updated_at,
        now.timestamp()
    );
    assert_eq!(
        result[0].metadata.as_ref().unwrap().viewed_at,
        Some(now.timestamp())
    );
}

#[test]
fn test_chat_history_missing_entry() {
    // Create a test response for a chat that doesn't have history
    let input = vec![create_test_response(
        "11111111-1111-1111-1111-111111111111",
        "11111111-1111-1111-1111-111111111111",
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
        ..Default::default()
    };

    chat_histories.insert("different_chat".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, chat_histories).unwrap();

    // Chats without history info should not be returned
    assert_eq!(result.len(), 0);
}

#[test]
fn test_chat_history_deleted() {
    let now = chrono::Utc::now();

    // Test 1: Chat that exists but is soft-deleted
    let input_deleted = vec![create_test_response(
        "11111111-1111-1111-1111-111111111111",
        "11111111-1111-1111-1111-111111111111",
        Some(vec!["hello world".to_string()]),
    )];

    let mut chat_histories = HashMap::new();
    chat_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        macro_db_client::chat::get::ChatHistoryInfo {
            item_id: "11111111-1111-1111-1111-111111111111".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: Some(now),
            project_id: Some("project_1".to_string()),
            deleted_at: Some(now), // Soft deleted
            name: "name".to_string(),
            user_id: "user_1".to_string(),
        },
    );

    let result = construct_search_result(input_deleted, chat_histories).unwrap();

    // Deleted chat should be returned with metadata including deleted_at
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.deleted_at, Some(now.timestamp()));
    assert_eq!(metadata.project_id, Some("project_1".to_string()));

    // Test 2: Chat that doesn't exist in DB (OpenSearch has stale data)
    let input_not_found = vec![create_test_response(
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        Some(vec!["stale data".to_string()]),
    )];

    let chat_histories_not_found = HashMap::new(); // No entry = not found

    let result_not_found =
        construct_search_result(input_not_found, chat_histories_not_found).unwrap();

    // Chat not in DB should not be returned
    assert_eq!(result_not_found.len(), 0);
}

#[test]
fn test_chat_history_null_viewed_at() {
    // Create a test response
    let input = vec![create_test_response(
        "11111111-1111-1111-1111-111111111111",
        "11111111-1111-1111-1111-111111111111",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock chat history with null viewed_at
    let mut chat_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = ChatHistoryInfo {
        item_id: "11111111-1111-1111-1111-111111111111".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None, // This user has never viewed this chat
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    chat_histories.insert("11111111-1111-1111-1111-111111111111".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, chat_histories).unwrap();

    // Verify that timestamps were copied correctly and viewed_at is None
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].metadata.as_ref().unwrap().created_at,
        now.timestamp()
    );
    assert_eq!(
        result[0].metadata.as_ref().unwrap().updated_at,
        now.timestamp()
    );
    assert!(result[0].metadata.as_ref().unwrap().viewed_at.is_none());
}

#[test]
fn test_sort_stability() {
    let input = vec![
        create_test_response(
            "33333333-3333-3333-3333-333333333333",
            "33333333-3333-3333-3333-333333333333",
            Some(vec!["third".to_string()]),
        ),
        create_test_response(
            "11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111",
            Some(vec!["first".to_string()]),
        ),
        create_test_response(
            "55555555-5555-5555-5555-555555555555",
            "55555555-5555-5555-5555-555555555555",
            Some(vec!["fifth".to_string()]),
        ),
        create_test_response(
            "22222222-2222-2222-2222-222222222222",
            "22222222-2222-2222-2222-222222222222",
            Some(vec!["second".to_string()]),
        ),
        create_test_response(
            "44444444-4444-4444-4444-444444444444",
            "44444444-4444-4444-4444-444444444444",
            Some(vec!["fourth".to_string()]),
        ),
    ];

    let mut chat_histories = HashMap::new();
    for chat_id in [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
    ] {
        chat_histories.insert(chat_id.to_string(), create_chat_history(chat_id));
    }

    let result1 = construct_search_result(input.clone(), chat_histories.clone()).unwrap();
    let result2 = construct_search_result(input.clone(), chat_histories.clone()).unwrap();
    let result3 = construct_search_result(input.clone(), chat_histories.clone()).unwrap();

    assert_eq!(result1.len(), 5);
    assert_eq!(result2.len(), 5);
    assert_eq!(result3.len(), 5);

    let ids1: Vec<Uuid> = result1.iter().map(|r| r.extra.id.clone()).collect();
    let ids2: Vec<Uuid> = result2.iter().map(|r| r.extra.id.clone()).collect();
    let ids3: Vec<Uuid> = result3.iter().map(|r| r.extra.id.clone()).collect();

    assert_eq!(ids1, ids2, "Results should be stable between runs");
    assert_eq!(ids2, ids3, "Results should be stable between runs");

    assert_eq!(
        ids1,
        vec![
            "33333333-3333-3333-3333-333333333333"
                .parse::<Uuid>()
                .unwrap(),
            "11111111-1111-1111-1111-111111111111".parse().unwrap(),
            "55555555-5555-5555-5555-555555555555".parse().unwrap(),
            "22222222-2222-2222-2222-222222222222".parse().unwrap(),
            "44444444-4444-4444-4444-444444444444".parse().unwrap()
        ],
        "Results should preserve original search result order"
    );
}
