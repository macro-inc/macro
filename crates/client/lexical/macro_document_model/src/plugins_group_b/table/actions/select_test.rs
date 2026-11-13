//! Source TableMoveHandle selectHandleCells: one table selection update (a no-op
//! for missing or detached cells), then one SELECTION_CHANGE notification per tap.
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
fn decode(editor: &Editor, payload: serde_json::Value) -> Result<Option<Command>, Error> {
    let generation = editor.state().max_key().generation();
    super::super::super::decode_command("group-b.table", &payload.to_string(), generation, None)
}
/// Dispatches `select-cells`; returns whether it was handled and the event names.
fn select(
    editor: &mut Editor,
    anchor: Option<NodeKey>,
    focus: Option<NodeKey>,
) -> Result<(Handled, Vec<String>), Error> {
    let mut payload = serde_json::json!({"action":"select-cells"});
    if let Some(anchor) = anchor {
        payload["anchor"] = anchor.index().into();
    }
    if let Some(focus) = focus {
        payload["focus"] = focus.index().into();
    }
    let command = decode(editor, payload)?.expect("typed select-cells");
    let (handled, commit) = editor.dispatch(&command)?;
    let events = commit
        .events
        .iter()
        .map(|event| event.name().to_owned())
        .collect();
    Ok((handled, events))
}
const EVENT: &str = "group-b.table-select-cells";

#[test]
fn a_tap_selects_the_tracked_cells_and_notifies_once() -> Result<(), Error> {
    let mut editor = editor();
    let (table, rows) = grid(&editor)?;
    let (handled, events) = select(&mut editor, Some(rows[0][0]), Some(rows[1][1]))?;
    assert_eq!((handled, events), (Handled::Yes, vec![EVENT.to_owned()]));
    assert_eq!(
        editor.state().selection().cloned(),
        Some(Selection::Table(TableSelection::new(
            table, rows[0][0], rows[1][1]
        )))
    );
    Ok(())
}

#[test]
fn a_repeated_tap_on_the_same_cells_still_notifies_once() -> Result<(), Error> {
    let mut editor = editor();
    let (_, rows) = grid(&editor)?;
    select(&mut editor, Some(rows[0][0]), Some(rows[0][0]))?;
    let before = editor.state().selection().cloned();
    let (handled, events) = select(&mut editor, Some(rows[0][0]), Some(rows[0][0]))?;
    assert_eq!((handled, events), (Handled::Yes, vec![EVENT.to_owned()]));
    assert_eq!(editor.state().selection().cloned(), before);
    Ok(())
}

#[test]
fn a_detached_tracked_cell_changes_nothing_but_still_notifies() -> Result<(), Error> {
    let mut editor = editor();
    let (_, rows) = grid(&editor)?;
    select(&mut editor, Some(rows[0][0]), Some(rows[0][0]))?;
    let detached = rows[2][0];
    editor.update(|tx| tx.remove(tx.parent(detached).expect("row"), true))?;
    let before = editor.state().selection().cloned();
    let json = editor.state().to_json()?;
    let (handled, events) = select(&mut editor, Some(detached), Some(detached))?;
    assert_eq!((handled, events), (Handled::Yes, vec![EVENT.to_owned()]));
    assert_eq!(editor.state().selection().cloned(), before);
    assert_eq!(editor.state().to_json()?, json);
    Ok(())
}

#[test]
fn missing_tracked_keys_change_nothing_but_still_notify() -> Result<(), Error> {
    let mut editor = editor();
    let before = editor.state().selection().cloned();
    let (handled, events) = select(&mut editor, None, None)?;
    assert_eq!((handled, events), (Handled::Yes, vec![EVENT.to_owned()]));
    assert_eq!(editor.state().selection().cloned(), before);
    Ok(())
}

