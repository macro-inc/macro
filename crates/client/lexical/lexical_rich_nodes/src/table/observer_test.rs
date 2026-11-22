use super::*;

// tableClear.test.ts: clears selected cells on cut.
#[test]
fn patched_clear_text_cut_leaves_other_cells_unchanged() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 3, 3, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let text = [["01", "02", "03"], ["04", "05", "06"], ["07", "08", "09"]];
        for (r, row) in tx.children_keys(table)?.into_iter().enumerate() {
            for (c, cell) in tx.children_keys(row)?.into_iter().enumerate() {
                tx.text(tx.first_descendant(cell).expect("text"))?
                    .set_text_content(text[r][c])?;
            }
        }
        Ok(table)
    })?;
    editor.update(|tx| {
        let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
        select_cells(
            tx,
            table,
            map.get(0, 0).expect("anchor").cell,
            map.get(1, 1).expect("focus").cell,
        )?;
        assert_eq!(clear_text(tx, table.key())?, ClearText::CellsCleared);
        assert!(tx.selection().is_none());
        Ok(())
    })?;
    let view = editor.state().view();
    let text = view
        .children(table)
        .map(|row| {
            view.children(row)
                .map(|cell| view.text_content(cell).into_owned())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        text,
        vec![
            vec!["", "", "03"],
            vec!["", "", "06"],
            vec!["07", "08", "09"]
        ]
    );
    Ok(())
}

// tableClear.test.ts: clears selected cells on delete.
#[test]
fn patched_clear_text_delete_leaves_other_cells_unchanged() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 3, 3, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let text = [["01", "02", "03"], ["04", "05", "06"], ["07", "08", "09"]];
        for (r, row) in tx.children_keys(table)?.into_iter().enumerate() {
            for (c, cell) in tx.children_keys(row)?.into_iter().enumerate() {
                tx.text(tx.first_descendant(cell).expect("text"))?
                    .set_text_content(text[r][c])?;
            }
        }
        Ok(table)
    })?;
    editor.update(|tx| {
        let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
        select_cells(
            tx,
            table,
            map.get(0, 0).expect("anchor").cell,
            map.get(0, 2).expect("focus").cell,
        )?;
        assert_eq!(clear_text(tx, table.key())?, ClearText::CellsCleared);
        assert!(tx.selection().is_none());
        Ok(())
    })?;
    let view = editor.state().view();
    let text = view
        .children(table)
        .map(|row| {
            view.children(row)
                .map(|cell| view.text_content(cell).into_owned())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        text,
        vec![
            vec!["", "", ""],
            vec!["04", "05", "06"],
            vec!["07", "08", "09"]
        ]
    );
    Ok(())
}

// tableClear.test.ts: clears selected cells on backspace.
#[test]
fn patched_clear_text_backspace_leaves_other_cells_unchanged() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 3, 3, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let text = [["01", "02", "03"], ["04", "05", "06"], ["07", "08", "09"]];
        for (r, row) in tx.children_keys(table)?.into_iter().enumerate() {
            for (c, cell) in tx.children_keys(row)?.into_iter().enumerate() {
                tx.text(tx.first_descendant(cell).expect("text"))?
                    .set_text_content(text[r][c])?;
            }
        }
        Ok(table)
    })?;
    editor.update(|tx| {
        let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
        select_cells(
            tx,
            table,
            map.get(2, 0).expect("anchor").cell,
            map.get(2, 2).expect("focus").cell,
        )?;
        assert_eq!(clear_text(tx, table.key())?, ClearText::CellsCleared);
        assert!(tx.selection().is_none());
        Ok(())
    })?;
    let view = editor.state().view();
    let text = view
        .children(table)
        .map(|row| {
            view.children(row)
                .map(|cell| view.text_content(cell).into_owned())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        text,
        vec![
            vec!["01", "02", "03"],
            vec!["04", "05", "06"],
            vec!["", "", ""]
        ]
    );
    Ok(())
}

