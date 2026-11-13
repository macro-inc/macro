//! Source's load write is a background update, so a failed load search-text projection is
//! reported as a follow-up failure and the writable open continues on a projection rebuilt
//! from the actual document.
use super::*;
use std::sync::atomic::AtomicI64;

#[cfg(feature = "test-faults")]
#[test]
fn a_failed_load_refresh_is_reported_and_the_open_continues() {
    let mut config = crate::application::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    // The browser host's root search-text writer, so the refresh has writes to fail.
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    lexical_loro::mirror::set_state(
        &doc,
        &serde_json::json!({
            "type":"root","version":1,"format":"","indent":0,"direction":null,
            "$":{"id":"root"},
            "children":[
                {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
                 "$":{"id":"stale-first"},"textFormat":0,"textStyle":"","children":[]},
                {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
                 "$":{"id":"stale-second"},"textFormat":0,"textStyle":"","children":[]}
            ]
        }),
    )
    .expect("stale document");
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let mut surface = EditorSurface::new(config, 7, now).expect("surface");
    // The fault fires after the first searchText write has reached Loro: a partial write.
    surface.fail_load_refresh_after_writes = Some(0);
    let mut view = Vec::new();
    surface
        .init(&doc, now, Access::Edit, &mut view)
        .expect("the open continues");
    assert!(view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Editor(Effect::FollowUpFailed {
            plugin: "load-search-text",
            ..
        })
    )));
    assert!(
        view.iter()
            .any(|effect| matches!(effect, ViewEffect::Initialize(_)))
    );
    let stored = lexical_loro::reconstruct_state(&doc, surface.config.policy).expect("stored");
    assert_eq!(
        stored.root["$"]["documentMetadata"],
        serde_json::json!({"version":10}),
        "the metadata upgrade still runs"
    );
    // The sealed fixup is not an undo item: one Undo removes only the metadata upgrade, the
    // partial search text stays, and nothing further is undoable.
    let partial = stored.root["children"][0]["$"]["searchText"].clone();
    assert_eq!(
        partial,
        serde_json::json!(""),
        "the partial write reached Loro"
    );
    assert!(surface.history().can_undo);
    surface
        .apply(
            &doc,
            Input::Undo,
            Now {
                mono: doc_sync_core::Millis(500),
                wall: doc_sync_core::UnixMillis(500),
            },
            Access::Edit,
            &mut Vec::new(),
        )
        .expect("undo the load group");
    let undone = lexical_loro::reconstruct_state(&doc, surface.config.policy).expect("stored");
    assert!(undone.root["$"].get("documentMetadata").is_none());
    assert_eq!(undone.root["children"][0]["$"]["searchText"], partial);
    assert!(!surface.history().can_undo, "the fixup added no undo item");
    let projection = surface.projection.as_ref().expect("rebuilt projection");
    projection
        .check(&doc, surface.state())
        .expect("projection consistent with the partially written document");
    // The projection is usable for the next local edit.
    let paragraph = surface
        .state()
        .first_child_or_err(NodeKey::ROOT)
        .expect("first");
    let point = Point::element(paragraph, ChildIndex(0));
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::InsertText("a".into()),
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            Now {
                mono: doc_sync_core::Millis(1000),
                wall: doc_sync_core::UnixMillis(1000),
            },
            Access::Edit,
            &mut Vec::new(),
        )
        .expect("next edit");
    surface
        .projection
        .as_ref()
        .expect("projection")
        .check(&doc, surface.state())
        .expect("consistent after the next edit");
    let first = surface
        .state()
        .first_child_or_err(NodeKey::ROOT)
        .expect("first");
    assert_eq!(surface.state().view().text_content(first), "a");
}
