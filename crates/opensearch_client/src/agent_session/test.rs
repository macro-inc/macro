use super::reports_error;
use serde_json::json;

#[test]
fn only_a_missing_document_reads_as_missing() {
    assert!(reports_error(&json!({
        "error": { "type": "index_not_found_exception" },
        "status": 404
    })));
    assert!(!reports_error(
        &json!({ "_index": "agent_sessions", "found": false })
    ));
}
