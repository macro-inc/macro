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
    assert_eq!(result[0].extra.subject, Some("subject".to_string()));
}

#[test]
fn test_sort_stability() {
    let thread_ids = [
        "550e8400-e29b-41d4-a716-446655440003",
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440005",
        "550e8400-e29b-41d4-a716-446655440002",
        "550e8400-e29b-41d4-a716-446655440004",
    ];

    let input = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: thread_ids[0].to_string(),
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "msg3".to_string(),
                    sender: "sender3@example.com".to_string(),
                    recipients: vec!["recipient3@example.com".to_string()],
                    cc: vec![],
                    bcc: vec![],
                    labels: vec!["inbox".to_string()],
                    sent_at: Some(1234567800),
                },
            )),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["third".to_string()],
            },
        },
        opensearch_client::search::model::SearchHit {
            entity_id: thread_ids[1].to_string(),
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "msg1".to_string(),
                    sender: "sender1@example.com".to_string(),
                    recipients: vec!["recipient1@example.com".to_string()],
                    cc: vec![],
                    bcc: vec![],
                    labels: vec!["inbox".to_string()],
                    sent_at: Some(1234567800),
                },
            )),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["first".to_string()],
            },
        },
        opensearch_client::search::model::SearchHit {
            entity_id: thread_ids[2].to_string(),
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "msg5".to_string(),
                    sender: "sender5@example.com".to_string(),
                    recipients: vec!["recipient5@example.com".to_string()],
                    cc: vec![],
                    bcc: vec![],
                    labels: vec!["inbox".to_string()],
                    sent_at: Some(1234567800),
                },
            )),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["fifth".to_string()],
            },
        },
        opensearch_client::search::model::SearchHit {
            entity_id: thread_ids[3].to_string(),
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "msg2".to_string(),
                    sender: "sender2@example.com".to_string(),
                    recipients: vec!["recipient2@example.com".to_string()],
                    cc: vec![],
                    bcc: vec![],
                    labels: vec!["inbox".to_string()],
                    sent_at: Some(1234567800),
                },
            )),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["second".to_string()],
            },
        },
        opensearch_client::search::model::SearchHit {
            entity_id: thread_ids[4].to_string(),
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "msg4".to_string(),
                    sender: "sender4@example.com".to_string(),
                    recipients: vec!["recipient4@example.com".to_string()],
                    cc: vec![],
                    bcc: vec![],
                    labels: vec!["inbox".to_string()],
                    sent_at: Some(1234567800),
                },
            )),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["fourth".to_string()],
            },
        },
    ];

    let mut thread_histories = HashMap::new();
    for thread_id in &thread_ids {
        thread_histories.insert(
            Uuid::parse_str(thread_id).unwrap(),
            create_email_history(thread_id),
        );
    }

    let result1 = construct_search_result(input.clone(), thread_histories.clone()).unwrap();
    let result2 = construct_search_result(input.clone(), thread_histories.clone()).unwrap();
    let result3 = construct_search_result(input.clone(), thread_histories.clone()).unwrap();

    assert_eq!(result1.len(), 5);
    assert_eq!(result2.len(), 5);
    assert_eq!(result3.len(), 5);

    let ids1: Vec<String> = result1.iter().map(|r| r.extra.id.clone()).collect();
    let ids2: Vec<String> = result2.iter().map(|r| r.extra.id.clone()).collect();
    let ids3: Vec<String> = result3.iter().map(|r| r.extra.id.clone()).collect();

    assert_eq!(ids1, ids2, "Results should be stable between runs");
    assert_eq!(ids2, ids3, "Results should be stable between runs");

    assert_eq!(
        ids1,
        thread_ids.to_vec(),
        "Results should preserve original search result order"
    );
}
