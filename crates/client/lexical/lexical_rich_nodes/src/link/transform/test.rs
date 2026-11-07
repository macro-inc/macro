use super::*;
/// upstream: LexicalLinkNode.test.ts, adjacent links merge while preserving element boundary selection.
#[test]
fn matching_adjacent_links_merge_without_moving_boundary_past_new_text() -> Result<()> {
    let mut editor = link_extension(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let a = create_link_node(&mut tx, "/same", LinkAttributes::default())?;
    let b = create_link_node(&mut tx, "/same", LinkAttributes::default())?;
    let x = tx.create_text("x")?;
    let y = tx.create_text("y")?;
    tx.append(a, &[x.key()])?;
    tx.append(b, &[y.key()])?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.element(p)?
        .select(Some(ChildIndex(1)), Some(ChildIndex(1)))?;
    assert!(should_merge_adjacent_link(&tx, a, b));
    tx.flush()?;
    assert_eq!(tx.children_keys(p)?, vec![a.key()]);
    assert_eq!(tx.text_content(a), "xy");
    let range = tx.range_at(SelectionSlot::Active)?;
    assert_eq!(range.anchor.offset(), 1);
    assert!(range.is_collapsed());
    Ok(())
}
/// upstream: linkNodeTransform lifts illegal block children and retains link labels.
#[test]
fn block_child_lifts_out_of_link_into_root() -> Result<()> {
    let mut editor = link_extension(crate::register_rich_text_nodes(Editor::builder(
        EditorMode::Headless,
    )))
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_link_node(&mut tx, "/url", LinkAttributes::default())?;
    let heading = crate::heading::create_heading_node(&mut tx, crate::heading::HeadingTagType::H2)
        .expect("heading");
    let text = tx.create_text("heading")?;
    tx.append(heading, &[text.key()])?;
    tx.append(link, &[heading.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(4)))?;
    tx.flush()?;
    assert_eq!(tx.parent(heading), Some(NodeKey::ROOT));
    let inner = tx.first_child_or_err(heading)?;
    assert!(tx.is::<LinkNode>(inner));
    assert_eq!(tx.parent(text), Some(inner));
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.anchor,
        Point::text(text.key(), Utf16Offset(2))
    );
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::text(text.key(), Utf16Offset(4))
    );
    Ok(())
}
