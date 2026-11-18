use super::*;
use crate::EditorType;

#[test]
fn border_insert_row_places_the_caret_at_the_first_cell_of_the_new_row() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .initial_state(serde_json::from_str(include_str!("fixtures/before.json"))?)
    .build()
    .expect("actual Macro registry");
    let view = editor.state().view();
    let table = view.first_child(NodeKey::ROOT).expect("table");
    let first_row = view.first_child(table).expect("first row");
    let hovered = view.children_keys(first_row)?[1];
    let command = super::super::super::decode_command(
        "group-b.table",
        &serde_json::json!({"action":"insert-row","cell":hovered.index(),"after":true}).to_string(),
        hovered.generation(),
        None,
    )?
    .expect("typed border action");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let state = editor.state();
    let rows = state.view().children_keys(table)?;
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0], first_row);
    let first_new_cell = state.view().first_child(rows[1]).expect("inserted cell");
    let paragraph = state
        .view()
        .first_child(first_new_cell)
        .expect("empty inserted paragraph");
    let selection = state
        .selection()
        .and_then(Selection::as_range)
        .expect("inserted row caret");
    let start = Point::element(paragraph, ChildIndex(0));
    assert_eq!((selection.anchor, selection.focus), (start, start));
    Ok(())
}
