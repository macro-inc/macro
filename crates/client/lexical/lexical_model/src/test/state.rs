use super::*;
static FOLDED: StateKey<String> = StateKey::new("folded", |value| {
    value
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .into()
})
.with_is_equal(|a, b| a.eq_ignore_ascii_case(b));

#[test]
fn learned_state_import_order_is_scoped_to_editor_and_exact_class() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let json = serde_json::json!({"type":"text","text":"text","$":{"folded":"value","extra":1}});
    {
        let mut tx = editor.transaction();
        let first = tx.import_node(json.as_object().expect("node"))?;
        tx.set_state(first, &FOLDED, "updated".into())?;
        assert_eq!(
            to_js_json_string(&tx.export_json(first)?["$"]),
            r#"{"folded":"updated","extra":1}"#
        );
        let second = tx.import_node(json.as_object().expect("node"))?;
        assert_eq!(
            to_js_json_string(&tx.export_json(second)?["$"]),
            r#"{"extra":1,"folded":"value"}"#
        );
        let paragraph = tx.import_node(
            serde_json::json!({"type":"paragraph","$":{"folded":"value","extra":1}})
                .as_object()
                .expect("paragraph"),
        )?;
        assert_eq!(
            to_js_json_string(&tx.export_json(paragraph)?["$"]),
            r#"{"folded":"value","extra":1}"#
        );
    }
    // Shared configs survive a parse/update boundary, as upstream's registered-node map does.
    let raw: SerializedEditorState = serde_json::from_str(
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"text","$":{"folded":"value","extra":1}}]}]}}"#,
    )?;
    let state = editor.parse_editor_state(&raw)?;
    assert_eq!(
        to_js_json_string(&state.to_json()?.root["children"][0]["children"][0]["$"]),
        r#"{"extra":1,"folded":"value"}"#
    );
    let mut fresh = Editor::builder(EditorMode::Headless)
        .build()
        .expect("fresh builder");
    let state = fresh.parse_editor_state(&raw)?;
    assert_eq!(
        to_js_json_string(&state.to_json()?.root["children"][0]["children"][0]["$"]),
        r#"{"folded":"value","extra":1}"#
    );
    Ok(())
}
#[test]
fn state_reads_teach_later_imports_and_copy_on_write_prunes_known_slots() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let json = serde_json::json!({"type":"text","text":"text","$":{"folded":"value","extra":1}});
    let (first, _) = editor.update(|tx| {
        let first = tx.import_node(json.as_object().expect("node"))?;
        assert_eq!(tx.get_state(first, &FOLDED)?, "value");
        let second = tx.import_node(json.as_object().expect("node"))?;
        assert_eq!(
            to_js_json_string(&tx.export_json(second)?["$"]),
            r#"{"extra":1,"folded":"value"}"#
        );
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(paragraph, &[first, second])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(first)
    })?;
    let before = editor.state().clone();
    assert_eq!(
        to_js_json_string(&before.view().export_json(first)?["$"]),
        r#"{"folded":"value","extra":1}"#
    );
    editor.update(|tx| {
        tx.set_state(first, &FOLDED, "next".into())?;
        assert_eq!(
            to_js_json_string(&tx.export_json(first)?["$"]),
            r#"{"extra":1,"folded":"next"}"#
        );
        Ok(())
    })?;
    assert_eq!(
        to_js_json_string(&before.view().export_json(first)?["$"]),
        r#"{"folded":"value","extra":1}"#
    );
    Ok(())
}

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

#[test]
fn optional_state_preserves_inner_identity_and_omits_none() -> Result<(), Error> {
    use std::sync::Arc;
    static LOCAL: StateKey<Option<bool>> =
        StateKey::new("local", |value| value.and_then(serde_json::Value::as_bool));
    static PEERS: StateKey<Option<Arc<[String]>>> = StateKey::new("peers", |_| None);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.set_state(paragraph, &LOCAL, Some(false))?;
    let peers: Arc<[String]> = vec!["peer".to_owned()].into();
    tx.set_state(paragraph, &PEERS, Some(peers.clone()))?;
    let first = tx.commit()?;
    assert_eq!(
        first.next.view().export_json(paragraph)?["$"]["local"],
        false
    );
    let mut tx = editor.transaction();
    tx.update_state(paragraph, &PEERS, |_| Some(peers))?;
    assert!(tx.commit()?.is_noop());
    let mut tx = editor.transaction();
    tx.set_state(paragraph, &PEERS, Some(vec!["peer".to_owned()].into()))?;
    assert!(!tx.commit()?.is_noop());
    let mut tx = editor.transaction();
    tx.set_state(paragraph, &LOCAL, None)?;
    tx.set_state(paragraph, &PEERS, None)?;
    assert!(
        !tx.commit()?
            .next
            .view()
            .export_json(paragraph)?
            .contains_key("$")
    );
    Ok(())
}

