use super::Normalizer;
use serde_json::json;

#[test]
fn backfill_retry_after_ceiling_is_opt_in_and_keeps_scheduling_boundaries() {
    let span = |value: &str| {
        json!({"name":"defer_rate_limited_operation","fields":{
        "retry_after":value,"other":"Some(59.999s)"}})
    };
    let original = span("Some(59.999s)");
    assert_eq!(
        Normalizer::default().value("spans", original.clone()),
        original
    );
    let mut normalizer = Normalizer {
        normalize_backfill_retry_after: true,
        ..Normalizer::default()
    };
    assert_eq!(
        normalizer.value("spans", span("Some(59.999s)")),
        span("Some(60s)")
    );
    assert_eq!(
        normalizer.value("spans", span("Some(60s)")),
        span("Some(60s)")
    );
    assert_ne!(
        normalizer.value("spans", span("Some(58.999s)")),
        span("Some(60s)")
    );
    for (input, expected) in [
        ("Some(1ms)", "Some(1s)"),
        ("Some(1.5µs)", "Some(1s)"),
        ("Some(0ns)", "Some(0s)"),
        ("None", "None"),
    ] {
        assert_eq!(normalizer.value("spans", span(input)), span(expected));
    }
    assert_eq!(normalizer.value("logs", original.clone()), original);
    let mut other = original.clone();
    other["name"] = json!("another_operation");
    assert_eq!(normalizer.value("spans", other.clone()), other);
    assert_eq!(
        normalizer.value("outcome", json!({"delay_seconds":60})),
        json!({"delay_seconds":60})
    );
}

#[test]
fn backfill_contacts_users_set_keeps_members_other_fields_and_other_queues() {
    let outcome = |users| {
        json!({"sent":[{"queue":"http://fake/000000000000/contacts",
        "body":json!({"users":users,"other":[2,1]}).to_string(),"delay_seconds":7}]})
    };
    let sqs = |users| {
        json!([{"operation":"SendMessage","request":{
            "QueueUrl":"http://fake/000000000000/contacts","MessageBody":{"users":users,"other":[2,1]}}
        }])
    };
    for (section, a, b) in [
        (
            "outcome",
            outcome(json!(["b", "a"])),
            outcome(json!(["a", "b"])),
        ),
        ("sqs", sqs(json!(["b", "a"])), sqs(json!(["a", "b"]))),
    ] {
        assert_ne!(Normalizer::default().value(section, a.clone()), b);
        let mut normalizer = Normalizer {
            normalize_backfill_contacts_users: true,
            ..Normalizer::default()
        };
        assert_eq!(normalizer.value(section, a.clone()), b);
        let mut other = a.clone();
        if section == "outcome" {
            other["sent"][0]["queue"] = json!("http://fake/000000000000/backfill");
        } else {
            other[0]["request"]["QueueUrl"] = json!("http://fake/000000000000/backfill");
        }
        assert_eq!(normalizer.value(section, other.clone()), other);
    }
    let mut normalizer = Normalizer {
        normalize_backfill_contacts_users: true,
        ..Normalizer::default()
    };
    assert_ne!(
        normalizer.value("outcome", outcome(json!(["a", "b"]))),
        normalizer.value("outcome", outcome(json!(["a", "b", "c"])))
    );
    assert_ne!(
        normalizer.value("outcome", outcome(json!(["a", "b"]))),
        normalizer.value("outcome", outcome(json!(["a", "a", "b"])))
    );
}

#[test]
fn backfill_wait_rule_is_opt_in_and_preserves_admission_and_other_spans() {
    let original = json!({"name":"email.backfill.write_slot", "fields":{
        "waited_ms":17,"admitted":true,"in_flight":3,"other":42
    }});
    assert_eq!(
        Normalizer::default().value("spans", original.clone()),
        original
    );
    let mut normalizer = Normalizer {
        normalize_backfill_write_wait: true,
        ..Normalizer::default()
    };
    let mut expected = original.clone();
    expected["fields"]["waited_ms"] = json!("<elapsed>");
    assert_eq!(normalizer.value("spans", original.clone()), expected);
    assert_eq!(normalizer.value("logs", original.clone()), original);
    let mut other = original.clone();
    other["name"] = json!("another.write_slot");
    assert_eq!(normalizer.value("spans", other.clone()), other);
    let mut refused = original;
    refused["fields"]["admitted"] = json!(false);
    assert_ne!(normalizer.value("spans", refused), expected);
}

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

#[test]
fn embedded_transaction_backtrace_keeps_the_rollback_error() {
    if !crate::parity::process_per_test() {
        return;
    }
    for (captured, expected) in [
        (
            "DetailedError { source: Original error: Retryable(DetailedError { source: database unavailable\n\nStack backtrace:\n   0: frame\n             at source.rs:1:2 }), Rollback error: Io(UnexpectedEof)\n\nStack backtrace:\n   0: outer frame }",
            "DetailedError { source: Original error: Retryable(DetailedError { source: database unavailable }), Rollback error: Io(UnexpectedEof) }",
        ),
        (
            r#"Outer(Transient("unavailable\n\nStack backtrace:\n   0: frame")), Rollback error: Io(UnexpectedEof))"#,
            r#"Outer(Transient("unavailable")), Rollback error: Io(UnexpectedEof))"#,
        ),
        (
            "Original error: Retryable(database unavailable), Rollback error: Io(UnexpectedEof)",
            "Original error: Retryable(database unavailable), Rollback error: Io(UnexpectedEof)",
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
