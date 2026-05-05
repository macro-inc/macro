use chrono::{DateTime, Utc};
use models_opensearch::SearchEntityType;
use opensearch_client::search::model::Highlight;

use super::*;

/// Build a message_states map that marks every content-match hit's
/// channel_message_id as existing-and-active. Tests that want to exercise
/// orphan filtering or soft-delete state should construct the map manually.
fn active_states_for(
    hits: &[opensearch_client::search::model::SearchHit],
) -> HashMap<Uuid, Option<DateTime<Utc>>> {
    hits.iter()
        .filter_map(|hit| match &hit.goto {
            Some(opensearch_client::search::model::SearchGotoContent::Channels(goto)) => {
                Some((goto.channel_message_id, None))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new(), HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_channel() {
    let channel_uuid: Uuid = "550e8400-e29b-41d4-a716-446655440000".parse().unwrap();
    let search_results = vec![opensearch_client::search::model::SearchHit {
        entity_id: channel_uuid,
        entity_type: SearchEntityType::Channels,
        goto: Some(
            opensearch_client::search::model::SearchGotoContent::Channels(
                opensearch_client::search::model::SearchGotoChannel {
                    channel_message_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
                    created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                    updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                    thread_id: Some("22222222-2222-2222-2222-222222222222".parse().unwrap()),
                    sender_id: "user1".to_string(),
                },
            ),
        ),
        score: None,
        highlight: Highlight {
            name: None,
            content: vec!["Test message content".to_string()],
            ..Default::default()
        },
        updated_at: None,
    }];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        channel_uuid,
        create_channel_history(channel_uuid.to_string().as_str()),
    );

    let states = active_states_for(&search_results);
    let result = construct_search_result(search_results, channel_histories, states).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.channel_id, channel_uuid);
    assert_eq!(result[0].extra.id, channel_uuid);
    assert_eq!(
        result[0].extra.channel_message_search_results[0]
            .message_id
            .as_ref()
            .unwrap()
            .to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.channel_message_search_results[0]
            .sender_id
            .as_ref()
            .unwrap(),
        "user1"
    );
    assert_eq!(
        result[0].extra.channel_message_search_results[0].thread_id,
        Some("22222222-2222-2222-2222-222222222222".parse().unwrap())
    );
}

#[test]
fn test_construct_search_result_multiple_messages_same_channel() {
    let channel_uuid: Uuid = "550e8400-e29b-41d4-a716-446655440001".parse().unwrap();
    let search_results = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: channel_uuid,
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("22222222-2222-2222-2222-222222222222".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["First message".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: channel_uuid,
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "22222222-2222-2222-2222-222222222222".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567892, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567893, 0).unwrap(),
                        thread_id: Some("33333333-3333-3333-3333-333333333333".parse().unwrap()),
                        sender_id: "user2".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Second message".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
    ];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        channel_uuid,
        create_channel_history(channel_uuid.to_string().as_str()),
    );

    let states = active_states_for(&search_results);
    let result = construct_search_result(search_results, channel_histories, states).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.channel_id, channel_uuid);
    assert_eq!(result[0].extra.id, channel_uuid);
    assert_eq!(result[0].extra.channel_message_search_results.len(), 2);

    let message_ids: Vec<String> = result[0]
        .extra
        .channel_message_search_results
        .iter()
        .map(|r| r.message_id.unwrap().to_string())
        .collect();
    assert!(message_ids.contains(&"11111111-1111-1111-1111-111111111111".to_string()));
    assert!(message_ids.contains(&"22222222-2222-2222-2222-222222222222".to_string()));

    let sender_ids: Vec<String> = result[0]
        .extra
        .channel_message_search_results
        .iter()
        .map(|r| r.sender_id.clone().unwrap())
        .collect();
    assert!(sender_ids.contains(&"user1".to_string()));
    assert!(sender_ids.contains(&"user2".to_string()));
}

