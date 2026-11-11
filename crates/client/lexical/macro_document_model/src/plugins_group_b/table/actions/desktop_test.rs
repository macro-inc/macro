use super::*;
use crate::EditorType;

#[test]
fn format_merge_retains_the_table_selection_but_removed_cells_are_not_query_targets()
-> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .initial_state(serde_json::from_str(include_str!("fixtures/before.json"))?)
    .build()
    .expect("actual Macro registry");
    let view = editor.state().view();
    let table = view.first_child(NodeKey::ROOT).expect("table");
    let row = view.first_child(table).expect("row");
    let cells = view.children_keys(row)?;
    let selection = Selection::Table(TableSelection::new(table, cells[0], cells[1]));
    editor.update(|tx| tx.set_selection(Some(selection.clone())))?;

    let command = super::super::super::decode_command(
        "group-b.table",
        r#"{"action":"format-selection-merge"}"#,
        table.generation(),
        None,
    )?
    .expect("typed desktop action");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let state = editor.state();
    assert_eq!(state.selection(), Some(&selection));
    assert!(!state.view().is_attached(cells[1]));
    let cell = state.get::<TableCellNode>(cells[0]).expect("merged cell");
    assert_eq!((cell.row_span, cell.col_span), (1, 2));

    let facts = super::super::super::query(
        "group-b.table-facts",
        &serde_json::json!({"keys":[table.index()]}),
        table.generation(),
        state,
    )?
    .expect("actual table facts");
    assert!(facts["tables"][0]["selection"].is_null());
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    Ok(())
}

#[test]
fn format_split_retains_the_exact_range_and_touch_split_clears_it() -> Result<(), Error> {
    for (action, keep) in [("format-selection-split", true), ("selection-split", false)] {
        let mut editor = crate::surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .initial_state(serde_json::from_str(include_str!(
            "fixtures/after-merge.json"
        ))?)
        .build()
        .expect("actual Macro registry");
        let view = editor.state().view();
        let table = view.first_child(NodeKey::ROOT).expect("table");
        let row = view.first_child(table).expect("row");
        let cell = view.first_child(row).expect("merged cell");
        let text = view.all_text_nodes(cell).next().expect("cell text");
        let range = Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(0)),
            Point::text(text, Utf16Offset(2)),
        ));
        editor.update(|tx| tx.set_selection(Some(range.clone())))?;

        let command = super::super::super::decode_command(
            "group-b.table",
            &serde_json::json!({"action":action}).to_string(),
            table.generation(),
            None,
        )?
        .expect("typed table action");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        let state = editor.state();
        assert_eq!(state.selection(), keep.then_some(&range));
        assert_eq!(state.view().children_keys(row)?.len(), 3);
        let cell = state.get::<TableCellNode>(cell).expect("split cell");
        assert_eq!((cell.row_span, cell.col_span), (1, 1));
    }
    Ok(())
}
