use super::*;
use crate::date_format::EpochSeconds;

fn args(doc_id: &str, node_id: &str) -> UpsertDocumentArgs {
    UpsertDocumentArgs {
        document_id: doc_id.to_string(),
        node_id: node_id.to_string(),
        document_name: format!("name-{doc_id}"),
        file_type: "md".to_string(),
        owner_id: format!("owner-{doc_id}"),
        raw_content: None,
        content: format!("content {doc_id} {node_id}"),
        updated_at_seconds: EpochSeconds::new(1_700_000_000).unwrap(),
        sub_type: None,
    }
}

#[test]
fn parent_doc_body_has_metadata_no_chunk_fields() {
    let doc = parent_doc_body(&args("doc1", "n1"));

    assert_eq!(doc["entity_id"], "doc1");
    assert_eq!(doc["document_name"], "name-doc1");
    assert_eq!(doc["owner_id"], "owner-doc1");
    assert_eq!(doc["file_type"], "md");
    assert_eq!(doc["document_relation"], "document");
    // Child-only fields must not be present on the parent.
    assert!(doc.get("content").is_none());
    assert!(doc.get("node_id").is_none());
    assert!(doc.get("raw_content").is_none());
}

#[test]
fn parent_doc_body_includes_optional_sub_type() {
    let mut a = args("doc1", "n1");
    a.sub_type = Some("task".to_string());
    let doc = parent_doc_body(&a);
    assert_eq!(doc["sub_type"], "task");
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
fn destination_uses_join_shape_for_v2() {
    use crate::documents_shape::{DOCUMENTS_V2, destination_uses_join_shape};
    assert!(destination_uses_join_shape(DOCUMENTS_V2));
    assert!(!destination_uses_join_shape("documents_v1"));
    assert!(!destination_uses_join_shape("documents_join_test"));
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
