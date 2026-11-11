use super::*;

fn read_imported(value: Option<Value>) -> Result<(Editor, Arc<Value>), Box<dyn std::error::Error>> {
    let mut state = serde_json::Map::new();
    state.insert("retained".into(), json!({"field":1}));
    if let Some(value) = value {
        state.insert("documentMetadata".into(), value);
    }
    let editor = Editor::builder(EditorMode::Headless)
        .initial_state(serde_json::from_value(json!({"root": {
            "type":"root", "version":1, "$":state,
            "children":[{"type":"paragraph","version":1,"children":[]}]
        }}))?)
        .build()?;
    let parsed = editor
        .state()
        .view()
        .get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
    Ok((editor, parsed))
}

#[test]
fn invalid_metadata_reuses_the_source_default_and_is_omitted_on_export()
-> Result<(), Box<dyn std::error::Error>> {
    let default = DOCUMENT_METADATA.default_value().clone();
    for input in [
        None,
        Some(Value::Null),
        Some(json!(false)),
        Some(json!(42)),
        Some(json!("invalid")),
    ] {
        let (editor, parsed) = read_imported(input)?;
        assert!(Arc::ptr_eq(&parsed, &default));
        let exported = editor.state().to_json()?;
        assert_eq!(exported.root["$"]["retained"], json!({"field":1}));
        assert!(exported.root["$"].get("documentMetadata").is_none());
    }
    Ok(())
}

#[test]
fn metadata_objects_and_arrays_parse_fresh_and_remain_exported()
-> Result<(), Box<dyn std::error::Error>> {
    let default = DOCUMENT_METADATA.default_value().clone();
    for (input, expected) in [
        (json!({}), json!({"version":-1,"environmentTags":null})),
        (json!([]), json!({"version":-1,"environmentTags":null})),
        (
            json!({"version":10}),
            json!({"version":10,"environmentTags":null}),
        ),
        (
            json!({"version":3,"environmentTags":["one",false,2,"two"]}),
            json!({"version":3,"environmentTags":["one","two"]}),
        ),
    ] {
        let (first_editor, first) = read_imported(Some(input.clone()))?;
        let (second_editor, second) = read_imported(Some(input))?;
        assert!(!Arc::ptr_eq(&first, &default));
        assert!(!Arc::ptr_eq(&first, &second));
        assert_eq!(first.as_ref(), &expected);
        assert_eq!(
            first_editor.state().to_json()?.root["$"]["documentMetadata"],
            expected
        );
        assert_eq!(
            second_editor.state().to_json()?.root["$"]["documentMetadata"],
            expected
        );
    }
    Ok(())
}
