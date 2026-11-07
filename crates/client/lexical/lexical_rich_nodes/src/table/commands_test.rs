use super::*;

// TableExtension.test.ts: INSERT_TABLE_COMMAND preserves split paragraphs and headers.
#[test]
fn upstream_insert_table_splits_empty_paragraph_and_blocks_nested_by_default() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    assert!(!insert_table(
        &mut tx,
        &InsertTablePayload {
            rows: 2,
            columns: 3,
            include_headers: IncludeHeaders::All(true)
        },
        false
    )?);
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(p)?;
    assert!(insert_table(
        &mut tx,
        &InsertTablePayload {
            rows: 2,
            columns: 3,
            include_headers: IncludeHeaders::All(true)
        },
        false
    )?);
    let roots = tx.children_keys(NodeKey::ROOT)?;
    assert_eq!(roots.len(), 3);
    assert_eq!(roots[0], p.key());
    assert!(tx.is::<TableNode>(roots[1]));
    assert!(tx.is::<Paragraph>(roots[2]));
    let table = table_id(tx.view(), roots[1])?;
    let grid = table_grid(tx.view(), table)?;
    assert_eq!((grid.rows, grid.columns), (2, 3));
    let headers = grid
        .physical
        .iter()
        .map(|row| {
            row.iter()
                .map(|c| {
                    tx.get::<TableCellNode>(*c)
                        .expect("cell")
                        .header_state
                        .bits()
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(headers, vec![vec![3, 1, 1], vec![2, 0, 0]]);
    let first = tx.first_descendant(table).expect("text");
    assert!(tx.is_text(first));
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::text(first, Utf16Offset(0))
    );
    assert!(!insert_table(
        &mut tx,
        &InsertTablePayload {
            rows: 1,
            columns: 1,
            include_headers: IncludeHeaders::All(false)
        },
        false
    )?);
    assert!(insert_table(
        &mut tx,
        &InsertTablePayload {
            rows: 1,
            columns: 1,
            include_headers: IncludeHeaders::All(false)
        },
        true
    )?);
    let outer = grid.cell_at(0, 0).expect("outer");
    assert!(tx.children(outer).any(|k| tx.is::<TableNode>(k)));
    tx.commit()?;
    Ok(())
}

// LexicalTablePluginHelpers: root-only SELECT_ALL and triple-click model selection.
#[test]
fn upstream_select_all_and_block_in_cell_guard_root_and_block_parent() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    assert!(!select_all_in_table(&mut tx)?);
    assert!(!select_block_in_cell(&mut tx, NodeKey::ROOT)?);
    let table = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let grid = table_grid(tx.view(), table)?;
    let a = grid.cell_at(0, 0).expect("a");
    let f = grid.cell_at(1, 1).expect("f");
    let text = tx.first_descendant(a).expect("text");
    tx.select_start(text)?;
    assert!(select_block_in_cell(&mut tx, text)?);
    let paragraph = tx.parent_or_err(text)?;
    let r = tx.selection().and_then(Selection::as_range).expect("range");
    assert_eq!(
        (r.anchor, r.focus),
        (
            Point::element(paragraph, ChildIndex(0)),
            Point::element(paragraph, ChildIndex(0))
        )
    );
    assert!(select_all_in_table(&mut tx)?);
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_table)
            .expect("table")
            .anchor
            .key(),
        a.key()
    );
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_table)
            .expect("table")
            .focus
            .key(),
        f.key()
    );
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_start(a)?;
    assert!(!select_all_in_table(&mut tx)?);
    tx.commit()?;
    Ok(())
}

