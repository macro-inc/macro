use super::*;
use serde_json::json;

#[test]
fn restores_nonsequential_preorder_links_selection_and_next_allocation() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let json: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"seed"}]}]}}),
    )?;
    let paragraph = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 5,
    });
    let text = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 2,
    });
    let next = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 9,
    });
    let selection = Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(4)),
    ));
    editor.restore_conformance_state(
        &json,
        &[NodeKey::ROOT, paragraph, text],
        next,
        Some(selection.clone()),
    )?;
    assert_eq!(
        editor.state().view().first_child(NodeKey::ROOT),
        Some(paragraph)
    );
    assert_eq!(editor.state().view().parent(text), Some(paragraph));
    assert_eq!(editor.state().selection(), Some(&selection));
    assert_eq!(editor.state().root_text_content().as_ref(), "seed");
    assert_eq!(editor.transaction().create_text("later")?.key(), next);
    Ok(())
}

#[test]
fn rejects_duplicate_layout_without_publishing_state() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let json: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}),
    )?;
    let next = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 3,
    });
    assert!(
        editor
            .restore_conformance_state(&json, &[NodeKey::ROOT, NodeKey::ROOT], next, None)
            .is_err()
    );
    assert!(editor.state().is_empty_state());
    Ok(())
}

#[test]
fn rejects_dangling_or_invalid_selection_before_publication() -> Result<(), Error> {
    let json: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"seed"}]}]}}),
    )?;
    let paragraph = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 1,
    });
    let text = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 2,
    });
    let missing = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 9,
    });
    let mut nodes = NodeSelection::new();
    nodes.add(missing);
    for selection in [
        Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(5)),
            Point::text(text, Utf16Offset(0)),
        )),
        Selection::Range(RangeSelection::new(
            Point::text(paragraph, Utf16Offset(0)),
            Point::text(text, Utf16Offset(0)),
        )),
        Selection::Node(nodes),
    ] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        assert!(
            editor
                .restore_conformance_state(
                    &json,
                    &[NodeKey::ROOT, paragraph, text],
                    missing,
                    Some(selection)
                )
                .is_err()
        );
        assert!(editor.state().is_empty_state());
    }
    Ok(())
}

#[test]
fn consumed_key_allocator_is_not_a_fresh_seed_target() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.transaction().create_text("discarded")?;
    let json: SerializedEditorState =
        serde_json::from_value(json!({"root":{"type":"root","children":[]}}))?;
    let next = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 1,
    });
    assert!(
        editor
            .restore_conformance_state(&json, &[NodeKey::ROOT], next, None)
            .is_err()
    );
    Ok(())
}
