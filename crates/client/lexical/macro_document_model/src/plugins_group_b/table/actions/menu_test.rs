//! Source TableMoveHandle runMenuAction: live selection first, tracked cell fallback.
use super::*;
use crate::EditorType;

fn editor() -> Editor {
    crate::surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .initial_state(
            serde_json::from_str(include_str!("fixtures/before.json")).expect("3x3 fixture"),
        )
        .build()
        .expect("actual Macro registry")
}
/// rows[r][c] of the fixture's single 3x3 table.
fn grid(editor: &Editor) -> Result<(NodeKey, Vec<Vec<NodeKey>>), Error> {
    let view = editor.state().view();
    let table = view.first_child(NodeKey::ROOT).expect("table");
    let rows = view
        .children_keys(table)?
        .into_iter()
        .map(|row| view.children_keys(row))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((table, rows))
}
fn menu(editor: &mut Editor, tracked: NodeKey, item: &str) -> Result<Handled, Error> {
    menu_with(editor, Some(tracked), item)
}
fn menu_with(editor: &mut Editor, tracked: Option<NodeKey>, item: &str) -> Result<Handled, Error> {
    let generation = editor.state().max_key().generation();
    let payload = match tracked {
        Some(key) => serde_json::json!({"action":"menu-action","tracked":key.index(),"item":item}),
        None => serde_json::json!({"action":"menu-action","item":item}),
    };
    let command = super::super::super::decode_command(
        "group-b.table",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("typed menu action");
    Ok(editor.dispatch(&command)?.0)
}
fn select_table(
    editor: &mut Editor,
    table: NodeKey,
    anchor: NodeKey,
    focus: NodeKey,
) -> Result<Selection, Error> {
    let selection = Selection::Table(TableSelection::new(table, anchor, focus));
    editor.update(|tx| tx.set_selection(Some(selection.clone())))?;
    Ok(editor
        .state()
        .selection()
        .cloned()
        .expect("table selection"))
}

#[test]
fn insert_row_below_inserts_after_the_lower_selected_row_and_keeps_the_selection()
-> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    let before = select_table(&mut editor, table, rows[0][0], rows[1][1])?;
    assert_eq!(
        menu(&mut editor, rows[0][0], "insert-row-below")?,
        Handled::Yes
    );
    let (_, after) = grid(&editor)?;
    assert_eq!(after.len(), 4);
    assert_eq!(
        (after[0][0], after[1][0], after[3][0]),
        (rows[0][0], rows[1][0], rows[2][0])
    );
    // Source $insertTableRowAtNode returns without touching the selection.
    assert_eq!(editor.state().selection().cloned(), Some(before));
    Ok(())
}

#[test]
fn insert_row_above_under_a_backward_selection_inserts_above_the_upper_row() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    let before = select_table(&mut editor, table, rows[2][0], rows[1][1])?;
    assert_eq!(
        menu(&mut editor, rows[2][0], "insert-row-above")?,
        Handled::Yes
    );
    let (_, after) = grid(&editor)?;
    assert_eq!(after.len(), 4);
    assert_eq!(
        (after[0][0], after[2][0], after[3][0]),
        (rows[0][0], rows[1][0], rows[2][0])
    );
    assert_eq!(editor.state().selection().cloned(), Some(before));
    Ok(())
}

#[test]
fn insert_column_right_moves_the_caret_to_the_first_inserted_cell() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    select_table(&mut editor, table, rows[0][0], rows[1][1])?;
    assert_eq!(
        menu(&mut editor, rows[0][0], "insert-column-right")?,
        Handled::Yes
    );
    let (_, after) = grid(&editor)?;
    assert!(after.iter().all(|row| row.len() == 4));
    // Source $insertTableColumnAtNode(shouldSetSelection=true): $moveSelectionToCell.
    let inserted = after[0][2];
    let selection = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .cloned();
    let anchor = selection.expect("caret").anchor.key();
    assert_eq!(
        find_cell_node(editor.state().view(), anchor).map(|cell| cell.key()),
        Some(inserted)
    );
    Ok(())
}

#[test]
fn with_no_live_table_selection_the_tracked_cell_is_selected_then_its_row_deleted()
-> Result<(), Error> {
    let mut editor = editor();
    let (_, rows) = grid(&editor)?;
    editor.update(|tx| tx.set_selection(None))?;
    assert_eq!(menu(&mut editor, rows[1][0], "delete-row")?, Handled::Yes);
    let (_, after) = grid(&editor)?;
    assert_eq!(after.len(), 2);
    assert_eq!((after[0][0], after[1][0]), (rows[0][0], rows[2][0]));
    Ok(())
}

#[test]
fn delete_row_under_a_live_table_selection_deletes_every_selected_row() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    // The tracked cell is ignored when the live selection is in a table cell.
    select_table(&mut editor, table, rows[0][0], rows[1][0])?;
    assert_eq!(menu(&mut editor, rows[2][2], "delete-row")?, Handled::Yes);
    let (_, after) = grid(&editor)?;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0][0], rows[2][0]);
    Ok(())
}

