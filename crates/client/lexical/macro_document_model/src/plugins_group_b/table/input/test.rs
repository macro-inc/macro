use super::*;
use crate::EditorType;
use lexical_rich_nodes::list::{ListNode, ListType};

#[test]
fn real_list_commands_indent_outdent_and_yield_at_the_depth_limit() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (item, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 1, 1, IncludeHeaders::All(false))?;
        let row = tx.first_child(table).expect("row");
        let cell = tx.first_child(row).expect("cell");
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let first = tx.create(ListItemNode::default())?;
        let second = tx.create(ListItemNode::default())?;
        let one = tx.create_text("one")?;
        let two = tx.create_text("two")?;
        tx.append(first, &[one.key()])?;
        tx.append(second, &[two.key()])?;
        tx.append(list, &[first.key(), second.key()])?;
        tx.append(cell, &[list.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        tx.select_start(two)?;
        Ok(second)
    })?;
    let (handled, commit) = editor.update(|tx| handle_list_tab(tx, false))?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    assert_eq!(editor.state().view().indent(item), 1);
    let before = editor.state().to_json()?;
    let (handled, commit) = editor.update(|tx| handle_list_tab(tx, false))?;
    assert_eq!(handled, Handled::No);
    assert!(!commit.default_prevented);
    assert_eq!(editor.state().to_json()?, before);
    let (handled, commit) = editor.update(|tx| handle_list_tab(tx, true))?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    assert_eq!(editor.state().view().indent(item), 0);
    Ok(())
}

#[test]
fn eligible_list_tab_consumes_even_when_indent_has_no_handler() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry only");
    let (item, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 1, 1, IncludeHeaders::All(false))?;
        let row = tx.first_child(table).expect("row");
        let cell = tx.first_child(row).expect("cell");
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("keep")?;
        tx.append(item, &[text.key()])?;
        tx.append(list, &[item.key()])?;
        tx.append(cell, &[list.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        tx.select_start(text)?;
        Ok(item)
    })?;
    let before = editor.state().to_json()?;
    let selection = editor.state().selection().cloned();
    let (handled, commit) = editor.update(|tx| {
        assert_eq!(tx.dispatch(&Command::IndentContent)?, Handled::No);
        handle_list_tab(tx, false)
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    assert_eq!(editor.state().to_json()?, before);
    assert_eq!(editor.state().selection(), selection.as_ref());
    assert_eq!(editor.state().view().indent(item), 0);

    let (handled, commit) = editor.update(|tx| handle_list_tab(tx, true))?;
    assert_eq!(handled, Handled::No);
    assert!(!commit.default_prevented);
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn terminal_cell_tab_grows_and_selects_first_new_cell() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry only");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 1, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let row = tx.first_child(table).expect("row");
        tx.select_start(tx.last_child(row).expect("cell"))?;
        Ok(table)
    })?;
    let before = editor.state().to_json()?;
    let selection = editor.state().selection().cloned();
    let (handled, commit) = editor.update(|tx| handle_insert_row_tab(tx, true))?;
    assert_eq!(handled, Handled::No);
    assert!(!commit.default_prevented);
    assert_eq!(editor.state().to_json()?, before);
    assert_eq!(editor.state().selection(), selection.as_ref());
    let (handled, commit) = editor.update(|tx| handle_insert_row_tab(tx, false))?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let state = editor.state().view();
    let rows = state.children_keys(table)?;
    assert_eq!(rows.len(), 2);
    assert_eq!(state.children_size(rows[1]), 2);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(
        find_cell_node(state, range.anchor.key()).map(Id::key),
        state.first_child(rows[1])
    );
    Ok(())
}

#[test]
fn nonterminal_and_shift_tabs_yield_without_navigation_or_growth() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry only");
    editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let row = tx.first_child(table).expect("row");
        tx.select_start(tx.first_child(row).expect("cell"))
    })?;
    let before = editor.state().to_json()?;
    let selection = editor.state().selection().cloned();
    for shift in [false, true] {
        let (handled, commit) = editor.update(|tx| handle_insert_row_tab(tx, shift))?;
        assert_eq!(handled, Handled::No);
        assert!(!commit.default_prevented);
        assert_eq!(editor.state().to_json()?, before);
        assert_eq!(editor.state().selection(), selection.as_ref());
    }
    Ok(())
}

#[test]
fn missing_and_expanded_selections_yield() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry only");
    let (text, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 1, 1, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let row = tx.first_child(table).expect("row");
        let cell = tx.first_child(row).expect("cell");
        let paragraph = tx.first_child(cell).expect("paragraph");
        let text = tx.create_text("keep")?;
        tx.append(paragraph, &[text.key()])?;
        tx.set_selection(None)?;
        Ok(text)
    })?;
    for expanded in [false, true] {
        let (_, commit) = editor.update(|tx| {
            if expanded {
                let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(0)));
                range.focus = Point::text(text, Utf16Offset(4));
                tx.set_selection(Some(Selection::Range(range)))?;
            }
            assert_eq!(handle_list_tab(tx, false)?, Handled::No);
            assert_eq!(handle_insert_row_tab(tx, false)?, Handled::No);
            Ok(())
        })?;
        assert!(!commit.default_prevented);
    }
    Ok(())
}
