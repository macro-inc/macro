use super::index_missing;
use serde_json::json;

#[test]
fn only_a_missing_index_reads_as_missing() {
    assert!(index_missing(&json!({
        "error": { "type": "index_not_found_exception" },
        "status": 404
    })));
    assert!(!index_missing(
        &json!({ "_index": "agent_sessions", "found": false })
    ));
}