#[test]
fn test_construct_search_result_filters_messages_without_content() {
    let channel_uuid: Uuid = "550e8400-e29b-41d4-a716-446655440002".parse().unwrap();
    let search_results = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: channel_uuid,
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("22222222-2222-2222-2222-222222222222".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Message with content".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: channel_uuid,
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "22222222-2222-2222-2222-222222222222".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567892, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567893, 0).unwrap(),
                        thread_id: Some("33333333-3333-3333-3333-333333333333".parse().unwrap()),
                        sender_id: "user2".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec![],
                ..Default::default()
            },
            updated_at: None,
        },
    ];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        channel_uuid,
        create_channel_history(channel_uuid.to_string().as_str()),
    );

    let states = active_states_for(&search_results);
    let result = construct_search_result(search_results, channel_histories, states).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.channel_message_search_results.len(), 2);
    assert_eq!(
        result[0].extra.channel_message_search_results[0]
            .message_id
            .as_ref()
            .unwrap()
            .to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
}

#[test]
fn test_construct_search_result_filters_orphans_and_propagates_deleted_at() {
    let channel_uuid: Uuid = "550e8400-e29b-41d4-a716-446655440099".parse().unwrap();
    let active_message_id: Uuid = "11111111-1111-1111-1111-111111111111".parse().unwrap();
    let deleted_message_id: Uuid = "22222222-2222-2222-2222-222222222222".parse().unwrap();
    let orphan_message_id: Uuid = "33333333-3333-3333-3333-333333333333".parse().unwrap();

    let search_results = vec![
        create_test_channel_response(
            &channel_uuid.to_string(),
            &active_message_id.to_string(),
            "user1",
            Some(vec!["active".to_string()]),
        ),
        create_test_channel_response(
            &channel_uuid.to_string(),
            &deleted_message_id.to_string(),
            "user2",
            Some(vec!["deleted".to_string()]),
        ),
        create_test_channel_response(
            &channel_uuid.to_string(),
            &orphan_message_id.to_string(),
            "user3",
            Some(vec!["orphan".to_string()]),
        ),
    ];

    let mut channel_histories = HashMap::new();
    channel_histories.insert(
        channel_uuid,
        create_channel_history(channel_uuid.to_string().as_str()),
    );

    let deleted_at = DateTime::from_timestamp(1700000000, 0).unwrap();
    let mut states: HashMap<Uuid, Option<DateTime<Utc>>> = HashMap::new();
    states.insert(active_message_id, None);
    states.insert(deleted_message_id, Some(deleted_at));
    // orphan_message_id intentionally omitted to simulate a hard-deleted row.

    let result = construct_search_result(search_results, channel_histories, states).unwrap();

    assert_eq!(result.len(), 1);
    let hits = &result[0].extra.channel_message_search_results;
    assert_eq!(hits.len(), 2, "orphan hit should be filtered out");

    let by_id: HashMap<Uuid, &ChannelSearchResult> =
        hits.iter().map(|h| (h.message_id.unwrap(), h)).collect();

    assert_eq!(by_id[&active_message_id].deleted_at, None);
    assert_eq!(by_id[&deleted_message_id].deleted_at, Some(deleted_at));
    assert!(!by_id.contains_key(&orphan_message_id));
}

