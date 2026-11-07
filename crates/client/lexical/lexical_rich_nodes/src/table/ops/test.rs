use super::*;

// LexicalTableUtils.test.ts: moves a column forward; reorders colWidths when present.
#[test]
fn upstream_moves_column_forward_with_widths_and_persistent_previous_state() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 4, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let texts = [
            ["r0c0", "r0c1", "r0c2", "r0c3"],
            ["r1c0", "r1c1", "r1c2", "r1c3"],
        ];
        for (r, row) in tx.children_keys(table)?.into_iter().enumerate() {
            for (c, cell) in tx.children_keys(row)?.into_iter().enumerate() {
                let text = tx.first_descendant(cell).expect("created text");
                tx.text(text)?.set_text_content(texts[r][c])?;
            }
        }
        tx.get_mut::<TableNode>(table)?.col_widths = Some(vec![
            Some(JsNumber(100.0)),
            Some(JsNumber(200.0)),
            Some(JsNumber(300.0)),
            Some(JsNumber(400.0)),
        ]);
        Ok(table)
    })?;
    let previous = editor.state().clone();
    let previous_json = previous.to_json()?;
    editor.update(|tx| move_table_column(tx, table, 0, 2))?;
    let view = editor.state().view();
    let texts = view
        .children(table)
        .map(|row| {
            view.children(row)
                .map(|cell| view.text_content(cell).into_owned())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        texts,
        vec![
            vec!["r0c1", "r0c2", "r0c0", "r0c3"],
            vec!["r1c1", "r1c2", "r1c0", "r1c3"]
        ]
    );
    assert_eq!(
        view.get::<TableNode>(table).expect("table").col_widths,
        Some(vec![
            Some(JsNumber(200.0)),
            Some(JsNumber(300.0)),
            Some(JsNumber(100.0)),
            Some(JsNumber(400.0))
        ])
    );
    assert!(is_simple_table(view, table));
    assert_eq!(previous.to_json()?, previous_json);
    let json = editor.state().to_json()?;
    editor.update(|tx| {
        move_table_column(tx, table, 2, 2)?;
        move_table_column(tx, table, u32::MAX, 0)?;
        move_table_column(tx, table, 0, 4)
    })?;
    assert_eq!(editor.state().to_json()?, json);
    Ok(())
}

// LexicalTableUtils.test.ts: moves a column backward.
#[test]
fn upstream_moves_column_backward() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 4, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let rows = tx.children_keys(table)?;
    let a = tx.children_keys(rows[0])?;
    let b = tx.children_keys(rows[1])?;
    move_table_column(&mut tx, table, 3, 1)?;
    assert_eq!(tx.children_keys(rows[0])?, vec![a[0], a[3], a[1], a[2]]);
    assert_eq!(tx.children_keys(rows[1])?, vec![b[0], b[3], b[1], b[2]]);
    Ok(())
}

#[test]
fn creation_preserves_empty_text_until_normalization_and_separate_header_axes() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(
            tx,
            2,
            2,
            IncludeHeaders::Some {
                rows: true,
                columns: false,
            },
        )?;
        let rows = tx.children_keys(table)?;
        let a = tx.children_keys(rows[0])?;
        let b = tx.children_keys(rows[1])?;
        assert_eq!(
            tx.get::<TableCellNode>(a[0]).expect("cell").header_state,
            TableCellHeaderState::ROW
        );
        assert_eq!(
            tx.get::<TableCellNode>(a[1]).expect("cell").header_state,
            TableCellHeaderState::ROW
        );
        assert_eq!(
            tx.get::<TableCellNode>(b[0]).expect("cell").header_state,
            TableCellHeaderState::NO_STATUS
        );
        let p = tx.first_child_or_err(a[0])?;
        assert_eq!(tx.children_size(p), 1);
        assert!(tx.is::<Text>(tx.first_child_or_err(p)?));
        assert_eq!(tx.text_content(p), "");
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok(table)
    })?;
    let view = editor.state().view();
    let a = view.first_child_or_err(view.first_child_or_err(table)?)?;
    assert_eq!(view.children_size(view.first_child_or_err(a)?), 0);
    Ok(())
}

