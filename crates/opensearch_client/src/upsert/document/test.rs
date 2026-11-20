use super::*;
use crate::date_format::EpochMillis;
use crate::error::WriteRefusal;
use crate::test_support::serve_once;

fn args(doc_id: &str, node_id: &str) -> UpsertDocumentArgs {
    UpsertDocumentArgs {
        document_id: doc_id.to_string(),
        node_id: node_id.to_string(),
        document_name: format!("name-{doc_id}"),
        file_type: "md".to_string(),
        owner_id: format!("owner-{doc_id}"),
        raw_content: None,
        content: format!("content {doc_id} {node_id}"),
        updated_at_millis: EpochMillis::new(1_700_000_000_123).unwrap(),
        sub_type: None,
        properties: vec![],
        is_email_attachment: false,
    }
}

#[test]
fn parent_doc_body_has_metadata_no_chunk_fields() {
    let doc = parent_doc_body(&args("doc1", "n1"));

    assert_eq!(doc["entity_id"], "doc1");
    assert_eq!(doc["document_name"], "name-doc1");
    assert_eq!(doc["owner_id"], "owner-doc1");
    assert_eq!(doc["file_type"], "md");
    assert_eq!(doc["updated_at_millis"], 1_700_000_000_123i64);
    assert_eq!(doc["document_relation"], "document");
    // Child-only fields must not be present on the parent.
    assert!(doc.get("content").is_none());
    assert!(doc.get("node_id").is_none());
    assert!(doc.get("raw_content").is_none());
}

#[test]
fn parent_doc_body_writes_the_email_attachment_flag_either_way() {
    // A full `index` overwrite drops any field it omits, so `false` is
    // written explicitly: an unlinked document must not keep a stale `true`.
    let doc = parent_doc_body(&args("doc1", "n1"));
    assert_eq!(doc["is_email_attachment"], false);

    let mut a = args("doc1", "n1");
    a.is_email_attachment = true;
    let doc = parent_doc_body(&a);
    assert_eq!(doc["is_email_attachment"], true);
}

#[test]
fn child_doc_body_omits_the_email_attachment_flag() {
    let mut a = args("doc1", "n1");
    a.is_email_attachment = true;
    let doc = child_doc_body(&a);
    assert!(doc.get("is_email_attachment").is_none());
}

#[test]
fn parent_doc_body_includes_optional_sub_type() {
    let mut a = args("doc1", "n1");
    a.sub_type = Some("task".to_string());
    let doc = parent_doc_body(&a);
    assert_eq!(doc["sub_type"], "task");
}

#[test]
fn parent_doc_body_includes_properties_when_present() {
    let mut a = args("doc1", "n1");
    a.properties = vec![
        IndexedProperty {
            definition_id: "status-def".to_string(),
            values: vec!["not-started".to_string()],
            ..Default::default()
        },
        IndexedProperty {
            definition_id: "assignees-def".to_string(),
            values: vec!["macro|gab@macro.com".to_string()],
            ..Default::default()
        },
        IndexedProperty {
            definition_id: "due-date-def".to_string(),
            date_value: Some(1_700_000_000_000),
            ..Default::default()
        },
    ];
    let doc = parent_doc_body(&a);
    let props = doc["properties"].as_array().expect("properties array");
    assert_eq!(props.len(), 3);
    assert_eq!(props[0]["definition_id"], "status-def");
    assert_eq!(props[0]["values"][0], "not-started");
    // Empty value fields are skipped, not serialized as empty/null.
    assert!(props[0].get("number_value").is_none());
    assert_eq!(props[1]["values"][0], "macro|gab@macro.com");
    assert_eq!(props[2]["date_value"], 1_700_000_000_000i64);
    assert!(props[2].get("values").is_none());
}

#[test]
fn parent_doc_body_omits_properties_when_empty() {
    let doc = parent_doc_body(&args("doc1", "n1"));
    assert!(doc.get("properties").is_none());
}

#[test]
fn child_doc_body_has_chunk_fields_and_join_pointer() {
    let mut a = args("doc1", "n1");
    a.raw_content = Some("raw".to_string());
    let doc = child_doc_body(&a);

    assert_eq!(doc["entity_id"], "doc1");
    assert_eq!(doc["node_id"], "n1");
    assert_eq!(doc["content"], "content doc1 n1");
    assert_eq!(doc["raw_content"], "raw");
    assert_eq!(doc["document_relation"]["name"], "chunk");
    assert_eq!(doc["document_relation"]["parent"], "doc1");
    // Parent-only metadata must not be redundantly written to children.
    assert!(doc.get("document_name").is_none());
    assert!(doc.get("owner_id").is_none());
    assert!(doc.get("file_type").is_none());
    assert!(doc.get("sub_type").is_none());
}

