use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::json;

static NUMBER: StateKey<f64> = StateKey::new("numberState", |value| {
    value.and_then(serde_json::Value::as_f64).unwrap_or(0.0)
});
static BOOL: StateKey<bool> = StateKey::new("boolState", |value| value.is_some_and(js_truthy));
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Stateful {}
impl NodeType for Stateful {
    const TYPE: &'static str = "state";
    type Kind = DecoratorKind;
    const REQUIRED_STATE: &'static [RequiredState] =
        &[RequiredState::flat(&NUMBER), RequiredState::nested(&BOOL)];
    impl_default_node!();
}
impl DecoratorNode for Stateful {
    decorator_node_base!();
}

#[test]
fn flat_state_round_trip_s1_18_4() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Stateful>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let flat = json!({"$":{"boolState":true},"numberState":2,"type":"state","version":1});
    let nested = json!({"$":{"boolState":true,"numberState":2},"type":"state","version":1});
    let both =
        json!({"$":{"boolState":true,"numberState":3},"numberState":2,"type":"state","version":1});
    for document in [&flat, &nested, &both] {
        let node = tx.import_node(document.as_object().expect("object"))?;
        let exported = serde_json::Value::Object(tx.export_node(node)?);
        assert_eq!(exported, flat);
        assert!(tx.get_state(node, &BOOL)?);
        assert_eq!(tx.get_state(node, &NUMBER)?, 2.0);
        assert_eq!(
            to_js_json_string(&exported),
            r#"{"type":"state","version":1,"numberState":2,"$":{"boolState":true}}"#
        );
    }
    Ok(())
}
#[test]
fn full_document_bytes_match_root_paragraph_text_order() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("hello")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.text(text)?.select(Some(Utf16Offset(2)), None)?;
        Ok(())
    })?;
    let value = serde_json::to_value(editor.state().to_json()?)?;
    assert_eq!(
        to_js_json_string(&value),
        r#"{"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"hello","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}}"#
    );
    assert_eq!(editor.state().to_json_string()?, to_js_json_string(&value));
    let before = editor.state().clone();
    let parsed = editor.parse_editor_state_str(&to_js_json_string(&value))?;
    assert_eq!(parsed.to_json()?, before.to_json()?);
    assert!(parsed.selection().is_none());
    assert!(before.same_snapshot(editor.state()));
    Ok(())
}
#[test]
fn unknown_state_fields_keep_insertion_order_and_nested_values() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let document = r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a","mode":"normal","$":{"z":{"b":[true,null,2]},"a":"unknown"}}]}]}}"#;
    let state = editor.parse_editor_state_str(document)?;
    let text = state
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .expect("text");
    let exported = state.view().export_node(text)?;
    assert_eq!(
        to_js_json_string(exported.get("$").expect("state")),
        r#"{"z":{"b":[true,null,2]},"a":"unknown"}"#
    );
    assert!(!exported.contains_key("format"));
    assert!(!exported.contains_key("detail"));
    assert!(!exported.contains_key("style"));
    Ok(())
}
#[test]
fn parse_errors_preserve_committed_state_and_classify_unknown_types() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let before = editor.state().clone();
    assert!(matches!(
        editor.parse_editor_state_str("{"),
        Err(Error::Json(_))
    ));
    assert!(matches!(
        editor.parse_editor_state_str(r#"{"root":{"type":"paragraph"}}"#),
        Err(Error::ExpectedSerializedRoot)
    ));
    let unknown = editor
        .parse_editor_state_str(r#"{"root":{"type":"root","children":[{"type":"unknown"}]}}"#);
    assert!(matches!(unknown, Err(Error::UnknownSerializedType(ref name)) if name == "unknown"));
    assert!(editor.state().same_snapshot(&before));
    Ok(())
}
#[test]
fn js_number_uses_integer_values_and_javascript_notation() {
    assert_eq!(js_number(1.0), json!(1));
    assert_eq!(js_number(1.5), json!(1.5));
    assert_eq!(js_number(-0.0), json!(0));
    assert_eq!(js_number(f64::NAN), json!(null));
    assert_eq!(js_number(f64::INFINITY), json!(null));
    assert_eq!(js_number(f64::NEG_INFINITY), json!(null));
    assert_eq!(to_js_json_string(&js_number(1e21)), "1e+21");
    assert_eq!(to_js_json_string(&js_number(1e20)), "100000000000000000000");
    assert_eq!(to_js_json_string(&js_number(1e-6)), "0.000001");
    assert_eq!(to_js_json_string(&js_number(1e-7)), "1e-7");
    assert_eq!(
        to_js_json_string(&json!(9007199254740993_u64)),
        "9007199254740992"
    );
}
#[test]
fn stringify_orders_array_indices_then_insertion_order_and_escapes_strings() {
    let value: serde_json::Value = serde_json::from_str(r#"{"z":"\b\f\n\r\t\"\\/","10":10,"2":2,"01":1,"4294967295":5,"0":0,"4294967294":4,"nested":{"4":4,"1":1},"a":"😀"}"#).expect("JSON");
    assert_eq!(
        to_js_json_string(&value),
        r#"{"0":0,"2":2,"10":10,"4294967294":4,"z":"\b\f\n\r\t\"\\/","01":1,"4294967295":5,"nested":{"1":1,"4":4},"a":"😀"}"#
    );
    assert_eq!(
        to_js_json_string(&json!([1.0, null, true, "\u{0}"])),
        r#"[1,null,true,"\u0000"]"#
    );
}
#[test]
fn truthiness_matches_javascript_for_every_json_kind() {
    assert!(!js_truthy(&json!(null)));
    assert!(!js_truthy(&json!(false)));
    assert!(!js_truthy(&json!(0)));
    assert!(!js_truthy(&json!(-0.0)));
    assert!(!js_truthy(&json!("")));
    assert!(js_truthy(&json!(true)));
    assert!(js_truthy(&json!(-2.5)));
    assert!(js_truthy(&json!("0")));
    assert!(js_truthy(&json!([])));
    assert!(js_truthy(&json!({})));
}
#[test]
fn float_serde_adapter_and_file_envelope_use_portable_values() -> Result<(), Error> {
    #[derive(Serialize)]
    struct Float {
        #[serde(serialize_with = "crate::json::serialize_js_number")]
        value: f64,
    }
    assert_eq!(
        serde_json::to_string(&Float { value: 2.0 })?,
        r#"{"value":2}"#
    );
    assert_eq!(
        serde_json::to_string(&Float { value: f64::NAN })?,
        r#"{"value":null}"#
    );
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let doc = SerializedDocument::from_state(editor.state(), Some(""), Some(0), HistoryTime(42))?;
    assert_eq!(doc.last_saved, 42);
    assert_eq!(doc.source, "Lexical");
    assert_eq!(doc.version, "0.45.0");
    let parsed = editor.state_from_serialized_document(&doc)?;
    assert_eq!(parsed.to_json()?, doc.editor_state);
    let parsed = editor.state_from_serialized_document_str(&serde_json::to_string(&doc)?)?;
    assert_eq!(parsed.to_json()?, doc.editor_state);
    let doc =
        SerializedDocument::from_state(editor.state(), Some("custom"), Some(3), HistoryTime(42))?;
    assert_eq!(doc.source, "custom");
    assert_eq!(doc.last_saved, 3);
    Ok(())
}

#[test]
fn parsing_a_typed_document_does_not_normalize_adjacent_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let document: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a","mode":"normal"},{"type":"text","text":"b","mode":"normal"}]}]}}),
    )?;
    let state = editor.parse_editor_state(&document)?;
    assert_eq!(state.view().all_text_nodes(NodeKey::ROOT).count(), 2);
    assert!(editor.state().is_empty_state());
    Ok(())
}

