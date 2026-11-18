use super::*;
use crate::application_editor_config;
use macro_document_model::{EditorType, node_ids::ID_STATE};
use std::sync::atomic::AtomicI64;

/// Formerly `application_root_stays_outside_identity_tracking_while_children_repair`. The
/// application root now carries the id its open minted (ID_STORED_AT_OPEN, root-id open control
/// outcome 6e501bb9) and is indexed; the surviving purpose is unchanged: children repair their
/// own ids and the root's id does not move while they do.
#[test]
fn application_root_keeps_its_open_id_while_children_repair() -> Result<(), Error> {
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
    let root_id = state.root["$"]["id"]
        .as_str()
        .expect("minted root id")
        .to_owned();
    assert_eq!(root_id.len(), 8, "{root_id}");
    assert!(
        root_id
            .bytes()
            .all(|byte| macro_document_model::node_ids::NANOID_ALPHABET.contains(&byte)),
        "{root_id}"
    );
    let first_paragraph_id = state.root["children"][0]["$"]["id"].clone();
    let text_id = state.root["children"][0]["children"][0]["$"]["id"].clone();
    assert!(first_paragraph_id.as_str().is_some_and(|id| !id.is_empty()));
    assert!(text_id.as_str().is_some_and(|id| !id.is_empty()));
    assert_eq!(
        editor.extension::<NodeIdIndex>()?.keys.get(&NodeKey::ROOT),
        Some(&root_id),
        "the open's root id is indexed"
    );
    editor.update(|tx| {
        tx.set_state(paragraph, &ID_STATE, None)?;
        tx.mark_dirty(NodeKey::ROOT)
    })?;
    let state = editor.state().to_json()?;
    assert_eq!(
        state.root["$"]["id"],
        root_id.as_str(),
        "the root id does not move"
    );
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

/// Formerly `application_imported_root_id_is_preserved_without_owning_child_conflicts`. The
/// imported root id is still preserved; a LATER child carrying the same id is regenerated,
/// because the root now owns it from the open, as Source does (root-id undo/collision Source
/// control r3, row (v), capture collision-later.after-collision.json): the later 'shared-id'
/// paragraph became '64ajgj6i' and Source's idToNodeKeyMap kept 'shared-id' -> root.
#[test]
fn application_imported_root_id_is_preserved_and_owns_a_later_duplicate() -> Result<(), Error> {
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
    let regenerated = state.root["children"][0]["$"]["id"]
        .as_str()
        .expect("child id")
        .to_owned();
    assert_ne!(
        regenerated, "shared-id",
        "the later duplicate is regenerated"
    );
    assert_eq!(regenerated.len(), 8, "{regenerated}");
    assert!(
        regenerated
            .bytes()
            .all(|byte| macro_document_model::node_ids::NANOID_ALPHABET.contains(&byte)),
        "{regenerated}"
    );
    let index = editor.extension::<NodeIdIndex>()?;
    assert_eq!(index.ids.get("shared-id"), Some(&NodeKey::ROOT));
    assert_eq!(
        index.keys.get(&NodeKey::ROOT).map(String::as_str),
        Some("shared-id")
    );
    assert_eq!(index.ids.get(regenerated.as_str()), Some(&paragraph));
    Ok(())
}

/// GUARD (root-id undo/collision Source control r3, row (vi), capture
/// collision-at-open.at-open.json): when the
/// root and a child BOTH store the same id at open, both keep it (the open's id pass never
/// regenerates) and the index maps the id to the child, as Source's idToNodeKeyMap does
/// ('shared-id' -> the paragraph, the root absent from the map).
#[test]
fn application_duplicate_root_and_child_ids_at_open_are_both_kept() -> Result<(), Error> {
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let editor = (config.builder)(EditorMode::Headless, 9)
        .initial_state(serde_json::from_value(serde_json::json!({
            "root": {"type":"root", "$":{"id":"shared-id"}, "children":[
                {"type":"paragraph", "$":{"id":"shared-id"}, "children":[
                    {"type":"text", "text":"hello", "$":{"id":"text0001"}}
                ]}
            ]}
        }))?)
        .build()
        .expect("application editor");
    let state = editor.state().to_json()?;
    assert_eq!(state.root["$"]["id"], "shared-id");
    assert_eq!(state.root["children"][0]["$"]["id"], "shared-id");
    assert_eq!(
        state.root["children"][0]["children"][0]["$"]["id"],
        "text0001"
    );
    let paragraph = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    // Only the id -> node direction is a Source fact (r3 (vi) idToNodeKeyMap); the node -> id
    // direction for the root is unobserved in Source and is not asserted here.
    let index = editor.extension::<NodeIdIndex>()?;
    assert_eq!(index.ids.get("shared-id"), Some(&paragraph));
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
