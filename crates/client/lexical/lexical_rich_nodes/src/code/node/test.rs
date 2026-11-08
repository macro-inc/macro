use super::*;
#[test]
fn code_payload_normalizes_optional_fields_and_exposes_language_metadata() -> crate::Result<()> {
    assert_eq!(crate::code::get_default_code_language(), "javascript");
    let mut code = CodeNode::default();
    code.set_language(Some("rust"));
    code.set_theme(Some("dark"));
    assert_eq!(code.language(), Some("rust"));
    assert_eq!(code.theme(), Some("dark"));
    code.set_language(Some(""));
    code.set_theme(None);
    assert_eq!(code.language(), None);
    assert_eq!(code.theme(), None);
    let imported: CodeNode = serde_json::from_str(r#"{"language":null,"theme":""}"#).unwrap();
    assert_eq!(serde_json::to_string(&imported).unwrap(), "{}");
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code =
            create_code_node(tx, Some("rust"), Some("dark")).map_err(|error| match error {
                crate::Error::Model(error) => error,
            })?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        assert!(is_code_node(tx, code.key()));
        assert!(!tx.can_indent(code));
        assert!(tx.has_language_field(code));
        Ok(())
    })?;
    assert_eq!(
        editor.state().to_json()?.root["children"][0],
        serde_json::json!({"children":[],"direction":null,"format":"","indent":0,"type":"code","version":1,"language":"rust","theme":"dark"})
    );
    Ok(())
}
#[test]
fn collapsing_code_preserves_children_in_a_paragraph() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        let text = tx.create_text("let x = 1;")?;
        tx.append(code, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(text)?;
        assert!(tx.collapse_at_start(code, SelectionSlot::Active)?);
        let paragraph = tx.parent_or_err(text)?;
        assert!(tx.is::<Paragraph>(paragraph));
        assert_eq!(tx.text_content(paragraph), "let x = 1;");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn enter_copies_plain_indentation_and_exits_after_two_empty_lines() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        let text = tx.create_text("  abc")?;
        tx.append(code, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_end(text)?;
        assert_eq!(
            tx.insert_new_after(code, SelectionSlot::Active, true)?,
            None
        );
        assert_eq!(tx.text_content(code), "  abc\n  ");
        assert_eq!(tx.anchor()?.offset(), 2);
        assert_eq!(tx.type_name(tx.anchor()?.key())?, "text");
        let first = tx.create(LineBreak {})?;
        let second = tx.create(LineBreak {})?;
        tx.append(code, &[first.key(), second.key()])?;
        let point = Point::element(code, ChildIndex(tx.children_size(code)));
        tx.set_selection(Some(Selection::Range(RangeSelection::new(point, point))))?;
        let paragraph = tx
            .insert_new_after(code, SelectionSlot::Active, true)?
            .unwrap();
        assert!(tx.is::<Paragraph>(paragraph));
        assert_eq!(tx.text_content(code), "  abc\n  ");
        assert_eq!(tx.anchor()?, Point::element(paragraph, ChildIndex(0)));
        Ok(())
    })?;
    Ok(())
}
#[test]
fn empty_code_enter_keeps_an_element_point() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(code)?;
        assert_eq!(
            tx.insert_new_after(code, SelectionSlot::Active, true)?,
            None
        );
        assert_eq!(tx.text_content(code), "\n");
        assert_eq!(tx.anchor()?, Point::element(code, ChildIndex(1)));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn paragraph_command_preserves_code_indentation_at_middle_and_end() -> Result<(), Error> {
    for (offset, expected) in [(3, "  a\n  bc"), (5, "  abc\n  ")] {
        let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
            .build()
            .unwrap();
        editor.update(|tx| {
            let code = tx.create(CodeNode::default())?;
            let text = tx.create_text("  abc")?;
            tx.append(code, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[code.key()])?;
            tx.select_start(text)?;
            tx.set_text_node_range(text, Utf16Offset(offset), text, Utf16Offset(offset))?;
            assert_eq!(tx.insert_paragraph()?, None);
            assert_eq!(tx.text_content(code), expected);
            assert_eq!(tx.children_size(NodeKey::ROOT), 1);
            Ok(())
        })?;
    }
    Ok(())
}