// tableClear.test.ts:135: no empty TextNode may exist even before normalization.
#[test]
fn patched_clear_text_creates_one_childless_paragraph_without_allocating_empty_text() -> Result<()>
{
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 3, 3, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let text = [["01", "02", "03"], ["04", "05", "06"], ["07", "08", "09"]];
        for (r, row) in tx.children_keys(table)?.into_iter().enumerate() {
            for (c, cell) in tx.children_keys(row)?.into_iter().enumerate() {
                tx.text(tx.first_descendant(cell).expect("text"))?
                    .set_text_content(text[r][c])?;
            }
        }
        Ok(table)
    })?;
    let before = editor.state().max_key().index();
    let (_, commit) = editor.update(|tx| {
        let cell = cell_id(
            tx.view(),
            tx.first_child_or_err(tx.first_child_or_err(table)?)?,
        )?;
        select_cells(tx, table, cell, cell)?;
        assert_eq!(clear_text(tx, table.key())?, ClearText::CellsCleared);
        let children = tx.children_keys(cell)?;
        assert_eq!(children.len(), 1);
        assert!(tx.is::<Paragraph>(children[0]));
        assert_eq!(tx.children_size(children[0]), 0);
        Ok(())
    })?;
    assert_eq!(commit.next.max_key().index(), before + 1);
    let cell = commit
        .next
        .view()
        .first_child_or_err(commit.next.view().first_child_or_err(table)?)?;
    let p = commit.next.view().first_child_or_err(cell)?;
    assert_eq!(commit.next.view().children_size(p), 0);
    Ok(())
}

#[test]
fn clearing_whole_table_reports_root_emptiness_without_inserting_a_paragraph() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 1, 1, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let cell = cell_id(
            tx.view(),
            tx.first_child_or_err(tx.first_child_or_err(table)?)?,
        )?;
        select_cells(tx, table, cell, cell)?;
        assert_eq!(
            clear_text(tx, table.key())?,
            ClearText::TableRemoved { root_emptied: true }
        );
        assert!(tx.is_empty(NodeKey::ROOT));
        assert_eq!(tx.anchor()?, Point::element(NodeKey::ROOT, ChildIndex(0)));
        Ok(())
    })?;
    assert_eq!(editor.state().node_count(), 1);
    Ok(())
}

#[test]
fn format_cells_uses_detached_ranges_and_restores_the_table_selection() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 1, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let row = tx.first_child_or_err(table)?;
        let a = cell_id(tx.view(), tx.first_child_or_err(row)?)?;
        let b = cell_id(tx.view(), tx.last_child_or_err(row)?)?;
        let ta = tx.first_descendant(a).expect("text");
        let tb = tx.first_descendant(b).expect("text");
        tx.text(ta)?
            .set_text_content("bold")?
            .set_format(TextFormat::BOLD)?;
        tx.text(tb)?.set_text_content("plain")?;
        let pa = tx.first_child_or_err(a)?;
        tx.element(pa)?.set_text_format(TextFormat::BOLD)?;
        let selection = select_cells(tx, table, a, b)?;
        let replacements = tx.selection_replacements();
        format_cells(tx, TextFormatType::Bold)?;
        assert_eq!(tx.view().text_data(ta)?.format, TextFormat::empty());
        assert_eq!(tx.view().text_data(tb)?.format, TextFormat::empty());
        assert_eq!(tx.selection(), Some(&Selection::Table(selection)));
        assert_eq!(tx.selection_replacements(), replacements);
        Ok(())
    })?;
    assert!(editor.state().selection().is_some_and(Selection::is_table));
    Ok(())
}

#[test]
fn observer_actions_reject_missing_table_or_table_selection_with_exact_diagnostics() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let mut tx = editor.transaction();
    assert_eq!(
        clear_text(&mut tx, NodeKey::ROOT)
            .expect_err("table")
            .to_string(),
        "Expected TableNode."
    );
    assert_eq!(
        format_cells(&mut tx, TextFormatType::Bold)
            .expect_err("selection")
            .to_string(),
        "Expected Table selection"
    );
    let table = create_table_node_with_dimensions(&mut tx, 1, 1, IncludeHeaders::All(false))?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    assert_eq!(
        clear_text(&mut tx, table.key())
            .expect_err("selection")
            .to_string(),
        "Expected TableSelection"
    );
    let text = tx.first_descendant(table).expect("text");
    let selection = TableSelection::new(table.key(), text, text);
    assert_eq!(
        selection
            .insert_nodes(&mut tx, &[])
            .expect_err("element focus")
            .to_string(),
        "Expected TableSelection focus to be an ElementNode"
    );
    Ok(())
}
