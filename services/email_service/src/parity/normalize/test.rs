use super::Normalizer;
use serde_json::json;

#[test]
fn generated_shared_customer_id_keeps_its_prefix_and_uuid_identity() {
    if !crate::parity::process_per_test() {
        return;
    }
    let uuid = "51000000-0000-0000-0000-000000000001";
    let value = json!({"id":uuid,"stripe_customer_id":format!("cus_shared_{uuid}")});
    let mut default = Normalizer::default();
    assert_eq!(
        default.value("db", value.clone())["stripe_customer_id"],
        format!("cus_shared_{uuid}")
    );
    let mut enabled = Normalizer {
        normalize_embedded_uuids: true,
        ..Normalizer::default()
    };
    assert_eq!(
        enabled.value("db", value),
        json!({"id":"<uuid:1>","stripe_customer_id":"cus_shared_<uuid:1>"})
    );
}

#[test]
fn gmail_redis_clocks_are_opt_in_and_keep_quota_and_capacity() {
    if !crate::parity::process_per_test() {
        return;
    }
    let original = json!({
        "gmail:{51000000-0000-0000-0000-000000000001}:window": {
            "before": null, "after": {"1790000000":"100"}
        },
        "gmail:{51000000-0000-0000-0000-000000000001}:limit": {
            "before": null, "after": {"at":"1790000000123", "cap":"3"}
        }
    });
    let mut normalizer = Normalizer::default();
    normalizer.symbol("51000000-0000-0000-0000-000000000001", "<link>");
    assert_eq!(normalizer.value("redis", original.clone()), original);
    normalizer.normalize_gmail_redis_clock = true;
    assert_eq!(
        normalizer.value("redis", original),
        json!({
            "gmail:{<link>}:window": {"before":null, "after":{"<window-units>":"100"}},
            "gmail:{<link>}:limit": {"before":null, "after":{"at":"<redis-time>", "cap":"3"}}
        })
    );
}

#[test]
fn response_key_sorting_is_opt_in_and_keeps_array_order() {
    if !crate::parity::process_per_test() {
        return;
    }
    let original = json!({"z":1,"a":{"z":2,"a":3},"array":[{"z":4,"a":5},2]});
    let mut unchanged = Normalizer::default();
    assert_eq!(
        unchanged.value("response", original.clone()).to_string(),
        original.to_string()
    );
    let mut sorted = Normalizer {
        sort_response_keys: true,
        ..Normalizer::default()
    };
    assert_eq!(
        sorted.value("response", original.clone()).to_string(),
        r#"{"a":{"a":3,"z":2},"array":[{"a":5,"z":4},2],"z":1}"#
    );
    assert_eq!(
        sorted.value("request", original.clone()).to_string(),
        original.to_string()
    );
}

#[test]
fn error_backtrace_removal_preserves_nested_debug_delimiters() {
    if !crate::parity::process_per_test() {
        return;
    }
    for (captured, expected) in [
        (
            "QueryError(database unavailable\n\nStack backtrace:\n   0: arbitrary frame)",
            "QueryError(database unavailable)",
        ),
        (
            "Outer(QueryError(database unavailable\n\nStack backtrace:\n   0: arbitrary frame))",
            "Outer(QueryError(database unavailable))",
        ),
        (
            "DetailedError { reason: DatabaseQueryFailed, source: database unavailable\n\nStack backtrace:\n   0: arbitrary frame }",
            "DetailedError { reason: DatabaseQueryFailed, source: database unavailable }",
        ),
        (
            "Outer([DetailedError { source: database unavailable\n\nStack backtrace:\n   0: arbitrary frame }])",
            "Outer([DetailedError { source: database unavailable }])",
        ),
        (
            "database unavailable\n\nStack backtrace:\n   0: arbitrary frame",
            "database unavailable",
        ),
    ] {
        let mut normalizer = Normalizer::default();
        assert_eq!(normalizer.value("logs", json!(captured)), json!(expected));
        assert_eq!(normalizer.value("spans", json!(captured)), json!(expected));
        assert_eq!(
            normalizer.value("response", json!(captured)),
            json!(captured)
        );
    }
}

#[test]
fn nested_string_backtraces_keep_the_error_and_debug_delimiters() {
    if !crate::parity::process_per_test() {
        return;
    }
    for (captured, expected) in [
        (
            r#"Outer(Transient("token unavailable\n\nCaused by:\n    unauthorized\n\nStack backtrace:\n   0: arbitrary frame"))"#,
            r#"Outer(Transient("token unavailable\n\nCaused by:\n    unauthorized"))"#,
        ),
        (
            r#"Outer { source: Transient("token unavailable\n\nStack backtrace:\n   0: arbitrary frame") }"#,
            r#"Outer { source: Transient("token unavailable") }"#,
        ),
    ] {
        let mut normalizer = Normalizer::default();
        assert_eq!(normalizer.value("logs", json!(captured)), json!(expected));
        assert_eq!(normalizer.value("spans", json!(captured)), json!(expected));
        assert_eq!(
            normalizer.value("response", json!(captured)),
            json!(captured)
        );
    }
}

#[test]
fn escaped_postgres_source_lines_are_normalized_without_changing_the_error() {
    if !crate::parity::process_per_test() {
        return;
    }
    for escaping in ["", "\\", "\\\\\\"] {
        let error = format!(
            "Retryable(\"Database(PgDatabaseError {{ file: Some({escaping}\"analyze.c{escaping}\"), line: Some(2474), routine: Some({escaping}\"transformUpdateTargetList{escaping}\") }})\")"
        );
        let mut normalizer = Normalizer::default();
        assert_eq!(
            normalizer.value("logs", json!(error)),
            json!(error.replace("2474", "<postgres-source-line>"))
        );
        assert_eq!(normalizer.value("response", json!(error)), json!(error));
    }
}

#[test]
fn sfs_source_set_order_is_opt_in_and_limited_to_its_span() {
    if !crate::parity::process_per_test() {
        return;
    }
    let source = json!({"name":"fetch_sfs_mappings","fields":{"sources":r#"{"https://example.com/z#two", "https://example.com/a#one"}"#}});
    let ordered = json!({"name":"fetch_sfs_mappings","fields":{"sources":r#"{"https://example.com/a#one", "https://example.com/z#two"}"#}});
    let mut normalizer = Normalizer::default();
    assert_eq!(normalizer.value("spans", source.clone()), source);
    normalizer.sort_sfs_source_sets = true;
    assert_eq!(normalizer.value("spans", source.clone()), ordered);
    assert_eq!(normalizer.value("response", source.clone()), source);
    let other = json!({"name":"other","fields":source["fields"]});
    assert_eq!(normalizer.value("spans", other.clone()), other);
    let malformed = json!({"name":"fetch_sfs_mappings","fields":{"sources":"not a set"}});
    assert_eq!(normalizer.value("spans", malformed.clone()), malformed);
}
