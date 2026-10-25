use loro::{LoroMap, LoroMovableList, LoroText};

use super::*;

#[test]
fn imported_updates_report_the_lexical_nodes_they_touch() {
    let state = DocumentState::new();
    let writer = LoroDoc::new();
    writer.set_peer_id(1).unwrap();
    let children = writer
        .get_map("root")
        .insert_container("children", LoroMovableList::new())
        .unwrap();
    let mut texts = Vec::new();
    for id in ["intro", "body", "outro"] {
        let node = children.push_container(LoroMap::new()).unwrap();
        node.insert_container("$", LoroMap::new())
            .unwrap()
            .insert("id", id)
            .unwrap();
        texts.push(node.insert_container("text", LoroText::new()).unwrap());
    }
    writer.commit();
    let created = state
        .import(&writer.export(ExportMode::all_updates()).unwrap())
        .unwrap();
    assert!(created.changed);
    assert_eq!(created.touched_nodes, ["body", "intro", "outro"]);

    let seen = writer.oplog_vv();
    for (peer, text) in [(2, &texts[0]), (3, &texts[2]), (2, &texts[0])] {
        writer.set_peer_id(peer).unwrap();
        text.insert(0, "typed").unwrap();
        writer.commit();
    }
    let edited = state
        .import(&writer.export(ExportMode::updates(&seen)).unwrap())
        .unwrap();
    assert!(edited.changed);
    assert_eq!(edited.touched_nodes, ["intro", "outro"]);

    let seen = writer.oplog_vv();
    writer.set_peer_id(4).unwrap();
    texts[1].insert(0, "first").unwrap();
    writer.commit();
    let missing = writer.oplog_vv();
    let first = writer.export(ExportMode::updates(&seen)).unwrap();
    let child = children.insert_container(0, LoroMap::new()).unwrap();
    child
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "heading")
        .unwrap();
    writer.commit();
    let early = state
        .import(&writer.export(ExportMode::updates(&missing)).unwrap())
        .unwrap();
    assert!(!early.changed);
    assert!(early.touched_nodes.is_empty());
    let unblocking = state.import(&first).unwrap();
    assert!(unblocking.changed);
    assert_eq!(unblocking.touched_nodes, ["body", "heading"]);
}

