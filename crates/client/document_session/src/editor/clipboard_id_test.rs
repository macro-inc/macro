use super::*;
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn ids(value: &Value) -> Vec<String> {
    let mut result = Vec::new();
    if let Some(id) = value["$"]["id"].as_str() {
        result.push(id.to_owned());
    }
    if let Some(children) = value["children"].as_array() {
        for child in children {
            result.extend(ids(child));
        }
    }
    result
}

fn now() -> Now {
    Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    }
}

fn surface(peer: u64, supplied: bool) -> (EditorSurface, LoroDoc) {
    let config = EditorConfig {
        builder: Arc::new(move |mode, peer| {
            if supplied {
                with_session_plugins_with_id_state(
                    lexical_rich_nodes::register_rich_text_nodes(Editor::builder(mode)),
                    peer,
                    &macro_document_model::node_ids::ID_STATE,
                )
            } else {
                default_editor_builder(mode, peer)
            }
        }),
        ..EditorConfig::default()
    };
    let mut surface = EditorSurface::new(config, peer, now()).unwrap();
    let doc = lexical_loro::new_doc(peer).unwrap();
    surface
        .init(&doc, now(), Access::Edit, &mut vec![])
        .unwrap();
    surface.focused = true;
    surface.focus_known = true;
    (surface, doc)
}

fn command(surface: &mut EditorSurface, doc: &LoroDoc, command: Command) {
    surface
        .apply(
            doc,
            Input::Command {
                command,
                selection: ViewSelection::KeepModel,
            },
            now(),
            Access::Edit,
            &mut vec![],
        )
        .unwrap();
}

