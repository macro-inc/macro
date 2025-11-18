use opensearch_client::search::model::Highlight;

use super::*;

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_thread() {
    let search_results = vec![opensearch_client::search::emails::EmailSearchResponse {
        thread_id: "thread1".to_string(),
        message_id: "msg1".to_string(),
        sender: "sender@example.com".to_string(),
        recipients: vec!["recipient@example.com".to_string()],
        cc: vec![],
        bcc: vec![],
        labels: vec!["inbox".to_string()],
        link_id: "link1".to_string(),
        user_id: "user1".to_string(),
        updated_at: 1234567890,
        sent_at: Some(1234567800),
        subject: Some("Test Subject".to_string()),
        highlight: Highlight {
            name: None,
            content: vec!["Test content".to_string()],
        },
    }];

    let result = construct_search_result(search_results, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.thread_id, "thread1");
    assert_eq!(result[0].extra.user_id, "user1");
    assert_eq!(result[0].extra.email_message_search_results.len(), 1);
    assert_eq!(
        result[0].extra.email_message_search_results[0].message_id,
        "msg1"
    );
    assert_eq!(
        result[0].extra.email_message_search_results[0].subject,
        Some("Test Subject".to_string())
    );
}