#[test]
fn child_doc_body_omits_raw_content_when_none() {
    let doc = child_doc_body(&args("doc1", "n1"));
    assert!(doc.get("raw_content").is_none());
}

#[test]
fn parent_only_bulk_body_writes_parent_and_no_children() {
    let mut a = args("doc1", "n1");
    a.sub_type = Some("task".to_string());
    a.properties = vec![IndexedProperty {
        definition_id: "tag-def".to_string(),
        values: vec!["opt-1".to_string()],
        ..Default::default()
    }];
    a.is_email_attachment = true;
    let body = parent_only_bulk_body(&a);

    assert_eq!(body.len(), 2);

    let action: serde_json::Value = serde_json::from_str(&body[0]).unwrap();
    assert_eq!(action["index"]["_id"], "doc1");
    assert_eq!(action["index"]["routing"], "doc1");

    let doc: serde_json::Value = serde_json::from_str(&body[1]).unwrap();
    assert_eq!(doc["entity_id"], "doc1");
    assert_eq!(doc["document_name"], "name-doc1");
    assert_eq!(doc["owner_id"], "owner-doc1");
    assert_eq!(doc["file_type"], "md");
    assert_eq!(doc["document_relation"], "document");
    assert_eq!(doc["sub_type"], "task");
    assert_eq!(doc["properties"][0]["definition_id"], "tag-def");
    assert_eq!(doc["properties"][0]["values"][0], "opt-1");
    assert_eq!(doc["is_email_attachment"], true);
    // No chunk is written and no chunk fields leak onto the parent.
    assert!(doc.get("content").is_none());
    assert!(doc.get("node_id").is_none());
    assert!(doc.get("raw_content").is_none());
}

#[test]
fn resolve_destination_defaults_to_documents_alias() {
    assert_eq!(resolve_destination(None), SearchIndex::Documents.as_ref());
    assert_eq!(resolve_destination(Some("documents_v2")), "documents_v2");
}

/// Builds the same bulk body the join-shape upsert would send, so we can
/// assert the exact OpenSearch wire format without standing up a cluster.
fn build_join_bulk_body(documents: &[UpsertDocumentArgs]) -> Vec<serde_json::Value> {
    let mut bulk: Vec<serde_json::Value> = Vec::new();
    let mut seen_parents: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for doc in documents {
        let parent_id = doc.document_id.as_str();
        if seen_parents.insert(parent_id) {
            bulk.push(serde_json::json!({
                "index": { "_id": parent_id, "routing": parent_id }
            }));
            bulk.push(parent_doc_body(doc));
        }
        let child_id = format!("{}:{}", doc.document_id, doc.node_id);
        bulk.push(serde_json::json!({
            "index": { "_id": child_id, "routing": parent_id }
        }));
        bulk.push(child_doc_body(doc));
    }
    bulk
}

#[test]
fn join_bulk_body_dedupes_parent_within_batch() {
    let body = build_join_bulk_body(&[args("doc1", "n1"), args("doc1", "n2"), args("doc2", "n1")]);

    // 2 parents × 2 ops + 3 children × 2 ops = 10 entries
    assert_eq!(body.len(), 10);

    // First op is doc1's parent index.
    assert_eq!(body[0]["index"]["_id"], "doc1");
    assert_eq!(body[0]["index"]["routing"], "doc1");
    assert_eq!(body[1]["entity_id"], "doc1");
    assert_eq!(body[1]["document_relation"], "document");

    // Then doc1's first child.
    assert_eq!(body[2]["index"]["_id"], "doc1:n1");
    assert_eq!(body[2]["index"]["routing"], "doc1");
    assert_eq!(body[3]["document_relation"]["parent"], "doc1");

    // Doc1's second child — note no second parent index for doc1.
    assert_eq!(body[4]["index"]["_id"], "doc1:n2");
    assert_eq!(body[4]["index"]["routing"], "doc1");

    // Now doc2 — new parent so we get an index op again.
    assert_eq!(body[6]["index"]["_id"], "doc2");
    assert_eq!(body[6]["index"]["routing"], "doc2");
    assert_eq!(body[8]["index"]["_id"], "doc2:n1");
    assert_eq!(body[8]["index"]["routing"], "doc2");
}

#[test]
fn parent_body_omits_sub_type_when_none_so_index_clears_it() {
    // The whole point of switching from update+doc_as_upsert to full index
    // writes: when sub_type becomes None, the new parent body must NOT
    // include sub_type, so an `index` op will drop any previously-stored
    // value rather than leaving it stale.
    let doc = parent_doc_body(&args("doc1", "n1"));
    assert!(doc.get("sub_type").is_none());
}

