use serde_json::json;

use super::*;

fn arguments(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

fn context() -> Value {
    json!({
        "trigger": {
            "entity_id": "thread-1",
            "email": {
                "subject": "Invoice #4",
                "from": { "name": "Ada", "email": "ada@example.com" },
                "to": [{ "email": "me@example.com" }],
            },
        },
        "steps": { "task": { "documentId": "doc-1", "count": 3 } },
    })
}

#[test]
fn whole_placeholders_keep_the_value_and_embedded_ones_become_text() {
    let rendered = render(
        &arguments(json!({
            "thread_id": "{{trigger.entity_id}}",
            "from": "{{ trigger.email.from }}",
            "content": "New: {{trigger.email.subject}} from {{trigger.email.from.name}} ({{steps.task.count}})",
            "nested": [{ "id": "{{steps.task.documentId}}" }],
            "missing": "{{trigger.email.cc}}",
            "missing_text": "cc: {{trigger.email.cc}}!",
            "index": "{{trigger.email.to.0.email}}",
            "untouched": 7,
        })),
        &context(),
    );
    assert_eq!(
        Value::Object(rendered),
        json!({
            "thread_id": "thread-1",
            "from": { "name": "Ada", "email": "ada@example.com" },
            "content": "New: Invoice #4 from Ada (3)",
            "nested": [{ "id": "doc-1" }],
            "missing": null,
            "missing_text": "cc: !",
            "index": "me@example.com",
            "untouched": 7,
        })
    );
}

#[test]
fn references_name_the_trigger_or_a_step() {
    let found = references(&json!({
        "a": "{{trigger.email.subject}} and {{steps.task.documentId}}",
        "b": ["{{trigger}}"],
    }))
    .unwrap();
    assert_eq!(
        found,
        vec![
            Reference::Trigger(vec!["email".into(), "subject".into()]),
            Reference::Step {
                id: StepId::try_from("task".to_owned()).unwrap(),
                path: vec!["documentId".into()],
            },
            Reference::Trigger(vec![]),
        ]
    );
}

#[test]
fn malformed_placeholders_are_errors() {
    for text in [
        "{{trigger.email",
        "{{email.subject}}",
        "{{steps}}",
        "{{steps.Bad.id}}",
        "{{trigger..subject}}",
        "{{trigger.a b}}",
    ] {
        assert!(references(&json!(text)).is_err(), "{text}");
    }
    assert!(
        references(&json!("plain {text} and }}"))
            .unwrap()
            .is_empty()
    );
}
