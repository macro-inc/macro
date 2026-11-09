use super::*;
use std::sync::Arc;

#[test]
fn unit_marker_projections_accept_foreign_fields_for_each_kind() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "unit-element".into(),
            class_name: "UnitElement".into(),
            kind: NodeKind::Element,
            extends: None,
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .foreign_node(ForeignNodeType {
            type_name: "unit-text".into(),
            class_name: "UnitText".into(),
            kind: NodeKind::Text,
            extends: None,
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .foreign_node(ForeignNodeType {
            type_name: "unit-decorator".into(),
            class_name: "UnitDecorator".into(),
            kind: NodeKind::Decorator,
            extends: None,
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .foreign_node(ForeignNodeType {
            type_name: "unit-linebreak".into(),
            class_name: "UnitLineBreak".into(),
            kind: NodeKind::LineBreak,
            extends: None,
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let element = tx.create_foreign(
        "unit-element",
        serde_json::json!({"custom": "element"})
            .as_object()
            .expect("object")
            .clone(),
    )?;
    assert!(tx.view().can_be_empty(element));
    tx.set_indent(element, 2)?;
    assert_eq!(tx.view().indent(element), 2);
    assert_eq!(tx.view().export_json(element)?["custom"], "element");
    let text = tx.create_foreign(
        "unit-text",
        serde_json::json!({"custom": "text"})
            .as_object()
            .expect("object")
            .clone(),
    )?;
    tx.text(text)?.set_text_content("content")?;
    assert_eq!(tx.view().text_content(text), "content");
    assert_eq!(tx.view().export_json(text)?["custom"], "text");
    let decorator = tx.create_foreign(
        "unit-decorator",
        serde_json::json!({"custom": "decorator"})
            .as_object()
            .expect("object")
            .clone(),
    )?;
    assert!(tx.view().is_inline(decorator));
    assert_eq!(tx.view().text_content(decorator), "");
    assert_eq!(tx.view().export_json(decorator)?["custom"], "decorator");
    tx.set_foreign_field(decorator, "custom", serde_json::json!("updated"))?;
    assert_eq!(tx.view().export_json(decorator)?["custom"], "updated");
    let linebreak = tx.create_foreign(
        "unit-linebreak",
        serde_json::json!({"custom": "linebreak"})
            .as_object()
            .expect("object")
            .clone(),
    )?;
    assert!(tx.view().is_inline(linebreak));
    assert_eq!(tx.view().text_content(linebreak), "\n");
    assert_eq!(tx.view().export_json(linebreak)?["custom"], "linebreak");
    tx.set_foreign_field(linebreak, "custom", serde_json::json!("updated break"))?;
    assert_eq!(tx.view().export_json(linebreak)?["custom"], "updated break");
    Ok(())
}