#[test]
fn logical_insertions_inherit_headers_move_selection_and_grow_widths() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::default())?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let row = tx.first_child_or_err(table)?;
    let cell = cell_id(tx.view(), tx.first_child_or_err(row)?)?;
    tx.get_mut::<TableNode>(table)?.col_widths =
        Some(vec![Some(JsNumber(100.0)), Some(JsNumber(200.0))]);
    let selected = Selection::Table(TableSelection::new(table.key(), cell.key(), cell.key()));
    tx.set_selection(Some(selected))?;
    let inserted = insert_table_row_at_selection(&mut tx, false)?.expect("row");
    assert_eq!(tx.first_child(table), Some(inserted.key()));
    assert_eq!(tx.children_size(inserted), 2);
    assert_eq!(
        tx.get::<TableCellNode>(tx.first_child_or_err(inserted)?)
            .expect("new cell")
            .header_state,
        TableCellHeaderState::COLUMN
    );
    let new = insert_table_column_at_selection(&mut tx, false)?.expect("column");
    assert_eq!(TableNode::column_count(tx.view(), table), 3);
    assert_eq!(
        tx.get::<TableNode>(table).expect("table").col_widths,
        Some(vec![
            Some(JsNumber(100.0)),
            Some(JsNumber(100.0)),
            Some(JsNumber(200.0))
        ])
    );
    assert!(
        tx.selection()
            .and_then(Selection::as_range)
            .is_some_and(|s| tx.is_parent_of(new, s.anchor.key()) || s.anchor.key() == new.key())
    );
    tx.set_selection(Some(Selection::Table(TableSelection::new(
        table.key(),
        cell.key(),
        cell.key(),
    ))))?;
    assert!(insert_table_row_at_selection(&mut tx, true)?.is_some());
    tx.set_selection(Some(Selection::Table(TableSelection::new(
        table.key(),
        cell.key(),
        cell.key(),
    ))))?;
    assert!(insert_table_column_at_selection(&mut tx, true)?.is_some());
    Ok(())
}

#[test]
fn deprecated_physical_edits_and_out_of_range_errors_keep_upstream_order() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(true))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let rows = tx.children_keys(table)?;
    let a = tx.first_child_or_err(rows[0])?;
    let b = tx.first_child_or_err(rows[1])?;
    tx.get_mut::<TableCellNode>(a)?.width = Some(JsNumber(92.5));
    tx.get_mut::<TableCellNode>(b)?.width = Some(JsNumber(120.0));
    let grid = table_grid(tx.view(), table)?;
    assert_eq!(insert_table_row(&mut tx, table, 0, true, 2, &grid)?, table);
    assert_eq!(tx.children_size(table), 4);
    let new_row = tx.next_sibling(rows[0]).expect("new row");
    assert_eq!(
        tx.get::<TableCellNode>(tx.first_child_or_err(new_row)?)
            .expect("new cell")
            .width,
        Some(JsNumber(120.0))
    );
    assert_eq!(
        tx.get::<TableCellNode>(tx.first_child_or_err(new_row)?)
            .expect("new cell")
            .header_state,
        TableCellHeaderState::COLUMN
    );
    let grid = table_grid(tx.view(), table)?;
    assert_eq!(
        insert_table_column(&mut tx, table, 0, false, 1, &grid)?,
        table
    );
    assert_eq!(tx.children_size(rows[0]), 3);
    assert_eq!(
        tx.get::<TableCellNode>(tx.first_child_or_err(rows[0])?)
            .expect("new cell")
            .header_state,
        TableCellHeaderState::ROW
    );
    assert_eq!(delete_table_column(&mut tx, table, 0)?, table);
    assert_eq!(tx.children_size(rows[0]), 2);
    assert_eq!(remove_table_row_at_index(&mut tx, table, 1)?, table);
    assert_eq!(tx.children_size(table), 3);
    assert!(remove_table_row_at_index(&mut tx, table, 99).is_err());
    assert!(delete_table_column(&mut tx, table, 99).is_err());
    assert!(insert_table_row(&mut tx, table, 99, false, 1, &grid).is_err());
    Ok(())
}

