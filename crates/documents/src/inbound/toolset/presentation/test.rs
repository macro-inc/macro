use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn presentation_tools_have_valid_model_schemas() {
    let read = generate_validated_input_schema::<ReadPresentation>().unwrap();
    assert_eq!(read.name, "ReadPresentation");
    let edit = generate_validated_input_schema::<EditPresentation>().unwrap();
    assert_eq!(edit.name, "EditPresentation");
    // Every operation is offered to the model, inlined into one schema.
    let schema = serde_json::to_string(&edit.schema).unwrap();
    for op in [
        "setText",
        "formatText",
        "addShape",
        "addSlide",
        "setCellText",
        "setNotes",
        "setAnimations",
        "addAnimation",
        "removeAnimations",
        "untilNextClick",
    ] {
        assert!(schema.contains(&format!("\"{op}\"")), "{op} missing");
    }
    assert!(!schema.contains("$ref"));
}

/// Strict-mode providers send `null` for each optional field; the operations
/// must read those as omitted.
#[test]
fn strict_mode_calls_deserialize() {
    let call: EditPresentation = serde_json::from_value(serde_json::json!({
        "documentId": "019fd3b9-3c6c-7c05-89c2-a27f01218140",
        "operations": [
            {"op": "setTransform", "slide": 256, "shape": 2, "x": 72.0, "y": null, "w": null,
             "h": null, "rotation": null, "flipH": null, "flipV": null},
            {"op": "addShape", "slide": 256, "x": 10, "y": 10, "w": 200, "h": 40,
             "shape": {"kind": "textBox", "text": null}},
            {"op": "addSlide", "layout": "Title Only", "after": null, "title": "Risks", "body": null},
            {"op": "formatText", "slide": 256, "shape": 2, "cell": null, "start": null, "end": null,
             "props": {"bold": true, "italic": null, "underline": null, "strike": null, "size": 28,
                       "color": "1F4E79", "font": null, "highlight": null, "baseline": null, "link": null}}
        ]
    }))
    .unwrap();
    assert_eq!(call.operations.len(), 4);
}

#[test]
fn unknown_operations_and_properties_are_rejected() {
    let bad_op = serde_json::from_value::<EditPresentation>(serde_json::json!({
        "documentId": "d", "operations": [{"op": "runMacro", "code": "x"}]
    }));
    assert!(bad_op.is_err());
    let bad_prop = serde_json::from_value::<EditPresentation>(serde_json::json!({
        "documentId": "d",
        "operations": [{"op": "formatText", "slide": 256, "shape": 2, "props": {"fontColor": "FF0000"}}]
    }));
    assert!(bad_prop.is_err());
}
