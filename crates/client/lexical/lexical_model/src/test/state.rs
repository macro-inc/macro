use super::*;
static FOLDED: StateKey<String> = StateKey::new("folded", |value| {
    value
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .into()
})
.with_is_equal(|a, b| a.eq_ignore_ascii_case(b));
#[test]
fn custom_state_equality_and_unknown_introspection() -> Result<(), Error> {
    assert_eq!(FOLDED.name(), "folded");
    assert!(FOLDED.is_equal(&"UP".into(), &"up".into()));
    assert_eq!(FOLDED.default_value(), "");
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("text")?;
        tx.set_state(t, &FOLDED, "UP".into())?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(t)
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.update_state(text, &FOLDED, |_| "up".into())?;
        assert!(!tx.is_dirty_leaf(text));
        let state = tx.node(text).and_then(NodeRef::node_state).expect("state");
        assert_eq!(state.known_names().collect::<Vec<_>>(), vec!["folded"]);
        assert!(state.unknown().is_none());
        assert_eq!(state, state);
        Ok(())
    })?;
    assert!(commit.is_noop());
    Ok(())
}
#[test]
fn import_filters_drop_unwanted_state_without_changing_unselected_fields() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let t = tx.create_text("original")?;
    let json = serde_json::json!({"type":"text","text":"imported","$":{"keep":1,"drop":2}});
    tx.update_from_json_with(
        t,
        json.as_object().expect("json"),
        JsonImport {
            state: StateImportFilter::Only(&["keep"]),
            base_fields: false,
            own_fields: false,
        },
    )?;
    assert_eq!(tx.text_content(t), "original");
    assert_eq!(
        tx.export_json(t)?.get("$"),
        Some(&serde_json::json!({"keep":1}))
    );
    let state = tx.node(t).and_then(NodeRef::node_state).expect("state");
    assert_eq!(
        state
            .unknown()
            .expect("unknown")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["keep"]
    );
    tx.update_from_json_with(
        t,
        json.as_object().expect("json"),
        JsonImport {
            state: StateImportFilter::None,
            base_fields: true,
            own_fields: false,
        },
    )?;
    assert_eq!(tx.text_content(t), "imported");
    assert!(!tx.export_json(t)?.contains_key("$"));
    Ok(())
}
#[test]
fn missing_mode_is_not_normalized_and_explicit_mode_clears_omission() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let state=editor.parse_editor_state_str(r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a"},{"type":"text","text":"b","mode":"normal"}]}]}}"#)?;
    editor.set_editor_state(state, TagSet::default())?;
    let texts = editor
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .collect::<Vec<_>>();
    editor.update(|tx| {
        tx.mark_type_dirty::<Text>()?;
        tx.flush()?;
        assert_eq!(tx.all_text_nodes(NodeKey::ROOT).collect::<Vec<_>>(), texts);
        assert!(!tx.is_simple_text(texts[0]));
        tx.text(texts[0])?.set_mode(TextMode::Normal)?;
        assert!(tx.is_simple_text(texts[0]));
        Ok(())
    })?;
    assert_eq!(editor.state().root_text_content().as_ref(), "ab");
    Ok(())
}

#[test]
fn nested_view_cache_uses_the_first_text_descendant() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .node::<Inline>()
        .build()
        .expect("builder");
    let ((p, first), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let link = tx.create(Inline::default())?;
        let first = tx.create_text("first")?;
        let second = tx.create_text("second")?;
        tx.text(first)?
            .set_format(TextFormat::BOLD)?
            .set_style("color: red")?;
        tx.text(second)?.set_format(TextFormat::ITALIC)?;
        tx.append(link, &[first.key()])?;
        tx.append(p, &[link.key(), second.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, first))
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.text(first)?.set_text_content("changed")?;
        Ok(())
    })?;
    assert_eq!(
        commit.next.view().element_data(p)?.text_format,
        TextFormat::BOLD
    );
    assert_eq!(
        commit.next.view().element_data(p)?.text_style.as_ref(),
        "color: red"
    );
    assert_eq!(commit.changes.mutations.len(), 1);
    Ok(())
}
