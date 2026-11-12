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

#[test]
fn stored_null_paragraph_indent_attaches_read_edit_and_survives_projection_reload() {
    for access in [Access::Read, Access::Edit] {
        let doc = lexical_loro::new_doc(17).expect("Loro document");
        lexical_loro::mirror::set_state(
            &doc,
            &serde_json::json!({
                "type":"root", "version":1, "indent":0, "format":"", "direction":null,
                "$":{"id":"fixture-root", "documentMetadata":{"version":10}},
                "children":[{"type":"paragraph", "version":1, "indent":null,
                    "format":"", "direction":null, "textFormat":0, "textStyle":"",
                    "$":{"id":"fixture-paragraph"},
                    "children":[{"type":"text", "version":1, "text":"fixture",
                        "format":0, "detail":0, "mode":"normal", "style":"",
                        "$":{"id":"fixture-text"}}]}]
            }),
        )
        .expect("actual null-bearing stored map");
        let config = crate::application_editor_config(
            EditorConfig::default(),
            Arc::new(AtomicI64::new(0)),
            macro_document_model::EditorType::MarkdownSync,
        );
        let policy = config.policy;
        let before = lexical_loro::reconstruct_initial_state(&doc, policy).expect("stored tree");
        let vv = doc.oplog_vv();
        let now = Now {
            mono: doc_sync_core::Millis(0),
            wall: doc_sync_core::UnixMillis(0),
        };
        let mut surface = EditorSurface::new(config, 18, now).expect("actual Macro surface");
        surface
            .init(&doc, now, access, &mut Vec::new())
            .expect("strict null indent attach");
        surface
            .projection
            .as_ref()
            .expect("actual projection")
            .check(&doc, surface.state())
            .expect("full stored comparison and index");
        let paragraph = surface
            .state()
            .first_child_or_err(NodeKey::ROOT)
            .expect("paragraph");
        assert_eq!(
            surface
                .state()
                .view()
                .export_stored_json(paragraph)
                .expect("stored paragraph")
                .get("indent"),
            Some(&serde_json::Value::Null)
        );
        if access == Access::Read {
            assert_eq!(doc.oplog_vv(), vv);
            assert_eq!(
                lexical_loro::reconstruct_initial_state(&doc, policy)
                    .expect("same stored tree")
                    .state,
                before.state
            );
        } else {
            let text = surface.state().first_child_or_err(paragraph).expect("text");
            surface
                .apply(
                    &doc,
                    Input::TextFromView {
                        key: text,
                        text: "changed".into(),
                        anchor: Some(Utf16Offset(0)),
                        focus: Some(Utf16Offset(0)),
                        composition_end: false,
                        composition_data: None,
                        selection: ViewSelection::Range {
                            anchor: Point::text(text, Utf16Offset(0)),
                            focus: Point::text(text, Utf16Offset(0)),
                            resolution_dirty: false,
                        },
                    },
                    Now {
                        mono: doc_sync_core::Millis(1),
                        wall: doc_sync_core::UnixMillis(1),
                    },
                    access,
                    &mut Vec::new(),
                )
                .expect("actual native text input");
            surface
                .projection
                .as_ref()
                .expect("actual projection")
                .check(&doc, surface.state())
                .expect("full comparison after text input");
            let stored =
                lexical_loro::reconstruct_initial_state(&doc, policy).expect("projected tree");
            assert_eq!(
                stored.state.root["children"][0].get("indent"),
                Some(&serde_json::Value::Null)
            );
            assert_eq!(
                stored.state.root["children"][0]["children"][0]["text"],
                "changed"
            );
        }
        drop(surface);
        let config = crate::application_editor_config(
            EditorConfig::default(),
            Arc::new(AtomicI64::new(0)),
            macro_document_model::EditorType::MarkdownSync,
        );
        let mut reloaded = EditorSurface::new(config, 19, now).expect("fresh Macro surface");
        reloaded
            .init(&doc, now, Access::Read, &mut Vec::new())
            .expect("strict reload");
        reloaded
            .projection
            .as_ref()
            .expect("reloaded projection")
            .check(&doc, reloaded.state())
            .expect("full comparison on reload");
        let paragraph = reloaded
            .state()
            .first_child_or_err(NodeKey::ROOT)
            .expect("paragraph");
        assert_eq!(
            reloaded
                .state()
                .view()
                .export_stored_json(paragraph)
                .expect("reloaded stored paragraph")
                .get("indent"),
            Some(&serde_json::Value::Null)
        );
    }
}
