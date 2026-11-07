use super::*;

// S3 §1b.0: retain repeated per-slot writes for cells writable at map time.
#[test]
fn row_insert_frozen_span_is_3() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let ((a, b), _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let r0 = tx.create(TableRowNode::default())?;
        let r1 = tx.create(TableRowNode::default())?;
        let a = tx.create(TableCellNode {
            row_span: 2,
            col_span: 2,
            ..Default::default()
        })?;
        let b = tx.create(TableCellNode::default())?;
        let c = tx.create(TableCellNode::default())?;
        tx.append(r0, &[a.key(), b.key()])?;
        tx.append(r1, &[c.key()])?;
        tx.append(table, &[r0.key(), r1.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok((a, b))
    })?;
    let previous = editor.state().clone();
    editor.update(|tx| {
        insert_table_row_at_node(tx, b, true)?;
        Ok(())
    })?;
    assert_eq!(
        previous
            .view()
            .get::<TableCellNode>(a)
            .expect("old cell")
            .row_span,
        2
    );
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableCellNode>(a)
            .expect("cell")
            .row_span,
        3
    );
    Ok(())
}

#[test]
fn row_insert_live_span_is_4() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let (a, _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let r0 = tx.create(TableRowNode::default())?;
        let r1 = tx.create(TableRowNode::default())?;
        let a = tx.create(TableCellNode {
            row_span: 2,
            col_span: 2,
            ..Default::default()
        })?;
        let b = tx.create(TableCellNode::default())?;
        let c = tx.create(TableCellNode::default())?;
        tx.append(r0, &[a.key(), b.key()])?;
        tx.append(r1, &[c.key()])?;
        tx.append(table, &[r0.key(), r1.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        insert_table_row_at_node(tx, b, true)?;
        Ok(a)
    })?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableCellNode>(a)
            .expect("cell")
            .row_span,
        4
    );
    Ok(())
}

#[test]
fn column_insert_frozen_span_is_3() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let ((a, d), _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let r0 = tx.create(TableRowNode::default())?;
        let r1 = tx.create(TableRowNode::default())?;
        let r2 = tx.create(TableRowNode::default())?;
        let a = tx.create(TableCellNode {
            row_span: 2,
            col_span: 2,
            ..Default::default()
        })?;
        let b = tx.create(TableCellNode::default())?;
        let c = tx.create(TableCellNode::default())?;
        let d = tx.create(TableCellNode::default())?;
        let e = tx.create(TableCellNode::default())?;
        let f = tx.create(TableCellNode::default())?;
        tx.append(r0, &[a.key(), b.key()])?;
        tx.append(r1, &[c.key()])?;
        tx.append(r2, &[d.key(), e.key(), f.key()])?;
        tx.append(table, &[r0.key(), r1.key(), r2.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok((a, d))
    })?;
    let previous = editor.state().clone();
    editor.update(|tx| {
        insert_table_column_at_node(tx, d, true, false)?;
        Ok(())
    })?;
    assert_eq!(
        previous
            .view()
            .get::<TableCellNode>(a)
            .expect("old cell")
            .col_span,
        2
    );
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableCellNode>(a)
            .expect("cell")
            .col_span,
        3
    );
    Ok(())
}

#[test]
fn column_insert_live_span_is_4() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let (a, _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let r0 = tx.create(TableRowNode::default())?;
        let r1 = tx.create(TableRowNode::default())?;
        let r2 = tx.create(TableRowNode::default())?;
        let a = tx.create(TableCellNode {
            row_span: 2,
            col_span: 2,
            ..Default::default()
        })?;
        let b = tx.create(TableCellNode::default())?;
        let c = tx.create(TableCellNode::default())?;
        let d = tx.create(TableCellNode::default())?;
        let e = tx.create(TableCellNode::default())?;
        let f = tx.create(TableCellNode::default())?;
        tx.append(r0, &[a.key(), b.key()])?;
        tx.append(r1, &[c.key()])?;
        tx.append(r2, &[d.key(), e.key(), f.key()])?;
        tx.append(table, &[r0.key(), r1.key(), r2.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        insert_table_column_at_node(tx, d, true, false)?;
        Ok(a)
    })?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableCellNode>(a)
            .expect("cell")
            .col_span,
        4
    );
    Ok(())
}
