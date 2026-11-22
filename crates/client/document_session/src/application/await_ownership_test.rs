use super::*;
use crate::{EditorSurface, InitialView, ViewEffect};
use doc_sync_core::{Access, Millis, Now, UnixMillis};
use lexical_model::*;
use macro_document_model::{
    EditorType,
    nodes::{AwaitNode, create_await_node},
    peer,
};

fn configuration(kind: EditorType) -> EditorConfig {
    application_editor_config(EditorConfig::default(), Arc::new(AtomicI64::new(100)), kind)
}

fn stored_await() -> loro::LoroDoc {
    let doc = lexical_loro::new_doc(7).unwrap();
    // Actual stored local is stale input, not an authored value for this reader.
    // Source Await.importJSON omits local, then its created listener derives it.
    lexical_loro::mirror::set_state(
        &doc,
        &serde_json::json!({
            "type":"root", "version":1, "direction":null, "format":"", "indent":0,
            "$":{"id":"root0001", "documentMetadata":{"version":11}},
            "children":[{
                "type":"paragraph", "version":1, "direction":null, "format":"", "indent":0,
                "textFormat":0, "textStyle":"", "$":{"id":"para0001"}, "children":[{
                    "type":"await", "version":1, "awaitId":"owned-await", "inline":true,
                    "$":{"id":"node0001", "peerId":"7", "local":true}
                }]
            }]
        }),
    )
    .unwrap();
    doc
}

fn awaiting(state: &EditorState) -> NodeKey {
    lexical_rich_nodes::utils::dfs(state.view(), None, None)
        .into_iter()
        .find(|entry| state.view().is::<AwaitNode>(entry.node))
        .expect("attached Await")
        .node
}