#[test]
fn json_boundary_coercions_use_javascript_primitives() {
    assert_eq!(js_string(&serde_json::json!({})), "[object Object]");
    assert_eq!(
        js_string(&serde_json::json!([1, null, [2, 3], {}])),
        "1,,2,3,[object Object]"
    );
    assert_eq!(js_to_number(&serde_json::json!([12])), 12.0);
    assert_eq!(js_to_number(&serde_json::json!([null])), 0.0);
    assert!(js_to_number(&serde_json::json!([1, 2])).is_nan());
    assert_eq!(js_to_number(&serde_json::json!("\u{feff}0x10\u{a0}")), 16.0);
    assert_eq!(js_to_number(&serde_json::json!("0b101")), 5.0);
    assert_eq!(js_to_number(&serde_json::json!("0o17")), 15.0);
    assert_eq!(
        js_to_number(&serde_json::json!("0x20000000000001")),
        9_007_199_254_740_992.0
    );
    assert_eq!(
        js_to_number(&serde_json::json!("0x20000000000003")),
        9_007_199_254_740_996.0
    );
    assert!(js_to_number(&serde_json::json!("-0x10")).is_nan());
    assert!(js_to_number(&serde_json::json!("inf")).is_nan());
    assert_eq!(js_to_number(&serde_json::json!("+Infinity")), f64::INFINITY);
    assert!(js_to_number(&serde_json::json!("-0")).is_sign_negative());
}

#[test]
fn parse_report_retains_partial_state_without_weakening_the_strict_parser() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let input: SerializedEditorState = serde_json::from_value(
        serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"retained"}]},{"type":"unknown-import-node","version":1}]}}),
    )?;
    assert!(matches!(
        editor.parse_editor_state(&input),
        Err(Error::UnknownSerializedType(_))
    ));
    let report = editor.parse_editor_state_report(&input)?;
    assert!(matches!(
        report.error,
        Some(Error::UnknownSerializedType(_))
    ));
    assert_eq!(report.state.view().children(NodeKey::ROOT).count(), 1);
    assert_eq!(
        report.state.view().text_content(
            report
                .state
                .view()
                .first_child(NodeKey::ROOT)
                .expect("retained paragraph")
        ),
        "retained"
    );
    assert!(editor.state().is_empty_state());
    Ok(())
}
