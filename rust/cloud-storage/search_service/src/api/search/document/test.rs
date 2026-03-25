use macro_db_client::document::get_document_history::DocumentHistoryInfo;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, shared::PropertyOwner};
use models_soup::SoupProperty;
use opensearch_client::search::model::Highlight;

use super::*;

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new(), HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_document() {
    let search_results = vec![opensearch_client::search::model::SearchHit {
        entity_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
        entity_type: SearchEntityType::Documents,
        goto: Some(
            opensearch_client::search::model::SearchGotoContent::Documents(
                opensearch_client::search::model::SearchGotoDocument {
                    node_id: "node1".to_string(),
                    raw_content: Some("Raw test content".to_string()),
                },
            ),
        ),
        score: None,
        highlight: Highlight {
            name: None,
            content: vec!["Test content".to_string()],
            ..Default::default()
        },
        updated_at: None,
    }];

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    document_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        DocumentHistoryInfo {
            item_id: "11111111-1111-1111-1111-111111111111".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            file_type: Some("pdf".to_string()),
            file_name: "Test Document".to_string(),
            owner: "user1".to_string(),
            deleted_at: None,
            sub_type: None,
        },
    );

    let result =
        construct_search_result(search_results, document_histories, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].extra.document_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(result[0].extra.document_name, "Test Document");
    assert_eq!(result[0].extra.name, "Test Document");
    assert_eq!(result[0].extra.owner_id, "user1");
    assert_eq!(result[0].extra.file_type.as_ref().unwrap(), "pdf");
    assert_eq!(result[0].extra.document_search_results.len(), 1);
    assert_eq!(
        result[0].extra.document_search_results[0]
            .node_id
            .as_ref()
            .unwrap(),
        "node1"
    );
    assert_eq!(
        result[0].extra.document_search_results[0].raw_content,
        Some("Raw test content".to_string())
    );
}

#[test]
fn test_construct_search_result_multiple_nodes_same_document() {
    let search_results = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node1".to_string(),
                        raw_content: Some("First content".to_string()),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["First content".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
        opensearch_client::search::model::SearchHit {
            entity_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node2".to_string(),
                        raw_content: Some("Second content".to_string()),
                    },
                ),
            ),
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Second content".to_string()],
                ..Default::default()
            },
            updated_at: None,
        },
    ];

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    document_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        DocumentHistoryInfo {
            item_id: "11111111-1111-1111-1111-111111111111".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            file_name: "Test Document".to_string(),
            owner: "user_1".to_string(),
            deleted_at: None,
            file_type: Some("pdf".to_string()),
            sub_type: None,
        },
    );

    let result =
        construct_search_result(search_results, document_histories, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].extra.document_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(
        result[0].extra.id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(result[0].extra.name, "Test Document");
    assert_eq!(result[0].extra.document_search_results.len(), 2);

    let node_ids: Vec<String> = result[0]
        .extra
        .document_search_results
        .iter()
        .map(|r| r.node_id.clone().unwrap())
        .collect();
    assert!(node_ids.contains(&"node1".to_string()));
    assert!(node_ids.contains(&"node2".to_string()));
}

