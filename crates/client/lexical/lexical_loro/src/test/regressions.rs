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
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let p = tx.import_node(
            json!({"type":"paragraph","version":1,"children":[],"$":{"floating":1.0}})
                .as_object()
                .expect("node"),
        )?;
        tx.append(NodeKey::ROOT, &[p])
    })?;
    let doc = new_doc(3)?;
    LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?
        .check(&doc, editor.state())
        .expect("JS integral numbers");
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

#[test]
fn all_three_item_permutations_keep_native_identity_including_stationary_non_lis_items()
-> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((a, b, c), _) = editor.update(|tx| {
        let a = tx.create(Paragraph::default())?;
        let b = tx.create(Paragraph::default())?;
        let c = tx.create(Paragraph::default())?;
        tx.set_state(a, &ID, "a".into())?;
        tx.set_state(b, &ID, "b".into())?;
        tx.set_state(c, &ID, "c".into())?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key(), c.key()])?;
        Ok((a, b, c))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let identities = [a, b, c].map(|key| {
        projection
            .container_of(key.key())
            .cloned()
            .expect("container")
    });
    for (i, order) in [
        [c, b, a],
        [a, b, c],
        [a, c, b],
        [b, a, c],
        [b, c, a],
        [c, a, b],
    ]
    .into_iter()
    .enumerate()
    {
        let (_, commit) = editor
            .update(|tx| tx.splice(NodeKey::ROOT, ChildIndex(0), 3, &order.map(|id| id.key())))?;
        projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, i as i64 + 1)?;
        projection.check(&doc, editor.state()).expect("permutation");
        for (key, identity) in [a, b, c].into_iter().zip(&identities) {
            assert_eq!(projection.container_of(key.key()), Some(identity));
        }
    }
    let (_, commit) = editor.update(|tx| tx.set_state(b, &ID, "changed-id".into()))?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 7)?;
    assert_eq!(projection.container_of(b.key()), Some(&identities[1]));
    assert_eq!(
        schema::children(&doc.get_map("root"))?
            .expect("children")
            .len(),
        3
    );
    projection
        .check(&doc, editor.state())
        .expect("id update in place");
    Ok(())
}

#[test]
fn idless_stored_highlight_edits_in_place_without_duplicating_its_native_map() -> Result<()> {
    let mut editor =
        lexical_rich_nodes::code::register_code_nodes(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let (highlight,_)=editor.update(|tx| {
        let code=tx.import_node(json!({"type":"code","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"code-highlight","version":1,"text":"const","format":0,"style":"","mode":"normal","detail":0,"highlightType":"keyword"}]}).as_object().expect("code"))?;
        tx.append(NodeKey::ROOT,&[code])?;
        Ok(tx.first_child(code).expect("highlight"))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let id = projection.container_of(highlight).cloned().expect("map");
    let (_, commit) =
        editor.update(|tx| tx.text(highlight)?.set_text_content("let").map(|_| ()))?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(projection.container_of(highlight), Some(&id));
    let root = doc.get_map("root");
    let code = schema::map_at(schema::children(&root)?.expect("children").get(0), "code")?;
    assert_eq!(schema::children(&code)?.expect("code children").len(), 1);
    projection
        .check(&doc, editor.state())
        .expect("idless highlight");
    Ok(())
}

#[test]
fn fixed_peers_and_explicit_timestamps_produce_identical_operations_and_snapshots() -> Result<()> {
    let mut outputs = Vec::new();
    for _ in 0..2 {
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
        let doc = new_doc(41)?;
        let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
        let (_, commit) = editor.update(|tx| {
            tx.select_end(text)?;
            tx.insert_text("é")
        })?;
        projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 123)?;
        let fork = fork_doc(&doc, 42)?;
        fork.get_map("meta").insert("fork", true)?;
        fork.commit_with(loro::CommitOptions::new().timestamp(124));
        outputs.push((
            doc.export(ExportMode::Snapshot)?,
            fork.export(ExportMode::Snapshot)?,
            serde_json::to_value(
                doc.export_json_updates(&loro::VersionVector::default(), &doc.oplog_vv())?,
            )
            .expect("JSON"),
        ));
    }
    assert_eq!(outputs[0], outputs[1]);
    Ok(())
}

#[test]
fn pure_remote_field_change_leaves_fresh_plain_composites_unmodified() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (p,_)=editor.update(|tx| {
        let p=tx.import_node(json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","children":[],"$":{"id":"p","sharedPeerIds":["a"]}}).as_object().expect("p"))?;
        tx.append(NodeKey::ROOT,&[p])?;Ok(p)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let map = projection.index.map(&doc, p)?;
    let state = schema::map_at(map.get("$"), "$")?;
    map.insert("indent", 1)?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
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
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 2)?.changed);
    assert!(matches!(
        state.get("sharedPeerIds"),
        Some(ValueOrContainer::Value(_))
    ));
    projection
        .check(&doc, core.state())
        .expect("pure field remote");
    Ok(())
}
