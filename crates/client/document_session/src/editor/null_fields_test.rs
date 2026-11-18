//! Source null text fields through the native Loro writer and the ordinary
//! load (slice B). Literals are observed Source values for the same document
//! loaded through the app's id-assigning wrapper (probe log be8649fb): Source
//! keeps null format/detail/style, exports no mode, derives the paragraph's
//! textFormat/textStyle from its first text child, and its Loro writer stores
//! null for every one of these fields.
use super::*;
use loro::ToJson;
use std::sync::atomic::AtomicI64;

fn config() -> EditorConfig {
    crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    )
}
fn now() -> Now {
    Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    }
}
/// The Loro deep value the native writer stores for an imported state.
fn native_write(state: serde_json::Value) -> serde_json::Value {
    let config = config();
    let initial = SerializedEditorState {
        root: state.as_object().cloned().expect("root object"),
    };
    let mut imported = EditorSurface::builder(&config, config.mode, 8)
        .initial_state(initial)
        .build()
        .expect("initial state");
    let commits = imported.take_initial_commits();
    let base = commits
        .first()
        .map_or(imported.state(), |commit| &commit.prev);
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    lexical_loro::LoroProjection::initialize(&doc, base, config.policy, 0)
        .expect("native initialize");
    doc.get_deep_value().to_json_value()["root"].clone()
}
/// What Source's Loro writer stores for this document (probe be8649fb).
fn source_stored() -> serde_json::Value {
    serde_json::json!({
        "type":"root","version":1,"format":"",
        "children":[{
            "$":{"id":"OdqPM9gw"},"textFormat":null,"textStyle":null,"direction":null,
            "indent":null,"type":"paragraph","version":1,"format":"",
            "children":[
                {"$":{"id":"mXsX_K_a"},"text":"hi ","style":null,"type":"text","version":1,
                    "format":null,"mode":null,"detail":null},
                {"$":{"id":"SQM0B-xS"},"text":"/","style":null,"type":"inline-search",
                    "version":1,"format":null,"mode":null,"detail":null}
            ]
        }]
    })
}
/// The own fields of `node` and its descendants, without children, as rows.
fn rows(node: &serde_json::Value, out: &mut Vec<serde_json::Value>) {
    let mut own = node.as_object().cloned().expect("node object");
    let children = own.remove("children");
    out.push(serde_json::Value::Object(own));
    if let Some(serde_json::Value::Array(children)) = children {
        for child in &children {
            rows(child, out);
        }
    }
}

#[test]
fn native_writes_an_imported_missing_key_text_as_source_stores_it() {
    // The same document as JSON with every optional text field omitted, as a
    // JSON import leaves it; Source's writer stores null for each (probe 2).
    let imported = serde_json::json!({
        "type":"root","version":1,
        "children":[{"type":"paragraph","version":1,"$":{"id":"OdqPM9gw"},
            "children":[
                {"type":"text","version":1,"text":"hi ","$":{"id":"mXsX_K_a"}},
                {"type":"inline-search","version":1,"text":"/","$":{"id":"SQM0B-xS"}}
            ]}]
    });
    let mut actual = Vec::new();
    rows(&native_write(imported), &mut actual);
    let mut expected = Vec::new();
    rows(&source_stored(), &mut expected);
    assert_eq!(actual, expected);
}

#[test]
fn native_writes_an_absent_element_direction_and_indent_as_source_stores_them() {
    // The exact input and stored map of the one-row Source writer observation
    // (probe log 1d9a47d4): Source stores null for the paragraph's absent
    // direction and indent, the root carries neither key, and textFormat and
    // textStyle follow the first text child.
    let input: serde_json::Value = serde_json::from_str(
        r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"format":"","$":{"id":"OdqPM9gw"},"children":[{"type":"text","version":1,"text":"hi","format":0,"detail":0,"mode":"normal","style":"","$":{"id":"mXsX_K_a"}}]}]}}"#,
    )
    .expect("probe input");
    let imported = input["root"].clone();
    let mut actual = Vec::new();
    rows(&native_write(imported), &mut actual);
    assert_eq!(
        actual,
        vec![
            serde_json::json!({"format":"","type":"root","version":1}),
            serde_json::json!({"$":{"id":"OdqPM9gw"},"direction":null,"format":"","indent":null,
                "textFormat":0,"textStyle":"","type":"paragraph","version":1}),
            serde_json::json!({"$":{"id":"mXsX_K_a"},"detail":0,"format":0,"mode":"normal",
                "style":"","text":"hi","type":"text","version":1}),
        ]
    );
}

#[test]
fn native_writes_a_null_field_text_as_source_stores_it() {
    let mut actual = Vec::new();
    rows(&native_write(source_stored()), &mut actual);
    let mut expected = Vec::new();
    rows(&source_stored(), &mut expected);
    assert_eq!(actual, expected);
}