#[test]
fn concurrent_branches_survive_session_snapshot_roundtrip() {
    for heads in 1..=9 {
        let state = DocumentState::new();
        for peer in 1..=heads {
            let branch = LoroDoc::new();
            branch.set_peer_id(peer).unwrap();
            branch
                .get_map("values")
                .insert(&peer.to_string(), peer as i64)
                .unwrap();
            state
                .loro_doc
                .import(&branch.export(ExportMode::all_updates()).unwrap())
                .unwrap();
        }

        let snapshot = state.export_shallow_snapshot().unwrap();
        let restored = LoroDoc::new();
        restored.import(&snapshot).unwrap();
        assert_eq!(restored.get_deep_value(), state.loro_doc.get_deep_value());
        assert_eq!(restored.oplog_vv(), state.loro_doc.oplog_vv());
        assert_eq!(restored.oplog_frontiers(), state.loro_doc.oplog_frontiers());

        restored
            .get_map("values")
            .insert("after-reconnect", true)
            .unwrap();
        state
            .loro_doc
            .import(
                &restored
                    .export(ExportMode::updates(&state.loro_doc.oplog_vv()))
                    .unwrap(),
            )
            .unwrap();
        state
            .loro_doc
            .get_map("values")
            .insert("remote-edit", true)
            .unwrap();
        restored
            .import(
                &state
                    .loro_doc
                    .export(ExportMode::updates(&restored.oplog_vv()))
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(restored.get_deep_value(), state.loro_doc.get_deep_value());
        assert_eq!(restored.oplog_vv(), state.loro_doc.oplog_vv());
    }
}

#[test]
fn shared_history_still_compacts_with_concurrent_heads() {
    for heads in [2, 3, 5] {
        let state = DocumentState::new();
        let text = state.loro_doc.get_text("content");
        text.insert(0, &"discarded history ".repeat(10_000))
            .unwrap();
        state.loro_doc.commit();
        text.delete(0, text.len_unicode()).unwrap();
        text.insert(0, "Saved content").unwrap();
        state.loro_doc.commit();
        let root = state.loro_doc.oplog_frontiers();
        let common = state.export_snapshot(None).unwrap();
        for peer in 1..=heads {
            let branch = LoroDoc::from_snapshot(&common).unwrap();
            branch.set_peer_id(peer).unwrap();
            branch
                .get_map("values")
                .insert(&peer.to_string(), peer as i64)
                .unwrap();
            state
                .loro_doc
                .import(
                    &branch
                        .export(ExportMode::updates(&state.loro_doc.oplog_vv()))
                        .unwrap(),
                )
                .unwrap();
        }
        assert_eq!(state.loro_doc.oplog_frontiers().len(), heads as usize);

        let full = state.export_snapshot(None).unwrap();
        let compact = state.export_shallow_snapshot().unwrap();
        let restored = LoroDoc::from_snapshot(&compact).unwrap();
        assert!(restored.is_shallow());
        assert_eq!(restored.shallow_since_frontiers(), root);
        assert_eq!(restored.get_deep_value(), state.loro_doc.get_deep_value());
        assert_eq!(restored.oplog_vv(), state.loro_doc.oplog_vv());
        assert!(compact.len() < full.len() / 2);
    }
}

#[test]
fn root_change_previews_an_update_without_applying_it() {
    let state = DocumentState::new();
    state
        .loro_doc
        .get_map("root")
        .insert("type", "root")
        .unwrap();
    let client = LoroDoc::new();
    client
        .import(&state.loro_doc.export(ExportMode::Snapshot).unwrap())
        .unwrap();
    client.get_map("root").insert("indent", 1).unwrap();
    let update = client
        .export(ExportMode::updates(&state.loro_doc.oplog_vv()))
        .unwrap();

    assert_eq!(
        state.root_change(&[&update]).unwrap(),
        Some(RootChange {
            before: serde_json::json!({"type": "root"}),
            after: serde_json::json!({"type": "root", "indent": 1}),
        })
    );
    assert_eq!(
        state.loro_doc.get_deep_value().to_json(),
        r#"{"root":{"type":"root"}}"#
    );
}

#[test]
fn root_change_refuses_writes_outside_the_root() {
    let state = DocumentState::new();
    state
        .loro_doc
        .get_map("root")
        .insert("type", "root")
        .unwrap();
    let client = LoroDoc::new();
    client
        .import(&state.loro_doc.export(ExportMode::Snapshot).unwrap())
        .unwrap();
    client.get_map("elsewhere").insert("hidden", true).unwrap();
    let update = client
        .export(ExportMode::updates(&state.loro_doc.oplog_vv()))
        .unwrap();

    assert_eq!(state.root_change(&[&update]).unwrap(), None);
}

#[test]
fn root_change_refuses_updates_missing_their_history() {
    let state = DocumentState::new();
    state
        .loro_doc
        .get_map("root")
        .insert("type", "root")
        .unwrap();
    let client = LoroDoc::new();
    client
        .import(&state.loro_doc.export(ExportMode::Snapshot).unwrap())
        .unwrap();
    client.get_map("root").insert("indent", 1).unwrap();
    let unseen = client.oplog_vv();
    client.get_map("root").insert("indent", 2).unwrap();
    let depends_on_unseen = client.export(ExportMode::updates(&unseen)).unwrap();

    assert_eq!(state.root_change(&[&depends_on_unseen]).unwrap(), None);
    assert_eq!(
        state.loro_doc.get_deep_value().to_json(),
        r#"{"root":{"type":"root"}}"#
    );
}