#[test]
fn child_body_keeps_content_under_cap_intact() {
    let mut a = args("doc1", "n1");
    a.content = "x".repeat(MAX_CHUNK_CONTENT_CHARS);
    let doc = child_doc_body(&a);
    assert_eq!(
        doc["content"].as_str().unwrap().chars().count(),
        MAX_CHUNK_CONTENT_CHARS
    );
}

#[test]
fn child_body_truncates_oversized_content() {
    let mut a = args("doc1", "n1");
    a.content = "x".repeat(MAX_CHUNK_CONTENT_CHARS + 10);
    let doc = child_doc_body(&a);
    assert_eq!(
        doc["content"].as_str().unwrap().chars().count(),
        MAX_CHUNK_CONTENT_CHARS
    );
}

#[test]
fn child_body_truncates_on_char_boundary() {
    let mut a = args("doc1", "n1");
    // é is 2 bytes per char, so a byte-index split would panic mid-char.
    a.content = "é".repeat(MAX_CHUNK_CONTENT_CHARS + 5);
    let doc = child_doc_body(&a);
    assert_eq!(
        doc["content"].as_str().unwrap().chars().count(),
        MAX_CHUNK_CONTENT_CHARS
    );
}

#[test]
fn email_attachment_update_sends_one_routed_partial_update_per_document() {
    let body = email_attachment_update_bulk_body(&["doc1".to_string(), "doc2".to_string()], true);
    let lines: Vec<serde_json::Value> = body
        .iter()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();

    assert_eq!(
        lines,
        vec![
            serde_json::json!({"update": {"_id": "doc1", "routing": "doc1", "retry_on_conflict": 3}}),
            serde_json::json!({"doc": {"is_email_attachment": true}, "detect_noop": false}),
            serde_json::json!({"update": {"_id": "doc2", "routing": "doc2", "retry_on_conflict": 3}}),
            serde_json::json!({"doc": {"is_email_attachment": true}, "detect_noop": false}),
        ]
    );
}

#[test]
fn email_attachment_update_can_clear_the_flag() {
    let body = email_attachment_update_bulk_body(&["doc1".to_string()], false);
    let update: serde_json::Value = serde_json::from_str(&body[1]).unwrap();

    assert_eq!(
        update,
        serde_json::json!({"doc": {"is_email_attachment": false}, "detect_noop": false})
    );
}

#[test]
fn email_attachment_update_counts_updated_missing_and_failed_items() {
    let body = serde_json::json!({
        "errors": true,
        "items": [
            {"update": {"_id": "doc1", "status": 200, "result": "updated"}},
            {"update": {"_id": "doc2", "status": 404, "error": {
                "type": "document_missing_exception",
                "reason": "[doc2]: document missing",
            }}},
            {"update": {"_id": "doc3", "status": 409, "error": {
                "type": "version_conflict_engine_exception",
                "reason": "[doc3]: version conflict",
            }}},
            {"update": {"_id": "doc4", "status": 404, "error": {
                "type": "index_not_found_exception",
                "reason": "no such index [documents]",
            }}},
        ],
    });

    let result = classify_email_attachment_update_response(200, &body.to_string()).unwrap();

    assert_eq!(
        result,
        EmailAttachmentUpdateResult {
            updated: 1,
            missing: 1,
            failed: vec![
                FailedDocumentUpdate {
                    document_id: "doc3".to_string(),
                    status: 409,
                    error_type: "version_conflict_engine_exception".to_string(),
                },
                FailedDocumentUpdate {
                    document_id: "doc4".to_string(),
                    status: 404,
                    error_type: "index_not_found_exception".to_string(),
                },
            ],
        }
    );
}

#[test]
fn an_item_rejected_with_429_refuses_the_whole_batch() {
    let body = serde_json::json!({
        "errors": true,
        "items": [
            {"update": {"_id": "doc1", "status": 200, "result": "updated"}},
            {"update": {"_id": "doc2", "status": 429, "error": {
                "type": "es_rejected_execution_exception",
                "reason": "rejected execution of coordinating operation",
            }}},
        ],
    });

    let error = classify_email_attachment_update_response(200, &body.to_string()).unwrap_err();

    let OpensearchClientError::WritesRefused {
        cause, operation, ..
    } = error
    else {
        panic!("expected a refusal, got {error:?}");
    };
    assert_eq!(cause, WriteRefusal::TooManyRequests);
    assert_eq!(
        operation,
        OpensearchOperation::BulkUpdateDocumentEmailAttachment
    );
}

