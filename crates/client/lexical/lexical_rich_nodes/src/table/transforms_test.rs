use super::*;

// LexicalTableExtension.test.ts: removes an empty colWidths array.
#[test]
fn upstream_empty_widths_are_removed() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.get_mut::<TableNode>(table)?.col_widths = Some(vec![]);
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok(table)
    })?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableNode>(table)
            .expect("table")
            .col_widths,
        None
    );
    Ok(())
}
// LexicalTableExtension.test.ts: repeats the last column width when the table is wider.
#[test]
fn upstream_short_widths_repeat_the_last_value() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 3, IncludeHeaders::All(false))?;
        tx.get_mut::<TableNode>(table)?.col_widths =
            Some(vec![Some(JsNumber(10.0)), Some(JsNumber(20.0))]);
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok(table)
    })?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableNode>(table)
            .expect("table")
            .col_widths,
        Some(vec![
            Some(JsNumber(10.0)),
            Some(JsNumber(20.0)),
            Some(JsNumber(20.0))
        ])
    );
    Ok(())
}
// LexicalTableExtension.test.ts: trims excess widths.
#[test]
fn upstream_excess_widths_are_truncated() -> Result<()> {
    let mut editor = register_table(
        Editor::builder(EditorMode::Headless),
        &TableConfig::default(),
    )
    .build()
    .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.get_mut::<TableNode>(table)?.col_widths = Some(vec![
            Some(JsNumber(10.0)),
            Some(JsNumber(20.0)),
            Some(JsNumber(30.0)),
        ]);
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok(table)
    })?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableNode>(table)
            .expect("table")
            .col_widths,
        Some(vec![Some(JsNumber(10.0)), Some(JsNumber(20.0))])
    );
    Ok(())
}

#[test]
fn configured_integrity_unmerges_cells_strips_backgrounds_and_repairs_orphans() -> Result<()> {
    let config = TableConfig {
        has_cell_merge: false,
        has_cell_background_color: false,
        has_nested_tables: false,
    };
    let mut editor = register_table(Editor::builder(EditorMode::Headless), &config)
        .build()
        .expect("registry");
    let ((table, a, orphan), _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let r0 = tx.create(TableRowNode::default())?;
        let r1 = tx.create(TableRowNode::default())?;
        let a = tx.create(TableCellNode {
            row_span: 2,
            col_span: 2,
            background_color: Some("red".into()),
            ..Default::default()
        })?;
        tx.append(r0, &[a.key()])?;
        tx.append(table, &[r0.key(), r1.key()])?;
        let p = tx.create(Paragraph::default())?;
        let orphan = tx.create(TableCellNode::default())?;
        tx.append(p, &[orphan.key()])?;
        tx.append(NodeKey::ROOT, &[table.key(), p.key()])?;
        Ok((table, a, orphan.key()))
    })?;
    let view = editor.state().view();
    assert!(!view.contains(orphan));
    assert_eq!(view.get::<TableCellNode>(a).expect("cell").row_span, 1);
    assert_eq!(view.get::<TableCellNode>(a).expect("cell").col_span, 1);
    assert_eq!(
        view.get::<TableCellNode>(a).expect("cell").background_color,
        None
    );
    let rows = view.children_keys(table)?;
    assert_eq!(rows.len(), 2);
    assert_eq!(view.children_size(rows[0]), 2);
    assert_eq!(view.children_size(rows[1]), 2);
    for row in rows {
        for cell in view.children(row) {
            let p = view.first_child_or_err(cell)?;
            assert!(view.is::<Paragraph>(p));
            assert_eq!(view.children_size(p), 0);
        }
    }
    Ok(())
}

#[test]
fn unwrap_filter_hoists_matching_descendants_in_original_order_and_fills_ragged_rows() -> Result<()>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let wrapper = tx.create(Paragraph::default())?;
    let inner = tx.create(Paragraph::default())?;
    let r0 = tx.create(TableRowNode::default())?;
    let r1 = tx.create(TableRowNode::default())?;
    let a = tx.create(TableCellNode::default())?;
    let b = tx.create(TableCellNode::default())?;
    let c = tx.create(TableCellNode::default())?;
    tx.append(r0, &[a.key(), b.key()])?;
    tx.append(r1, &[c.key()])?;
    tx.append(inner, &[r0.key(), r1.key()])?;
    tx.append(wrapper, &[inner.key()])?;
    tx.append(table, &[wrapper.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    assert!(crate::utils::unwrap_and_filter_descendants(
        &mut tx,
        table.key(),
        |view, key| view.is::<TableRowNode>(key)
    )?);
    assert_eq!(tx.children_keys(table)?, vec![r0.key(), r1.key()]);
    assert!(!crate::utils::unwrap_and_filter_descendants(
        &mut tx,
        table.key(),
        |view, key| view.is::<TableRowNode>(key)
    )?);
    transforms::table_transform(&mut tx, table)?;
    assert_eq!(tx.children_size(r1), 2);
    transforms::table_cell_transform(&mut tx, a)?;
    assert!(tx.is::<Paragraph>(tx.first_child_or_err(a)?));
    let invalid_row = tx.create(TableRowNode::default())?;
    tx.append(NodeKey::ROOT, &[invalid_row.key()])?;
    transforms::table_row_transform(&mut tx, invalid_row)?;
    assert!(!tx.is_attached(invalid_row));
    Ok(())
}
