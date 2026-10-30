use loro::{LoroList, LoroMap, LoroMovableList, LoroText};

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

/// One user writes a paragraph next to another's. The second user comments
/// on the author's text and later deletes the comment. The client's mirror
/// rewrites the author's text node each time, but the commenter wrote none of
/// it, so blame must not move.
#[test]
fn comment_marks_keep_the_text_authors_blame() {
    const AUTHOR: u64 = 1;
    const COMMENTER: u64 = 2;
    let state = DocumentState::new();
    let client = LoroDoc::new();
    client.set_peer_id(AUTHOR).unwrap();
    let root_children = client
        .get_map("root")
        .insert_container("children", LoroMovableList::new())
        .unwrap();
    let author_paragraph = root_children.push_container(LoroMap::new()).unwrap();
    author_paragraph.insert("type", "paragraph").unwrap();
    author_paragraph
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "p-author")
        .unwrap();
    let author_children = author_paragraph
        .insert_container("children", LoroMovableList::new())
        .unwrap();
    let author_text = author_children.push_container(LoroMap::new()).unwrap();
    author_text.insert("type", "text").unwrap();
    author_text
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "t-author")
        .unwrap();
    author_text
        .insert_container("text", LoroText::new())
        .unwrap()
        .insert(0, "author wrote this")
        .unwrap();
    client.commit();
    client.set_peer_id(COMMENTER).unwrap();
    let commenter_paragraph = root_children.push_container(LoroMap::new()).unwrap();
    commenter_paragraph.insert("type", "paragraph").unwrap();
    commenter_paragraph
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "p-commenter")
        .unwrap();
    let commenter_text = commenter_paragraph
        .insert_container("children", LoroMovableList::new())
        .unwrap()
        .push_container(LoroMap::new())
        .unwrap();
    commenter_text.insert("type", "text").unwrap();
    commenter_text
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "t-commenter")
        .unwrap();
    commenter_text
        .insert_container("text", LoroText::new())
        .unwrap()
        .insert(0, "commenter wrote this")
        .unwrap();
    client.commit();
    let written = state
        .import(&client.export(ExportMode::all_updates()).unwrap())
        .unwrap();
    assert_eq!(
        written.touched_nodes,
        ["p-author", "p-commenter", "t-author", "t-commenter"]
    );

    // The commenter marks all of the author's text: the mirror deletes the
    // text node and recreates it, same id and text, inside a comment node.
    let seen = client.oplog_vv();
    author_children.delete(0, 1).unwrap();
    let comment = author_children.insert_container(0, LoroMap::new()).unwrap();
    comment.insert("type", "comment").unwrap();
    comment
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "c-whole")
        .unwrap();
    comment
        .insert_container("ids", LoroList::new())
        .unwrap()
        .push("mark-1")
        .unwrap();
    let wrapped = comment
        .insert_container("children", LoroMovableList::new())
        .unwrap()
        .push_container(LoroMap::new())
        .unwrap();
    wrapped.insert("type", "text").unwrap();
    wrapped
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "t-author")
        .unwrap();
    wrapped
        .insert_container("text", LoroText::new())
        .unwrap()
        .insert(0, "author wrote this")
        .unwrap();
    client.commit();
    let commented = state
        .import(&client.export(ExportMode::updates(&seen)).unwrap())
        .unwrap();
    assert!(commented.changed);
    assert!(commented.touched_nodes.is_empty());

    // The commenter deletes the comment: the comment node goes and the text
    // node is recreated directly in the paragraph again.
    let seen = client.oplog_vv();
    author_children.delete(0, 1).unwrap();
    let unwrapped = author_children.insert_container(0, LoroMap::new()).unwrap();
    unwrapped.insert("type", "text").unwrap();
    unwrapped
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "t-author")
        .unwrap();
    let unwrapped_text = unwrapped.insert_container("text", LoroText::new()).unwrap();
    unwrapped_text.insert(0, "author wrote this").unwrap();
    client.commit();
    let uncommented = state
        .import(&client.export(ExportMode::updates(&seen)).unwrap())
        .unwrap();
    assert!(uncommented.changed);
    assert!(uncommented.touched_nodes.is_empty());

    // The commenter marks "wrote": Lexical splits the author's text node,
    // keeping "author " in it and moving the rest into new nodes.
    let seen = client.oplog_vv();
    let comment = author_children.push_container(LoroMap::new()).unwrap();
    comment.insert("type", "comment").unwrap();
    comment
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "c-part")
        .unwrap();
    let marked = comment
        .insert_container("children", LoroMovableList::new())
        .unwrap()
        .push_container(LoroMap::new())
        .unwrap();
    marked.insert("type", "text").unwrap();
    marked
        .insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "t-marked")
        .unwrap();
    marked
        .insert_container("text", LoroText::new())
        .unwrap()
        .insert(0, "wrote")
        .unwrap();
    let tail = author_children.push_container(LoroMap::new()).unwrap();
    tail.insert("type", "text").unwrap();
    tail.insert_container("$", LoroMap::new())
        .unwrap()
        .insert("id", "t-tail")
        .unwrap();
    tail.insert_container("text", LoroText::new())
        .unwrap()
        .insert(0, " this")
        .unwrap();
    unwrapped_text.delete(7, 10).unwrap();
    client.commit();
    let split = state
        .import(&client.export(ExportMode::updates(&seen)).unwrap())
        .unwrap();
    assert!(split.changed);
    assert!(split.touched_nodes.is_empty());

    // The commenter deletes that comment: Lexical merges the pieces back
    // into the author's text node and removes the comment and tail nodes.
    let seen = client.oplog_vv();
    author_children.delete(1, 2).unwrap();
    unwrapped_text.insert(7, "wrote this").unwrap();
    client.commit();
    let merged = state
        .import(&client.export(ExportMode::updates(&seen)).unwrap())
        .unwrap();
    assert!(merged.changed);
    assert!(merged.touched_nodes.is_empty());
    assert_eq!(unwrapped_text.to_string(), "author wrote this");

    // Typing into the author's text is still the commenter's edit.
    let seen = client.oplog_vv();
    unwrapped_text.insert(17, "!").unwrap();
    client.commit();
    let typed = state
        .import(&client.export(ExportMode::updates(&seen)).unwrap())
        .unwrap();
    assert_eq!(typed.touched_nodes, ["t-author"]);
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
