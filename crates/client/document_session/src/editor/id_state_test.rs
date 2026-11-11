use super::*;
use lexical_rich_nodes::code::{self, CodeNode};
use macro_document_model::node_ids::ID_STATE;
use serde::{Deserialize, Serialize};

// A portable code node whose importer declares the application's actual ID key.
// The integrated CustomCode importer installs this same key explicitly on reload.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
struct StoredCode(CodeNode);
impl NodeType for StoredCode {
    const TYPE: &'static str = "stored-code";
    type Kind = ElementKind;
    const REQUIRED_STATE: &'static [RequiredState] = &[RequiredState::nested(&ID_STATE)];
    const HAS_LANGUAGE_FIELD: bool = true;
    lexical_model::impl_default_node!();
}
impl ElementNode for StoredCode {
    type Parent = CodeNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.0
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.0)
    }
}

#[test]
fn supplied_id_state_survives_code_snapshot_and_fresh_reload() {
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let config = EditorConfig {
        builder: Arc::new(|mode, peer| {
            with_session_plugins_with_id_state(
                code::register_code_nodes(Editor::builder(mode)).node::<StoredCode>(),
                peer,
                &ID_STATE,
            )
        }),
        ..EditorConfig::default()
    };
    let mut writer = EditorSurface::new(config.clone(), 7, now).unwrap();
    let doc = lexical_loro::new_doc(7).unwrap();
    writer
        .init(&doc, now, Access::Edit, &mut Vec::new())
        .unwrap();
    writer.apply(&doc,Input::SetState {
        state:serde_json::from_value(serde_json::json!({"root":{"type":"root","$":{"id":"stored-root"},"children":[
            {"type":"stored-code","language":"rust","$":{"id":"stored-code"},"children":[
                {"type":"text","text":"let persisted_value = 1;","$":{"id":"stored-leaf"}}
            ]},
            {"type":"paragraph","$":{"id":"stored-end"},"children":[]}
        ]}})).unwrap(),
        tags:TagSet::default(),
    },now,Access::Edit,&mut Vec::new()).unwrap();
    let expected = writer.state().to_json().unwrap();
    assert_eq!(expected.root["children"][0]["$"]["id"], "stored-code");
    assert_eq!(
        expected.root["children"][0]["children"][0]["$"]["id"],
        "stored-leaf"
    );
    let snapshot = doc.export(loro::ExportMode::Snapshot).unwrap();
    drop(writer);
    drop(doc);
    let restored = lexical_loro::new_doc(8).unwrap();
    restored.import(&snapshot).unwrap();
    let mut reader = EditorSurface::new(config, 8, now).unwrap();
    reader
        .init(&restored, now, Access::Edit, &mut Vec::new())
        .unwrap();
    assert_eq!(reader.state().to_json().unwrap(), expected);
}

#[test]
fn initial_state_rejects_a_different_session_key_named_id() {
    let result = with_session_plugins(
        code::register_code_nodes(Editor::builder(EditorMode::Headless)).node::<StoredCode>(),
        7,
    )
    .initial_state(
        serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[
            {"type":"stored-code","$":{"id":"persisted-code"},"children":[]}
        ]}}))
        .unwrap(),
    )
    .build();
    let error = result
        .err()
        .expect("distinct id keys must remain a startup failure");
    assert!(
        error.to_string().contains("state key collision: id"),
        "{error}"
    );
}

