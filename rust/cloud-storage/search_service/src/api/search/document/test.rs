use macro_db_client::document::get_document_history::DocumentHistoryInfo;
use opensearch_client::search::model::Highlight;

use super::*;

#[test]
fn test_construct_search_result_empty_input() {
    let result = construct_search_result(vec![], HashMap::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
}

#[test]
fn test_construct_search_result_single_document() {
    let search_results = vec![
        opensearch_client::search::documents::DocumentSearchResponse {
            document_id: "doc1".to_string(),
            document_name: "Test Document".to_string(),
            node_id: "node1".to_string(),
            owner_id: "user1".to_string(),
            file_type: "pdf".to_string(),
            updated_at: 1234567890,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Test content".to_string()],
            },
            raw_content: Some("Raw test content".to_string()),
        },
    ];

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    document_histories.insert(
        "doc1".to_string(),
        DocumentHistoryInfo {
            item_id: "doc1".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            ..Default::default()
        },
    );

    let result = construct_search_result(search_results, document_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.document_id, "doc1");
    assert_eq!(result[0].extra.id, "doc1");
    assert_eq!(result[0].extra.document_name, "Test Document");
    assert_eq!(result[0].extra.name, "Test Document");
    assert_eq!(result[0].extra.owner_id, "user1");
    assert_eq!(result[0].extra.file_type, "pdf");
    assert_eq!(result[0].extra.document_search_results.len(), 1);
    assert_eq!(result[0].extra.document_search_results[0].node_id, "node1");
    assert_eq!(
        result[0].extra.document_search_results[0].raw_content,
        Some("Raw test content".to_string())
    );
}

#[test]
fn test_construct_search_result_multiple_nodes_same_document() {
    let search_results = vec![
        opensearch_client::search::documents::DocumentSearchResponse {
            document_id: "doc1".to_string(),
            document_name: "Test Document".to_string(),
            node_id: "node1".to_string(),
            owner_id: "user1".to_string(),
            file_type: "pdf".to_string(),
            updated_at: 1234567890,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["First content".to_string()],
            },
            raw_content: Some("First raw content".to_string()),
        },
        opensearch_client::search::documents::DocumentSearchResponse {
            document_id: "doc1".to_string(),
            document_name: "Test Document".to_string(),
            node_id: "node2".to_string(),
            owner_id: "user1".to_string(),
            file_type: "pdf".to_string(),
            updated_at: 1234567891,
            score: None,
            highlight: Highlight {
                name: None,
                content: vec!["Second content".to_string()],
            },
            raw_content: Some("Second raw content".to_string()),
        },
    ];

    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    document_histories.insert(
        "doc1".to_string(),
        DocumentHistoryInfo {
            item_id: "doc1".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: None,
            ..Default::default()
        },
    );

    let result = construct_search_result(search_results, document_histories).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].extra.document_id, "doc1");
    assert_eq!(result[0].extra.id, "doc1");
    assert_eq!(result[0].extra.name, "Test Document");
    assert_eq!(result[0].extra.document_search_results.len(), 2);

    let node_ids: Vec<String> = result[0]
        .extra
        .document_search_results
        .iter()
        .map(|r| r.node_id.clone())
        .collect();
    assert!(node_ids.contains(&"node1".to_string()));
    assert!(node_ids.contains(&"node2".to_string()));
}

// Helper function to create a test document search response
fn create_test_document_response(
    document_id: &str,
    node_id: &str,
    owner_id: &str,
    content: Option<Vec<String>>,
) -> opensearch_client::search::documents::DocumentSearchResponse {
    opensearch_client::search::documents::DocumentSearchResponse {
        document_id: document_id.to_string(),
        document_name: "Test Document".to_string(),
        node_id: node_id.to_string(),
        owner_id: owner_id.to_string(),
        file_type: "pdf".to_string(),
        updated_at: 1234567890,
        score: None,
        highlight: Highlight {
            name: None,
            content: content.unwrap_or_default(),
        },
        raw_content: Some("Raw test content".to_string()),
    }
}

