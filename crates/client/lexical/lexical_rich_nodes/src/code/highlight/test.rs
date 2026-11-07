use super::*;
#[test]
fn stored_highlights_round_trip_without_tokenizing_or_merging() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let json = r#"{"root":{"children":[{"children":[{"detail":1,"format":0,"mode":"normal","style":"color:red","text":"let","type":"code-highlight","version":1,"$":{"marker":3},"highlightType":"keyword"},{"detail":0,"format":0,"mode":"normal","style":"","text":"x","type":"code-highlight","version":1,"highlightType":"variable"}],"direction":null,"format":"","indent":0,"type":"code","version":1,"language":"rust"}],"direction":null,"format":"","indent":0,"type":"root","version":1}}"#;
    let state = editor.parse_editor_state_str(json)?;
    assert_eq!(
        to_js_json_string(&serde_json::to_value(state.to_json()?).unwrap()),
        json
    );
    editor.set_editor_state(state, TagSet::default())?;
    editor.update(|tx| {
        let code = tx.first_child(NodeKey::ROOT).unwrap();
        let first = tx.first_child(code).unwrap();
        assert!(is_code_highlight_node(tx, first));
        assert!(!tx.is_simple_text(first));
        tx.text(first)?.set_format(TextFormat::BOLD)?;
        assert_eq!(tx.text_data(first)?.format, TextFormat::empty());
        Ok(())
    })?;
    let code = editor.state().view().first_child(NodeKey::ROOT).unwrap();
    assert_eq!(editor.state().view().children_size(code), 2);
    Ok(())
}
#[test]
fn importing_highlight_forces_zero_format_and_orphans_become_plain_text() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let highlight = tx.import_node(serde_json::json!({"type":"code-highlight","version":1,"text":"stored","format":3,"detail":0,"mode":"normal","style":"color:red","highlightType":"keyword"}).as_object().unwrap())?;
        assert_eq!(tx.text_data(highlight)?.format, TextFormat::empty());
        assert!(tx.is_parent_required(highlight));
        let wrapper = tx.create_parent_element(highlight)?;
        assert!(tx.is::<CodeNode>(wrapper));
        tx.append(paragraph, &[highlight])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(())
    })?;
    let view = editor.state().view();
    let plain = view.first_descendant(NodeKey::ROOT).unwrap();
    assert_eq!(view.type_name(plain)?, "text");
    assert_eq!(view.text_content(plain), "stored");
    assert_eq!(view.text_data(plain)?.style.as_ref(), "");
    Ok(())
}
