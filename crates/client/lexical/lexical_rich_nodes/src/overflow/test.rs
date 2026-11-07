use super::*;
#[test]
fn intrinsic_transform_removes_empty_overflow() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<OverflowNode>()
        .build()
        .unwrap();
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let overflow = tx.create(OverflowNode {})?;
        tx.append(p, &[overflow.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(overflow.key())
    })?;
    assert!(!editor.state().contains(key));
    Ok(())
}
#[test]
fn nonempty_overflow_delegates_new_block_to_parent() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<OverflowNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let o = create_overflow_node(&mut tx)?;
    let t = tx.create_text("overflow")?;
    tx.append(o, &[t.key()])?;
    tx.append(p, &[o.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert!(is_overflow_node(&tx, o.key()));
    assert!(!tx.is_inline(o));
    let next = tx
        .insert_new_after(o, SelectionSlot::Active, false)?
        .unwrap();
    assert!(tx.is::<Paragraph>(next));
    assert_eq!(tx.next_sibling(p), Some(next));
    assert_eq!(tx.text_content(o), "overflow");
    Ok(())
}
