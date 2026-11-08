use super::*;
struct Host {
    typeahead: bool,
    present: bool,
    exits: Option<bool>,
}
impl TableView for Host {
    fn is_typeahead_open(&self) -> bool {
        self.typeahead
    }
    fn has_cell_element(&self, _: NodeKey) -> bool {
        self.present
    }
    fn caret_exits_cell(&self, _: &Point, _: NodeKey, _: TableDirection) -> Option<bool> {
        self.exits
    }
}

// LexicalTableSelectionHelpers horizontal arrows: native text movement until the cell edge.
#[test]
fn horizontal_arrows_use_core_carets_and_host_presence() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 1, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let b = g.cell_at(1, 0).expect("b");
    let t = tx.first_descendant(a).expect("text");
    tx.text(t)?.set_text_content("abc")?;
    let host = Host {
        typeahead: false,
        present: true,
        exits: Some(true),
    };
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(t, Utf16Offset(1)),
        Point::text(t, Utf16Offset(1)),
    ))))?;
    assert!(!handle_arrow_key(&mut tx, table, TableDirection::Forward, false, &host)?.handled);
    tx.select_end(a)?;
    let no_dom = Host {
        present: false,
        ..host
    };
    assert!(!handle_arrow_key(&mut tx, table, TableDirection::Forward, true, &no_dom)?.handled);
    assert_eq!(
        handle_arrow_key(&mut tx, table, TableDirection::Forward, true, &host)?,
        HandlerResult {
            handled: true,
            stop_event: true,
            effect: ObserverEffect::SelectCells {
                table,
                anchor: a,
                focus: b
            }
        }
    );
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Forward, false, &host)?.handled);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(b)
    );
    tx.select_end(b)?;
    assert_eq!(
        handle_arrow_key(&mut tx, table, TableDirection::Forward, true, &host)?.effect,
        ObserverEffect::SelectCells {
            table,
            anchor: b,
            focus: b
        }
    );
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Forward, false, &host)?.handled);
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::element(NodeKey::ROOT, ChildIndex(1))
    );
    tx.select_start(b)?;
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Backward, false, &host)?.handled);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(a)
    );
    tx.commit()?;
    Ok(())
}

#[test]
fn vertical_arrows_require_edge_facts_and_table_selection_extension_stops_at_edge() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let c = g.cell_at(0, 1).expect("c");
    let d = g.cell_at(1, 1).expect("d");
    tx.select_start(a)?;
    let host = Host {
        typeahead: false,
        present: true,
        exits: Some(true),
    };
    assert!(
        !handle_arrow_key(
            &mut tx,
            table,
            TableDirection::Down,
            false,
            &Host {
                typeahead: true,
                ..host
            }
        )?
        .handled
    );
    assert!(
        !handle_arrow_key(
            &mut tx,
            table,
            TableDirection::Down,
            false,
            &Host {
                exits: None,
                ..host
            }
        )?
        .handled
    );
    assert!(
        !handle_arrow_key(
            &mut tx,
            table,
            TableDirection::Down,
            false,
            &Host {
                exits: Some(false),
                ..host
            }
        )?
        .handled
    );
    assert_eq!(
        handle_arrow_key(&mut tx, table, TableDirection::Down, true, &host)?.effect,
        ObserverEffect::SelectCells {
            table,
            anchor: a,
            focus: a
        }
    );
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Down, false, &host)?.handled);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(c)
    );
    select_cells(&mut tx, table, a, c)?;
    assert_eq!(
        handle_arrow_key(&mut tx, table, TableDirection::Forward, true, &host)?,
        HandlerResult {
            handled: true,
            stop_event: true,
            effect: ObserverEffect::ResyncFromTableSelection {
                anchor: a,
                then: Some((a, d))
            }
        }
    );
    select_cells(&mut tx, table, a, d)?;
    assert_eq!(
        handle_arrow_key(&mut tx, table, TableDirection::Down, true, &host)?,
        HandlerResult {
            handled: false,
            stop_event: true,
            effect: ObserverEffect::ResyncFromTableSelection {
                anchor: a,
                then: None
            }
        }
    );
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Up, false, &host)?.handled);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(d)
    );
    tx.commit()?;
    Ok(())
}

