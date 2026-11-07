use super::*;
use lexical_model::*;
use loro::ExportMode;
use serde_json::json;
static PLAIN: PlainPolicy = PlainPolicy;
static ID: StateKey<String> = StateKey::new("id", |v| {
    v.and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned()
});

#[test]
fn literal_local_text_fields_container_kinds_and_cursor_roundtrip() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((p, t), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("a😀b")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_state(p, &ID, "p".into())?;
        tx.set_state(t, &ID, "t".into())?;
        tx.text(t)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok((p, t))
    })?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    assert_eq!(
        reconstruct_state(&doc, &PLAIN)?,
        synced_json(editor.state(), &PLAIN)?
    );
    projection.check(&doc, editor.state()).expect("consistent");
    let root = doc.get_map("root");
    assert!(matches!(
        root.get("children"),
        Some(ValueOrContainer::Container(Container::MovableList(_)))
    ));
    let textmap = projection.index.map(&doc, t.key())?;
    assert!(matches!(
        textmap.get("text"),
        Some(ValueOrContainer::Container(Container::Text(_)))
    ));
    assert!(matches!(
        textmap.get("$"),
        Some(ValueOrContainer::Container(Container::Map(_)))
    ));
    let cursors = projection
        .cursor(
            &doc,
            editor.state(),
            editor.state().selection().expect("selection"),
        )
        .expect("cursors");
    assert_eq!(
        projection.point(&doc, editor.state(), &cursors.anchor),
        Some(Point::text(t, Utf16Offset(3)))
    );
    assert_eq!(
        decode_selection(&encode_selection(&cursors)),
        Some(cursors.clone())
    );
    assert!(decode_selection(&loro::LoroValue::Null).is_none());
    let before = doc.oplog_vv();
    let (_, commit) = editor.update(|tx| tx.insert_text("é"))?;
    let result = projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 12)?;
    assert!(result.changed);
    assert_eq!(result.stats.text_splices, 1);
    assert!(result.stats.nodes_visited <= 3);
    assert_ne!(before, doc.oplog_vv());
    assert_eq!(
        schema::read_value(&textmap.get("text").expect("text"))?,
        json!("a😀éb")
    );
    projection.check(&doc, editor.state()).expect("consistent");
    projection
        .check_nodes(&doc, editor.state(), &[t.key()])
        .expect("incremental");
    let (_, commit) = editor.update(|tx| {
        tx.text(t)?.set_format(TextFormat::BOLD)?;
        tx.element(p)?.set_format(ElementFormat::Center)?;
        Ok(())
    })?;
    assert!(projection.local(&doc, &[commit], 13)?.is_some());
    projection.check(&doc, editor.state()).expect("consistent");
    let (_, noop) = editor.update(|_| Ok(()))?;
    assert!(projection.local(&doc, &[noop], 14)?.is_none());
    assert!(
        projection
            .take_remote(&doc, editor.state())?
            .changes
            .is_empty()
    );
    let fork = fork_doc(&doc, 8)?;
    assert_eq!(doc.get_deep_value(), fork.get_deep_value());
    Ok(())
}