fn create_test_channel_response(
    channel_id: &str,
    message_id: &str,
    sender_id: &str,
    content: Option<Vec<String>>,
) -> opensearch_client::search::model::SearchHit {
    opensearch_client::search::model::SearchHit {
        entity_id: channel_id.parse().unwrap(),
        entity_type: SearchEntityType::Channels,
        goto: Some(
            opensearch_client::search::model::SearchGotoContent::Channels(
                opensearch_client::search::model::SearchGotoChannel {
                    channel_message_id: message_id.parse().unwrap(),
                    created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                    updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                    thread_id: Some("22222222-2222-2222-2222-222222222222".parse().unwrap()),
                    sender_id: sender_id.to_string(),
                },
            ),
        ),
        score: None,
        highlight: Highlight {
            name: None,
            content: content.unwrap_or_default(),
            ..Default::default()
        },
        updated_at: None,
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
        user_id: "user1".to_string(),
        channel_type: "public".to_string(),
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
        user_id: "user1".to_string(),
        channel_type: "public".to_string(),
    };

    channel_histories.insert(channel_uuid, history);

    // Create a test response with the UUID
    let input = vec![create_test_channel_response(
        &channel_uuid.to_string(),
        "11111111-1111-1111-1111-111111111111",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Call the function under test
    let states = active_states_for(&input);
    let result = construct_search_result(input, channel_histories, states).unwrap();

    // Verify that timestamps were copied from the channel history
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.created_at, now);
    assert_eq!(metadata.updated_at, now);
    assert_eq!(metadata.viewed_at, Some(now));
    assert_eq!(metadata.interacted_at, Some(now));
}

#[test]
fn test_channel_history_missing_entry() {
    // Create a test response for a channel that doesn't have history
    let missing_channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440002").unwrap();
    let input = vec![create_test_channel_response(
        &missing_channel_uuid.to_string(),
        "11111111-1111-1111-1111-111111111111",
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
        user_id: "user1".to_string(),
        channel_type: "public".to_string(),
    };

    channel_histories.insert(different_channel_uuid, history);

    // Call the function under test
    let states = active_states_for(&input);
    let result = construct_search_result(input, channel_histories, states).unwrap();

    // Channels without history info should not be returned
    assert_eq!(result.len(), 0);
}

#[test]
fn test_channel_history_null_viewed_at() {
    // Create a test response
    let channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440004").unwrap();
    let input = vec![create_test_channel_response(
        &channel_uuid.to_string(),
        "11111111-1111-1111-1111-111111111111",
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
        user_id: "user1".to_string(),
        channel_type: "public".to_string(),
    };

    channel_histories.insert(channel_uuid, history);

    // Call the function under test
    let states = active_states_for(&input);
    let result = construct_search_result(input, channel_histories, states).unwrap();

    // Verify that timestamps were copied correctly and viewed_at is None
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.created_at, now);
    assert_eq!(metadata.updated_at, now);
    assert!(metadata.viewed_at.is_none());
    assert!(metadata.interacted_at.is_none());
}

#[test]
fn test_sort_stability() {
    let channel_ids: Vec<Uuid> = [
        "550e8400-e29b-41d4-a716-446655440003",
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440005",
        "550e8400-e29b-41d4-a716-446655440002",
        "550e8400-e29b-41d4-a716-446655440004",
    ]
    .iter()
    .map(|s| s.parse().unwrap())
    .collect::<Vec<_>>();

    let input = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: channel_ids[0],
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "33333333-3333-3333-3333-333333333333".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("33333333-3333-3333-3333-333333333333".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["third".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: channel_ids[1],
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("11111111-1111-1111-1111-111111111111".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["first".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: channel_ids[2],
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "55555555-5555-5555-5555-555555555555".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("55555555-5555-5555-5555-555555555555".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["fifth".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: channel_ids[3],
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "22222222-2222-2222-2222-222222222222".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("22222222-2222-2222-2222-222222222222".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["second".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: channel_ids[4],
            entity_type: SearchEntityType::Channels,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Channels(
                    opensearch_client::search::model::SearchGotoChannel {
                        channel_message_id: "44444444-4444-4444-4444-444444444444".parse().unwrap(),
                        created_at: DateTime::from_timestamp(1234567890, 0).unwrap(),
                        updated_at: DateTime::from_timestamp(1234567891, 0).unwrap(),
                        thread_id: Some("44444444-4444-4444-4444-444444444444".parse().unwrap()),
                        sender_id: "user1".to_string(),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["fourth".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
    ];

    let mut channel_histories = HashMap::new();
    for channel_id in &channel_ids {
        channel_histories.insert(
            channel_id.clone(),
            create_channel_history(channel_id.to_string().as_str()),
        );
    }

    let states = active_states_for(&input);
    let result1 =
        construct_search_result(input.clone(), channel_histories.clone(), states.clone()).unwrap();
    let result2 =
        construct_search_result(input.clone(), channel_histories.clone(), states.clone()).unwrap();
    let result3 =
        construct_search_result(input.clone(), channel_histories.clone(), states).unwrap();

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
        channel_ids.to_vec(),
        "Results should preserve original search result order"
    );
}
