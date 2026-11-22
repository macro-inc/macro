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
        None,
        "eligible native structural text remains lazy until explicitly read"
    );
    assert_eq!(
        normal.state().view().foreign_root_cached_text()?.as_deref(),
        Some("child")
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

#[test]
fn first_paragraph_split_cache_work_is_independent_of_untouched_blocks() -> Result<(), Error> {
    use crate::test_work::Measurement;

    let mut rows = Vec::new();
    for blocks in [50, 500, 5000] {
        for warm_previous in [false, true] {
            let mut headless = Editor::builder(EditorMode::Headless)
                .build()
                .expect("editor");
            let mut tx = headless.transaction();
            let mut first = None;
            for _ in 0..blocks {
                let paragraph = tx.create(Paragraph::default())?;
                let text = tx.create_text("hello world")?;
                tx.append(paragraph, &[text.key()])?;
                tx.append(NodeKey::ROOT, &[paragraph.key()])?;
                first.get_or_insert((paragraph.key(), text.key()));
            }
            let (paragraph, text) = first.expect("nonempty fixture");
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(5)),
            ))))?;
            tx.commit()?;
            let previous = headless.state().clone();
            assert!(previous.root_text.get().is_none());
            if warm_previous {
                assert_eq!(
                    previous.root_text_content().as_ref(),
                    vec!["hello world"; blocks].join("\n\n")
                );
            }
            let mut attached = headless.create_conformance_peer(EditorMode::ViewAttached)?;
            attached.state = previous.clone();
            let measurement = Measurement::start();
            let (inserted, commit) = attached.update(|tx| tx.insert_paragraph())?;
            let visits = measurement.text_visits();
            drop(measurement);

            let inserted = inserted.expect("paragraph split");
            let view = commit.next.view();
            let mut expected_keys = previous.view().children_keys(NodeKey::ROOT)?;
            expected_keys.insert(1, inserted);
            assert_eq!(view.children_keys(NodeKey::ROOT)?, expected_keys);
            assert_eq!(view.children_size(NodeKey::ROOT), blocks as u32 + 1);
            assert_eq!(view.first_child(NodeKey::ROOT), Some(paragraph));
            assert_eq!(view.next_sibling(paragraph), Some(inserted));
            assert_eq!(view.first_child(paragraph), Some(text));
            assert_eq!(view.text_content(text), "hello");
            assert_eq!(view.text_content(inserted), " world");
            let tail = view.first_child(inserted).expect("trailing text");
            let Selection::Range(selection) = commit.next.selection().expect("range") else {
                panic!("paragraph split lost range selection");
            };
            assert_eq!(selection.anchor, Point::text(tail, Utf16Offset(0)));
            assert_eq!(selection.focus, selection.anchor);
            assert_eq!(
                commit.changes.dirty_elements.get(&NodeKey::ROOT),
                Some(&DirtyIntent::Intentional)
            );
            assert!(!Arc::ptr_eq(
                previous.nodes.get(&NodeKey::ROOT).expect("old root"),
                commit.next.nodes.get(&NodeKey::ROOT).expect("new root")
            ));
            let mut expected = vec!["hello".to_owned(), " world".to_owned()];
            expected.extend((1..blocks).map(|_| "hello world".to_owned()));
            assert_eq!(
                commit.next.root_text_content().as_ref(),
                expected.join("\n\n")
            );
            assert_eq!(
                previous.root_text_content().as_ref(),
                vec!["hello world"; blocks].join("\n\n")
            );
            rows.push((blocks, warm_previous, visits));
        }
    }
    eprintln!("cache split text visits: {rows:?}");
    assert!(
        rows.iter().all(|(_, _, visits)| *visits <= 32),
        "cache reconciliation traversed untouched blocks: {rows:?}"
    );
    Ok(())
}
