//! Search indexing is an opted-in collaboration writer, with independently checked storage.
use lexical_loro::{LOCAL_ORIGIN, LoroProjection, SyncPolicy, new_doc, reconstruct_state};
use lexical_model::*;
use macro_document_model::{
    EditorType, preset_builder,
    sync::{MACRO_SEARCH_TEXT_SYNC_POLICY, MACRO_SYNC_POLICY},
};
use serde_json::json;

#[test]
fn local_search_fields_preserve_ordinary_json_and_track_moved_duplicate_owners() {
    for (enabled, policy) in [
        (false, &MACRO_SYNC_POLICY as &dyn SyncPolicy),
        (true, &MACRO_SEARCH_TEXT_SYNC_POLICY as &dyn SyncPolicy),
    ] {
        let initial = serde_json::from_value(json!({"root":{"type":"root","children":[
            {"type":"paragraph","$":{"id":"duplicate","searchText":"stale"},"children":[{"type":"text","text":"first"}]},
            {"type":"paragraph","$":{"id":"duplicate"},"children":[{"type":"text","text":"last"}]},
            {"type":"quote","$":{"id":"container"},"children":[{"type":"text","text":"quote"}]},
            {"type":"paragraph","$":{"id":"untouched"},"children":[{"type":"text","text":"untouched"}]}
        ]}})).expect("literal");
        let mut editor = preset_builder(EditorType::MarkdownSync)
            .initial_state(initial)
            .build()
            .expect("actual registry");
        let doc = new_doc(71).expect("actual Loro");
        let mut projection = LoroProjection::initialize(&doc, editor.state(), policy, 0)
            .expect("attach exact raw source");
        let top = editor
            .state()
            .view()
            .children_keys(NodeKey::ROOT)
            .expect("root");
        let last_text = editor.state().view().first_child(top[1]).expect("text");
        let raw = |doc: &loro::LoroDoc| reconstruct_state(doc, policy).expect("raw Loro").root;
        let original = raw(&doc);
        assert_eq!(original["children"][0]["$"]["searchText"], "stale");
        assert!(original["children"][1]["$"].get("searchText").is_none());
        for (time, content) in [(1, "latest"), (2, "updated")] {
            let (_, commit) = editor
                .update(|tx| {
                    tx.text(last_text)?.set_text_content(content)?;
                    Ok(())
                })
                .expect("actual model edit");
            projection
                .local_commit(&doc, &[commit], LOCAL_ORIGIN, time)
                .expect("project");
            projection
                .check(&doc, editor.state())
                .expect("strict stored expectation");
            let stored = raw(&doc);
            let model = editor.state().to_json().expect("ordinary editor").root;
            assert_eq!(model["children"][0]["$"]["searchText"], "stale");
            assert!(model["children"][1]["$"].get("searchText").is_none());
            assert_eq!(
                stored["children"][0]["$"]["searchText"],
                if enabled { content } else { "stale" }
            );
            if enabled {
                assert_eq!(stored["children"][1]["$"]["searchText"], content);
                assert_eq!(stored["children"][3]["$"]["searchText"], "untouched");
            } else {
                assert!(stored["children"][1]["$"].get("searchText").is_none());
                assert!(stored["children"][3]["$"].get("searchText").is_none());
            }
        }
        let peer = doc.fork();
        peer.set_peer_id(91).expect("distinct peer");
        let since = peer.oplog_vv();
        let Some(loro::ValueOrContainer::Container(loro::Container::MovableList(children))) =
            peer.get_map("root").get("children")
        else {
            panic!("stored root children")
        };
        let Some(loro::ValueOrContainer::Container(loro::Container::Map(child))) = children.get(3)
        else {
            panic!("stored untouched child")
        };
        let Some(loro::ValueOrContainer::Container(loro::Container::Map(fields))) = child.get("$")
        else {
            panic!("stored fields")
        };
        fields
            .insert("local", true)
            .expect("actual peer own-field event");
        peer.commit();
        let bytes = peer
            .export(loro::ExportMode::updates(&since))
            .expect("peer update");
        let (_, changes) = projection
            .remote(&doc, editor.state(), &bytes)
            .expect("actual peer import");
        assert!(
            changes.changes.is_empty(),
            "masked own-field event imports no editor state"
        );
        projection
            .bind_created(changes, &[])
            .expect("accept without an own import");
        projection
            .check(&doc, editor.state())
            .expect("no-import comparison stays exact");
        let (_, commit) = editor
            .update(|tx| tx.append(top[2], &[top[1]]))
            .expect("move source out of top level");
        projection
            .local_commit(&doc, &[commit], LOCAL_ORIGIN, 3)
            .expect("project move");
        projection
            .check(&doc, editor.state())
            .expect("strict after move");
        let stored = raw(&doc);
        assert_eq!(
            stored["children"][0]["$"]["searchText"],
            if enabled { "first" } else { "stale" }
        );
        assert!(
            stored["children"][1]["children"][1]["$"]
                .get("searchText")
                .is_none()
        );
        if enabled {
            assert_eq!(stored["children"][1]["$"]["searchText"], "quoteupdated");
        }
        let (_, commit) = editor
            .update(|tx| tx.append(top[2], &[top[0]]))
            .expect("fixup moves an existing key to another stored container");
        projection
            .local_commit(&doc, &[commit], lexical_loro::FIXUP_ORIGIN, 4)
            .expect("fixup rebind without deriving");
        projection
            .check(&doc, editor.state())
            .expect("strict after rebind");
        let rebound = raw(&doc);
        assert_eq!(
            rebound["children"][0]["children"][2]["$"]["searchText"],
            "stale"
        );
        if enabled {
            assert_eq!(rebound["children"][0]["$"]["searchText"], "quoteupdated");
        }
    }
}