// LexicalTableSelectionHelpers: single-table paste grows a grid and moves template children.
#[test]
fn upstream_clipboard_table_grows_grid_copies_background_and_moves_children() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 1, 1, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let cell = table_grid(tx.view(), table)?.cell_at(0, 0).expect("cell");
    tx.select_start(cell)?;
    let template = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    let template_grid = table_grid(tx.view(), template)?;
    for (row, values) in [["one", "two"], ["three", "four"]].iter().enumerate() {
        for (col, value) in values.iter().enumerate() {
            let c = template_grid.cell_at(col as i64, row as i64).expect("cell");
            let t = tx.first_descendant(c).expect("text");
            tx.text(t)?.set_text_content(*value)?;
        }
    }
    tx.get_mut::<TableCellNode>(template_grid.cell_at(1, 1).expect("cell"))?
        .background_color = Some("red".into());
    assert!(insert_clipboard_nodes_in_table(
        &mut tx,
        &[template.key()],
        SelectionSlot::Active,
        false
    )?);
    let grid = table_grid(tx.view(), table)?;
    assert_eq!((grid.rows, grid.columns), (2, 2));
    let content = grid
        .physical
        .iter()
        .map(|row| {
            row.iter()
                .map(|c| tx.text_content(*c).into_owned())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(content, vec![vec!["one", "two"], vec!["three", "four"]]);
    assert_eq!(
        tx.get::<TableCellNode>(grid.cell_at(1, 1).expect("cell"))
            .expect("cell")
            .background_color
            .as_deref(),
        Some("red")
    );
    for (c, _, _) in template_grid.cells() {
        assert!(tx.is_empty(c));
    }
    tx.commit()?;
    Ok(())
}

#[test]
fn clipboard_merged_table_selection_clamps_and_swallow_rules_match_upstream() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    let table = create_table_node_with_dimensions(&mut tx, 2, 3, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let grid = table_grid(tx.view(), table)?;
    let a = grid.cell_at(0, 0).expect("a");
    let b = grid.cell_at(1, 0).expect("b");
    let template = create_table_node_with_dimensions(&mut tx, 2, 2, IncludeHeaders::All(false))?;
    let tg = table_grid(tx.view(), template)?;
    let merged = merge_cells(
        &mut tx,
        &[
            tg.cell_at(0, 0).expect("cell"),
            tg.cell_at(1, 1).expect("cell"),
        ],
    )?
    .expect("merged");
    let t = tx.create_text("merged")?;
    let p = tx.first_child(merged).expect("paragraph");
    tx.append(p, &[t.key()])?;
    select_cells(&mut tx, table, a, b)?;
    assert!(insert_clipboard_nodes_in_table(
        &mut tx,
        &[template.key()],
        SelectionSlot::Active,
        false
    )?);
    assert_eq!(tx.get::<TableCellNode>(a).expect("cell").col_span, 2);
    assert_eq!(tx.get::<TableCellNode>(a).expect("cell").row_span, 1);
    assert_eq!(tx.text_content(a), "merged\n\n\n\n\n\n");
    assert!(matches!(tx.selection(), Some(Selection::Range(_))));
    let wrapper = tx.create(Paragraph::default())?;
    let nested = create_table_node_with_dimensions(&mut tx, 1, 1, IncludeHeaders::All(false))?;
    tx.append(wrapper, &[nested.key()])?;
    tx.select_start(a)?;
    assert!(!insert_clipboard_nodes_in_table(
        &mut tx,
        &[wrapper.key()],
        SelectionSlot::Active,
        true
    )?);
    assert!(insert_clipboard_nodes_in_table(
        &mut tx,
        &[wrapper.key()],
        SelectionSlot::Active,
        false
    )?);
    let text = tx.create_text("plain")?;
    assert!(!insert_clipboard_nodes_in_table(
        &mut tx,
        &[text.key()],
        SelectionSlot::Active,
        false
    )?);
    tx.set_selection(None)?;
    assert!(!insert_clipboard_nodes_in_table(
        &mut tx,
        &[wrapper.key()],
        SelectionSlot::Active,
        false
    )?);
    tx.commit()?;
    Ok(())
}

// lexical-utils $insertNodeToNearestRootAtCaret: inline wrapping and direction retention.
#[test]
fn nearest_root_caret_splits_text_wraps_inline_and_preserves_direction() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abcd")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let inline = tx.create_text("x")?;
    let caret = caret_from_point(
        tx.view(),
        &Point::text(t, Utf16Offset(2)),
        CaretDirection::Previous,
    )?;
    let result = crate::utils::insert_node_to_nearest_root_at_caret(
        &mut tx,
        inline.key(),
        caret,
        Default::default(),
    )?;
    assert_eq!(result.direction(), CaretDirection::Previous);
    assert_eq!(tx.children_size(NodeKey::ROOT), 3);
    assert!(tx.parent(inline).is_some_and(|k| tx.is::<Paragraph>(k)));
    assert_eq!(
        tx.children(NodeKey::ROOT)
            .map(|k| tx.text_content(k).into_owned())
            .collect::<Vec<_>>(),
        vec!["ab", "x", "cd"]
    );
    tx.set_selection(None)?;
    let block = tx.create(Paragraph::default())?;
    assert_eq!(
        crate::utils::insert_node_to_nearest_root(&mut tx, block.key())?,
        block.key()
    );
    assert_eq!(tx.children_size(NodeKey::ROOT), 5);
    tx.commit()?;
    Ok(())
}
