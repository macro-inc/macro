use super::*;

#[test]
fn selection_hooks_preserve_reverse_dfs_order_shape_formats_and_row_text() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let row = tx.create(TableRowNode::default())?;
    let a = tx.create(TableCellNode::default())?;
    let b = tx.create(TableCellNode::default())?;
    let p1 = tx.create(Paragraph::default())?;
    let p2 = tx.create(Paragraph::default())?;
    let p3 = tx.create(Paragraph::default())?;
    let t1 = tx.create_text("first")?;
    let t2 = tx.create_text("second")?;
    let t3 = tx.create_text("third")?;
    tx.append(p1, &[t1.key()])?;
    tx.append(p2, &[t2.key()])?;
    tx.append(p3, &[t3.key()])?;
    tx.append(a, &[p1.key(), p2.key()])?;
    tx.append(b, &[p3.key()])?;
    tx.append(row, &[a.key(), b.key()])?;
    tx.append(table, &[row.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    tx.element(p1)?.set_text_format(TextFormat::BOLD)?;
    let selection = table_selection(table, a, b);
    assert!(selection.is_dirty());
    assert!(is_table_selection(Some(&Selection::Table(selection))));
    assert!(!is_table_selection(None));
    assert!(!is_table_selection(Some(&Selection::Range(
        RangeSelection::at_root()
    ))));
    let expected = vec![
        table.key(),
        row.key(),
        a.key(),
        p2.key(),
        t2.key(),
        p1.key(),
        t1.key(),
        b.key(),
        p3.key(),
        t3.key(),
    ];
    assert_eq!(selection.get_nodes(tx.view())?, expected);
    assert_eq!(Selection::Table(selection).nodes(tx.view())?, expected);
    assert_eq!(
        selection.get_shape(tx.view())?,
        TableSelectionShape {
            from_x: 0,
            from_y: 0,
            to_x: 1,
            to_y: 0
        }
    );
    assert!(selection.has_format(tx.view(), TextFormatType::Bold)?);
    assert!(!selection.has_format(tx.view(), TextFormatType::Italic)?);
    assert_eq!(
        TableSelectionExt::text_content(selection, tx.view())?,
        "first\n\nsecond\tthird\n"
    );
    assert_eq!(
        Selection::Table(selection).text_content(tx.view())?,
        "first\n\nsecond\tthird\n"
    );
    let mut visited = vec![];
    visit_recursively(tx.view(), table.key(), &mut |key| {
        visited.push(key);
        key != a.key()
    });
    assert_eq!(
        visited,
        vec![table.key(), row.key(), b.key(), p3.key(), t3.key(), a.key()]
    );
    tx.set_selection(Some(Selection::Table(selection)))?;
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("replacement")?;
    tx.append(p, &[text.key()])?;
    tx.insert_nodes(&[p.key()])?;
    assert_eq!(tx.text_content(b), "replacement");
    assert_eq!(tx.text_content(a), "first\n\nsecond");
    assert!(tx.selection().is_some_and(Selection::is_range));
    tx.commit()?;
    Ok(())
}

#[test]
fn create_from_validates_membership_and_keeps_offsets_when_reusing_a_selection() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 1, 2, IncludeHeaders::All(false))?;
    let row = tx.first_child_or_err(table)?;
    let a = cell_id(tx.view(), tx.first_child_or_err(row)?)?;
    let b = cell_id(tx.view(), tx.last_child_or_err(row)?)?;
    assert_eq!(
        create_table_selection_from(&tx, table, a, b)
            .expect_err("detached table")
            .to_string(),
        "$createTableSelectionFrom: tableNode 1 is not attached"
    );
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let selected = select_cells(&mut tx, table, a, b)?;
    assert_eq!(tx.selection(), Some(&Selection::Table(selected)));
    assert_eq!(tx.selection_replacements(), 1);
    let mut selected = selected;
    selected.anchor = Point::element(a, ChildIndex(2));
    selected.focus = Point::element(b, ChildIndex(5));
    tx.set_selection(Some(Selection::Table(selected)))?;
    let same = create_table_selection_from(&tx, table, a, b)?;
    assert_eq!(same.anchor, Point::element(a, ChildIndex(2)));
    assert_eq!(same.focus, Point::element(b, ChildIndex(5)));
    assert!(!same.is_dirty());
    let changed = create_table_selection_from(&tx, table, b, a)?;
    assert_eq!(changed.anchor, Point::element(b, ChildIndex(2)));
    assert_eq!(changed.focus, Point::element(a, ChildIndex(5)));
    assert!(changed.is_dirty());
    let other = create_table_node_with_dimensions(&mut tx, 1, 1, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[other.key()])?;
    let other_cell = cell_id(
        tx.view(),
        tx.first_child_or_err(tx.first_child_or_err(other)?)?,
    )?;
    assert_eq!(
        create_table_selection_from(&tx, table, other_cell, a)
            .expect_err("foreign anchor")
            .to_string(),
        "$createTableSelectionFrom: anchorCell 11 is not in table 1"
    );
    assert_eq!(
        create_table_selection_from(&tx, table, a, other_cell)
            .expect_err("foreign focus")
            .to_string(),
        "$createTableSelectionFrom: focusCell 11 is not in table 1"
    );
    let invalid = TableSelection::new(NodeKey::ROOT, a.key(), b.key());
    assert_eq!(invalid.get_nodes(tx.view())?, Vec::<NodeKey>::new());
    Ok(())
}

// LexicalTableSelection.test.tsx regression #7140.
#[test]
fn upstream_selection_points_to_missing_nodes_after_deleting_all_table_rows() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("Before table")?;
        tx.append(p, &[text.key()])?;
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[p.key(), table.key()])?;
        let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
        let selection = create_table_selection_from(
            tx,
            table,
            map.get(0, 0).expect("first").cell,
            map.get(1, 1).expect("last").cell,
        )?;
        tx.set_selection(Some(Selection::Table(selection)))
    })?;
    editor.update(delete_table_row_at_selection)?;
    let view = editor.state().view();
    let selection = editor
        .state()
        .selection()
        .and_then(Selection::as_table)
        .expect("upstream keeps invalid table selection");
    assert!(!selection.is_valid(view));
    assert_eq!(selection.get_nodes(view)?, Vec::<NodeKey>::new());
    assert_eq!(view.text_content(NodeKey::ROOT), "Before table");
    Ok(())
}

#[test]
fn invalid_table_selection_endpoints_keep_the_upstream_contextual_diagnostic() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 1, 1, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let cell = tx.first_child_or_err(tx.first_child_or_err(table)?)?;
    let selection = TableSelection::new(table.key(), NodeKey::ROOT, cell);
    assert_eq!(
        selection
            .get_shape(tx.view())
            .expect_err("invalid anchor")
            .to_string(),
        "Expected TableSelection anchor to be (or a child of) TableCellNode, got key root of type root"
    );
    Ok(())
}