// Helper function to create a test document search response
fn create_test_document_response(
    document_id: &str,
    node_id: &str,
    content: Option<Vec<String>>,
) -> opensearch_client::search::model::SearchHit {
    opensearch_client::search::model::SearchHit {
        entity_id: document_id.parse().unwrap(),
        entity_type: SearchEntityType::Documents,
        goto: Some(
            opensearch_client::search::model::SearchGotoContent::Documents(
                opensearch_client::search::model::SearchGotoDocument {
                    node_id: node_id.to_string(),
                    raw_content: Some("Raw test content".to_string()),
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

#[test]
fn test_document_history_timestamps() {
    // Create a test response
    let input = vec![create_test_document_response(
        "11111111-1111-1111-1111-111111111111",
        "node_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock document history with known timestamps
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "11111111-1111-1111-1111-111111111111".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("11111111-1111-1111-1111-111111111111".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories, HashMap::new()).unwrap();

    // Verify that timestamps were copied from the document history
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].metadata.as_ref().unwrap().created_at, now);
    assert_eq!(result[0].metadata.as_ref().unwrap().updated_at, now);
    assert_eq!(result[0].metadata.as_ref().unwrap().viewed_at, Some(now));
}

#[test]
fn test_document_history_missing_entry() {
    // Create a test response for a document that doesn't have history
    let input = vec![create_test_document_response(
        "11111111-1111-1111-1111-111111111111",
        "node_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock document history that doesn't contain the document_id
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "22222222-2222-2222-2222-222222222222".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None,
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("22222222-2222-2222-2222-222222222222".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories, HashMap::new()).unwrap();

    // Documents without history info should not return
    assert_eq!(result.len(), 0);
}

#[test]
fn test_document_history_null_viewed_at() {
    // Create a test response
    let input = vec![create_test_document_response(
        "11111111-1111-1111-1111-111111111111",
        "node_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock document history with null viewed_at
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "11111111-1111-1111-1111-111111111111".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None, // This user has never viewed this document
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("11111111-1111-1111-1111-111111111111".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories, HashMap::new()).unwrap();

    // Verify that timestamps were copied correctly and viewed_at is None
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].metadata.as_ref().unwrap().created_at, now);
    assert_eq!(result[0].metadata.as_ref().unwrap().updated_at, now);
    assert_eq!(result[0].metadata.as_ref().unwrap().viewed_at, None);
}

#[test]
fn test_document_history_multiple_documents() {
    // Create test responses for multiple documents
    let input = vec![
        create_test_document_response(
            "11111111-1111-1111-1111-111111111111",
            "node_1",
            Some(vec!["first document".to_string()]),
        ),
        create_test_document_response(
            "22222222-2222-2222-2222-222222222222",
            "node_2",
            Some(vec!["second document".to_string()]),
        ),
    ];

    // Create mock document histories
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    let earlier = now - chrono::Duration::hours(1);

    let history1 = DocumentHistoryInfo {
        item_id: "11111111-1111-1111-1111-111111111111".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    let history2 = DocumentHistoryInfo {
        item_id: "22222222-2222-2222-2222-222222222222".to_string(),
        created_at: earlier,
        updated_at: earlier,
        viewed_at: None,
        project_id: Some("project_2".to_string()),
        ..Default::default()
    };

    document_histories.insert("11111111-1111-1111-1111-111111111111".to_string(), history1);
    document_histories.insert("22222222-2222-2222-2222-222222222222".to_string(), history2);

    // Call the function under test
    let result = construct_search_result(input, document_histories, HashMap::new()).unwrap();

    // Verify that timestamps were copied correctly for both documents
    assert_eq!(result.len(), 2);

    // Find each document in results (order might not be preserved)
    let doc1_result = result
        .iter()
        .find(|r| r.extra.document_id.to_string() == "11111111-1111-1111-1111-111111111111")
        .unwrap();
    let doc2_result = result
        .iter()
        .find(|r| r.extra.document_id.to_string() == "22222222-2222-2222-2222-222222222222")
        .unwrap();

    let doc1_metadata = doc1_result.metadata.as_ref().unwrap();
    assert_eq!(doc1_metadata.created_at, now);
    assert_eq!(doc1_metadata.updated_at, now);
    assert_eq!(doc1_metadata.viewed_at, Some(now));

    let doc2_metadata = doc2_result.metadata.as_ref().unwrap();
    assert_eq!(doc2_metadata.created_at, earlier);
    assert_eq!(doc2_metadata.updated_at, earlier);
    assert_eq!(doc2_metadata.viewed_at, None);
}

#[test]
fn test_document_history_partial_missing_entries() {
    // Create test responses for multiple documents
    let input = vec![
        create_test_document_response(
            "11111111-1111-1111-1111-111111111111",
            "node_1",
            Some(vec!["existing document".to_string()]),
        ),
        create_test_document_response(
            "22222222-2222-2222-2222-222222222222",
            "node_2",
            Some(vec!["missing document".to_string()]),
        ),
    ];

    // Create document history for only one document
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "11111111-1111-1111-1111-111111111111".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("11111111-1111-1111-1111-111111111111".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories, HashMap::new()).unwrap();

    // We should have 2 results - one with real data, one not found
    assert_eq!(result.len(), 1);

    // The existing document should have real timestamps in metadata
    let existing_doc = result
        .iter()
        .find(|r| r.extra.document_id.to_string() == "11111111-1111-1111-1111-111111111111")
        .unwrap();
    assert!(existing_doc.metadata.is_some());
    let metadata = existing_doc.metadata.as_ref().unwrap();
    assert_eq!(metadata.created_at, now);
    assert_eq!(metadata.updated_at, now);
    assert_eq!(metadata.viewed_at, Some(now));
}

#[test]
fn test_document_history_deleted() {
    let now = chrono::Utc::now();

    // Test 1: Document that exists but is soft-deleted
    let input_deleted = vec![create_test_document_response(
        "11111111-1111-1111-1111-111111111111",
        "node_1",
        Some(vec!["hello world".to_string()]),
    )];

    let mut document_histories = HashMap::new();
    document_histories.insert(
        "11111111-1111-1111-1111-111111111111".to_string(),
        macro_db_client::document::get_document_history::DocumentHistoryInfo {
            item_id: "11111111-1111-1111-1111-111111111111".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: Some(now),
            project_id: Some("project_1".to_string()),
            deleted_at: Some(now), // Soft deleted
            file_type: Some("pdf".to_string()),
            owner: "user_1".to_string(),
            file_name: "name".to_string(),
            sub_type: None,
        },
    );

    let result =
        construct_search_result(input_deleted, document_histories, HashMap::new()).unwrap();

    // Deleted document should be returned with metadata including deleted_at
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.deleted_at, Some(now));
    assert_eq!(metadata.project_id, Some("project_1".to_string()));

    // Test 2: Document that doesn't exist in DB (OpenSearch has stale data)
    let input_not_found = vec![create_test_document_response(
        "22222222-2222-2222-2222-222222222222",
        "node_2",
        Some(vec!["stale data".to_string()]),
    )];

    let document_histories_not_found = HashMap::new(); // No entry = not found

    let result_not_found = construct_search_result(
        input_not_found,
        document_histories_not_found,
        HashMap::new(),
    )
    .unwrap();

    // Document not in DB should not be returned
    assert_eq!(result_not_found.len(), 0);
}

#[test]
fn test_sort_stability() {
    let input = vec![
        opensearch_client::search::model::SearchHit {
            entity_id: "33333333-3333-3333-3333-333333333333".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node_3".to_string(),
                        raw_content: Some("third".to_string()),
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
            entity_id: "11111111-1111-1111-1111-111111111111".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node_1".to_string(),
                        raw_content: Some("first".to_string()),
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
            entity_id: "55555555-5555-5555-5555-555555555555".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node_5".to_string(),
                        raw_content: Some("fifth".to_string()),
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
            entity_id: "22222222-2222-2222-2222-222222222222".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node_2".to_string(),
                        raw_content: Some("second".to_string()),
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
            entity_id: "44444444-4444-4444-4444-444444444444".parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            goto: Some(
                opensearch_client::search::model::SearchGotoContent::Documents(
                    opensearch_client::search::model::SearchGotoDocument {
                        node_id: "node_4".to_string(),
                        raw_content: Some("fourth".to_string()),
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

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    for doc_id in [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
    ] {
        document_histories.insert(
            doc_id.to_string(),
            DocumentHistoryInfo {
                item_id: doc_id.to_string(),
                created_at: now,
                updated_at: now,
                viewed_at: None,
                project_id: None,
                file_type: Some("pdf".to_string()),
                file_name: format!("{}.pdf", doc_id),
                owner: "user1".to_string(),
                deleted_at: None,
                sub_type: None,
            },
        );
    }

    let result1 =
        construct_search_result(input.clone(), document_histories.clone(), HashMap::new()).unwrap();
    let result2 =
        construct_search_result(input.clone(), document_histories.clone(), HashMap::new()).unwrap();
    let result3 =
        construct_search_result(input.clone(), document_histories.clone(), HashMap::new()).unwrap();

    assert_eq!(result1.len(), 5);
    assert_eq!(result2.len(), 5);
    assert_eq!(result3.len(), 5);

    let ids1: Vec<String> = result1.iter().map(|r| r.extra.id.to_string()).collect();
    let ids2: Vec<String> = result2.iter().map(|r| r.extra.id.to_string()).collect();
    let ids3: Vec<String> = result3.iter().map(|r| r.extra.id.to_string()).collect();

    assert_eq!(ids1, ids2, "Results should be stable between runs");
    assert_eq!(ids2, ids3, "Results should be stable between runs");

    assert_eq!(
        ids1,
        vec![
            "33333333-3333-3333-3333-333333333333",
            "11111111-1111-1111-1111-111111111111",
            "55555555-5555-5555-5555-555555555555",
            "22222222-2222-2222-2222-222222222222",
            "44444444-4444-4444-4444-444444444444"
        ],
        "Results should preserve original search result order"
    );
}

fn make_test_soup_property(name: &str) -> SoupProperty {
    SoupProperty {
        definition: PropertyDefinition {
            id: Uuid::new_v4(),
            owner: PropertyOwner::System,
            display_name: name.to_string(),
            data_type: DataType::Entity,
            is_multi_select: true,
            specific_entity_type: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            is_system: true,
            is_metadata: false,
        },
        value: Some(PropertyValue::EntityRef(vec![])),
    }
}

#[test]
fn test_properties_enrichment_with_properties() {
    let doc_id = "11111111-1111-1111-1111-111111111111";
    let input = vec![create_test_document_response(doc_id, "node_1", None)];

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    document_histories.insert(
        doc_id.to_string(),
        DocumentHistoryInfo {
            item_id: doc_id.to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            file_type: Some("md".to_string()),
            file_name: "Test Task".to_string(),
            owner: "user1".to_string(),
            deleted_at: None,
            sub_type: Some(document_sub_type::DocumentSubType::Task),
        },
    );

    let mut properties_map = HashMap::new();
    properties_map.insert(
        doc_id.to_string(),
        vec![make_test_soup_property("Assignees")],
    );

    let result = construct_search_result(input, document_histories, properties_map).unwrap();

    assert_eq!(result.len(), 1);
    let props = result[0]
        .properties
        .as_ref()
        .expect("properties should be Some");
    assert_eq!(props.len(), 1);
    assert_eq!(props[0].definition.display_name, "Assignees");
}

#[test]
fn test_properties_enrichment_empty_map() {
    let doc_id = "11111111-1111-1111-1111-111111111111";
    let input = vec![create_test_document_response(doc_id, "node_1", None)];

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    document_histories.insert(
        doc_id.to_string(),
        DocumentHistoryInfo {
            item_id: doc_id.to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            file_type: Some("md".to_string()),
            file_name: "Test Task".to_string(),
            owner: "user1".to_string(),
            deleted_at: None,
            sub_type: Some(document_sub_type::DocumentSubType::Task),
        },
    );

    let result = construct_search_result(input, document_histories, HashMap::new()).unwrap();

    assert_eq!(result.len(), 1);
    assert!(result[0].properties.is_none());
}
