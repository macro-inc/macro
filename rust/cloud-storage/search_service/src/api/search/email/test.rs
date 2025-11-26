use models_opensearch::SearchEntityType;
use opensearch_client::search::model::Highlight;

use super::*;

fn create_email_history(thread_id: &str) -> models_email::service::message::ThreadHistoryInfo {
    let now = chrono::Utc::now();
    let thread_uuid = Uuid::parse_str(thread_id).unwrap_or_else(|_| Uuid::new_v4());
    models_email::service::message::ThreadHistoryInfo {
        item_id: thread_uuid,
        created_at: now,
        updated_at: now,
        viewed_at: None,
        snippet: None,
        user_id: "user1".to_string(),
        subject: Some("subject".to_string()),
    }
}

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_thread() {
    let thread_uuid = "550e8400-e29b-41d4-a716-446655440000";
    let search_results = vec![opensearch_client::search::model::SearchHit {
        entity_id: thread_uuid.to_string(),
        entity_type: SearchEntityType::Emails,
        goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
            opensearch_client::search::model::SearchGotoEmail {
                email_message_id: "msg1".to_string(),
                sender: "sender@example.com".to_string(),
                recipients: vec!["recipient@example.com".to_string()],
                cc: vec![],
                bcc: vec![],
                labels: vec!["inbox".to_string()],
                sent_at: Some(1234567800),
            },
        )),
        score: None,
        highlight: Highlight {
            name: None,
            content: vec!["Test content".to_string()],
        },
    }];

    let mut thread_histories = HashMap::new();
    thread_histories.insert(
        Uuid::parse_str(thread_uuid).unwrap(),
        create_email_history(thread_uuid),
    );

    let result = construct_search_result(search_results, thread_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.thread_id, thread_uuid);
    assert_eq!(result[0].extra.user_id, "user1");
    assert_eq!(result[0].extra.email_message_search_results.len(), 1);
    assert_eq!(
        result[0].extra.email_message_search_results[0]
            .message_id
            .as_ref()
            .unwrap(),
        "msg1"
    );
    assert_eq!(
        result[0].extra.subject,
        Some("subject".to_string())
    );
}
