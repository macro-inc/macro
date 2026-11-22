use super::*;
use std::collections::HashSet;
#[test]
fn physical_grid_clamps_coordinates_uses_last_row_width_and_keeps_span_geometry_distinct()
-> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let rows = tx.children_keys(table)?;
    let a = cell_id(tx.view(), tx.first_child_or_err(rows[0])?)?;
    let b = cell_id(tx.view(), tx.last_child_or_err(rows[0])?)?;
    let c = cell_id(tx.view(), tx.first_child_or_err(rows[1])?)?;
    let d = tx.last_child_or_err(rows[1])?;
    tx.remove(d, true)?;
    tx.get_mut::<TableCellNode>(a)?.col_span = 2;
    tx.text(tx.first_descendant(a).expect("text"))?
        .set_text_content("a")?;
    tx.text(tx.first_descendant(b).expect("text"))?
        .set_text_content("b")?;
    tx.text(tx.first_descendant(c).expect("text"))?
        .set_text_content("c")?;
    let grid = table_grid(tx.view(), table)?;
    assert_eq!(grid.physical, vec![vec![a, b], vec![c]]);
    assert_eq!((grid.rows, grid.columns), (2, 1));
    assert_eq!(grid.map.column_count(), 3);
    assert_eq!(grid.cell_at(999, 0), Some(b));
    assert_eq!(grid.cell_at(1, 1), Some(c));
    assert_eq!(grid.cell_at(-1, 0), None);
    assert_eq!(grid.cell_at(0, -1), None);
    assert_eq!(grid.cell_at(0, 99), None);
    assert_eq!(grid.cell_at_or_err(0, 1)?, c);
    assert!(matches!(
        grid.cell_at_or_err(0, 99),
        Err(Error::Invariant("Cell not found at cords."))
    ));
    assert_eq!(grid.coords_of(b)?, (1, 0));
    assert!(grid.coords_of(cell_id(tx.view(), d)?).is_err());
    assert_eq!(grid.slot(0, 1).expect("span").cell, a);
    assert_eq!(grid.slot(0, 2).expect("span").cell, b);
    assert_eq!(grid.slot(1, 1), None);
    assert_eq!(
        grid.cells().collect::<Vec<_>>(),
        vec![(a, 0, 0), (b, 1, 0), (c, 0, 1)]
    );
    assert_eq!(
        next_cell_in_direction(&grid, 0, 0, TableDirection::Backward)?,
        CellMove::SelectPreviousOfTable
    );
    assert_eq!(
        next_cell_in_direction(&grid, 0, 0, TableDirection::Forward)?,
        CellMove::Cell {
            cell: c,
            from_start: true
        }
    );
    assert_eq!(
        next_cell_in_direction(&grid, 1, 0, TableDirection::Backward)?,
        CellMove::Cell {
            cell: a,
            from_start: false
        }
    );
    assert_eq!(
        next_cell_in_direction(&grid, 0, 1, TableDirection::Up)?,
        CellMove::Cell {
            cell: a,
            from_start: false
        }
    );
    assert_eq!(
        next_cell_in_direction(&grid, 1, 0, TableDirection::Down)?,
        CellMove::Cell {
            cell: c,
            from_start: true
        }
    );
    assert_eq!(
        next_cell_in_direction(&grid, 0, 1, TableDirection::Forward)?,
        CellMove::SelectNextOfTable
    );
    assert_eq!(
        next_cell_in_direction(&grid, 0, 1, TableDirection::Down)?,
        CellMove::SelectNextOfTable
    );
    apply_cell_move(
        &mut tx,
        table,
        CellMove::Cell {
            cell: b,
            from_start: false,
        },
    )?;
    assert_eq!(
        tx.anchor()?,
        Point::text(tx.first_descendant(b).expect("text"), Utf16Offset(1))
    );
    apply_cell_move(
        &mut tx,
        table,
        CellMove::Cell {
            cell: c,
            from_start: true,
        },
    )?;
    assert_eq!(
        tx.anchor()?,
        Point::text(tx.first_descendant(c).expect("text"), Utf16Offset(0))
    );
    apply_cell_move(&mut tx, table, CellMove::SelectNextOfTable)?;
    assert_eq!(tx.anchor()?, Point::element(NodeKey::ROOT, ChildIndex(1)));
    apply_cell_move(&mut tx, table, CellMove::SelectPreviousOfTable)?;
    assert_eq!(tx.anchor()?, Point::element(NodeKey::ROOT, ChildIndex(0)));
    let mut selected = NodeSelection::new();
    selected.add(a);
    selected.add(c);
    assert_eq!(
        selected_node_keys(tx.view(), Some(&Selection::Node(selected)))?,
        HashSet::from([a.key(), c.key()])
    );
    assert!(selected_node_keys(tx.view(), None)?.is_empty());
    let json = serde_json::to_value(&grid).expect("grid boundary");
    assert_eq!(json["table"], "1");
    assert_eq!(json["physical"], serde_json::json!([["3", "6"], ["10"]]));
    assert_eq!(json["rows"], 2);
    assert_eq!(json["columns"], 1);
    assert_eq!(json["map"]["rows"][0][1]["cell"], "3");
    assert_eq!(json["map"]["rows"][0][2]["cell"], "6");
    tx.commit()?;
    Ok(())
}
