use super::hooks::{AssignIds, Ids};
use super::peers::apply_remote;
use super::*;

#[test]
fn native_undo_reverts_only_own_edits_and_excludes_remote_fixups() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("base")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let mut undo = loro::UndoManager::new(&doc);
    undo.set_merge_interval(0);
    undo.add_exclude_origin_prefix("history-");
    let peer = fork_doc(&doc, 2)?;
    let baseline = peer.oplog_vv();
    let map = projection.index.map(&peer, text.key())?;
    let Container::Text(native) = map
        .get("text")
        .expect("text")
        .as_container()
        .expect("container")
        .clone()
    else {
        panic!("text")
    };
    native.insert(0, "remote-")?;
    peer.commit_with(loro::CommitOptions::new().timestamp(2));
    let (_, commit) = editor.update(|tx| {
        tx.select_end(text)?;
        tx.insert_text("-own")
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(undo.undo_count(), 1);
    let (_, changes) = projection.remote(
        &doc,
        editor.state(),
        &peer.export(ExportMode::updates(&baseline))?,
    )?;
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
    let mut repair = core.state().view().export_json(text)?;
    repair.insert("style".into(), json!("repair"));
    let output = core
        .apply(
            Input::ApplyRemote {
                changes: vec![NodeChange::Update {
                    node: NodeTarget::Key(text.key()),
                    json: repair,
                }],
                options: UpdateOptions::default(),
            },
            HistoryTime(3),
        )
        .expect("repair");
    assert!(
        projection
            .local_commit(&doc, &output.commits, FIXUP_ORIGIN, 3)?
            .changed
    );
    assert_eq!(undo.undo_count(), 1);
    assert!(undo.undo()?);
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 4)?.changed);
    assert_eq!(core.state().view().text_content(text), "remote-base");
    assert_eq!(
        core.state().view().text(text).expect("text").style.as_ref(),
        "repair"
    );
    projection
        .check(&doc, core.state())
        .expect("undo consistent");
    assert!(undo.redo()?);
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 5)?.changed);
    assert_eq!(core.state().view().text_content(text), "remote-base-own");
    projection
        .check(&doc, core.state())
        .expect("redo consistent");
    Ok(())
}

#[test]
fn idless_remote_node_gets_one_id_write_and_a_second_fixup_is_empty() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids {
            peer: "receiver",
            next: 0,
        })
        .plugin(AssignIds)
        .build()
        .expect("editor");
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let children = schema::children(&doc.get_map("root"))?.expect("children");
    let map = children.insert_container(0, LoroMap::new())?;
    schema::initialize_map(&map, json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","children":[]}).as_object().expect("node"), schema::MapSchema::Node)?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
    let changes = projection.take_remote(&doc, editor.state())?;
    let before = doc.oplog_vv();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    assert!(apply_remote(&mut projection, &doc, &mut core, changes, 2)?.changed);
    assert_eq!(
        schema::read_value(&map.get("$").expect("state"))?,
        json!({"id":"receiver-1"})
    );
    let updates =
        serde_json::to_value(doc.export_json_updates(&before, &doc.oplog_vv())?).expect("ops");
    assert_eq!(updates.to_string().matches("receiver-1").count(), 1);
    let changes = projection.take_remote(&doc, core.state())?;
    assert!(changes.changes.is_empty());
    assert!(!apply_remote(&mut projection, &doc, &mut core, changes, 3)?.changed);
    projection
        .check(&doc, core.state())
        .expect("id repair consistent");
    Ok(())
}

#[test]
fn cursors_cover_element_and_leaf_offsets_plain_text_is_read_only_and_node_selection_is_absent()
-> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀é")?;
        tx.set_state(p, &ID, "p".into())?;
        tx.set_state(text, &ID, "t".into())?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, text))
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    for point in [
        Point::text(text, Utf16Offset(0)),
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(3)),
        Point::text(text, Utf16Offset(4)),
        Point::element(p, ChildIndex(0)),
        Point::element(p, ChildIndex(1)),
    ] {
        let mut range = RangeSelection::at_root();
        range.anchor = point;
        range.focus = point;
        let cursors = projection
            .cursor(&doc, editor.state(), &Selection::Range(range))
            .expect("cursor");
        assert_eq!(
            projection.point(&doc, editor.state(), &cursors.anchor),
            Some(point)
        );
    }
    assert!(
        projection
            .cursor(
                &doc,
                editor.state(),
                &Selection::Node(NodeSelection::default())
            )
            .is_none()
    );
    let map = projection.index.map(&doc, text.key())?;
    map.insert("text", "a😀é")?;
    doc.commit_with(loro::CommitOptions::new().origin(LOCAL_ORIGIN).timestamp(1));
    projection.index.bind(text.key(), &map, &PLAIN)?;
    let before = doc.oplog_vv();
    let mut range = RangeSelection::at_root();
    range.anchor = Point::text(text, Utf16Offset(1));
    range.focus = range.anchor;
    assert!(
        projection
            .cursor(&doc, editor.state(), &Selection::Range(range))
            .is_none()
    );
    assert_eq!(before, doc.oplog_vv());
    // Childless element fallback stores a position in its parent's list.
    editor.update(|tx| tx.remove(text, true))?;
    let pmap = projection.index.map(&doc, p.key())?;
    pmap.delete("children")?;
    doc.commit_with(loro::CommitOptions::new().origin(LOCAL_ORIGIN).timestamp(2));
    projection.index.bind(p.key(), &pmap, &PLAIN)?;
    let mut range = RangeSelection::at_root();
    range.anchor = Point::element(p, ChildIndex(0));
    range.focus = range.anchor;
    let cursors = projection
        .cursor(&doc, editor.state(), &Selection::Range(range))
        .expect("leaf cursor");
    assert_eq!(
        projection.point(&doc, editor.state(), &cursors.focus),
        Some(Point::element(p, ChildIndex(0)))
    );
    Ok(())
}

