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
        sender: "sender@example.com".to_string(),
        pretty_sender: "Pretty Sender".to_string(),
    }
}

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new(), HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_thread() {
    let thread_uuid: Uuid = "550e8400-e29b-41d4-a716-446655440000".parse().unwrap();
    let search_results = vec![opensearch_client::search::model::SearchHit {
        entity_id: thread_uuid,
        entity_type: SearchEntityType::Emails,
        goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
            opensearch_client::search::model::SearchGotoEmail {
                email_message_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
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
    thread_histories.insert(thread_uuid, create_email_history(&thread_uuid.to_string()));

    let result = construct_search_result(search_results, thread_histories, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.thread_id, thread_uuid);
    assert_eq!(result[0].extra.user_id, "user1");
    assert_eq!(result[0].extra.email_message_search_results.len(), 1);
    assert_eq!(
        result[0].extra.email_message_search_results[0]
            .message_id
            .as_ref()
            .unwrap()
            .to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(result[0].extra.subject, Some("subject".to_string()));
}

#[test]
fn test_sort_stability() {
    let thread_ids: Vec<Uuid> = [
        "550e8400-e29b-41d4-a716-446655440003",
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440005",
        "550e8400-e29b-41d4-a716-446655440002",
        "550e8400-e29b-41d4-a716-446655440004",
    ]
    .into_iter()
    .map(|a| a.parse().unwrap())
    .collect();

    let input = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: thread_ids[0],
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "33333333-3333-3333-3333-333333333333".parse().unwrap(),
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
            entity_id: thread_ids[1],
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
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
            entity_id: thread_ids[2],
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "55555555-5555-5555-5555-555555555555".parse().unwrap(),
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
            entity_id: thread_ids[3],
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "22222222-2222-2222-2222-222222222222".parse().unwrap(),
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
            entity_id: thread_ids[4],
            entity_type: SearchEntityType::Emails,
            goto: Some(opensearch_client::search::model::SearchGotoContent::Emails(
                opensearch_client::search::model::SearchGotoEmail {
                    email_message_id: "44444444-4444-4444-4444-444444444444".parse().unwrap(),
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
            thread_id.clone(),
            create_email_history(&thread_id.to_string()),
        );
    }

    let result1 =
        construct_search_result(input.clone(), thread_histories.clone(), HashMap::new()).unwrap();
    let result2 =
        construct_search_result(input.clone(), thread_histories.clone(), HashMap::new()).unwrap();
    let result3 =
        construct_search_result(input.clone(), thread_histories.clone(), HashMap::new()).unwrap();

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
        thread_ids.to_vec(),
        "Results should preserve original search result order"
    );
}
