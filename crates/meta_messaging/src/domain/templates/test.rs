use super::*;
use serde_json::json;

#[test]
fn named_and_positional_templates_collect_exact_component_inputs() {
    let params = text_parameters(&json!([
        {"type":"HEADER","format":"TEXT","text":"Order {{order_number}}"},
        {"type":"BODY","text":"Hello {{first_name}}, your order {{order_number}} is ready."},
        {"type":"BUTTONS","buttons":[{"type":"URL","url":"https://example.test/orders"}]}
    ]))
    .unwrap();
    assert_eq!(
        params.iter().map(|p| p.name.as_deref()).collect::<Vec<_>>(),
        vec![
            Some("order_number"),
            Some("first_name"),
            Some("order_number")
        ]
    );
    assert_eq!(params[0].component, "header");
    let params = text_parameters(&json!([{"type":"BODY","text":"{{1}} {{2}} {{1}}"}])).unwrap();
    assert_eq!(params.len(), 2);
    assert!(params.iter().all(|p| p.name.is_none()));
}

#[test]
fn unsupported_inputs_are_disabled_before_send() {
    for components in [
        json!([{"type":"HEADER","format":"IMAGE"}]),
        json!([{"type":"BUTTONS","buttons":[{"type":"URL","url":"https://example.test/{{1}}"}]}]),
        json!([{"type":"BODY","text":"{{2}}"}]),
        json!([{"type":"BODY","text":"{{name}} {{1}}"}]),
        json!([{"type":"CAROUSEL","cards":[]}]),
    ] {
        assert!(text_parameters(&components).is_err());
    }
}

#[test]
fn substituted_values_are_not_parsed_as_more_variables() {
    let components = json!([{"type":"BODY","text":"Hello {{name}}, order {{order}}"}]);
    assert_eq!(
        render_text(&components, &["{{order}}".into(), "42".into()]).unwrap(),
        "Hello {{order}}, order 42"
    );
}
