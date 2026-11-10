use super::*;
use crate::EditorType;

#[test]
fn selection_actions_match_complete_source_merge_and_split_models() -> Result<(), Error> {
    let before: SerializedEditorState = serde_json::from_str(include_str!("fixtures/before.json"))?;
    let merged: SerializedEditorState =
        serde_json::from_str(include_str!("fixtures/after-merge.json"))?;
    let split: SerializedEditorState =
        serde_json::from_str(include_str!("fixtures/after-split.json"))?;
    let mut editor = register(crate::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .initial_state(before.clone())
    .build()
    .expect("actual Macro node registry and table actions");
    assert_eq!(editor.state().to_json()?, before);
    let ((table, anchor), _) = editor.update(|tx| {
        let table = tx.first_child_or_err(NodeKey::ROOT)?;
        let row = tx.first_child_or_err(table)?;
        let cells = tx.children_keys(row)?;
        tx.set_selection(Some(Selection::Table(TableSelection::new(
            table, cells[0], cells[1],
        ))))?;
        Ok((table, cells[0]))
    })?;
    let command = decode(
        "group-b.table",
        r#"{"action":"selection-merge"}"#,
        table.generation(),
    )?
    .expect("named merge");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert!(editor.state().selection().is_none());
    assert_eq!(editor.state().to_json()?, merged);
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Table(TableSelection::new(
            table, anchor, anchor,
        ))))
    })?;
    let command = decode(
        "group-b.table",
        r#"{"action":"selection-split"}"#,
        table.generation(),
    )?
    .expect("named split");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert!(editor.state().selection().is_none());
    assert_eq!(editor.state().to_json()?, split);
    Ok(())
}

#[test]
fn selection_merge_preserves_cell_content_and_clears_the_selection() -> Result<(), Error> {
    let mut editor = register(crate::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .build()
    .expect("table registry and application actions");
    let ((table, cells, paragraphs), _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let mut cells = Vec::new();
        let mut paragraphs = Vec::new();
        for row in tx.children_keys(table)? {
            for cell in tx.children_keys(row)? {
                let paragraph = tx.first_child_or_err(cell)?;
                let text = tx.first_child_or_err(paragraph)?;
                let label = ["a", "b", "c", "d"][cells.len()];
                tx.text(text)?.set_text_content(label)?;
                cells.push(cell);
                paragraphs.push(paragraph);
            }
        }
        tx.set_selection(Some(Selection::Table(TableSelection::new(
            table.key(),
            cells[0],
            cells[3],
        ))))?;
        Ok((table, cells, paragraphs))
    })?;
    let command = decode(
        "group-b.table",
        r#"{"action":"selection-merge"}"#,
        table.key().generation(),
    )?
    .expect("named table action");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let view = editor.state().view();
    let merged = view.get::<TableCellNode>(cells[0]).expect("anchor cell");
    assert_eq!((merged.row_span, merged.col_span), (2, 2));
    assert_eq!(view.children_keys(cells[0])?, paragraphs);
    for (paragraph, text) in paragraphs.iter().zip(["a", "b", "c", "d"]) {
        assert_eq!(view.text_content(*paragraph), text);
    }
    assert!(cells[1..].iter().all(|cell| !view.is_attached(*cell)));
    assert!(editor.state().selection().is_none());
    Ok(())
}

#[test]
fn selection_split_expands_the_current_cell_and_clears_the_selection() -> Result<(), Error> {
    let mut editor = register(crate::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .build()
    .expect("table registry and application actions");
    let ((table, anchor), _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let mut cells = Vec::new();
        for row in tx.children_keys(table)? {
            for cell in tx.children_keys(row)? {
                cells.push(tx.view().cast::<TableCellNode>(cell).expect("cell"));
            }
        }
        let anchor = merge_cells(tx, &cells)?.expect("merged cell");
        let paragraph = tx.first_child_or_err(anchor)?;
        let text = tx.first_child_or_err(paragraph)?;
        tx.text(text)?.set_text_content("keep")?;
        tx.set_selection(Some(Selection::Table(TableSelection::new(
            table.key(),
            anchor.key(),
            anchor.key(),
        ))))?;
        Ok((table, anchor))
    })?;
    let command = decode(
        "group-b.table",
        r#"{"action":"selection-split"}"#,
        table.key().generation(),
    )?
    .expect("named table action");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let view = editor.state().view();
    let rows = view.children_keys(table)?;
    assert_eq!(rows.len(), 2);
    for row in rows {
        let cells = view.children_keys(row)?;
        assert_eq!(cells.len(), 2);
        for cell in cells {
            let data = view.get::<TableCellNode>(cell).expect("cell");
            assert_eq!((data.row_span, data.col_span), (1, 1));
            assert_eq!(
                view.text_content(cell),
                if cell == anchor.key() {
                    // The setup merges four paragraphs before empty-text normalization.
                    "keep\n\n\n\n\n\n"
                } else {
                    ""
                }
            );
        }
    }
    assert!(editor.state().selection().is_none());
    Ok(())
}
