use super::*;
use lexical_model::*;
use loro::ExportMode;
use serde_json::json;
mod stored_state;
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

fn assert_text_splice_matches_native_update(old: &str, new: &str) -> Result<()> {
    let doc = new_doc(7)?;
    doc.get_text("text").insert(0, old)?;
    doc.commit_with(loro::CommitOptions::new().timestamp(0));
    let peer = fork_doc(&doc, 9)?;
    doc.set_peer_id(9)?;
    let before = doc.oplog_vv();
    let projected_events = Arc::new(Mutex::new(Vec::new()));
    let native_events = Arc::new(Mutex::new(Vec::new()));
    let events = projected_events.clone();
    let _projected = doc.subscribe_root(Arc::new(move |event| {
        events
            .lock()
            .expect("events")
            .push(format!("{:?}", event.events));
    }));
    let events = native_events.clone();
    let _native = peer.subscribe_root(Arc::new(move |event| {
        events
            .lock()
            .expect("events")
            .push(format!("{:?}", event.events));
    }));
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
    assert_eq!(doc.get_text("text").to_string(), new);
    assert_eq!(doc.get_deep_value(), peer.get_deep_value());
    assert_eq!(doc.oplog_vv(), peer.oplog_vv());
    assert_eq!(doc.oplog_frontiers(), peer.oplog_frontiers());
    assert_eq!(
        serde_json::to_value(doc.export_json_updates(&before, &doc.oplog_vv())?).expect("JSON ops"),
        serde_json::to_value(peer.export_json_updates(&before, &peer.oplog_vv())?)
            .expect("JSON ops")
    );
    assert_eq!(
        *projected_events.lock().expect("events"),
        *native_events.lock().expect("events")
    );
    let expected = if old == new { 0 } else { 1 };
    assert_eq!(stats.text_splices, expected);
    assert_eq!(stats.containers_written, expected);
    Ok(())
}

#[test]
fn text_splices_match_native_update_operations_for_single_and_multiple_regions() -> Result<()> {
    for (old, new) in [
        ("", ""),
        ("same😀", "same😀"),
        ("a😀b", "a😀éb"),
        ("abc😀xyz", "aBc😀xyZ"),
        ("a😀b", "ab"),
        ("old", "new"),
        ("", "😀"),
        ("😀", ""),
        ("aaaa", "aa"),
        ("aa", "aaaa"),
        ("é中😀", "éX中😀"),
        ("é中😀", "é中X😀"),
        ("é中😀", "é中😀X"),
        ("é中😀", "中😀"),
        ("e\u{301}👩‍💻\r\n中", "e\u{301}👩‍💻\n中"),
    ] {
        assert_text_splice_matches_native_update(old, new)?;
    }
    Ok(())
}

proptest::proptest! {
    #[test]
    fn generated_unicode_splices_preserve_native_operations_and_events(
        prefix in proptest::collection::vec(proptest::prelude::any::<char>(), 0..24),
        removed in proptest::collection::vec(proptest::prelude::any::<char>(), 0..16),
        inserted in proptest::collection::vec(proptest::prelude::any::<char>(), 0..16),
        suffix in proptest::collection::vec(proptest::prelude::any::<char>(), 0..24),
    ) {
        let prefix = prefix.into_iter().collect::<String>();
        let suffix = suffix.into_iter().collect::<String>();
        let old = format!("{prefix}{}{suffix}", removed.into_iter().collect::<String>());
        let new = format!("{prefix}{}{suffix}", inserted.into_iter().collect::<String>());
        assert_text_splice_matches_native_update(&old, &new).expect("valid Unicode update");
    }
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
mod hooks;
mod peers;

mod differential;

mod regressions;

mod policy;

mod lifecycle;

#[test]
fn unknown_remote_element_and_text_roundtrip_through_projection_and_core() -> Result<()> {
    let source = Editor::builder(EditorMode::Headless).opaque_unknown_types(true)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
            {"type":"future-block","version":5,"payload":{"x":true},"children":[
                {"type":"future-text","version":3,"text":"a😀b","format":0,"mode":"normal","detail":0,"style":""}
            ]}
        ]}})).expect("literal state")).build().expect("source");
    let remote = new_doc(12)?;
    LoroProjection::initialize(&remote, source.state(), &PLAIN, 0)?;
    let doc = new_doc(13)?;
    let editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .build()
        .expect("target");
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    // Share a common empty root, then insert future nodes using the remote projection.
    let baseline = doc.oplog_vv();
    let peer = fork_doc(&doc, 14)?;
    let mut peer_editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .build()
        .expect("peer");
    let mut peer_projection = LoroProjection::attach(&peer, peer_editor.state(), &PLAIN)?;
    let (_, commit) = peer_editor.update(|tx| {
        let block = tx.import_node(
            source.state().to_json()?.root["children"][0]
                .as_object()
                .expect("block"),
        )?;
        tx.append(NodeKey::ROOT, &[block])?;
        Ok(())
    })?;
    peer_projection.local_commit(&peer, &[commit], LOCAL_ORIGIN, 1)?;
    let bytes = peer.export(ExportMode::updates(&baseline))?;
    let (_, changes) = projection.remote(&doc, editor.state(), &bytes)?;
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
                options: UpdateOptions::default(),
            },
            HistoryTime(1),
        )
        .expect("apply unknown nodes");
    let created = output
        .effects
        .iter()
        .find_map(|effect| {
            if let Effect::RemoteNodesCreated(nodes) = effect {
                Some(nodes.as_slice())
            } else {
                None
            }
        })
        .expect("created keys");
    projection.bind_created(changes, created)?;
    assert_eq!(
        core.state().to_json()?.root["children"],
        source.state().to_json()?.root["children"]
    );
    projection
        .check(&doc, core.state())
        .expect("consistent unknown nodes");
    Ok(())
}

#[test]
fn moving_a_text_into_a_new_parent_removes_the_old_owned_container() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((old_parent, first, moved), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create_text("left")?;
        let b = tx.create_text("right")?;
        tx.text(b)?.set_format(TextFormat::BOLD)?;
        tx.set_state(p, &ID, "old-parent".into())?;
        tx.set_state(a, &ID, "first-text".into())?;
        tx.set_state(b, &ID, "moved-text".into())?;
        tx.append(p, &[a.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), a.key(), b.key()))
    })?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let (new_parent, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.set_state(p, &ID, "new-parent".into())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[moved])?;
        Ok(p.key())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(
        editor
            .state()
            .view()
            .children(old_parent)
            .collect::<Vec<_>>(),
        vec![first]
    );
    assert_eq!(
        editor
            .state()
            .view()
            .children(new_parent)
            .collect::<Vec<_>>(),
        vec![moved]
    );
    projection
        .check(&doc, editor.state())
        .expect("moved node occurs exactly once");
    assert_eq!(
        reconstruct_state(&doc, &PLAIN)?.root["children"][0]["children"]
            .as_array()
            .expect("old children")
            .len(),
        1
    );
    Ok(())
}