#[cfg(feature = "application")]
#[test]
fn application_custom_code_reopens_from_a_fresh_loro_snapshot() {
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let config = crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(std::sync::atomic::AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let mut writer = EditorSurface::new(config.clone(), 7, now).unwrap();
    let doc = lexical_loro::new_doc(7).unwrap();
    writer
        .init(&doc, now, Access::Edit, &mut Vec::new())
        .unwrap();
    let mut state = writer.state().to_json().unwrap();
    state.root.insert(
        "children".into(),
        serde_json::json!([
            {"type":"custom-code","language":"rust","$":{"id":"application-code"},"children":[
                {"type":"text","text":"let durable = \"😀\";","$":{"id":"application-leaf"}}
            ]},
            {"type":"paragraph","$":{"id":"application-end"},"children":[]}
        ]),
    );
    writer
        .apply(
            &doc,
            Input::SetState {
                state,
                tags: TagSet::default(),
            },
            now,
            Access::Edit,
            &mut Vec::new(),
        )
        .unwrap();
    let mut expected = writer.state().to_json().unwrap();
    assert_eq!(expected.root["children"][0]["$"]["id"], "application-code");
    assert_eq!(
        expected.root["children"][0]["children"][0]["$"]["id"],
        "application-leaf"
    );
    // OFF first edit persists the bare version (receipt SHA-256
    // 17135650998faced89334561c0fed993b0f4c5113a3da1740b47bb6dfe511eec).
    let bare = serde_json::json!({"version":10});
    assert_eq!(expected.root["$"]["documentMetadata"], bare);
    let persisted = lexical_loro::reconstruct_state(&doc, config.policy).unwrap();
    assert_eq!(persisted.root["$"]["documentMetadata"], bare);
    let snapshot = doc.export(loro::ExportMode::Snapshot).unwrap();
    drop(writer);
    drop(doc);
    let restored = lexical_loro::new_doc(8).unwrap();
    restored.import(&snapshot).unwrap();
    let restored_vv = restored.oplog_vv();
    let policy = config.policy;
    assert_eq!(
        lexical_loro::reconstruct_state(&restored, policy).unwrap(),
        persisted
    );
    let mut reader = EditorSurface::new(config, 8, now).unwrap();
    reader
        .init(&restored, now, Access::Edit, &mut Vec::new())
        .unwrap();
    // Ordinary Source parse/reopen export adds the null slot (receipt SHA-256
    // e85063a242345ba0cb23cbdcdacdf89643961f16ac978d8602729b0aae0c75e2).
    expected.root["$"]["documentMetadata"] =
        serde_json::json!({"version":10,"environmentTags":null});
    assert_eq!(reader.state().to_json().unwrap(), expected);
    assert_eq!(
        lexical_loro::reconstruct_state(&restored, policy).unwrap(),
        persisted
    );
    assert_eq!(restored.oplog_vv(), restored_vv);
}

#[test]
fn editable_draft_cleanup_preserves_bare_metadata_storage() {
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let config = crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(std::sync::atomic::AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let policy = config.policy;
    let doc = lexical_loro::new_doc(7).unwrap();
    lexical_loro::mirror::set_state(&doc, &serde_json::json!({
        "type":"root","version":1,"format":"","indent":0,"direction":null,
        "$":{"id":"cleanup-root","documentMetadata":{"version":10}},
        "children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
            "$":{"id":"cleanup-paragraph"},"children":[{
                "type":"comment-mark","version":1,"isDraft":true,"ids":["draft"],
                "format":"","indent":0,"direction":null,"$":{"id":"cleanup-wrapper"},
                "children":[{"type":"text","version":1,"text":"preserved","$":{"id":"cleanup-text"}}]
            }]
        }]
    })).unwrap();
    let before = lexical_loro::reconstruct_initial_state(&doc, policy).unwrap();
    assert!(before.has_transparent_wrappers);
    let before_vv = doc.oplog_vv();
    let mut reader = EditorSurface::new(config, 8, now).unwrap();
    reader
        .init(&doc, now, Access::Edit, &mut Vec::new())
        .unwrap();
    let after = lexical_loro::reconstruct_initial_state(&doc, policy).unwrap();
    assert!(!after.has_transparent_wrappers);
    assert_ne!(doc.oplog_vv(), before_vv);
    assert_eq!(
        after.state.root["$"]["documentMetadata"],
        serde_json::json!({"version":10})
    );
    let text = &after.state.root["children"][0]["children"][0];
    assert_eq!(text["text"], "preserved");
    assert_eq!(text["$"]["id"], "cleanup-text");
    assert_eq!(
        reader.state().to_json().unwrap().root["$"]["documentMetadata"],
        serde_json::json!({"version":10,"environmentTags":null})
    );
    reader
        .projection
        .as_ref()
        .unwrap()
        .check(&doc, reader.state())
        .unwrap();
}

#[test]
fn standalone_key_raw_import_keeps_empty_missing_and_nonstring_ids_omitted() {
    for fields in [
        serde_json::json!({"type":"root","$":{"id":""}}),
        serde_json::json!({"type":"root","$":{"id":null}}),
        serde_json::json!({"type":"root"}),
        serde_json::json!({"type":"root","$":{"id":17}}),
        serde_json::json!({"type":"root","$":{"id":false}}),
        serde_json::json!({"type":"root","$":{"id":[]}}),
        serde_json::json!({"type":"root","$":{"id":{}}}),
    ] {
        let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
        editor
            .update(|tx| tx.set_state(NodeKey::ROOT, &builder::ID, Some("before".into())))
            .unwrap();
        editor
            .update(|tx| tx.apply_remote_fields(NodeKey::ROOT, fields.as_object().unwrap()))
            .unwrap();
        let json = editor.state().to_json().unwrap();
        assert!(
            json.root
                .get("$")
                .and_then(|state| state.get("id"))
                .is_none(),
            "{json:?}"
        );
    }
}