#[test]
fn authored_await_gets_current_peer_and_local_status() {
    let config = configuration(EditorType::MarkdownSync);
    let mut editor = (config.builder)(EditorMode::Headless, 7).build().unwrap();
    let (key, _) = editor
        .update(|tx| {
            let node = create_await_node(tx, Some("owned-await".into()), None, true)?;
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(paragraph, &[node.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(node.key())
        })
        .unwrap();
    assert_eq!(
        peer::get_peer_id(editor.state().view(), key)
            .unwrap()
            .as_deref(),
        Some("7")
    );
    assert_eq!(
        peer::get_local(editor.state().view(), key).unwrap(),
        Some(true)
    );
    assert_eq!(
        peer::get_peer_id(editor.state().view(), NodeKey::ROOT).unwrap(),
        None
    );
}

// Was on_open_await_derives_ownership_without_writing_raw_local_state; renamed once the
// reader-8 Source control (manifest 5a4699a2, classification 367f0cbf) showed a foreign Edit
// open stores its derived local.
#[test]
fn on_open_await_derives_ownership_writing_only_source_open_state() {
    let source = stored_await();
    let snapshot = source.export(loro::ExportMode::Snapshot).unwrap();
    let now = Now {
        mono: Millis(1),
        wall: UnixMillis(100),
    };
    for (reader, access, local) in [
        (7, Access::Edit, true),
        (8, Access::Edit, false),
        (7, Access::Read, true),
        (8, Access::Read, false),
    ] {
        let doc = lexical_loro::new_doc(reader).unwrap();
        doc.import(&snapshot).unwrap();
        let raw = lexical_loro::reconstruct_state(&doc, &lexical_loro::PlainPolicy).unwrap();
        let vv = doc.oplog_vv();
        let mut surface =
            EditorSurface::new(configuration(EditorType::MarkdownSync), reader, now).unwrap();
        surface.init(&doc, now, access, &mut Vec::new()).unwrap();
        let key = awaiting(surface.state());
        assert_eq!(
            peer::get_local(surface.state().view(), key).unwrap(),
            Some(local)
        );
        assert_eq!(
            peer::get_peer_id(surface.state().view(), NodeKey::ROOT).unwrap(),
            None
        );
        // An Edit open writes the parsed null metadata slot (first open 605dfc47, reopen
        // 5486fba0). A foreign Edit reader's derived local rides in that same open commit, as
        // in Source: reader-8 Source control, manifest 5a4699a2, classification 367f0cbf
        // (STALE TEST under rule v4). Read opens write nothing.
        let mut expected = raw.clone();
        if access == Access::Edit {
            expected.root["$"]["documentMetadata"]["environmentTags"] = serde_json::Value::Null;
        }
        if (reader, access) == (8, Access::Edit) {
            expected.root["children"][0]["children"][0]["$"]["local"] =
                serde_json::Value::Bool(false);
        }
        assert_eq!(
            lexical_loro::reconstruct_state(&doc, &lexical_loro::PlainPolicy).unwrap(),
            expected
        );
        assert_eq!(doc.oplog_vv() == vv, access != Access::Edit);
        surface
            .projection
            .as_ref()
            .unwrap()
            .check(&doc, surface.state())
            .unwrap();
    }
}

#[test]
fn initialize_and_repaint_deliver_only_flat_await_local_state() {
    let doc = stored_await();
    doc.set_peer_id(8).unwrap();
    let now = Now {
        mono: Millis(1),
        wall: UnixMillis(100),
    };
    let mut surface = EditorSurface::new(configuration(EditorType::MarkdownSync), 8, now).unwrap();
    let mut effects = Vec::new();
    surface.init(&doc, now, Access::Read, &mut effects).unwrap();
    let key = awaiting(surface.state());
    let expected = SerializedNode::from_iter([("local".into(), serde_json::Value::Bool(false))]);
    let initial = effects
        .iter()
        .find_map(|effect| match effect {
            ViewEffect::Initialize(InitialView::Editor { diff, .. }) => Some(diff),
            _ => None,
        })
        .expect("actual Initialize diff");
    for diff in [initial, &surface.view_diff().unwrap()] {
        let states: Vec<_> = diff
            .ops
            .iter()
            .filter_map(|op| match op {
                DiffOp::State { key, state } => Some((*key, state)),
                _ => None,
            })
            .collect();
        assert_eq!(states, vec![(key, &Some(expected.clone()))]);
    }
}

#[test]
fn non_sync_preset_keeps_await_ownership_unregistered() {
    let config = configuration(EditorType::Markdown);
    let mut editor = (config.builder)(EditorMode::Headless, 7).build().unwrap();
    let (key, _) = editor
        .update(|tx| {
            let node = create_await_node(tx, Some("standalone".into()), None, true)?;
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(paragraph, &[node.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(node.key())
        })
        .unwrap();
    assert_eq!(peer::get_local(editor.state().view(), key).unwrap(), None);
    assert_eq!(peer::get_peer_id(editor.state().view(), key).unwrap(), None);
}

#[test]
fn actual_composer_insert_delivers_the_created_await_local_followup() {
    let doc = stored_await();
    doc.set_peer_id(8).unwrap();
    let now = Now {
        mono: Millis(1),
        wall: UnixMillis(100),
    };
    let mut surface = EditorSurface::new(configuration(EditorType::MarkdownSync), 8, now).unwrap();
    surface
        .init(&doc, now, Access::Edit, &mut Vec::new())
        .unwrap();
    let paragraph = surface
        .state()
        .view()
        .children(NodeKey::ROOT)
        .next()
        .unwrap();
    let point = Point::element(paragraph, ChildIndex(1));
    let command = macro_document_model::surface::decode_command(
        "group-b.creation-await-insert",
        r#"{"awaitId":"composer-await","text":"Creating"}"#,
        paragraph.generation(),
        None,
    )
    .unwrap()
    .unwrap();
    let mut effects = Vec::new();
    surface
        .apply(
            &doc,
            Input::Command {
                command,
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            now,
            Access::Edit,
            &mut effects,
        )
        .unwrap();
    let key = lexical_rich_nodes::utils::dfs(surface.state().view(), None, None)
        .into_iter()
        .find(|entry| {
            surface
                .state()
                .view()
                .get::<AwaitNode>(entry.node)
                .is_some_and(|node| node.await_id.as_deref() == Some("composer-await"))
        })
        .expect("actual composer Await")
        .node;
    assert_eq!(
        peer::get_local(surface.state().view(), key).unwrap(),
        Some(true)
    );
    assert!(effects.iter().any(|effect| matches!(effect,
        ViewEffect::Diff(diff) if diff.ops.iter().any(|op| matches!(op,
            DiffOp::State { key: selected, state: Some(state) }
            if *selected == key && state == &SerializedNode::from_iter([
                ("local".into(), serde_json::Value::Bool(true))
            ])
        ))
    )));
    surface
        .projection
        .as_ref()
        .unwrap()
        .check(&doc, surface.state())
        .unwrap();
}

#[test]
fn ownerless_await_open_keeps_the_source_created_listener_boundary() {
    let doc = stored_await();
    let mut raw = lexical_loro::reconstruct_state(&doc, &lexical_loro::PlainPolicy).unwrap();
    raw.root["children"][0]["children"][0]["$"]
        .as_object_mut()
        .unwrap()
        .remove("peerId");
    lexical_loro::mirror::set_state(&doc, &serde_json::Value::Object(raw.root.clone())).unwrap();
    doc.set_peer_id(8).unwrap();
    let now = Now {
        mono: Millis(1),
        wall: UnixMillis(100),
    };
    let vv = doc.oplog_vv();
    let mut surface = EditorSurface::new(configuration(EditorType::MarkdownSync), 8, now).unwrap();
    surface
        .init(&doc, now, Access::Read, &mut Vec::new())
        .unwrap();
    let key = awaiting(surface.state());
    assert_eq!(
        peer::get_peer_id(surface.state().view(), key).unwrap(),
        None
    );
    assert_eq!(peer::get_local(surface.state().view(), key).unwrap(), None);
    assert!(
        !surface
            .view_diff()
            .unwrap()
            .ops
            .iter()
            .any(|op| matches!(op, DiffOp::State { .. }))
    );
    assert_eq!(
        lexical_loro::reconstruct_state(&doc, &lexical_loro::PlainPolicy).unwrap(),
        raw
    );
    assert_eq!(doc.oplog_vv(), vv);
    surface
        .projection
        .as_ref()
        .unwrap()
        .check(&doc, surface.state())
        .unwrap();
}
