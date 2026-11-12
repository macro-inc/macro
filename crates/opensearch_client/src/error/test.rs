use super::*;

#[test]
fn test_is_too_many_clauses_detects_nested_clause_limit() {
    let body = serde_json::json!({
        "error": {
            "root_cause": [{
                "type": "too_many_nested_clauses",
                "reason": "Query contains too many nested clauses; maxClauseCount is set to 1024"
            }],
            "type": "search_phase_execution_exception",
            "reason": "all shards failed"
        },
        "status": 400
    });

    assert!(is_too_many_clauses(&body.to_string()));
}

#[test]
fn test_is_too_many_clauses_detects_bool_clause_limit_in_cause_chain() {
    let body = serde_json::json!({
        "error": {
            "root_cause": [{
                "type": "query_shard_exception",
                "reason": "failed to create query: maxClauseCount is set to 1024"
            }],
            "type": "search_phase_execution_exception",
            "reason": "all shards failed",
            "caused_by": {
                "type": "query_shard_exception",
                "caused_by": { "type": "too_many_clauses", "reason": "maxClauseCount is set to 1024" }
            }
        },
        "status": 400
    });

    assert!(is_too_many_clauses(&body.to_string()));
}

#[test]
fn test_is_too_many_clauses_ignores_other_errors() {
    let parse_error = serde_json::json!({
        "error": {
            "root_cause": [{ "type": "parsing_exception", "reason": "unknown query [foo]" }],
            "type": "parsing_exception"
        },
        "status": 400
    });

    assert!(!is_too_many_clauses(&parse_error.to_string()));
    assert!(!is_too_many_clauses("upstream connect error"));
    assert!(!is_too_many_clauses(""));
}
