use super::*;
use serde_json::json;

#[test]
fn truncate_chars_borrows_when_within_budget() {
    assert!(matches!(truncate_chars("hello", 5), Cow::Borrowed("hello")));
    assert!(matches!(truncate_chars("", 0), Cow::Borrowed("")));
}

#[test]
fn truncate_chars_cuts_on_char_boundaries_and_marks_the_cut() {
    // Multi-byte characters: the byte length exceeds the budget but the char
    // count does not, so nothing is cut.
    assert!(matches!(truncate_chars("héllo", 5), Cow::Borrowed("héllo")));
    assert_eq!(
        truncate_chars("héllo wörld", 5),
        "héllo…[truncated 6 chars]"
    );
}

#[test]
fn policy_parses_the_standard_switch() {
    assert!(ContentPolicy::parse(None).capture);
    assert!(ContentPolicy::parse(Some("true")).capture);
    assert!(ContentPolicy::parse(Some("anything")).capture);
    for off in ["false", "FALSE", " 0 ", "no", "Off"] {
        assert!(
            !ContentPolicy::parse(Some(off)).capture,
            "{off:?} should disable capture"
        );
    }
    assert_eq!(ContentPolicy::parse(None).limits, Limits::default());
}

#[test]
fn bounded_json_string_cuts_leaves_then_the_whole_value() {
    let limits = Limits {
        max_part_chars: 4,
        max_attribute_bytes: 1_000,
    };
    let (json, cut) = bounded_json_string(&json!({"a": "abcdefgh", "n": 1}), &limits);
    assert!(cut);
    assert_eq!(json, r#"{"a":"abcd…[truncated 4 chars]","n":1}"#);

    let (json, cut) = bounded_json_string(&json!({"a": "ab"}), &limits);
    assert!(!cut);
    assert_eq!(json, r#"{"a":"ab"}"#);

    // A bare string is recorded unquoted.
    let (json, cut) = bounded_json_string(&json!("plain"), &limits);
    assert!(cut);
    assert_eq!(json, "plai…[truncated 1 chars]");

    let tight = Limits {
        max_part_chars: 1_000,
        max_attribute_bytes: 10,
    };
    let (json, cut) = bounded_json_string(&json!({"key": "value"}), &tight);
    assert!(cut);
    assert!(json.starts_with(r#"{"key"#), "{json}");
    assert!(json.ends_with("bytes]"), "{json}");
}

fn message(role: &str, text: &str) -> serde_json::Value {
    json!({"role": role, "parts": [{"type": "text", "content": text}]})
}

#[test]
fn bound_messages_keeps_everything_within_budget() {
    let bounded = bound_messages(
        vec![message("user", "hi"), message("assistant", "hello")],
        &Limits::default(),
    );
    assert_eq!(bounded.omitted, 0);
    assert!(!bounded.truncated);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&bounded.json).unwrap();
    assert_eq!(parsed.len(), 2);
}

#[test]
fn bound_messages_drops_the_oldest_messages_first_and_never_the_last() {
    let messages = vec![
        message("user", "first"),
        message("assistant", "second"),
        message("user", "third"),
    ];
    let one_message_budget = serde_json::to_string(&vec![message("user", "third")])
        .unwrap()
        .len();
    let limits = Limits {
        max_part_chars: 1_000,
        max_attribute_bytes: one_message_budget,
    };
    let bounded = bound_messages(messages, &limits);
    assert_eq!(bounded.omitted, 2);
    assert!(bounded.truncated);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&bounded.json).unwrap();
    assert_eq!(parsed, vec![message("user", "third")]);
}

#[test]
fn bound_messages_cuts_long_parts() {
    let limits = Limits {
        max_part_chars: 3,
        max_attribute_bytes: 10_000,
    };
    let bounded = bound_messages(vec![message("user", "abcdef")], &limits);
    assert_eq!(bounded.omitted, 0);
    assert!(bounded.truncated);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&bounded.json).unwrap();
    assert_eq!(parsed[0]["parts"][0]["content"], "abc…[truncated 3 chars]");
}

fn definition(name: &str) -> serde_json::Value {
    json!({
        "type": "function",
        "name": name,
        "description": format!("does {name}"),
        "parameters": {"type": "object", "properties": {"q": {"type": "string", "description": "a long schema description"}}}
    })
}

#[test]
fn bound_tool_definitions_keeps_schemas_within_budget() {
    let (json, cut) =
        bound_tool_definitions(vec![definition("a"), definition("b")], &Limits::default());
    assert!(!cut);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
    assert!(parsed.iter().all(|d| d.get("parameters").is_some()));
}

#[test]
fn bound_tool_definitions_drops_parameters_before_names_and_descriptions() {
    let full = serde_json::to_string(&vec![definition("a"), definition("b")]).unwrap();
    let limits = Limits {
        max_part_chars: 1_000,
        max_attribute_bytes: full.len() - 1,
    };
    let (json, cut) = bound_tool_definitions(vec![definition("a"), definition("b")], &limits);
    assert!(cut);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.len(), 2);
    assert!(parsed.iter().all(|d| d.get("parameters").is_none()));
    assert_eq!(parsed[0]["name"], "a");
    assert_eq!(parsed[0]["description"], "does a");
}