#[test]
fn test_document_history_timestamps() {
    // Create a test response
    let input = vec![create_test_document_response(
        "doc_1",
        "node_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock document history with known timestamps
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "doc_1".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("doc_1".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Verify that timestamps were copied from the document history
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
fn test_document_history_missing_entry() {
    // Create a test response for a document that doesn't have history
    let input = vec![create_test_document_response(
        "doc_missing",
        "node_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock document history that doesn't contain the document_id
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "different_doc".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None,
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("different_doc".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Documents without history info should have metadata=None
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_none());
}

#[test]
fn test_document_history_null_viewed_at() {
    // Create a test response
    let input = vec![create_test_document_response(
        "doc_1",
        "node_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    // Create a mock document history with null viewed_at
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "doc_1".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: None, // This user has never viewed this document
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("doc_1".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

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
    assert_eq!(result[0].metadata.as_ref().unwrap().viewed_at, None);
}

#[test]
fn test_document_history_multiple_documents() {
    // Create test responses for multiple documents
    let input = vec![
        create_test_document_response(
            "doc_1",
            "node_1",
            "user_1",
            Some(vec!["first document".to_string()]),
        ),
        create_test_document_response(
            "doc_2",
            "node_2",
            "user_2",
            Some(vec!["second document".to_string()]),
        ),
    ];

    // Create mock document histories
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();
    let earlier = now - chrono::Duration::hours(1);

    let history1 = DocumentHistoryInfo {
        item_id: "doc_1".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    let history2 = DocumentHistoryInfo {
        item_id: "doc_2".to_string(),
        created_at: earlier,
        updated_at: earlier,
        viewed_at: None,
        project_id: Some("project_2".to_string()),
        ..Default::default()
    };

    document_histories.insert("doc_1".to_string(), history1);
    document_histories.insert("doc_2".to_string(), history2);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Verify that timestamps were copied correctly for both documents
    assert_eq!(result.len(), 2);

    // Find each document in results (order might not be preserved)
    let doc1_result = result
        .iter()
        .find(|r| r.extra.document_id == "doc_1")
        .unwrap();
    let doc2_result = result
        .iter()
        .find(|r| r.extra.document_id == "doc_2")
        .unwrap();

    let doc1_metadata = doc1_result.metadata.as_ref().unwrap();
    assert_eq!(doc1_metadata.created_at, now.timestamp());
    assert_eq!(doc1_metadata.updated_at, now.timestamp());
    assert_eq!(doc1_metadata.viewed_at, Some(now.timestamp()));

    let doc2_metadata = doc2_result.metadata.as_ref().unwrap();
    assert_eq!(doc2_metadata.created_at, earlier.timestamp());
    assert_eq!(doc2_metadata.updated_at, earlier.timestamp());
    assert_eq!(doc2_metadata.viewed_at, None);
}

#[test]
fn test_document_history_partial_missing_entries() {
    // Create test responses for multiple documents
    let input = vec![
        create_test_document_response(
            "doc_exists",
            "node_1",
            "user_1",
            Some(vec!["existing document".to_string()]),
        ),
        create_test_document_response(
            "doc_missing",
            "node_2",
            "user_2",
            Some(vec!["missing document".to_string()]),
        ),
    ];

    // Create document history for only one document
    let mut document_histories = HashMap::new();
    let now = chrono::Utc::now();

    let history = DocumentHistoryInfo {
        item_id: "doc_exists".to_string(),
        created_at: now,
        updated_at: now,
        viewed_at: Some(now),
        project_id: Some("project_1".to_string()),
        ..Default::default()
    };

    document_histories.insert("doc_exists".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // We should have 2 results - one with real data, one with defaults
    assert_eq!(result.len(), 2);

    // The existing document should have real timestamps in metadata
    let existing_doc = result
        .iter()
        .find(|r| r.extra.document_id == "doc_exists")
        .unwrap();
    assert!(existing_doc.metadata.is_some());
    let metadata = existing_doc.metadata.as_ref().unwrap();
    assert_eq!(metadata.created_at, now.timestamp());
    assert_eq!(metadata.updated_at, now.timestamp());
    assert_eq!(metadata.viewed_at, Some(now.timestamp()));

    // The missing document should have no metadata
    let missing_doc = result
        .iter()
        .find(|r| r.extra.document_id == "doc_missing")
        .unwrap();
    assert!(missing_doc.metadata.is_none());
}

#[test]
fn test_document_history_deleted() {
    let now = chrono::Utc::now();

    // Test 1: Document that exists but is soft-deleted
    let input_deleted = vec![create_test_document_response(
        "doc_deleted",
        "node_1",
        "user_1",
        Some(vec!["hello world".to_string()]),
    )];

    let mut document_histories = HashMap::new();
    document_histories.insert(
        "doc_deleted".to_string(),
        macro_db_client::document::get_document_history::DocumentHistoryInfo {
            item_id: "doc_deleted".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: Some(now),
            project_id: Some("project_1".to_string()),
            deleted_at: Some(now), // Soft deleted
        },
    );

    let result = construct_search_result(input_deleted, document_histories).unwrap();

    // Deleted document should be returned with metadata including deleted_at
    assert_eq!(result.len(), 1);
    assert!(result[0].metadata.is_some());
    let metadata = result[0].metadata.as_ref().unwrap();
    assert_eq!(metadata.deleted_at, Some(now.timestamp()));
    assert_eq!(metadata.project_id, Some("project_1".to_string()));

    // Test 2: Document that doesn't exist in DB (OpenSearch has stale data)
    let input_not_found = vec![create_test_document_response(
        "doc_not_found",
        "node_2",
        "user_1",
        Some(vec!["stale data".to_string()]),
    )];

    let document_histories_not_found = HashMap::new(); // No entry = not found

    let result_not_found =
        construct_search_result(input_not_found, document_histories_not_found).unwrap();

    // Document not in DB should be returned with metadata=None
    assert_eq!(result_not_found.len(), 1);
    assert!(result_not_found[0].metadata.is_none());
}