fn paste(surface: &mut EditorSurface, doc: &LoroDoc, nodes: &[Value], html: bool) {
    let point = Point::element(
        NodeKey::ROOT,
        ChildIndex(
            surface
                .state()
                .view()
                .children(NodeKey::ROOT)
                .count()
                .try_into()
                .unwrap(),
        ),
    );
    let payload = if html {
        ClipboardPayload {
            data: [("text/html".into(), "<p><b>copied</b></p>".into())]
                .into_iter()
                .collect(),
            has_files: false,
            html_nodes: Some(
                nodes
                    .iter()
                    .map(|node| node.as_object().unwrap().clone())
                    .collect(),
            ),
        }
    } else {
        ClipboardPayload {
            data: [(
                "application/x-lexical-editor".into(),
                json!({"namespace":"document-session", "nodes":nodes}).to_string(),
            )]
            .into_iter()
            .collect(),
            has_files: false,
            html_nodes: None,
        }
    };
    surface
        .apply(
            doc,
            Input::Command {
                command: Command::Paste(payload),
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            now(),
            Access::Edit,
            &mut vec![],
        )
        .unwrap();
}

#[test]
fn clipboard_cross_document_and_repeated_paste_refresh_ids_then_history_preserves_them() {
    for supplied in [false, true] {
        for html in [false, true] {
            let (mut source, source_doc) = surface(7, supplied);
            source.apply(&source_doc, Input::SetState {
                state: serde_json::from_value(json!({"root":{"type":"root","children":[
                    {"type":"paragraph","children":[{"type":"text","text":"copied","format":1}]},
                    {"type":"paragraph","children":[{"type":"text","text":"second","format":2}]},
                    {"type":"paragraph","children":[{"type":"text","text":"third","format":4}]}
                ]}})).unwrap(), tags: TagSet::default(),
            }, now(), Access::Edit, &mut vec![]).unwrap();
            let copied = source.state().to_json().unwrap().root["children"]
                .as_array()
                .unwrap()
                .clone();
            let source_ids = copied.iter().flat_map(ids).collect::<BTreeSet<_>>();
            assert_eq!(source_ids.len(), 6);
            let (mut target, target_doc) = surface(8, supplied);
            command(&mut target, &target_doc, Command::ClearHistory);
            paste(&mut target, &target_doc, &copied, html);
            let first = target.state().to_json().unwrap();
            let pasted_ids = ids(&Value::Object(first.root.clone()))
                .into_iter()
                .collect::<BTreeSet<_>>();
            assert_eq!(pasted_ids.len(), 7);
            assert_eq!(first.root["children"][0]["children"][0]["format"], 1);
            assert!(
                source_ids.is_disjoint(&pasted_ids),
                "copied identities survived cross-document paste"
            );
            let selection = target.state().selection().unwrap().as_range().unwrap();
            let caret_id = target
                .state()
                .view()
                .export_json(selection.anchor.key())
                .unwrap()["$"]["id"]
                .clone();
            let caret_offset = selection.anchor.offset();
            command(&mut target, &target_doc, Command::Undo);
            assert_ne!(target.state().to_json().unwrap(), first);
            assert!(
                !target
                    .state()
                    .view()
                    .text_content(NodeKey::ROOT)
                    .contains("copied")
            );
            command(&mut target, &target_doc, Command::Redo);
            let selection = target.state().selection().unwrap().as_range().unwrap();
            assert_eq!(selection.anchor.offset(), caret_offset);
            assert_eq!(selection.focus.offset(), caret_offset);
            assert_eq!(
                target
                    .state()
                    .view()
                    .export_json(selection.anchor.key())
                    .unwrap()["$"]["id"],
                caret_id
            );
            assert_eq!(
                target
                    .state()
                    .view()
                    .export_json(selection.focus.key())
                    .unwrap()["$"]["id"],
                caret_id
            );
            assert_eq!(target.state().to_json().unwrap(), first);
            paste(&mut target, &target_doc, &copied, html);
            let twice = target.state().to_json().unwrap();
            let all = ids(&Value::Object(twice.root.clone()));
            assert_eq!(all.len(), all.iter().collect::<BTreeSet<_>>().len());
            assert!(source_ids.is_disjoint(&all.into_iter().collect()));
            // Paste into the original document as well: attached source IDs stay intact.
            paste(&mut source, &source_doc, &copied, html);
            let same_doc = source.state().to_json().unwrap();
            let all = ids(&Value::Object(same_doc.root.clone()));
            assert_eq!(all.len(), all.iter().collect::<BTreeSet<_>>().len());
            assert_eq!(
                &same_doc.root["children"].as_array().unwrap()[..3],
                copied.as_slice()
            );
        }
    }
}

#[test]
fn clipboard_cut_paste_replaces_detached_source_ids() {
    for supplied in [false, true] {
        let (mut surface, doc) = surface(7, supplied);
        surface
            .apply(
                &doc,
                Input::SetState {
                    state: serde_json::from_value(json!({"root":{"type":"root","children":[
                        {"type":"paragraph","children":[{"type":"text","text":"cut me","format":1}]}
                    ]}}))
                    .unwrap(),
                    tags: TagSet::default(),
                },
                now(),
                Access::Edit,
                &mut vec![],
            )
            .unwrap();
        let copied = surface.state().to_json().unwrap().root["children"]
            .as_array()
            .unwrap()
            .clone();
        let old_ids = copied.iter().flat_map(ids).collect::<BTreeSet<_>>();
        assert_eq!(old_ids.len(), 2);
        command(&mut surface, &doc, Command::SelectAll(None));
        command(&mut surface, &doc, Command::RemoveText);
        assert!(
            !surface
                .state()
                .view()
                .text_content(NodeKey::ROOT)
                .contains("cut me")
        );
        paste(&mut surface, &doc, &copied, false);
        let pasted = surface.state().to_json().unwrap();
        let new_ids = ids(&Value::Object(pasted.root.clone()))
            .into_iter()
            .collect::<BTreeSet<_>>();
        // Removing selected text retains its destination paragraph. Pasting a
        // paragraph merges into that live block; only imported nodes get new IDs.
        assert_eq!(pasted.root["children"][0]["$"]["id"], copied[0]["$"]["id"]);
        assert!(!new_ids.contains(copied[0]["children"][0]["$"]["id"].as_str().unwrap()));
        assert!(
            surface
                .state()
                .view()
                .text_content(NodeKey::ROOT)
                .contains("cut me")
        );
    }
}

#[test]
fn plain_and_markdown_text_pastes_keep_existing_ids_and_assign_fresh_nodes() {
    for text in ["plain\nsecond", "**markdown**\n# heading"] {
        let (mut surface, doc) = surface(7, true);
        paste(
            &mut surface,
            &doc,
            &[json!({"type":"paragraph","children":[]})],
            false,
        );
        let paragraph = surface
            .state()
            .view()
            .children(NodeKey::ROOT)
            .next()
            .unwrap();
        let existing = surface
            .state()
            .view()
            .get_state(paragraph, &macro_document_model::node_ids::ID_STATE)
            .unwrap();
        let point = Point::element(paragraph, ChildIndex(0));
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::Paste(ClipboardPayload {
                        data: [("text/plain".into(), text.into())].into_iter().collect(),
                        has_files: false,
                        html_nodes: None,
                    }),
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                },
                now(),
                Access::Edit,
                &mut vec![],
            )
            .unwrap();
        assert_eq!(
            surface
                .state()
                .view()
                .get_state(paragraph, &macro_document_model::node_ids::ID_STATE)
                .unwrap(),
            existing
        );
        let state = surface.state().to_json().unwrap();
        let all = ids(&Value::Object(state.root));
        assert_eq!(all.len(), all.iter().collect::<BTreeSet<_>>().len());
        assert!(all.len() >= 5);
    }
}
