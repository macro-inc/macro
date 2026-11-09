use crate::*;
use std::sync::{Arc, Mutex};

#[test]
fn lazy_previous_and_pending_text_caches_retain_current_callback_provenance() -> Result<(), Error> {
    struct Hooks {
        origin: Arc<Mutex<Option<(ForeignEditorIdentity, ForeignUpdateIdentity)>>>,
        observations: Arc<Mutex<Vec<(u32, bool)>>>,
    }
    impl ForeignHooks for Hooks {
        fn is_inline(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            if let Some((owner, update)) = self.origin.lock().expect("origin").clone() {
                let snapshot = node.state.snapshot_for_foreign_read().expect("capture");
                let indent = node.state.element_data(node.key).expect("element").indent;
                self.observations
                    .lock()
                    .expect("observations")
                    .push((indent, snapshot.matches_origin(&owner, &update)));
            }
            Override::Value(false)
        }
    }
    let origin = Arc::new(Mutex::new(None));
    let observations = Arc::new(Mutex::new(Vec::new()));
    let mut headless = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "cache-element".into(),
            class_name: "CacheElement".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                origin: origin.clone(),
                observations: observations.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = headless.transaction();
    let key = tx.create_foreign("cache-element", SerializedNode::new())?;
    tx.set_indent(key, 3)?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    assert!(headless.state.root_text.get().is_none());
    // An uncomputed previous memo is valid, including a state seeded from headless.
    let mut attached = headless.create_conformance_peer(EditorMode::ViewAttached)?;
    attached.state = headless.state.clone();
    let mut tx = attached.transaction();
    *origin.lock().expect("origin") =
        Some((tx.foreign_editor_identity(), tx.foreign_update_identity()));
    tx.set_indent(key, 4)?;
    tx.commit()?;
    let observed = observations.lock().expect("observations");
    assert!(
        observed.contains(&(3, true)),
        "previous graph was read: {observed:?}"
    );
    assert!(
        observed.contains(&(4, true)),
        "pending graph was read: {observed:?}"
    );
    assert!(observed.iter().all(|(_, matches)| *matches));
    assert!(headless.state.root_text.get().is_some());
    assert!(attached.state.root_text.get().is_some());
    Ok(())
}

#[test]
fn external_reconciler_owns_root_and_element_cache_writes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .without_reconciler_caches()
        .build()
        .expect("external reconciler");
    let ((p, t), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("child")?;
        tx.text(t)?
            .set_format(TextFormat::BOLD)?
            .set_style("color:red")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), t.key()))
    })?;
    editor.update(|tx| {
        tx.text(t)?
            .set_format(TextFormat::BOLD | TextFormat::ITALIC)?
            .set_style("color:blue")?;
        Ok(())
    })?;
    assert_eq!(
        editor.state().view().element_data(p)?.text_format,
        TextFormat::empty()
    );
    assert_eq!(
        editor.state().view().element_data(p)?.text_style.as_ref(),
        ""
    );
    assert_eq!(
        editor
            .state()
            .view()
            .node_or_err(NodeKey::ROOT)?
            .foreign_raw_root_cached_text(),
        None
    );
    editor.update(|tx| {
        tx.mark_dirty(p)?;
        // A JS virtual setter may deliberately choose a different cache value.
        tx.patch_foreign_base(
            p,
            ForeignBaseField::TextFormat(TextFormat::SUBSCRIPT.bits()),
        )?;
        tx.patch_foreign_base(p, ForeignBaseField::TextStyle("font-weight:normal".into()))?;
        Ok(())
    })?;
    assert_eq!(
        editor.state().view().element_data(p)?.text_format,
        TextFormat::SUBSCRIPT
    );
    assert_eq!(
        editor.state().view().element_data(p)?.text_style.as_ref(),
        "font-weight:normal"
    );
    assert_eq!(
        editor.state().view().text_data(t)?.format,
        TextFormat::BOLD | TextFormat::ITALIC
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "child");
    let mut normal = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("native reconciler");
    let ((p, t), _) = normal.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("child")?;
        tx.text(t)?
            .set_format(TextFormat::BOLD)?
            .set_style("color:red")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), t.key()))
    })?;
    normal.update(|tx| {
        tx.text(t)?
            .set_format(TextFormat::BOLD | TextFormat::ITALIC)?
            .set_style("color:blue")?;
        Ok(())
    })?;
    assert_eq!(
        normal.state().view().element_data(p)?.text_format,
        TextFormat::BOLD | TextFormat::ITALIC
    );
    assert_eq!(
        normal.state().view().element_data(p)?.text_style.as_ref(),
        "color:blue"
    );
    assert_eq!(
        normal
            .state()
            .view()
            .node_or_err(NodeKey::ROOT)?
            .foreign_raw_root_cached_text(),
        Some("child")
    );
    Ok(())
}