#[test]
fn outside_arrows_enter_table_unselect_and_request_down_fix() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let before = tx.create(Paragraph::default())?;
    let bt = tx.create_text("before")?;
    tx.append(before, &[bt.key()])?;
    let table = create_table_node_with_dimensions(&mut tx, 1, 2, IncludeHeaders::All(false))?;
    let after = tx.create(Paragraph::default())?;
    let at = tx.create_text("after")?;
    tx.append(after, &[at.key()])?;
    tx.append(NodeKey::ROOT, &[before.key(), table.key(), after.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let b = g.cell_at(1, 0).expect("b");
    let host = Host {
        typeahead: false,
        present: true,
        exits: Some(true),
    };
    tx.select_start(after)?;
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Backward, false, &host)?.handled);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .focus
                .key()
        ),
        Some(b)
    );
    tx.select_start(after)?;
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Backward, true, &host)?.handled);
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .focus,
        Point::element(NodeKey::ROOT, ChildIndex(1))
    );
    tx.select_start(before)?;
    assert_eq!(
        handle_arrow_key(&mut tx, table, TableDirection::Down, false, &host)?.effect,
        ObserverEffect::CheckSelectionAfterDown { table }
    );
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Down, true, &host)?.handled);
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .focus,
        Point::element(b, ChildIndex(1))
    );
    assert!(handle_arrow_key(&mut tx, table, TableDirection::Up, true, &host)?.handled);
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .focus,
        Point::text(bt, Utf16Offset(6))
    );
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(tx.first_descendant(a).expect("text"), Utf16Offset(0)),
        Point::element(NodeKey::ROOT, ChildIndex(2)),
    ))))?;
    let result = handle_arrow_key(&mut tx, table, TableDirection::Down, true, &host)?;
    assert_eq!(
        result,
        HandlerResult {
            handled: true,
            stop_event: false,
            effect: ObserverEffect::SelectCells {
                table,
                anchor: a,
                focus: b
            }
        }
    );
    tx.commit()?;
    Ok(())
}

#[test]
fn merged_rectangle_focus_extension_contracts_at_cell_boundaries() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 3, 3, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let b = g.cell_at(1, 0).expect("b");
    let end = g.cell_at(2, 2).expect("end");
    let merged = merge_cells(&mut tx, &[a, b])?.expect("merged");
    let (map, av, fv) = compute_table_map(tx.view(), table, merged, end)?;
    assert_eq!(
        adjust_focus_in_direction(&map, &av, &fv, TableDirection::Up)?,
        Some((merged, g.cell_at(2, 1).expect("cell")))
    );
    assert_eq!(
        adjust_focus_in_direction(&map, &av, &fv, TableDirection::Backward)?,
        Some((merged, g.cell_at(1, 2).expect("cell")))
    );
    assert_eq!(
        adjust_focus_in_direction(&map, &av, &fv, TableDirection::Forward)?,
        None
    );
    tx.commit()?;
    Ok(())
}

#[test]
fn tab_escape_format_and_delete_line_handlers_keep_upstream_guards() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let b = g.cell_at(1, 0).expect("b");
    let d = g.cell_at(1, 1).expect("d");
    tx.select_start(a)?;
    assert_eq!(
        delete_text_in_table(&mut tx, table, DeleteTextKind::Line)?,
        DeleteOutcome::Handled
    );
    assert_eq!(
        delete_text_in_table(&mut tx, table, DeleteTextKind::Word)?,
        DeleteOutcome::NotHandled
    );
    assert_eq!(
        delete_text_in_table(&mut tx, table, DeleteTextKind::Character)?,
        DeleteOutcome::NotHandled
    );
    assert!(tab_in_table(&mut tx, table, false)?);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(b)
    );
    assert!(tab_in_table(&mut tx, table, true)?);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(a)
    );
    select_adjacent_cell(&mut tx, b, true)?;
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        g.cell_at(0, 1)
    );
    select_adjacent_cell(&mut tx, d, true)?;
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::element(NodeKey::ROOT, ChildIndex(1))
    );
    assert!(!escape_table_selection(&mut tx, table)?);
    assert!(!format_text_in_table(&mut tx, table, TextFormatType::Bold)?);
    select_cells(&mut tx, table, a, b)?;
    assert!(format_element_in_table(
        &mut tx,
        table,
        ElementFormat::Center
    )?);
    assert_eq!(tx.view().element_data(a)?.format, ElementFormat::Center);
    assert_eq!(
        tx.view()
            .element_data(tx.first_child(a).expect("paragraph"))?
            .format,
        ElementFormat::Center
    );
    assert_eq!(
        tx.view().element_data(table)?.format,
        ElementFormat::default()
    );
    assert!(format_text_in_table(&mut tx, table, TextFormatType::Bold)?);
    assert!(escape_table_selection(&mut tx, table)?);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(b)
    );
    select_cells(&mut tx, table, a, d)?;
    assert!(format_element_in_table(
        &mut tx,
        table,
        ElementFormat::Right
    )?);
    assert_eq!(tx.view().element_data(table)?.format, ElementFormat::Right);
    select_cells(&mut tx, table, a, a)?;
    assert_eq!(
        delete_text_in_table(&mut tx, table, DeleteTextKind::Character)?,
        DeleteOutcome::Cleared(ClearText::CellsCleared)
    );
    assert!(tx.selection().is_none());
    tx.commit()?;
    Ok(())
}

