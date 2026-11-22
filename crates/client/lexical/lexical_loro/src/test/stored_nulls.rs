//! The attach comparison's stored-null rule (slice B) is one-directional: a
//! Loro writer stores an undefined text field as null (Source loroSyncState,
//! probes be8649fb and 1d9a47d4), so a stored null matches a model whose field
//! is absent; a model null never matches a stored map that lacks the key.
use super::*;

fn editor(text: serde_json::Value) -> Editor {
    Editor::builder(EditorMode::Headless)
        .initial_state(
            serde_json::from_value(json!({"root":{
                "type":"root","version":1,
                "children":[{"type":"paragraph","version":1,"format":"","direction":null,
                    "indent":0,"textFormat":0,"textStyle":"","children":[text]}]
            }}))
            .expect("literal serialized state"),
        )
        .build()
        .expect("editor")
}
fn stored(text: serde_json::Value) -> LoroDoc {
    let doc = new_doc(1).expect("doc");
    mirror::set_state(
        &doc,
        // The paragraph's textFormat follows its first text child's format; a
        // writer stores that undefined or null as null.
        &json!({"type":"root","version":1,"format":"",
            "children":[{"type":"paragraph","version":1,"format":"","direction":null,
                "indent":0,"textFormat":null,"textStyle":"","children":[text]}]}),
    )
    .expect("stored map");
    doc
}

#[test]
fn a_stored_null_format_matches_a_model_with_the_format_absent() {
    let editor = editor(
        json!({"type":"text","version":1,"text":"hi","detail":0,"mode":"normal","style":""}),
    );
    let doc = stored(
        json!({"type":"text","version":1,"text":"hi","format":null,"detail":0,"mode":"normal","style":""}),
    );
    assert!(LoroProjection::attach(&doc, editor.state(), &PLAIN).is_ok());
}

#[test]
fn a_model_null_format_does_not_match_a_stored_map_without_the_key() {
    let editor = editor(
        json!({"type":"text","version":1,"text":"hi","format":null,"detail":0,"mode":"normal","style":""}),
    );
    let doc = stored(
        json!({"type":"text","version":1,"text":"hi","detail":0,"mode":"normal","style":""}),
    );
    assert!(matches!(
        LoroProjection::attach(&doc, editor.state(), &PLAIN),
        Err(error) if error.to_string().contains("attach synced JSON differs")
    ));
}

#[test]
fn a_stored_null_does_not_match_a_model_value() {
    let editor = editor(
        json!({"type":"text","version":1,"text":"hi","format":0,"detail":0,"mode":"normal","style":""}),
    );
    let doc = stored(
        json!({"type":"text","version":1,"text":"hi","format":null,"detail":0,"mode":"normal","style":""}),
    );
    assert!(LoroProjection::attach(&doc, editor.state(), &PLAIN).is_err());
}

#[test]
fn a_stored_null_direction_on_a_non_paragraph_element_does_not_match_a_model_absent() {
    // Only text kinds and Paragraph have writer-encoded nulls; no writer is
    // observed to store null for another element's undefined direction.
    let state = |direction: Option<serde_json::Value>| {
        let mut quote = json!({"type":"quote","version":1,"format":"","indent":0,
            "children":[{"type":"text","version":1,"text":"hi","format":0,"detail":0,
                "mode":"normal","style":""}]});
        if let Some(direction) = direction {
            quote
                .as_object_mut()
                .expect("quote")
                .insert("direction".into(), direction);
        }
        quote
    };
    let editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .initial_state(
            serde_json::from_value(json!({"root":{"type":"root","version":1,
                "children":[state(None)]}}))
            .expect("literal serialized state"),
        )
        .build()
        .expect("editor");
    // Control: the same stored map without the key attaches.
    let control = new_doc(2).expect("doc");
    mirror::set_state(
        &control,
        &json!({"type":"root","version":1,"format":"","children":[state(None)]}),
    )
    .expect("stored map");
    assert!(LoroProjection::attach(&control, editor.state(), &PLAIN).is_ok());
    let doc = new_doc(1).expect("doc");
    mirror::set_state(
        &doc,
        &json!({"type":"root","version":1,"format":"",
            "children":[state(Some(serde_json::Value::Null))]}),
    )
    .expect("stored map");
    assert!(matches!(
        LoroProjection::attach(&doc, editor.state(), &PLAIN),
        Err(error) if error.to_string().contains("attach synced JSON differs")
    ));
}

// ---- Loro-driven imports restore stored nulls on untouched nodes -----------
// Source's reconcile walks the whole tree on every Loro-driven update and gives
// each node its stored value, so an untouched node whose model field is
// undefined takes the stored null (Source undo/redo probe a5c2a8e1, row 1:
// 'third' and qrjUG59N). A local commit never imports.