#[test]
fn imported_text_format_names_and_undefined_style_reach_paragraph_export() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let input: SerializedEditorState = serde_json::from_value(
        serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"format":"unknown","children":[{"type":"text","version":1,"text":"text","format":"unknown","detail":0,"mode":"normal"}]}]}}),
    )?;
    let state = editor.parse_editor_state(&input)?;
    let output = serde_json::to_value(state.to_json()?)?;
    assert_eq!(output["root"]["children"][0]["format"], "");
    assert!(output["root"]["children"][0].get("textFormat").is_none());
    assert!(output["root"]["children"][0].get("textStyle").is_none());
    assert!(
        output["root"]["children"][0]["children"][0]
            .get("format")
            .is_none()
    );
    let mut named = input;
    named.root["children"][0]["children"][0]["format"] = serde_json::json!("bold");
    assert_eq!(
        serde_json::to_value(editor.parse_editor_state(&named)?.to_json()?)?["root"]["children"][0]
            ["textFormat"],
        1
    );
    Ok(())
}

#[test]
fn raw_remote_updates_retain_unchanged_typed_state_and_parse_real_changes() -> Result<(), Error> {
    use std::sync::Arc;
    static METADATA: StateKey<Arc<serde_json::Value>> = StateKey::new("metadata", |value| {
        Arc::new(match value {
            Some(value) if value.is_object() => serde_json::json!({
                "version": value.get("version").cloned().unwrap_or(serde_json::json!(-1)),
                "tags": value.get("tags").cloned().unwrap_or(serde_json::Value::Null),
            }),
            _ => serde_json::json!({"version": -1}),
        })
    });
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let value = Arc::new(serde_json::json!({"version":10}));
        tx.set_state(NodeKey::ROOT, &METADATA, value.clone())?;
        let original = tx.export_json(NodeKey::ROOT)?;
        let mut update = original.clone();
        update.insert("format".into(), serde_json::json!("right"));
        update
            .get_mut("$")
            .expect("state")
            .as_object_mut()
            .expect("object")
            .insert("future".into(), serde_json::json!({"keep":true}));
        tx.apply_remote_fields(NodeKey::ROOT, &update)?;
        assert!(Arc::ptr_eq(
            &tx.get_state(NodeKey::ROOT, &METADATA)?,
            &value
        ));
        assert_eq!(tx.export_json(NodeKey::ROOT)?, update);
        assert_eq!(tx.element_data(NodeKey::ROOT)?.format, ElementFormat::Right);
        update
            .get_mut("$")
            .expect("state")
            .as_object_mut()
            .expect("object")
            .insert("metadata".into(), serde_json::json!({"version":11}));
        tx.apply_remote_fields(NodeKey::ROOT, &update)?;
        assert_eq!(
            tx.get_state(NodeKey::ROOT, &METADATA)?.as_ref(),
            &serde_json::json!({"version":11,"tags":null})
        );
        assert_eq!(
            tx.export_json(NodeKey::ROOT)?["$"]["future"],
            serde_json::json!({"keep":true})
        );
        update
            .get_mut("$")
            .expect("state")
            .as_object_mut()
            .expect("object")
            .insert("metadata".into(), serde_json::Value::Null);
        tx.apply_remote_fields(NodeKey::ROOT, &update)?;
        assert_eq!(
            tx.get_state(NodeKey::ROOT, &METADATA)?.as_ref(),
            &serde_json::json!({"version":-1})
        );
        tx.set_state(NodeKey::ROOT, &METADATA, value.clone())?;
        update
            .get_mut("$")
            .expect("state")
            .as_object_mut()
            .expect("object")
            .remove("metadata");
        tx.apply_remote_fields(NodeKey::ROOT, &update)?;
        assert!(Arc::ptr_eq(
            &tx.get_state(NodeKey::ROOT, &METADATA)?,
            METADATA.default_value()
        ));
        tx.apply_remote_fields(NodeKey::ROOT, &update)?;
        assert!(Arc::ptr_eq(
            &tx.get_state(NodeKey::ROOT, &METADATA)?,
            METADATA.default_value()
        ));
        // The default is omitted by export. An explicitly supplied default-shaped
        // object is new input, even though it equals the default's serialization.
        update
            .get_mut("$")
            .expect("state")
            .as_object_mut()
            .expect("object")
            .insert("metadata".into(), serde_json::json!({"version":-1}));
        tx.apply_remote_fields(NodeKey::ROOT, &update)?;
        assert_eq!(
            tx.get_state(NodeKey::ROOT, &METADATA)?.as_ref(),
            &serde_json::json!({"version":-1,"tags":null})
        );
        tx.set_state(NodeKey::ROOT, &METADATA, value)?;
        // Ordinary JSON import must still invoke the source parser even for identical JSON.
        tx.update_from_json(NodeKey::ROOT, &original)?;
        assert_eq!(
            tx.get_state(NodeKey::ROOT, &METADATA)?.as_ref(),
            &serde_json::json!({"version":10,"tags":null})
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn raw_remote_state_import_keeps_flat_precedence_and_removal() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Stateful>()
        .build()
        .expect("builder");
    editor.update(|tx| {
        let node = tx.create(Stateful::default())?;
        tx.set_state(node, &NOTE, "flat".into())?;
        let array: std::sync::Arc<[String]> = vec!["nested".to_owned()].into();
        tx.set_state(node, &ARRAY, array.clone())?;
        tx.apply_remote_fields(node, serde_json::json!({"type":"stateful","note":"flat","$":{"note":"shadowed","array":["nested"],"future":7}}).as_object().expect("object"))?;
        assert_eq!(tx.get_state(node, &NOTE)?, "flat");
        assert!(std::sync::Arc::ptr_eq(&tx.get_state(node, &ARRAY)?, &array));
        assert_eq!(tx.export_json(node)?["$"], serde_json::json!({"array":["nested"],"future":7}));
        tx.apply_remote_fields(node, serde_json::json!({"type":"stateful","$":{"note":"nested","array":["changed"]}}).as_object().expect("object"))?;
        assert_eq!(tx.get_state(node, &NOTE)?, "nested");
        assert_eq!(tx.get_state(node, &ARRAY)?.as_ref(), &["changed".to_owned()]);
        tx.apply_remote_fields(node, serde_json::json!({"type":"stateful"}).as_object().expect("object"))?;
        assert_eq!(tx.get_state(node, &NOTE)?, "");
        assert!(std::sync::Arc::ptr_eq(&tx.get_state(node, &ARRAY)?, ARRAY.default_value()));
        assert!(!tx.export_json(node)?.contains_key("$"));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn raw_remote_state_distinguishes_signed_zero_inside_objects_and_arrays() -> Result<(), Error> {
    use std::sync::Arc;
    static JSON: StateKey<Arc<serde_json::Value>> = StateKey::new("json", |value| {
        Arc::new(value.cloned().unwrap_or(serde_json::Value::Null))
    });
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        tx.set_state(NodeKey::ROOT, &JSON, Arc::new(serde_json::json!(-0.0)))?;
        tx.apply_remote_fields(
            NodeKey::ROOT,
            serde_json::json!({"type":"root","$":{"json":0.0}})
                .as_object()
                .expect("object"),
        )?;
        assert_eq!(
            tx.get_state(NodeKey::ROOT, &JSON)?
                .as_f64()
                .expect("number")
                .to_bits(),
            0.0_f64.to_bits()
        );
        tx.set_state(
            NodeKey::ROOT,
            &JSON,
            Arc::new(serde_json::json!({"values":[-0.0],"keep":true})),
        )?;
        tx.apply_remote_fields(
            NodeKey::ROOT,
            serde_json::json!({"type":"root","$":{"json":{"values":[0.0],"keep":true}}})
                .as_object()
                .expect("object"),
        )?;
        assert_eq!(
            tx.get_state(NodeKey::ROOT, &JSON)?["values"][0]
                .as_f64()
                .expect("number")
                .to_bits(),
            0.0_f64.to_bits()
        );
        let stored = tx.get_state(NodeKey::ROOT, &JSON)?;
        tx.apply_remote_fields(
            NodeKey::ROOT,
            serde_json::json!({"type":"root","$":{"json":{"keep":true,"values":[0.0]}}})
                .as_object()
                .expect("object"),
        )?;
        assert!(Arc::ptr_eq(&stored, &tx.get_state(NodeKey::ROOT, &JSON)?));
        Ok(())
    })?;
    Ok(())
}
