use super::Normalizer;
use serde_json::json;

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
