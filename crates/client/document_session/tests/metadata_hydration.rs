#![cfg(feature = "application")]

use doc_sync_core::{Access, Millis, Now, UnixMillis};
use document_session::{
    EditorConfig, EditorSurface, Surface, SurfaceConfig, application_editor_config,
};
use lexical_model::{EditorMode, SerializedEditorState};
use macro_document_model::EditorType;
use serde_json::json;
use std::sync::{Arc, atomic::AtomicI64};

#[test]
fn opening_a_metadata_free_document_keeps_the_persisted_state()
-> Result<(), Box<dyn std::error::Error>> {
    let source = macro_document_model::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .initial_state(serde_json::from_value::<SerializedEditorState>(json!({
        "root": { "type": "root", "version": 1, "$": { "id": "metadata-root" }, "children": [
            { "type": "paragraph", "version": 1, "$": { "id": "metadata-block" }, "children": [
                { "type": "text", "version": 1, "text": "before", "$": { "id": "metadata-leaf" } }
            ] }
        ] }
    }))?)
    .build()?;
    let expected = source.state().to_json()?;
    assert!(
        expected
            .root
            .get("$")
            .and_then(|state| state.get("documentMetadata"))
            .is_none()
    );
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &serde_json::to_value(&expected)?,
        None,
    )?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
    let before_version = doc.oplog_vv();
    let before_raw = doc.get_deep_value();
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    let mut effects = Vec::new();
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut effects)?;
    let actual = surface.state().to_json()?;
    eprintln!(
        "{}",
        json!({
            "oplogChanged": doc.oplog_vv() != before_version,
            "rawDocumentChanged": doc.get_deep_value() != before_raw,
            "metadata": actual.root.get("$").and_then(|state| state.get("documentMetadata")),
            "modelEqual": actual == expected,
        })
    );
    assert_eq!(
        doc.oplog_vv(),
        before_version,
        "hydration wrote Loro operations"
    );
    assert_eq!(
        doc.get_deep_value(),
        before_raw,
        "hydration changed persisted fields"
    );
    assert_eq!(actual, expected, "hydration changed the public model");
    let paragraph = surface
        .state()
        .view()
        .first_child(lexical_model::NodeKey::ROOT)
        .expect("paragraph");
    let text = surface.state().view().first_child(paragraph).expect("text");
    let point = lexical_model::Point::text(text, lexical_model::Utf16Offset(6));
    let mut edit_effects = Vec::new();
    let changed = Surface::local(
        &mut surface,
        &doc,
        document_session::SessionInput::Editor(lexical_model::Input::Command {
            command: lexical_model::Command::InsertText("x".into()),
            selection: lexical_model::ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        }),
        Now {
            mono: Millis(1),
            wall: UnixMillis(1),
        },
        Access::Edit,
        true,
        &mut edit_effects,
    )?;
    assert!(changed);
    let edited = surface.state().to_json()?;
    assert_eq!(edited.root["$"]["documentMetadata"]["version"], json!(10));
    assert_eq!(surface.state().root_text_content().as_ref(), "beforex");
    assert_ne!(doc.oplog_vv(), before_version);
    let edited_version = doc.oplog_vv();
    assert_eq!(
        surface.state().to_json()?,
        edited,
        "read-only export changed metadata"
    );
    assert_eq!(
        doc.oplog_vv(),
        edited_version,
        "read-only export wrote operations"
    );
    Ok(())
}