#[test]
fn logical_deletions_remove_only_selected_axes_and_all_row_selection_removes_table() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 3, 3, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let rows = tx.children_keys(table)?;
    let middle = cell_id(
        tx.view(),
        tx.child_at_index(rows[1], ChildIndex(1)).expect("middle"),
    )?;
    tx.get_mut::<TableNode>(table)?.col_widths = Some(vec![
        Some(JsNumber(10.0)),
        Some(JsNumber(20.0)),
        Some(JsNumber(30.0)),
    ]);
    tx.set_selection(Some(Selection::Table(TableSelection::new(
        table.key(),
        middle.key(),
        middle.key(),
    ))))?;
    delete_table_column_at_selection(&mut tx)?;
    assert_eq!(TableNode::column_count(tx.view(), table), 2);
    assert_eq!(
        tx.get::<TableNode>(table).expect("table").col_widths,
        Some(vec![Some(JsNumber(10.0)), Some(JsNumber(30.0))])
    );
    let cell = cell_id(tx.view(), tx.first_child_or_err(rows[1])?)?;
    tx.set_selection(Some(Selection::Table(TableSelection::new(
        table.key(),
        cell.key(),
        cell.key(),
    ))))?;
    delete_table_row_at_selection(&mut tx)?;
    assert_eq!(tx.children_keys(table)?, vec![rows[0], rows[2]]);
    let first = cell_id(tx.view(), tx.first_child_or_err(rows[0])?)?;
    let last = cell_id(tx.view(), tx.last_child_or_err(rows[2])?)?;
    tx.set_selection(Some(Selection::Table(TableSelection::new(
        table.key(),
        first.key(),
        last.key(),
    ))))?;
    delete_table_row_at_selection(&mut tx)?;
    assert!(!tx.is_attached(table));
    assert!(tx.is_empty(NodeKey::ROOT));
    Ok(())
}

// LexicalTableUtils.test.ts: merged tables are not simple and column moves are a no-op.
#[test]
fn merge_and_unmerge_preserve_headers_and_interior_cell_content() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 3, IncludeHeaders::All(true))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let row = tx.first_child_or_err(table)?;
    let cells = tx.children_keys(row)?;
    let a = cell_id(tx.view(), cells[0])?;
    let b = cell_id(tx.view(), cells[1])?;
    let c = cell_id(tx.view(), cells[2])?;
    tx.text(tx.first_descendant(a).expect("text"))?
        .set_text_content("a")?;
    tx.text(tx.first_descendant(b).expect("text"))?
        .set_text_content("b")?;
    tx.text(tx.first_descendant(c).expect("text"))?
        .set_text_content("c")?;
    assert_eq!(merge_cells(&mut tx, &[])?, None);
    assert_eq!(merge_cells(&mut tx, &[a, c])?, Some(a));
    assert_eq!(tx.children_keys(row)?, vec![a.key()]);
    assert_eq!(tx.text_content(a), "a\n\nb\n\nc");
    assert_eq!(tx.get::<TableCellNode>(a).expect("cell").col_span, 3);
    assert!(!is_simple_table(tx.view(), table));
    move_table_column(&mut tx, table, 0, 1)?;
    assert_eq!(tx.children_keys(row)?, vec![a.key()]);
    tx.set_selection(Some(Selection::Table(TableSelection::new(
        table.key(),
        a.key(),
        a.key(),
    ))))?;
    unmerge_cell(&mut tx)?;
    assert_eq!(tx.children_size(row), 3);
    assert_eq!(tx.get::<TableCellNode>(a).expect("cell").col_span, 1);
    let new = tx.next_sibling(a).expect("new cell");
    assert_eq!(
        tx.get::<TableCellNode>(new).expect("cell").header_state,
        TableCellHeaderState::ROW
    );
    unmerge_cell_node(&mut tx, a)?;
    assert!(is_simple_table(tx.view(), table));
    Ok(())
}

#[test]
fn unmerge_uses_only_the_anchor_cell_when_focus_is_outside_the_table() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let table = create_table_node_with_dimensions(&mut tx, 1, 1, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[paragraph.key(), table.key()])?;
    let row = tx.first_child_or_err(table)?;
    let cell = tx.first_child_or_err(row)?;
    let point = Point::element(cell, ChildIndex(0));
    let range = RangeSelection::new(point, Point::element(paragraph, ChildIndex(0)));
    tx.set_selection(Some(Selection::Range(range.clone())))?;
    unmerge_cell(&mut tx)?;
    assert_eq!(tx.selection(), Some(&Selection::Range(range)));
    Ok(())
}
