use super::delete_failed;
use serde_json::json;

#[test]
fn partial_deletions_are_errors_even_with_http_success() {
    assert!(!delete_failed(
        &json!({"timed_out": false, "version_conflicts": 0, "failures": []})
    ));
    assert!(delete_failed(&json!({"timed_out": true})));
    assert!(delete_failed(&json!({"version_conflicts": 1})));
    assert!(delete_failed(
        &json!({"failures": [{"reason": "shard unavailable"}]})
    ));
}
