use super::*;
use crate::application_editor_config;
use macro_document_model::{EditorType, node_ids::ID_STATE};
use std::sync::atomic::AtomicI64;

#[test]
fn application_root_stays_outside_identity_tracking_while_children_repair() -> Result<(), Error> {
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let mut editor = (config.builder)(EditorMode::Headless, 7)
        .initial_state(serde_json::from_value(serde_json::json!({
            "root": {"type":"root", "$":{"documentMetadata":{"version":10}}, "children":[]}
        }))?)
        .build()
        .expect("application editor");
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("body")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.mark_dirty(NodeKey::ROOT)?;
        Ok((paragraph.key(), text.key()))
    })?;
    let state = editor.state().to_json()?;
    assert!(state.root["$"].get("id").is_none());
    let first_paragraph_id = state.root["children"][0]["$"]["id"].clone();
    let text_id = state.root["children"][0]["children"][0]["$"]["id"].clone();
    assert!(first_paragraph_id.as_str().is_some_and(|id| !id.is_empty()));
    assert!(text_id.as_str().is_some_and(|id| !id.is_empty()));
    assert!(
        !editor
            .extension::<NodeIdIndex>()?
            .keys
            .contains_key(&NodeKey::ROOT)
    );
    editor.update(|tx| {
        tx.set_state(paragraph, &ID_STATE, None)?;
        tx.mark_dirty(NodeKey::ROOT)
    })?;
    let state = editor.state().to_json()?;
    assert!(state.root["$"].get("id").is_none());
    assert!(
        state.root["children"][0]["$"]["id"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
    );
    assert_ne!(state.root["children"][0]["$"]["id"], first_paragraph_id);
    assert_eq!(state.root["children"][0]["children"][0]["$"]["id"], text_id);
    assert_eq!(editor.state().view().parent(text), Some(paragraph));
    Ok(())
}

#[test]
fn application_imported_root_id_is_preserved_without_owning_child_conflicts() -> Result<(), Error> {
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let mut editor = (config.builder)(EditorMode::Headless, 9)
        .initial_state(serde_json::from_value(serde_json::json!({
            "root": {"type":"root", "$":{"id":"shared-id"}, "children":[]}
        }))?)
        .build()
        .expect("application editor");
    let (paragraph, _) = editor.update(|tx| {
        tx.mark_dirty(NodeKey::ROOT)?;
        let paragraph = tx.create(Paragraph::default())?;
        tx.set_state(paragraph, &ID_STATE, Some("shared-id".into()))?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    let state = editor.state().to_json()?;
    assert_eq!(state.root["$"]["id"], "shared-id");
    assert_eq!(state.root["children"][0]["$"]["id"], "shared-id");
    let index = editor.extension::<NodeIdIndex>()?;
    assert_eq!(index.ids.get("shared-id"), Some(&paragraph));
    assert!(!index.keys.contains_key(&NodeKey::ROOT));
    Ok(())
}

#[test]
fn standalone_root_identity_tracking_is_preserved() -> Result<(), Error> {
    let mut editor = default_editor_builder(EditorMode::Headless, 11)
        .build()
        .expect("standalone editor");
    editor.update(|tx| tx.mark_dirty(NodeKey::ROOT))?;
    let state = editor.state().to_json()?;
    let id = state.root["$"]["id"].as_str().expect("root identity");
    assert!(!id.is_empty());
    assert_eq!(
        editor.extension::<NodeIdIndex>()?.ids.get(id),
        Some(&NodeKey::ROOT)
    );
    Ok(())
}

#[test]
fn application_set_state_preserves_missing_root_id_in_model_and_storage() {
    let now = doc_sync_core::Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let policy = config.policy;
    let mut surface = EditorSurface::new(config, 13, now).expect("surface");
    let doc = lexical_loro::new_doc(13).expect("document");
    surface
        .init(&doc, now, doc_sync_core::Access::Edit, &mut Vec::new())
        .expect("initialize");
    surface
        .apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(serde_json::json!({
                    "root": {"type":"root", "$":{"documentMetadata":{"version":10}}, "children":[
                        {"type":"paragraph", "$":{"id":"paragraph"}, "children":[
                            {"type":"text", "text":"body", "$":{"id":"text"}}
                        ]}
                    ]}
                }))
                .expect("state"),
                tags: TagSet::default(),
            },
            now,
            doc_sync_core::Access::Edit,
            &mut Vec::new(),
        )
        .expect("set state");
    let model = surface.state().to_json().expect("model");
    assert!(model.root["$"].get("id").is_none());
    assert_eq!(model.root["children"][0]["$"]["id"], "paragraph");
    assert_eq!(model.root["children"][0]["children"][0]["$"]["id"], "text");
    let stored = lexical_loro::reconstruct_state(&doc, policy).expect("stored state");
    assert!(stored.root["$"].get("id").is_none());
    surface
        .projection
        .as_ref()
        .expect("projection")
        .check(&doc, surface.state())
        .expect("strict projection");
}