#[test]
fn local_history_reimports_the_actual_stored_search_field() {
    let policy = &MACRO_SEARCH_TEXT_SYNC_POLICY;
    let initial = serde_json::from_value(json!({"root":{"type":"root","children":[
        {"type":"paragraph","$":{"id":"block"},"children":[{"type":"text","text":"abc"}]}
    ]}}))
    .expect("literal");
    let mut editor = preset_builder(EditorType::MarkdownSync)
        .initial_state(initial)
        .build()
        .expect("actual registry");
    let doc = new_doc(72).expect("actual Loro");
    let mut projection =
        LoroProjection::initialize(&doc, editor.state(), policy, 0).expect("exact seed");
    let mut undo = loro::UndoManager::new(&doc);
    undo.set_merge_interval(0);
    let text = editor
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .expect("text");
    let (_, commit) = editor
        .update(|tx| {
            tx.text(text)?.set_text_content("abXc")?;
            Ok(())
        })
        .expect("type inside the actual node");
    projection
        .local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)
        .expect("local write");
    let raw = || reconstruct_state(&doc, policy).expect("stored state").root;
    assert_eq!(raw()["children"][0]["$"]["searchText"], "abXc");
    assert!(
        editor.state().to_json().expect("typed model").root["children"][0]["$"]
            .get("searchText")
            .is_none()
    );
    projection
        .check(&doc, editor.state())
        .expect("strict typed verification");

    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    for (redo, expected) in [(false, "abc"), (true, "abXc")] {
        assert!(if redo { undo.redo() } else { undo.undo() }.expect("native history"));
        let stored = raw();
        if redo {
            assert_eq!(stored["children"][0]["$"]["searchText"], expected);
        } else {
            assert!(stored["children"][0]["$"].get("searchText").is_none());
        }
        let remote = projection
            .take_remote(&doc, core.state())
            .expect("actual history changes");
        let output = core
            .apply(
                Input::ApplyRemote {
                    changes: remote.changes.clone(),
                    options: UpdateOptions {
                        tags: TagSet::from_tags([UpdateTag::Historic]),
                        ..UpdateOptions::default()
                    },
                },
                HistoryTime(2),
            )
            .expect("actual remote apply");
        let created = output
            .effects
            .iter()
            .find_map(|effect| {
                if let Effect::RemoteNodesCreated(created) = effect {
                    Some(created.as_slice())
                } else {
                    None
                }
            })
            .unwrap_or_default();
        projection
            .bind_created(remote, created)
            .expect("accept real storage import");
        projection
            .local_commit(&doc, &output.commits, lexical_loro::FIXUP_ORIGIN, 2)
            .expect("fixup without deriving");
        assert_eq!(raw(), stored);
        projection
            .check(&doc, core.state())
            .expect("strict post-history verification");
        let model = core.state().to_json().expect("ordinary model").root;
        assert_eq!(
            model["children"][0]["$"].get("searchText"),
            stored["children"][0]["$"].get("searchText")
        );
        assert_eq!(core.state().root_text_content().as_ref(), expected);
    }
}

#[test]
fn fixup_rebinding_invalidates_the_duplicate_root_index_before_the_next_local_edit() {
    let policy = &MACRO_SEARCH_TEXT_SYNC_POLICY;
    let initial = serde_json::from_value(json!({"root":{"type":"root","children":[
        {"type":"paragraph","$":{"id":"same"},"children":[{"type":"text","text":"first"}]},
        {"type":"paragraph","$":{"id":"same","searchText":"imported"},"children":[{"type":"text","text":"second"}]},
        {"type":"quote","$":{"id":"quote"},"children":[]}
    ]}})).expect("literal");
    let mut editor = preset_builder(EditorType::MarkdownSync)
        .initial_state(initial)
        .build()
        .expect("actual registry");
    let doc = new_doc(73).expect("actual Loro");
    let mut projection =
        LoroProjection::initialize(&doc, editor.state(), policy, 0).expect("exact seed");
    let [first, second, quote]: [NodeKey; 3] = editor
        .state()
        .view()
        .children_keys(NodeKey::ROOT)
        .expect("root children")
        .try_into()
        .expect("three fixture children");
    let leaf = editor
        .state()
        .view()
        .first_child(first)
        .expect("first text");
    let (_, typed) = editor
        .update(|tx| tx.text(leaf)?.set_text_content("edited").map(|_| ()))
        .expect("edit");
    projection
        .local_commit(&doc, &[typed], LOCAL_ORIGIN, 1)
        .expect("write duplicate group");
    let (_, moved) = editor
        .update(|tx| tx.append(quote, &[second]))
        .expect("actual reparent");
    projection
        .local_commit(&doc, &[moved], lexical_loro::FIXUP_ORIGIN, 2)
        .expect("rebind without deriving");
    projection
        .check(&doc, editor.state())
        .expect("exact after rebind");
    let (_, typed) = editor
        .update(|tx| tx.text(leaf)?.set_text_content("latest").map(|_| ()))
        .expect("edit again");
    projection
        .local_commit(&doc, &[typed], LOCAL_ORIGIN, 3)
        .expect("write surviving root");
    projection
        .check(&doc, editor.state())
        .expect("exact after later edit");
    let stored = reconstruct_state(&doc, policy)
        .expect("real stored state")
        .root;
    assert_eq!(stored["children"][0]["$"]["searchText"], "latest");
    assert_eq!(
        stored["children"][1]["children"][0]["$"]["searchText"],
        "imported"
    );
}
