use super::*;
use crate::node_ids::ID_STATE;
use crate::{EditorType, surface};

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .build()
        .expect("surface")
}

/// Two paragraphs, "Alpha beta gamma" and "Second line"; ids only where given.
fn document(editor: &mut Editor, ids: [Option<&str>; 2]) -> Result<(NodeKey, NodeKey), Error> {
    let (keys, _) = editor.update(|tx| {
        let mut texts = Vec::new();
        for (text, id) in ["Alpha beta gamma", "Second line"].into_iter().zip(ids) {
            let paragraph = tx.create(Paragraph::default())?;
            let leaf = tx.create_text(text)?;
            if let Some(id) = id {
                tx.set_state(leaf.key(), &ID_STATE, Some(id.to_owned()))?;
            }
            tx.append(paragraph, &[leaf.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            texts.push(leaf.key());
        }
        Ok((texts[0], texts[1]))
    })?;
    Ok(keys)
}

fn select(editor: &mut Editor, anchor: Point, focus: Point) -> Result<(), Error> {
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(anchor, focus))))
    })?;
    Ok(())
}

fn snippet(editor: &Editor) -> Result<Value, Error> {
    let generation = editor.state().max_key().generation();
    Ok(query(
        "group-b.selection-snippet",
        &json!({}),
        generation,
        editor.state(),
    )?
    .expect("reply"))
}

#[test]
fn a_forward_range_reports_location_text_and_focus_end() -> Result<(), Error> {
    let mut editor = editor();
    let (first, _) = document(&mut editor, [Some("firstTxt"), Some("secondTx")])?;
    select(
        &mut editor,
        Point::text(first, Utf16Offset(6)),
        Point::text(first, Utf16Offset(10)),
    )?;
    assert_eq!(
        snippet(&editor)?,
        json!({
            "location": {
                "anchor": { "id": "firstTxt", "offset": 6 },
                "focus": { "id": "firstTxt", "offset": 10 },
            },
            "text": "beta",
            "end": { "key": first.parts().index, "offset": 10, "type": "text" },
        })
    );
    Ok(())
}

#[test]
fn a_backward_range_keeps_anchor_and_focus_and_ends_at_the_anchor() -> Result<(), Error> {
    let mut editor = editor();
    let (first, _) = document(&mut editor, [Some("firstTxt"), Some("secondTx")])?;
    select(
        &mut editor,
        Point::text(first, Utf16Offset(10)),
        Point::text(first, Utf16Offset(6)),
    )?;
    let reply = snippet(&editor)?;
    assert_eq!(
        reply["location"]["anchor"],
        json!({ "id": "firstTxt", "offset": 10 })
    );
    assert_eq!(
        reply["location"]["focus"],
        json!({ "id": "firstTxt", "offset": 6 })
    );
    assert_eq!(reply["text"], "beta");
    assert_eq!(
        reply["end"],
        json!({ "key": first.parts().index, "offset": 10, "type": "text" })
    );
    Ok(())
}

#[test]
fn a_range_across_blocks_names_both_nodes() -> Result<(), Error> {
    let mut editor = editor();
    let (first, second) = document(&mut editor, [Some("firstTxt"), Some("secondTx")])?;
    select(
        &mut editor,
        Point::text(first, Utf16Offset(6)),
        Point::text(second, Utf16Offset(6)),
    )?;
    let reply = snippet(&editor)?;
    assert_eq!(
        reply["location"]["anchor"],
        json!({ "id": "firstTxt", "offset": 6 })
    );
    assert_eq!(
        reply["location"]["focus"],
        json!({ "id": "secondTx", "offset": 6 })
    );
    let text = reply["text"].as_str().expect("text");
    assert!(
        text.starts_with("beta gamma") && text.ends_with("Second"),
        "{text:?}"
    );
    Ok(())
}

#[test]
fn collapsed_missing_and_id_less_selections_have_no_snippet() -> Result<(), Error> {
    let mut editor = editor();
    assert_eq!(snippet(&editor)?, Value::Null);
    let (first, _) = document(&mut editor, [None, Some("secondTx")])?;
    select(
        &mut editor,
        Point::text(first, Utf16Offset(6)),
        Point::text(first, Utf16Offset(6)),
    )?;
    assert_eq!(snippet(&editor)?, Value::Null);
    select(
        &mut editor,
        Point::text(first, Utf16Offset(6)),
        Point::text(first, Utf16Offset(10)),
    )?;
    assert_eq!(snippet(&editor)?, Value::Null);
    Ok(())
}

#[test]
fn selection_snippet_rejects_stale_generations_and_non_object_payloads() {
    let editor = editor();
    let generation = editor.state().max_key().generation();
    assert!(
        query(
            "group-b.selection-snippet",
            &json!({}),
            generation + 1,
            editor.state()
        )
        .is_err()
    );
    assert!(
        query(
            "group-b.selection-snippet",
            &json!([]),
            generation,
            editor.state()
        )
        .is_err()
    );
    assert!(
        query(
            "group-b.selection-snippet",
            &json!({"x": 1}),
            generation,
            editor.state()
        )
        .is_err()
    );
    assert!(
        query("other", &json!({}), generation, editor.state())
            .expect("unknown")
            .is_none()
    );
}