#[test]
fn the_notification_is_a_registered_view_event_with_no_payload() -> Result<(), Error> {
    let mut editor = editor();
    let (_, rows) = grid(&editor)?;
    let generation = editor.state().max_key().generation();
    let payload = serde_json::json!({"action":"select-cells","anchor":rows[0][0].index(),"focus":rows[0][0].index()});
    let command = super::super::super::decode_command(
        "group-b.table",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("typed select-cells");
    let (_, commit) = editor.dispatch(&command)?;
    let event = commit.events.first().expect("select-cells event");
    assert_eq!(super::event_payload(event)?, Some(serde_json::Value::Null));
    Ok(())
}

#[test]
fn the_payload_is_closed() -> Result<(), Error> {
    let editor = editor();
    for payload in [
        serde_json::json!({"action":"select-cells","anchor":1,"focus":1,"extra":true}),
        serde_json::json!({"action":"select-cells","anchor":-1}),
        serde_json::json!({"action":"select-cells","focus":"1"}),
    ] {
        assert!(decode(&editor, payload.clone()).is_err(), "{payload}");
    }
    Ok(())
}

/// The fixture's table twice, as two sibling root children.
fn two_tables() -> Editor {
    let mut state: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/before.json")).expect("3x3 fixture");
    let table = state["root"]["children"][0].clone();
    if let Some(children) = state["root"]["children"].as_array_mut() {
        children.push(table);
    }
    crate::surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .initial_state(serde_json::from_value(state).expect("two-table fixture"))
        .build()
        .expect("actual Macro registry")
}

/// Source (tableSelectCellsSource.test.ts) builds the straddling TableSelection, then
/// the table plugin's SELECTION_CHANGE handler hits Lexical's "anchor and focus in the
/// same table" invariant; the app's onError reports it and Lexical discards the update,
/// so nothing commits while the explicit notification still fires once. Native keeps
/// the selection unchanged, notifies once, and reports the same invariant once as a
/// follow-up failure after the commit publishes.
#[test]
fn cells_in_different_tables_change_nothing_but_still_notify() -> Result<(), Error> {
    let mut editor = two_tables();
    let view = editor.state().view();
    let tables = view.children_keys(NodeKey::ROOT)?;
    let first_cell = |table: NodeKey| -> Result<NodeKey, Error> {
        let row = view.children_keys(table)?[0];
        Ok(view.children_keys(row)?[0])
    };
    let (anchor, focus) = (first_cell(tables[0])?, first_cell(tables[1])?);
    let before = editor.state().selection().cloned();
    let json = editor.state().to_json()?;
    let payload =
        serde_json::json!({"action":"select-cells","anchor":anchor.index(),"focus":focus.index()});
    let command = decode(&editor, payload)?.expect("typed select-cells");
    let (handled, commit) = editor.dispatch(&command)?;
    let events: Vec<_> = commit
        .events
        .iter()
        .map(|event| event.name().to_owned())
        .collect();
    assert_eq!((handled, events), (Handled::Yes, vec![EVENT.to_owned()]));
    // Exactly one report, as Source's app onError receives once.
    let report = commit
        .follow_up_error
        .as_ref()
        .map(|failure| (failure.plugin, failure.error.to_string()));
    assert_eq!(
        report,
        Some((
            "group-b.table-actions",
            Error::invariant("Expected TableSelection anchor and focus to be in the same table")
                .to_string()
        ))
    );
    assert_eq!(editor.state().selection().cloned(), before);
    assert_eq!(editor.state().to_json()?, json);
    Ok(())
}

#[test]
fn a_same_table_tap_reports_nothing() -> Result<(), Error> {
    let mut editor = editor();
    let (_, rows) = grid(&editor)?;
    let payload = serde_json::json!({"action":"select-cells","anchor":rows[0][0].index(),"focus":rows[2][2].index()});
    let command = decode(&editor, payload)?.expect("typed select-cells");
    let (_, commit) = editor.dispatch(&command)?;
    assert!(commit.follow_up_error.is_none());
    Ok(())
}