#[test]
fn explicit_reconstruction_and_reattach_recovers_an_injected_index_divergence() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    projection.index.unbind(p.key());
    assert!(projection.check(&doc, editor.state()).is_err());
    let reconstructed = reconstruct_state(&doc, &PLAIN)?;
    let state = editor.parse_editor_state(&reconstructed)?;
    editor.set_editor_state(state, TagSet::default())?;
    let projection = LoroProjection::attach(&doc, editor.state(), &PLAIN)?;
    projection.check(&doc, editor.state()).expect("recovered");
    Ok(())
}

#[test]
fn event_free_local_commit_preserves_remote_undo_group_boundaries() -> Result<()> {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(text)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PlainPolicy, 0)?;
    let peer = fork_doc(&doc, 2)?;
    let baseline = peer.oplog_vv();
    let text_id = projection.index.nodes[&text.key()]
        .text
        .clone()
        .expect("text slot");
    let undo = loro::InnerUndoManager::new(doc.inner());
    undo.set_merge_interval(0);
    undo.group_start()?;
    let local_events = Arc::new(AtomicUsize::new(0));
    let import_events = Arc::new(AtomicUsize::new(0));
    let local = local_events.clone();
    let imported = import_events.clone();
    let _events = doc.subscribe_root(Arc::new(move |event| match event.triggered_by {
        loro::EventTriggerKind::Local => {
            local.fetch_add(1, Ordering::Relaxed);
        }
        loro::EventTriggerKind::Import => {
            imported.fetch_add(1, Ordering::Relaxed);
        }
        _ => {}
    }));
    let (_, commit) = editor.update(|tx| tx.insert_text("1"))?;
    let projected = projection.local_commit_without_events(&doc, &[commit], 1)?;
    assert!(projected.changed && projected.events_suppressed);
    undo.record_projected_checkpoint()?;
    assert_eq!(undo.undo_count(), 1);
    assert_eq!(local_events.load(Ordering::Relaxed), 0);
    assert!(doc.with_state(|state| state.is_recording()));

    peer.get_text(text_id.clone()).insert(0, "R")?;
    peer.commit();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let (_, changes) = projection.remote(
        &doc,
        core.state(),
        &peer.export(ExportMode::updates(&baseline))?,
    )?;
    assert_eq!(import_events.load(Ordering::Relaxed), 1);
    apply_remote(&mut projection, &doc, &mut core, changes, 2)?;
    assert_eq!(doc.get_text(text_id.clone()).to_string(), "Ra1");
    let output = core
        .apply(
            Input::TextFromView {
                key: text.key(),
                text: "Ra12".into(),
                anchor: Some(Utf16Offset(4)),
                focus: Some(Utf16Offset(4)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(4)),
                    focus: Point::text(text, Utf16Offset(4)),
                    resolution_dirty: false,
                },
            },
            HistoryTime(3),
        )
        .expect("second local edit");
    let projected = projection.local_commit_without_events(&doc, &output.commits, 3)?;
    assert!(projected.changed && projected.events_suppressed);
    undo.record_projected_checkpoint()?;
    assert_eq!(doc.get_text(text_id.clone()).to_string(), "Ra12");
    assert_eq!(
        undo.undo_count(),
        2,
        "overlapping remote edit must end the local group"
    );
    assert_eq!(local_events.load(Ordering::Relaxed), 0);
    assert!(undo.undo()?);
    assert_eq!(doc.get_text(text_id).to_string(), "Ra1");
    assert_eq!(
        local_events.load(Ordering::Relaxed),
        1,
        "undo still emits its normal event"
    );
    Ok(())
}