#[test]
fn delete_and_cut_preserve_outer_range_point_and_clear_cell_selections() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 1, 2, IncludeHeaders::All(false))?;
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("outer")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[table.key(), p.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let at = tx.first_descendant(a).expect("text");
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(at, Utf16Offset(0)),
        Point::text(t, Utf16Offset(3)),
    ))))?;
    assert_eq!(delete_cell(&mut tx, table)?, DeleteOutcome::NotHandled);
    let r = tx.selection().and_then(Selection::as_range).expect("range");
    assert_eq!(r.focus, Point::text(t, Utf16Offset(3)));
    assert_eq!(r.anchor, Point::element(NodeKey::ROOT, ChildIndex(0)));
    select_cells(&mut tx, table, a, a)?;
    assert_eq!(
        cut_in_table(&mut tx, table)?,
        DeleteOutcome::Cleared(ClearText::CellsCleared)
    );
    tx.text(t)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(4)))?;
    assert_eq!(cut_in_table(&mut tx, table)?, DeleteOutcome::Handled);
    assert_eq!(tx.text_content(t), "or");
    select_cells(&mut tx, table, a, g.cell_at(1, 0).expect("cell"))?;
    assert_eq!(
        delete_cell(&mut tx, table)?,
        DeleteOutcome::Cleared(ClearText::TableRemoved {
            root_emptied: false
        })
    );
    assert!(!tx.is_attached(table));
    tx.commit()?;
    Ok(())
}

#[test]
fn edge_paragraph_and_controlled_text_require_host_beside_fact() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let d = g.cell_at(1, 1).expect("d");
    tx.select_start(a)?;
    let r = tx.selection().and_then(Selection::as_range).expect("range");
    assert_eq!(
        table_edge_cursor_position(tx.view(), r, table, false)?,
        None
    );
    assert_eq!(
        table_edge_cursor_position(tx.view(), r, table, true)?,
        Some(TableEdge::First)
    );
    assert!(!controlled_text_insertion_in_table(
        &mut tx, table, "before", false
    )?);
    assert!(controlled_text_insertion_in_table(
        &mut tx, table, "before", true
    )?);
    let before = tx.first_child(NodeKey::ROOT).expect("p");
    assert_eq!(tx.text_content(before), "before");
    tx.select_end(d)?;
    let r = tx.selection().and_then(Selection::as_range).expect("range");
    assert_eq!(
        table_edge_cursor_position(tx.view(), r, table, true)?,
        Some(TableEdge::Last)
    );
    assert!(insert_paragraph_in_table(&mut tx, table, true)?);
    let after = tx.last_child(NodeKey::ROOT).expect("p");
    assert!(tx.is::<Paragraph>(after));
    assert!(tx.is_empty(after));
    let text = tx.create_text("tail")?;
    insert_paragraph_at_table_edge(&mut tx, TableEdge::Last, table, &[text.key()])?;
    assert_eq!(tx.text_content(tx.next_sibling(table).expect("p")), "tail");
    select_cells(&mut tx, table, a, d)?;
    assert!(!controlled_text_insertion_in_table(
        &mut tx, table, "ignored", true
    )?);
    assert!(tx.selection().is_none());
    tx.commit()?;
    Ok(())
}

#[test]
fn selection_change_clamps_crossing_ranges_and_converts_distinct_cells() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("before")?;
    tx.append(p, &[t.key()])?;
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[p.key(), table.key()])?;
    let g = table_grid(tx.view(), table)?;
    let a = g.cell_at(0, 0).expect("a");
    let d = g.cell_at(1, 1).expect("d");
    let at = tx.first_descendant(a).expect("a text");
    let dt = tx.first_descendant(d).expect("d text");
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(t, Utf16Offset(0)),
        Point::text(dt, Utf16Offset(0)),
    ))))?;
    assert_eq!(
        fix_range_selection_for_tables(&mut tx, &|_| TouchState::default())?,
        RangeFix::Applied
    );
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .focus,
        Point::element(d, ChildIndex(1))
    );
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(at, Utf16Offset(0)),
        Point::text(t, Utf16Offset(0)),
    ))))?;
    assert_eq!(
        fix_range_selection_for_tables(&mut tx, &|_| TouchState::default())?,
        RangeFix::Applied
    );
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::element(d, ChildIndex(1))
    );
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(at, Utf16Offset(0)),
        Point::text(dt, Utf16Offset(0)),
    ))))?;
    assert_eq!(
        fix_range_selection_for_tables(&mut tx, &|_| TouchState::default())?,
        RangeFix::ConvertToCells {
            table,
            anchor: a,
            focus: d,
            reset_pointer_type: false
        }
    );
    select_cells(&mut tx, table, a, d)?;
    normalize_table_selection(&mut tx)?;
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_table)
            .expect("table")
            .anchor
            .key(),
        a.key()
    );
    tx.select_start(a)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.select_start(d)?;
    assert_eq!(
        fix_range_selection_for_tables(&mut tx, &|_| TouchState {
            is_touch: true,
            is_selecting: true
        })?,
        RangeFix::ConvertToCells {
            table,
            anchor: a,
            focus: d,
            reset_pointer_type: true
        }
    );
    assert!(fix_selection_after_down_into_table(&mut tx, table)?);
    assert_eq!(
        find_cell_node(
            tx.view(),
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        Some(a)
    );
    assert!(!fix_selection_after_down_into_table(&mut tx, table)?);
    tx.commit()?;
    Ok(())
}