#[test]
fn delete_table_removes_the_live_cells_table() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    select_table(&mut editor, table, rows[0][0], rows[0][0])?;
    assert_eq!(menu(&mut editor, rows[0][0], "delete-table")?, Handled::Yes);
    assert!(!editor.state().view().contains(table));
    Ok(())
}

#[test]
fn a_detached_tracked_cell_without_a_live_table_selection_is_not_handled() -> Result<(), Error> {
    let mut editor = editor();
    let (_, rows) = grid(&editor)?;
    editor.update(|tx| tx.set_selection(None))?;
    let tracked = rows[1][0];
    editor.update(|tx| tx.remove(tx.parent(tracked).expect("row"), true))?;
    let before = editor.state().to_json()?;
    assert_eq!(menu(&mut editor, tracked, "insert-row-below")?, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn hover_insert_row_keeps_its_caret_into_the_new_row() -> Result<(), Error> {
    // The existing border action is unchanged by the menu mode.
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    select_table(&mut editor, table, rows[0][0], rows[1][1])?;
    let command = super::super::super::decode_command(
        "group-b.table",
        &serde_json::json!({"action":"insert-row","cell":rows[0][0].index(),"after":true})
            .to_string(),
        rows[0][0].generation(),
        None,
    )?
    .expect("typed border action");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert!(editor.state().selection().is_some_and(Selection::is_range));
    Ok(())
}

#[test]
fn a_live_cell_acts_without_a_tracked_cell() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    let before = select_table(&mut editor, table, rows[1][0], rows[1][0])?;
    assert_eq!(
        menu_with(&mut editor, None, "insert-row-below")?,
        Handled::Yes
    );
    let (_, after) = grid(&editor)?;
    assert_eq!(after.len(), 4);
    assert_eq!((after[1][0], after[3][0]), (rows[1][0], rows[2][0]));
    assert_eq!(editor.state().selection().cloned(), Some(before));
    Ok(())
}

#[test]
fn a_live_cell_acts_even_when_the_tracked_cell_is_detached() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    let tracked = rows[2][2];
    editor.update(|tx| tx.remove(tx.parent(tracked).expect("row"), true))?;
    select_table(&mut editor, table, rows[0][0], rows[0][0])?;
    assert_eq!(menu(&mut editor, tracked, "delete-row")?, Handled::Yes);
    let (_, after) = grid(&editor)?;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0][0], rows[1][0]);
    Ok(())
}

#[test]
fn no_live_cell_and_no_tracked_cell_is_not_handled() -> Result<(), Error> {
    let mut editor = editor();
    editor.update(|tx| tx.set_selection(None))?;
    let before = editor.state().to_json()?;
    assert_eq!(menu_with(&mut editor, None, "delete-table")?, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn the_menu_payload_is_closed_and_object_only() {
    for payload in [
        r#"{"action":"menu-action"}"#,
        r#"{"action":"menu-action","item":"delete-row","tracked":-1}"#,
        r#"{"action":"menu-action","item":"delete-row","tracked":1.5}"#,
        r#"{"action":"menu-action","item":"delete-row","tracked":4294967296}"#,
        r#"{"action":"menu-action","item":"delete-everything"}"#,
        r#"{"action":"menu-action","item":"delete-row","cell":1}"#,
        r#"["menu-action",1,"delete-row"]"#,
        r#"["menu-action",{"item":"delete-row"}]"#,
        r#""menu-action""#,
        r#"{"action":"menu-action","item":"delete-row","item":"split-cell"}"#,
        r#"{"action":"menu-action","item":"delete-row","tracked":1,"tracked":2}"#,
        r#"{"action":"menu-action","action":"menu-action","item":"delete-row"}"#,
    ] {
        assert!(
            super::super::super::decode_command("group-b.table", payload, 0, None).is_err(),
            "accepted {payload}"
        );
    }
    for payload in [
        r#"{"action":"menu-action","item":"delete-row"}"#,
        r#"{"action":"menu-action","item":"delete-row","tracked":null}"#,
        r#"{"action":"menu-action","item":"split-cell","tracked":4294967295}"#,
    ] {
        assert!(
            super::super::super::decode_command("group-b.table", payload, 0, None)
                .is_ok_and(|command| command.is_some()),
            "rejected {payload}"
        );
    }
}

#[test]
fn an_old_action_with_a_duplicate_field_is_refused_as_before() {
    // Baseline: the existing derived decoding refuses duplicates from the original
    // JSON text, which a serde_json::Value round trip would silently collapse.
    let payload = r#"{"action":"delete","cell":1,"cell":2,"axis":"row"}"#;
    assert!(serde_json::from_str::<serde_json::Value>(payload).is_ok());
    assert!(super::super::super::decode_command("group-b.table", payload, 0, None).is_err());
}
