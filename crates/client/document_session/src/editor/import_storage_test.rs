use super::*;
use std::sync::atomic::AtomicI64;

#[test]
fn filtered_diff_search_state_preserves_storage_through_cold_session_attach() {
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    lexical_loro::mirror::set_state(&doc, &serde_json::json!({
        "type":"root","version":1,"format":"","indent":0,"direction":null,
        "$":{"id":"fixture-root","documentMetadata":{"version":10}},
        "children":[{"type":"diff","version":1,"format":"","indent":0,"direction":null,
            "userId":"fixture-user","label":"Diff","$":{"id":"fixture-diff","searchText":""},
            "children":[{"type":"diff-insert","version":1,"markdown":"fixture", "$":{"id":"fixture-insert"}}]}]
    })).expect("actual stored Diff");
    let config = crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let policy = config.policy;
    let before = lexical_loro::reconstruct_initial_state(&doc, policy).expect("raw snapshot");
    let vv = doc.oplog_vv();
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let mut imported = EditorSurface::builder(&config, config.mode, 8)
        .initial_state(before.state.clone())
        .build()
        .expect("actual initial hooks");
    let commits = imported.take_initial_commits();
    let base = commits
        .first()
        .map_or(imported.state(), |commit| &commit.prev);
    let stored = base
        .view()
        .export_stored_json(NodeKey::ROOT)
        .expect("import baseline storage");
    let diff = base.first_child_or_err(NodeKey::ROOT).expect("Diff child");
    assert_eq!(
        base.view().export_stored_json(diff).expect("stored Diff")["$"]["searchText"],
        ""
    );
    assert_eq!(
        stored["$"]["documentMetadata"],
        serde_json::json!({"version":10})
    );
    let mut surface = EditorSurface::new(config, 8, now).expect("Macro session");
    surface
        .init(&doc, now, Access::Read, &mut Vec::new())
        .expect("strict stored attach");
    let ordinary = surface.state().to_json().expect("ordinary export");
    assert!(
        ordinary.root["children"][0]["$"]
            .get("searchText")
            .is_none()
    );
    assert_eq!(
        ordinary.root["$"]["documentMetadata"],
        serde_json::json!({"version":10,"environmentTags":null})
    );
    assert_eq!(
        lexical_loro::reconstruct_initial_state(&doc, policy)
            .expect("same raw")
            .state
            .root,
        before.state.root
    );
    assert_eq!(doc.oplog_vv(), vv);
    assert!(surface.projection.is_some());
}
