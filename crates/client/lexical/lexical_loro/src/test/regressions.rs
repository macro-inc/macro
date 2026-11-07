use super::peers::apply_remote;
use super::*;

#[test]
fn buffered_text_replacement_discards_superseded_deltas_and_preserves_newer_fields() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀b")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let map = projection.index.map(&doc, text.key())?;
    let Container::Text(old) = map
        .get("text")
        .expect("text")
        .as_container()
        .expect("container")
        .clone()
    else {
        panic!("text")
    };
    old.insert(1, "old")?;
    doc.commit_with(loro::CommitOptions::new().origin("other").timestamp(1));
    let replacement = map.insert_container("text", loro::LoroText::new())?;
    replacement.insert(0, "newé😀")?;
    map.insert("future", schema::to_loro(&json!({"new":true})))?;
    doc.commit_with(loro::CommitOptions::new().origin("other").timestamp(2));
    assert!(
        projection
            .check_nodes(&doc, editor.state(), &[text.key()])
            .is_err()
    );
    let changes = projection.take_remote(&doc, editor.state())?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 3)?.changed);
    assert_eq!(core.state().view().text_content(text), "newé😀");
    assert_eq!(
        schema::read_value(&map.get("future").expect("future"))?,
        json!({"new":true})
    );
    // Known types cannot re-export unknown own fields. Keep the strict checker
    // honest rather than dropping newer data or masking its mismatch.
    assert!(projection.check(&doc, core.state()).is_err());
    Ok(())
}
#[test]
fn buffered_text_batches_compose_unicode_positions_and_create_nested_nodes() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀b")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let map = projection.index.map(&doc, text.key())?;
    let Container::Text(native) = map
        .get("text")
        .expect("text")
        .as_container()
        .expect("container")
        .clone()
    else {
        panic!("text")
    };
    native.insert(2, "é")?;
    doc.commit_with(loro::CommitOptions::new().origin("other").timestamp(1));
    native.delete(1, 1)?;
    doc.commit_with(loro::CommitOptions::new().origin("other").timestamp(2));
    let root_children = schema::children(&doc.get_map("root"))?.expect("children");
    let fresh = root_children.insert_container(1, LoroMap::new())?;
    schema::initialize_map(&fresh, json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","children":[{"type":"text","version":1,"text":"remote","format":0,"detail":0,"mode":"normal","style":""}]}).as_object().expect("node"), schema::MapSchema::Node)?;
    doc.commit_with(loro::CommitOptions::new().origin("other").timestamp(3));
    let changes = projection.take_remote(&doc, editor.state())?;
    assert_eq!(
        changes
            .changes
            .iter()
            .filter(|c| matches!(c, NodeChange::Create { .. }))
            .count(),
        2
    );
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 4)?.changed);
    assert_eq!(core.state().view().text_content(text), "aéb");
    projection.check(&doc, core.state()).expect("consistent");
    Ok(())
}
#[test]
fn typed_slots_reject_wrong_containers_and_js_integral_numbers_use_i64() -> Result<()> {
    assert!(matches!(
        schema::to_loro(&json!(1.0)),
        loro::LoroValue::I64(1)
    ));
    assert!(matches!(
        schema::to_loro(&json!(1.5)),
        loro::LoroValue::Double(_)
    ));
    assert!(matches!(
        schema::to_loro(&json!(9223372036854775808u64)),
        loro::LoroValue::Double(_)
    ));
    for slot in ["$", "text", "ids", "children"] {
        let doc = new_doc(1)?;
        doc.get_map("root")
            .insert_container(slot, loro::LoroText::new())?;
        if slot == "text" {
            doc.get_map("root")
                .insert_container(slot, loro::LoroList::new())?;
        }
        assert!(
            matches!(
                reconstruct_state(&doc, &PLAIN),
                Err(ProjectionError::Schema { .. })
            ),
            "{slot}"
        );
    }
    Ok(())
}
#[test]
fn dirty_without_synced_changes_retains_plain_composites_and_writes_nothing() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (p, _) = editor.update(|tx| {
        let p = tx.import_node(json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[],"$":{"settings":{"x":1}}}).as_object().expect("node"))?;
        tx.append(NodeKey::ROOT, &[p])?;
        Ok(p)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let (_, commit) = editor.update(|tx| tx.mark_dirty(p))?;
    assert!(
        !projection
            .local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?
            .changed
    );
    let map = projection.index.map(&doc, p)?;
    let state = schema::map_at(map.get("$"), "$")?;
    assert!(matches!(
        state.get("settings"),
        Some(ValueOrContainer::Value(_))
    ));
    Ok(())
}
#[test]
fn typing_in_half_megabyte_document_does_not_scan_sibling_children() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let mut last = None;
        for _ in 0..2048 {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text(&"x".repeat(256))?;
            tx.append(p, &[t.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            last = Some(t);
        }
        Ok(last.expect("text"))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let (_, commit) = editor.update(|tx| {
        tx.select_end(text)?;
        tx.insert_text("a")
    })?;
    let result = projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(result.stats.children_scanned, 0);
    assert!(result.stats.nodes_visited <= 3, "{:?}", result.stats);
    projection.check(&doc, editor.state()).expect("consistent");
    Ok(())
}