#[test]
fn a_flood_stage_block_on_an_item_is_a_cluster_block() {
    let body = serde_json::json!({
        "errors": true,
        "items": [
            {"update": {"_id": "doc1", "status": 429, "error": {
                "type": "cluster_block_exception",
                "reason": "index [documents_v2] blocked by: [TOO_MANY_REQUESTS/12/disk usage exceeded flood-stage watermark, index has read-only-allow-delete block];",
            }}},
        ],
    });

    let error = classify_email_attachment_update_response(200, &body.to_string()).unwrap_err();

    let OpensearchClientError::WritesRefused { cause, details, .. } = error else {
        panic!("expected a refusal, got {error:?}");
    };
    assert_eq!(cause, WriteRefusal::ClusterBlock);
    assert!(details.contains("flood-stage watermark"), "{details}");
}

#[test]
fn a_request_level_429_without_json_is_a_refusal() {
    let error =
        classify_email_attachment_update_response(429, "429 Too Many Requests").unwrap_err();

    assert_eq!(
        error,
        OpensearchClientError::WritesRefused {
            details: "429 Too Many Requests".to_string(),
            cause: WriteRefusal::TooManyRequests,
            operation: OpensearchOperation::BulkUpdateDocumentEmailAttachment,
        }
    );
}

#[test]
fn a_request_level_cluster_block_is_a_refusal() {
    let body = serde_json::json!({
        "error": {
            "type": "cluster_block_exception",
            "reason": "index [documents_v2] blocked by: [FORBIDDEN/8/index write (api)];",
        },
        "status": 403,
    });

    let error = classify_email_attachment_update_response(403, &body.to_string()).unwrap_err();

    assert!(
        matches!(
            error,
            OpensearchClientError::WritesRefused {
                cause: WriteRefusal::ClusterBlock,
                ..
            }
        ),
        "{error:?}"
    );
}

#[test]
fn a_request_level_403_that_is_not_a_block_is_not_a_refusal() {
    let body = serde_json::json!({
        "error": {"type": "security_exception", "reason": "no permissions"},
        "status": 403,
    });

    let error = classify_email_attachment_update_response(403, &body.to_string()).unwrap_err();

    assert!(
        matches!(error, OpensearchClientError::Unknown { .. }),
        "{error:?}"
    );
}

#[test]
fn an_undecodable_success_body_is_a_deserialization_failure() {
    let error = classify_email_attachment_update_response(200, "not json").unwrap_err();

    assert!(
        matches!(error, OpensearchClientError::DeserializationFailed { .. }),
        "{error:?}"
    );
}

#[tokio::test]
async fn an_empty_batch_sends_no_request() {
    // Nothing listens on port 1, so any request would fail.
    let client =
        crate::OpensearchClient::new("http://127.0.0.1:1".into(), "".into(), "".into()).unwrap();

    let result = client
        .bulk_update_email_attachment(&[], true)
        .await
        .unwrap();

    assert_eq!(result, EmailAttachmentUpdateResult::default());
}

#[tokio::test]
async fn email_attachment_update_writes_through_the_documents_alias() {
    let (url, server) = serve_once(
        "200 OK",
        r#"{"errors":false,"items":[{"update":{"_id":"doc1","status":200,"result":"updated"}}]}"#,
    );
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let result = client
        .bulk_update_email_attachment(&["doc1".to_string()], true)
        .await
        .unwrap();
    let (request_line, request_body) = server.join().unwrap();

    assert_eq!(result.updated, 1);
    assert!(
        request_line.starts_with("POST /documents/_bulk?"),
        "{request_line}"
    );
    assert!(
        request_line.contains("require_alias=true"),
        "{request_line}"
    );
    assert!(
        request_body.contains(r#""routing":"doc1""#),
        "{request_body}"
    );
}

#[tokio::test]
async fn a_refused_update_is_not_resent() {
    // `serve_once` answers one request, so a resend would fail to connect
    // instead of returning the refusal.
    let (url, server) = serve_once(
        "429 Too Many Requests",
        r#"{"error":{"type":"es_rejected_execution_exception","reason":"rejected"},"status":429}"#,
    );
    let client = crate::OpensearchClient::new(url, "".into(), "".into()).unwrap();

    let result = client
        .bulk_update_email_attachment(&["doc1".to_string()], true)
        .await;
    server.join().unwrap();

    assert!(
        matches!(
            result,
            Err(OpensearchClientError::WritesRefused {
                cause: WriteRefusal::TooManyRequests,
                ..
            })
        ),
        "{result:?}"
    );
}

#[test]
fn a_success_without_items_acknowledges_nothing() {
    for body in ["{}", r#"{"items":null}"#, r#"{"errors":false}"#] {
        let error = classify_email_attachment_update_response(200, body).unwrap_err();
        assert!(
            matches!(error, OpensearchClientError::DeserializationFailed { .. }),
            "{body}: {error:?}"
        );
    }
}