#[test]
fn a_natively_created_text_with_every_field_present_keeps_its_stored_bytes() {
    // No absent or null fields: the stored map must not change.
    let created = serde_json::json!({
        "type":"root","version":1,"format":"","indent":0,"direction":null,
        "children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
            "textFormat":0,"textStyle":"","$":{"id":"OdqPM9gw"},
            "children":[{"type":"text","version":1,"text":"hi","format":0,"detail":0,
                "mode":"normal","style":"","$":{"id":"mXsX_K_a"}}]}]
    });
    let mut actual = Vec::new();
    rows(&native_write(created), &mut actual);
    assert_eq!(
        actual,
        vec![
            serde_json::json!({"direction":null,"format":"","indent":0,"type":"root","version":1}),
            serde_json::json!({"$":{"id":"OdqPM9gw"},"direction":null,"format":"","indent":0,
                "textFormat":0,"textStyle":"","type":"paragraph","version":1}),
            serde_json::json!({"$":{"id":"mXsX_K_a"},"detail":0,"format":0,"mode":"normal",
                "style":"","text":"hi","type":"text","version":1}),
        ]
    );
}

#[test]
fn the_source_written_null_field_document_opens_and_loads_as_source_does() {
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    lexical_loro::mirror::set_state(&doc, &source_stored()).expect("Source-written map");
    let stored = doc.get_deep_value().to_json_value();
    let mut surface = EditorSurface::new(config(), 8, now()).expect("Macro session");
    let mut view = Vec::new();
    surface
        .init(&doc, now(), Access::Edit, &mut view)
        .expect("strict attach");
    // The model after load, as Source's post-load toJSON (probe be8649fb),
    // every field and every NodeState key compared. Neither side stamps peer
    // ownership on inline-search here: the probe's wrapper registers no
    // peerIdPlugin, and this native session's PeerIdPlugin covers Await only.
    // The root's $.documentMetadata row is derived from Source code, not the
    // probe (its wrapper lacks the plugin): documentMetadataPlugin.ts:116-127
    // sets version = MARKDOWN_VERSION_COUNTER (version.ts:44, 11) in a queued
    // HISTORY_MERGE update after any update with mutatedNodes, and
    // $setDocumentMetadata (:54-58) merges over parse()'s result. The stored
    // map here has no root $ (source_stored()), so parse() returns
    // DEFAULT_METADATA {version:-1} (:21-29) and no environmentTags key
    // appears; be8649fb covers the rest of the tree.
    let model = surface.state().to_json().expect("model export");
    // The root id this Edit open minted (ID_STORED_AT_OPEN, root-id open control outcome
    // 6e501bb9): read from the model only for this one field, checked to be a Source-shaped
    // nanoid(8), and checked below to be the id the open stored.
    let root_id = model.root["$"]["id"]
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
    let mut actual = Vec::new();
    rows(&serde_json::Value::Object(model.root.clone()), &mut actual);
    assert_eq!(
        actual,
        vec![
            serde_json::json!({"$":{"id":root_id,"documentMetadata":{"version":11}},"format":"",
                "type":"root","version":1}),
            serde_json::json!({"$":{"id":"OdqPM9gw"},"direction":null,"format":"","indent":null,
                "textFormat":null,"textStyle":null,"type":"paragraph","version":1}),
            serde_json::json!({"$":{"id":"mXsX_K_a"},"detail":null,"format":null,"style":null,
                "text":"hi ","type":"text","version":1}),
            serde_json::json!({"$":{"id":"SQM0B-xS"},"detail":null,"format":null,"style":null,
                "text":"/","type":"inline-search","version":1}),
        ]
    );
    // The null fields cause no write-back: Source writes the same nulls. The
    // only stored change is the root's $.documentMetadata {version:10}: the
    // union base rule that a writable open upgrades a metadata-free document
    // (tests/metadata_hydration.rs:15). This is not observed Source write-back
    // at open; Source's exact write timing is not established here.
    let mut after = Vec::new();
    rows(&doc.get_deep_value().to_json_value()["root"], &mut after);
    let mut expected = Vec::new();
    rows(&stored["root"], &mut expected);
    assert_eq!(
        expected[0],
        serde_json::json!({"format":"","type":"root","version":1})
    );
    // The open also stores the minted root id (6e501bb9), the same id as the model's.
    expected[0] = serde_json::json!({"$":{"id":root_id,"documentMetadata":{"version":11}},
        "format":"","type":"root","version":1});
    assert_eq!(after, expected);
    // Control: a null-style text renders; the view receives its Initialize.
    assert!(
        view.iter()
            .any(|effect| matches!(effect, ViewEffect::Initialize(_))),
        "no Initialize view effect"
    );
}