#[test]
fn truncate_bytes_respects_the_byte_budget_on_char_boundaries() {
    assert!(matches!(truncate_bytes("héllo", 6), Cow::Borrowed("héllo")));
    let emoji = "😀".repeat(1_000);
    let cut = truncate_bytes(&emoji, 200);
    assert!(cut.len() <= 200, "{} bytes", cut.len());
    assert!(cut.starts_with("😀"), "cut on a character boundary");
    assert!(cut.contains("…[truncated"), "{cut}");
}

#[test]
fn bounded_json_string_enforces_bytes_not_chars() {
    let limits = Limits {
        max_part_chars: 100_000,
        max_attribute_bytes: 500,
    };
    let (json, cut) = bounded_json_string(&json!("😀".repeat(1_000)), &limits);
    assert!(cut);
    assert!(json.len() <= 500, "{} bytes", json.len());
}

#[test]
fn an_oversized_last_message_is_shrunk_into_valid_json() {
    let limits = Limits {
        max_part_chars: 100_000,
        max_attribute_bytes: 300,
    };
    let big = json!({
        "role": "user",
        "parts": [
            {"type": "text", "content": "a".repeat(400)},
            {"type": "text", "content": "b".repeat(400)},
        ]
    });
    let bounded = bound_messages(vec![message("assistant", "earlier"), big], &limits);
    assert!(bounded.truncated);
    assert_eq!(bounded.omitted, 1);
    assert!(bounded.json.len() <= 300, "{} bytes", bounded.json.len());
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(&bounded.json).expect("valid JSON: {bounded.json}");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0]["role"], "user");

    // Even a budget too small for any of its content leaves a note behind.
    let bounded = bound_messages(
        vec![message("user", &"x".repeat(1_000))],
        &Limits {
            max_part_chars: 100_000,
            max_attribute_bytes: 60,
        },
    );
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&bounded.json).expect("valid JSON");
    assert!(
        parsed[0]["parts"][0]["content"]
            .as_str()
            .is_some_and(|content| content.starts_with("[content omitted")),
        "{}",
        bounded.json
    );
}

#[test]
fn an_overlong_tool_list_drops_definitions_but_stays_valid_json() {
    let definitions: Vec<_> = (0..50).map(|i| definition(&format!("tool_{i}"))).collect();
    let limits = Limits {
        max_part_chars: 1_000,
        max_attribute_bytes: 600,
    };
    let (json, cut) = bound_tool_definitions(definitions, &limits);
    assert!(cut);
    assert!(json.len() <= 600, "{} bytes", json.len());
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&json).expect("valid JSON");
    assert!(!parsed.is_empty());
    assert_eq!(parsed[0]["name"], "tool_0");
}