/// Paragraph A holds a full-field text; paragraph B a text whose format, detail
/// and style are absent, so the writer stores them as null.
fn two_blocks() -> (Editor, NodeKey, NodeKey) {
    let editor = Editor::builder(EditorMode::Headless)
        .initial_state(
            serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
                {"type":"paragraph","version":1,"format":"","direction":null,"indent":0,
                    "textFormat":0,"textStyle":"","children":[{"type":"text","version":1,
                    "text":"a","format":0,"detail":0,"mode":"normal","style":""}]},
                {"type":"paragraph","version":1,"format":"","direction":null,"indent":0,
                    "textFormat":0,"textStyle":"","children":[{"type":"text","version":1,
                    "text":"b","mode":"normal"}]}
            ]}}))
            .expect("literal serialized state"),
        )
        .build()
        .expect("editor");
    let view = editor.state().view();
    let first = view.first_child_or_err(NodeKey::ROOT).expect("A");
    let a_text = view.first_child_or_err(first).expect("A text");
    let second = view.next_sibling(first).expect("B");
    let b_text = view.first_child_or_err(second).expect("B text");
    (editor, a_text, b_text)
}
fn update_json(changes: &RemoteChanges, key: NodeKey) -> Option<&SerializedNode> {
    changes.changes.iter().find_map(|change| match change {
        NodeChange::Update {
            node: NodeTarget::Key(node),
            json,
            ..
        } if *node == key => Some(json),
        _ => None,
    })
}

#[test]
fn a_remote_edit_in_another_block_gives_untouched_absent_fields_their_stored_null() {
    let (editor, a_text, b_text) = two_blocks();
    let doc = new_doc(1).expect("doc");
    let mut projection =
        LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0).expect("initialize");
    assert!(projection.pending_nulls.contains(&b_text));
    // A remote peer edits A's text only.
    let map = projection.index.map(&doc, a_text).expect("A map");
    let Some(loro::ValueOrContainer::Container(loro::Container::Text(text))) = map.get("text")
    else {
        panic!("A text container");
    };
    text.insert(1, "!").expect("remote insert");
    doc.commit_with(loro::CommitOptions::new().origin("remote").timestamp(1));
    let changes = projection
        .take_remote(&doc, editor.state())
        .expect("remote");
    let b = update_json(&changes, b_text).expect("untouched B imported");
    for name in ["detail", "format", "style"] {
        assert_eq!(b.get(name), Some(&serde_json::Value::Null), "{name}");
    }
    assert!(projection.pending_nulls.is_empty());
}

#[test]
fn an_undo_gives_untouched_absent_fields_their_stored_null() {
    let (mut editor, a_text, b_text) = two_blocks();
    let doc = new_doc(1).expect("doc");
    let mut projection =
        LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0).expect("initialize");
    let mut undo = loro::UndoManager::new(&doc);
    let (_, commit) = editor
        .update(|tx| {
            tx.text(a_text)?.set_text_content("a edited")?;
            Ok(())
        })
        .expect("local edit");
    projection
        .local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)
        .expect("local commit");
    assert!(undo.undo().expect("undo"));
    let changes = projection
        .take_remote(&doc, editor.state())
        .expect("history import");
    let b = update_json(&changes, b_text).expect("untouched B imported by the undo");
    for name in ["detail", "format", "style"] {
        assert_eq!(b.get(name), Some(&serde_json::Value::Null), "{name}");
    }
}

#[test]
fn a_local_commit_never_imports_the_stored_nulls() {
    let (mut editor, a_text, b_text) = two_blocks();
    let doc = new_doc(1).expect("doc");
    let mut projection =
        LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0).expect("initialize");
    let (_, commit) = editor
        .update(|tx| {
            tx.text(a_text)?.set_text_content("a edited")?;
            Ok(())
        })
        .expect("local edit");
    projection
        .local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)
        .expect("local commit");
    // The model keeps B's fields absent and B stays pending.
    let own = editor.state().view().export_json(b_text).expect("B export");
    assert!(!own.contains_key("format"));
    assert!(projection.pending_nulls.contains(&b_text));
    let changes = projection
        .take_remote(&doc, editor.state())
        .expect("no import");
    assert!(changes.changes.is_empty());
}

#[test]
fn a_diverged_remote_projection_keeps_the_pending_nulls() {
    let (editor, a_text, b_text) = two_blocks();
    let doc = new_doc(1).expect("doc");
    let mut projection =
        LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0).expect("initialize");
    // A remote change of A's type diverges ("remote type changed").
    let map = projection.index.map(&doc, a_text).expect("A map");
    map.insert("type", "linebreak").expect("remote type change");
    doc.commit_with(loro::CommitOptions::new().origin("remote").timestamp(1));
    assert!(projection.take_remote(&doc, editor.state()).is_err());
    assert!(projection.pending_nulls.contains(&b_text));
}
