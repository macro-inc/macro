use super::*;
use serde_json::json;
#[test]
fn registered_tab_limits_indent_before_rich_text_and_inserts_a_real_tab() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut r = Replayer::default();
    r.rich_text_registered = true;
    register(&mut r, &json!([{"$ed":0},2]))?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("ab")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    assert!(dispatch(
        &r,
        &mut tx,
        "KEY_TAB_COMMAND",
        &json!({"shiftKey":false})
    )?);
    assert_eq!(tx.indent(p), 1);
    assert!(dispatch(
        &r,
        &mut tx,
        "INDENT_CONTENT_COMMAND",
        &Value::Null
    )?);
    assert_eq!(tx.indent(p), 1);
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    assert!(dispatch(
        &r,
        &mut tx,
        "KEY_TAB_COMMAND",
        &json!({"shiftKey":false})
    )?);
    assert_eq!(tx.text_content(p), "a\tb");
    assert!(tx.children_keys(p)?.iter().any(|key| tx.is::<Tab>(*key)));
    assert!(register(&mut r, &json!([{"$ed":1}])).is_err());
    Ok(())
}