#[test]
fn delete_then_move_reversals_and_cross_parent_moves_keep_correct_native_items() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((a, b, c, left, right, t), _) = editor.update(|tx| {
        let a = tx.create(Paragraph::default())?;
        let b = tx.create(Paragraph::default())?;
        let c = tx.create(Paragraph::default())?;
        let left = tx.create(Paragraph::default())?;
        let right = tx.create(Paragraph::default())?;
        let t = tx.create_text("move")?;
        tx.set_state(a, &ID, "a".into())?;
        tx.set_state(b, &ID, "b".into())?;
        tx.set_state(c, &ID, "c".into())?;
        tx.set_state(t, &ID, "t".into())?;
        tx.append(left, &[t.key()])?;
        tx.append(
            NodeKey::ROOT,
            &[a.key(), b.key(), c.key(), left.key(), right.key()],
        )?;
        Ok((a, b, c, left, right, t))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let old_b = projection.container_of(b.key()).cloned();
    let old_c = projection.container_of(c.key()).cloned();
    let old_text = projection.container_of(t.key()).cloned();
    let (_, commit) = editor.update(|tx| {
        tx.remove(a, true)?;
        tx.insert_before(b, c, true)?;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    projection
        .check(&doc, editor.state())
        .expect("move after deletion");
    assert_eq!(projection.container_of(b.key()), old_b.as_ref());
    assert_eq!(projection.container_of(c.key()), old_c.as_ref());
    assert!(projection.container_of(a.key()).is_none());
    let (_, commit) = editor.update(|tx| {
        tx.append(right, &[t.key()])?;
        tx.insert_before(c, right, true)?;
        tx.insert_before(c, left, true)?;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 2)?;
    projection
        .check(&doc, editor.state())
        .expect("cross-parent");
    assert_ne!(projection.container_of(t.key()), old_text.as_ref());
    let (_, commit) = editor.update(|tx| {
        tx.splice(
            NodeKey::ROOT,
            ChildIndex(0),
            4,
            &[b.key(), c.key(), left.key(), right.key()],
        )
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 3)?;
    projection
        .check(&doc, editor.state())
        .expect("reverse reorder");
    Ok(())
}

#[test]
fn remote_utf16_splices_apply_without_echo_and_missing_created_binding_is_an_error() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (t, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("a😀b")?;
        tx.set_state(t, &ID, "t".into())?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(t)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok(t)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let remote = fork_doc(&doc, 2)?;
    let baseline = remote.oplog_vv();
    let map = projection.index.map(&remote, t.key())?;
    let Container::Text(text) = map
        .get("text")
        .expect("text")
        .as_container()
        .expect("container")
        .clone()
    else {
        panic!("text")
    };
    text.delete(1, 1)?;
    text.insert(1, "é")?;
    remote.commit_with(loro::CommitOptions::new().timestamp(1));
    let bytes = remote.export(ExportMode::updates(&baseline))?;
    let (_, changes) = projection.remote(&doc, editor.state(), &bytes)?;
    assert!(changes.changes.iter().any(|c|matches!(c,NodeChange::SpliceText{range,..} if range.start==Utf16Offset(1)&&range.end==Utf16Offset(3))));
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core
        .apply(
            Input::ApplyRemote {
                changes: changes.changes.clone(),
                options: UpdateOptions {
                    skip_transforms: false,
                    tags: TagSet::from_tags([
                        UpdateTag::Collaboration,
                        UpdateTag::Custom("from-loro".into()),
                    ]),
                },
            },
            HistoryTime(1),
        )
        .expect("remote apply");
    projection.bind_created(changes, &[])?;
    assert_eq!(core.state().view().text_content(t), "aéb");
    projection.check(&doc, core.state()).expect("consistent");
    assert!(
        !projection
            .local_commit(&doc, &output.commits, FIXUP_ORIGIN, 1)?
            .changed
    );
    assert!(
        projection
            .take_remote(&doc, core.state())?
            .changes
            .is_empty()
    );
    let before = remote.oplog_vv();
    let list = schema::children(&remote.get_map("root"))?.expect("children");
    let fresh = list.insert_container(list.len(), LoroMap::new())?;
    schema::initialize_map(&fresh,json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[]}).as_object().expect("json"),schema::MapSchema::Node)?;
    remote.commit_with(loro::CommitOptions::new().timestamp(2));
    let (_, changes) = projection.remote(
        &doc,
        core.state(),
        &remote.export(ExportMode::updates(&before))?,
    )?;
    assert!(matches!(
        projection.bind_created(changes, &[]),
        Err(ProjectionError::Diverged { .. })
    ));
    Ok(())
}

#[test]
fn text_splices_match_native_update_operations_for_single_and_multiple_regions() -> Result<()> {
    for (old, new) in [
        ("a😀b", "a😀éb"),
        ("abc😀xyz", "aBc😀xyZ"),
        ("a😀b", "ab"),
        ("old", "new"),
        ("", "😀"),
    ] {
        let doc = new_doc(1)?;
        doc.get_text("text").insert(0, old)?;
        doc.commit_with(loro::CommitOptions::new().timestamp(0));
        let peer = fork_doc(&doc, 1)?;
        let mut stats = ProjectionStats::default();
        schema::splice_text(&doc.get_text("text"), old, new, &mut stats)?;
        doc.commit_with(loro::CommitOptions::new().timestamp(1));
        peer.get_text("text").update(
            new,
            loro::UpdateOptions {
                timeout_ms: None,
                use_refined_diff: true,
            },
        )?;
        peer.commit_with(loro::CommitOptions::new().timestamp(1));
        assert_eq!(
            serde_json::to_value(
                doc.export_json_updates(&loro::VersionVector::default(), &doc.oplog_vv())?
            )
            .expect("JSON ops"),
            serde_json::to_value(
                peer.export_json_updates(&loro::VersionVector::default(), &peer.oplog_vv())?
            )
            .expect("JSON ops")
        );
    }
    Ok(())
}

#[test]
fn initial_schema_and_plain_text_cursor_errors_remain_explicit() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let doc = new_doc(1)?;
    doc.get_map("root")
        .insert("children", loro::LoroValue::List(Vec::new().into()))?;
    assert!(matches!(
        reconstruct_state(&doc, &PLAIN),
        Err(ProjectionError::Schema { .. })
    ));
    assert!(LoroProjection::attach(&doc, editor.state(), &PLAIN).is_err());
    assert!(LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0).is_err());
    assert_eq!(
        local::lis(&[3, 1, 2, 0]).into_iter().collect::<Vec<_>>(),
        vec![2, 1]
    );
    Ok(())
}
mod fields;
