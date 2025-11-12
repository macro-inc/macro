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
            highlight: Highlight {
                name: None,
                content: vec!["Test content".to_string()],
            },
            raw_content: Some("Raw test content".to_string()),
        },
    ];

    let result = construct_search_result(search_results, HashMap::new()).unwrap();

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
            highlight: Highlight {
                name: None,
                content: vec!["Second content".to_string()],
            },
            raw_content: Some("Second raw content".to_string()),
        },
    ];

    let result = construct_search_result(search_results, HashMap::new()).unwrap();

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
    };

    document_histories.insert("doc_1".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Verify that timestamps were copied from the document history
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].created_at, now.timestamp());
    assert_eq!(result[0].updated_at, now.timestamp());
    assert_eq!(result[0].viewed_at, Some(now.timestamp()));
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
    };

    document_histories.insert("different_doc".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Verify that default timestamps were used
    assert_eq!(result.len(), 1);

    // Default values from DocumentHistoryInfo::default()
    let default_time = chrono::DateTime::<chrono::Utc>::default().timestamp();
    assert_eq!(result[0].created_at, default_time);
    assert_eq!(result[0].updated_at, default_time);
    assert_eq!(result[0].viewed_at, None);
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
    };

    document_histories.insert("doc_1".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Verify that timestamps were copied correctly and viewed_at is None
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].created_at, now.timestamp());
    assert_eq!(result[0].updated_at, now.timestamp());
    assert_eq!(result[0].viewed_at, None);
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
    };

    let history2 = DocumentHistoryInfo {
        item_id: "doc_2".to_string(),
        created_at: earlier,
        updated_at: earlier,
        viewed_at: None,
        project_id: Some("project_2".to_string()),
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

    assert_eq!(doc1_result.created_at, now.timestamp());
    assert_eq!(doc1_result.updated_at, now.timestamp());
    assert_eq!(doc1_result.viewed_at, Some(now.timestamp()));

    assert_eq!(doc2_result.created_at, earlier.timestamp());
    assert_eq!(doc2_result.updated_at, earlier.timestamp());
    assert_eq!(doc2_result.viewed_at, None);
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
    };

    document_histories.insert("doc_exists".to_string(), history);

    // Call the function under test
    let result = construct_search_result(input, document_histories).unwrap();

    // Verify results
    assert_eq!(result.len(), 2);

    // Find each document in results
    let existing_doc = result
        .iter()
        .find(|r| r.extra.document_id == "doc_exists")
        .unwrap();
    let missing_doc = result
        .iter()
        .find(|r| r.extra.document_id == "doc_missing")
        .unwrap();

    // Existing document should have real timestamps
    assert_eq!(existing_doc.created_at, now.timestamp());
    assert_eq!(existing_doc.updated_at, now.timestamp());
    assert_eq!(existing_doc.viewed_at, Some(now.timestamp()));

    // Missing document should have default timestamps
    let default_time = chrono::DateTime::<chrono::Utc>::default().timestamp();
    assert_eq!(missing_doc.created_at, default_time);
    assert_eq!(missing_doc.updated_at, default_time);
    assert_eq!(missing_doc.viewed_at, None);
}
