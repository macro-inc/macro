use super::*;

// LexicalTableUtils.test.ts: a cell spanning rows occupies the same logical slots.
#[test]
fn span_map_truncates_bottom_overflow_and_preserves_holes_and_physical_indices() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let row0 = tx.create(TableRowNode::default())?;
    let row1 = tx.create(TableRowNode::default())?;
    let a = tx.create(TableCellNode::default())?;
    let b = tx.create(TableCellNode {
        row_span: 4,
        col_span: 2,
        header_state: TableCellHeaderState::ROW,
        ..Default::default()
    })?;
    let c = tx.create(TableCellNode::default())?;
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("content")?;
    tx.append(p, &[text.key()])?;
    tx.append(b, &[p.key()])?;
    tx.append(row0, &[a.key(), b.key()])?;
    tx.append(row1, &[c.key()])?;
    tx.append(table, &[row0.key(), row1.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let (map, av, bv) = compute_table_map(tx.view(), table, a, b)?;
    assert_eq!(map.row_count(), 2);
    assert_eq!(map.column_count(), 3);
    assert_eq!(
        map.rows
            .iter()
            .map(|row| row.iter().map(|v| v.map(|v| v.cell)).collect::<Vec<_>>())
            .collect::<Vec<_>>(),
        vec![
            vec![Some(a), Some(b), Some(b)],
            vec![Some(c), Some(b), Some(b)]
        ]
    );
    assert_eq!(
        (
            av.start_row,
            av.start_column,
            av.row_span,
            av.col_span,
            av.live
        ),
        (0, 0, 1, 1, false)
    );
    assert_eq!(
        (
            bv.start_row,
            bv.start_column,
            bv.row_span,
            bv.col_span,
            bv.live
        ),
        (0, 1, 4, 2, false)
    );
    assert_eq!(bv.row_span(tx.view()), 4);
    assert_eq!(bv.col_span(tx.view()), 2);
    assert_eq!(bv.header_state(tx.view()), TableCellHeaderState::ROW);
    assert_eq!((bv.end_row(tx.view()), bv.end_column(tx.view())), (3, 2));
    assert_eq!(map.get(1, 2), Some(&bv));
    assert_eq!(map.get(2, 0), None);
    assert_eq!(
        get_node_triplet(
            tx.view(),
            TripletSource::Point(Point::text(text, Utf16Offset(0)))
        )?,
        (b, row0, table)
    );
    assert_eq!(find_cell_node(tx.view(), text.key()), Some(b));
    assert_eq!(find_table_node(tx.view(), text.key()), Some(table));
    assert_eq!(
        get_table_row_node_from_table_cell_node(tx.view(), text.key())?,
        row0
    );
    assert_eq!(
        get_table_node_from_lexical_node(tx.view(), text.key())?,
        table
    );
    assert_eq!(get_table_row_index_from_table_cell_node(tx.view(), c)?, 1);
    assert_eq!(
        get_table_column_index_from_table_cell_node(tx.view(), b)?,
        1
    );
    assert_eq!(
        find_parent_table_cell_node_in_table(tx.view(), table.key(), Some(text.key())),
        Some(b)
    );
    assert_eq!(
        find_parent_table_cell_node_in_table(tx.view(), p.key(), Some(a.key())),
        None
    );
    let selection = Selection::Table(TableSelection::new(table.key(), a.key(), b.key()));
    assert!(is_selection_in_table(
        tx.view(),
        Some(&selection),
        table.key()
    ));
    assert!(!is_selection_in_table(tx.view(), None, table.key()));
    assert!(is_full_table_selection(tx.view(), Some(&selection), table)?);
    assert!(!is_full_table_selection(tx.view(), None, table)?);
    assert_eq!(
        get_table_cell_node_rect(tx.view(), c)?,
        Some(TableCellNodeRect {
            row_index: 1,
            column_index: 0,
            row_span: 1,
            col_span: 1
        })
    );
    tx.remove(c, true)?;
    let (ragged, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
    assert_eq!(ragged.rows[1][0], None);
    assert_eq!(ragged.rows[1][1].expect("span").cell, b);
    assert!(matches!(
        compute_table_map(tx.view(), table, c, a),
        Err(Error::Invariant("Anchor not found in Table"))
    ));
    assert!(matches!(
        compute_table_map(tx.view(), table, a, c),
        Err(Error::Invariant("Focus not found in Table"))
    ));
    Ok(())
}

#[test]
fn rectangle_expansion_includes_intersecting_spans_to_a_fixpoint() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let r0 = tx.create(TableRowNode::default())?;
    let r1 = tx.create(TableRowNode::default())?;
    let r2 = tx.create(TableRowNode::default())?;
    let a = tx.create(TableCellNode {
        col_span: 2,
        ..Default::default()
    })?;
    let b = tx.create(TableCellNode {
        row_span: 2,
        ..Default::default()
    })?;
    let c = tx.create(TableCellNode {
        row_span: 2,
        ..Default::default()
    })?;
    let d = tx.create(TableCellNode::default())?;
    let e = tx.create(TableCellNode {
        col_span: 2,
        ..Default::default()
    })?;
    tx.append(r0, &[a.key(), b.key()])?;
    tx.append(r1, &[c.key(), d.key()])?;
    tx.append(r2, &[e.key()])?;
    tx.append(table, &[r0.key(), r1.key(), r2.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let (map, av, ev) = compute_table_map(tx.view(), table, a, e)?;
    assert_eq!(
        compute_table_cell_rect_boundary(&map, &av, &ev),
        TableCellRectBoundary {
            min_column: 0,
            min_row: 0,
            max_column: 2,
            max_row: 2
        }
    );
    assert_eq!(
        compute_table_cell_rect_spans(
            &map,
            &TableCellRectBoundary {
                min_column: 0,
                min_row: 0,
                max_column: 2,
                max_row: 2
            }
        )?,
        TableCellRectSpans {
            top_span: 2,
            left_span: 2,
            right_span: 2,
            bottom_span: 2
        }
    );
    assert!(
        compute_table_cell_rect_spans(
            &map,
            &TableCellRectBoundary {
                min_column: 0,
                min_row: 0,
                max_column: 3,
                max_row: 2
            }
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn maps_capture_writable_identity_before_later_span_changes() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let ((table, cell), _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let row = tx.create(TableRowNode::default())?;
        let cell = tx.create(TableCellNode::default())?;
        tx.append(row, &[cell.key()])?;
        tx.append(table, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok((table, cell))
    })?;
    let mut tx = editor.transaction();
    let (_, frozen, _) = compute_in(&tx, table, Some(cell), None)?;
    let frozen = frozen.expect("cell");
    assert!(!frozen.live);
    tx.get_mut::<TableCellNode>(cell)?.row_span = 2;
    tx.get_mut::<TableCellNode>(cell)?.col_span = 3;
    tx.get_mut::<TableCellNode>(cell)?.header_state = TableCellHeaderState::ROW;
    let (_, live, _) = compute_in(&tx, table, Some(cell), None)?;
    let live = live.expect("cell");
    assert!(live.live);
    tx.get_mut::<TableCellNode>(cell)?.row_span = 4;
    tx.get_mut::<TableCellNode>(cell)?.col_span = 5;
    tx.get_mut::<TableCellNode>(cell)?.header_state = TableCellHeaderState::BOTH;
    assert_eq!(
        (
            frozen.row_span(tx.view()),
            frozen.col_span(tx.view()),
            frozen.header_state(tx.view())
        ),
        (1, 1, TableCellHeaderState::NO_STATUS)
    );
    assert_eq!(
        (
            live.row_span(tx.view()),
            live.col_span(tx.view()),
            live.header_state(tx.view())
        ),
        (4, 5, TableCellHeaderState::BOTH)
    );
    assert_eq!(
        (live.end_row(tx.view()), live.end_column(tx.view())),
        (3, 4)
    );
    let (checked, _, _) = checked_in(&tx, table, cell, cell)?;
    assert_eq!(checked.column_count(), 5);
    Ok(())
}

#[test]
fn malformed_children_and_missing_ancestors_return_upstream_diagnostics() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let paragraph = tx.create(Paragraph::default())?;
    tx.append(table, &[paragraph.key()])?;
    assert!(matches!(
        compute_table_map_skip_cell_check(tx.view(), table, None, None),
        Err(Error::Invariant(
            "Expected TableNode children to be TableRowNode"
        ))
    ));
    tx.remove(paragraph, true)?;
    let row = tx.create(TableRowNode::default())?;
    tx.append(table, &[row.key()])?;
    tx.append(row, &[paragraph.key()])?;
    assert!(matches!(
        compute_table_map_skip_cell_check(tx.view(), table, None, None),
        Err(Error::Invariant(
            "Expected TableRowNode children to be TableCellNode"
        ))
    ));
    assert_eq!(
        get_table_row_node_from_table_cell_node(tx.view(), paragraph.key())?,
        row
    );
    assert!(matches!(
        get_table_row_node_from_table_cell_node(tx.view(), NodeKey::ROOT),
        Err(Error::Invariant(
            "Expected table cell to be inside of table row."
        ))
    ));
    assert!(matches!(
        get_table_node_from_lexical_node(tx.view(), NodeKey::ROOT),
        Err(Error::Invariant(
            "Expected table cell to be inside of table."
        ))
    ));
    assert!(get_node_triplet(tx.view(), TripletSource::Node(paragraph.key())).is_err());
    assert_eq!(TableMap::default().row_count(), 0);
    assert_eq!(TableMap::default().column_count(), 0);
    Ok(())
}

#[test]
fn zero_span_endpoints_keep_signed_upstream_arithmetic_and_full_selection_checks_membership()
-> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let a = tx.create(TableCellNode::default())?;
    let value = TableMapValue {
        cell: a,
        start_row: 5,
        start_column: 6,
        row_span: 0,
        col_span: 0,
        header_state: TableCellHeaderState::NO_STATUS,
        live: false,
    };
    assert_eq!(value.end_row(tx.view()), 4);
    assert_eq!(value.end_column(tx.view()), 5);
    let origin = TableMapValue {
        start_row: 0,
        start_column: 0,
        ..value
    };
    assert_eq!(origin.end_row(tx.view()), -1);
    assert_eq!(origin.end_column(tx.view()), -1);
    tx.get_mut::<TableCellNode>(a)?.row_span = 0;
    tx.get_mut::<TableCellNode>(a)?.col_span = 0;
    let live = TableMapValue {
        row_span: 1,
        col_span: 1,
        live: true,
        ..value
    };
    assert_eq!(live.end_row(tx.view()), 4);
    assert_eq!(live.end_column(tx.view()), 5);
    let table = tx.create(TableNode::default())?;
    let row = tx.create(TableRowNode::default())?;
    let inside = tx.create(TableCellNode::default())?;
    tx.append(row, &[inside.key()])?;
    tx.append(table, &[row.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let anchor_outside = Selection::Table(TableSelection::new(table.key(), a.key(), inside.key()));
    let focus_outside = Selection::Table(TableSelection::new(table.key(), inside.key(), a.key()));
    assert!(matches!(
        is_full_table_selection(tx.view(), Some(&anchor_outside), table),
        Err(Error::Invariant("Anchor not found in Table"))
    ));
    assert!(matches!(
        is_full_table_selection(tx.view(), Some(&focus_outside), table),
        Err(Error::Invariant("Focus not found in Table"))
    ));
    Ok(())
}
