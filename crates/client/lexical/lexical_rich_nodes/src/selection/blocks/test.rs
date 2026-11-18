use super::*;
#[test]
fn replacing_blocks_skips_focus_at_next_nonempty_block_start() -> Result<(), Error> {
    let mut editor = crate::register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let a = tx.create(Paragraph {})?;
        let b = tx.create(Paragraph {})?;
        let text = tx.create_text("one")?;
        let tail = tx.create_text("two")?;
        tx.append(a, &[text.key()])?;
        tx.append(b, &[tail.key()])?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
        tx.set_indent(a, 2)?;
        tx.element(a)?.set_format(ElementFormat::Center)?;
        let selection = Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(0)),
            Point::text(tail, Utf16Offset(0)),
        ));
        set_blocks_type_default(tx, Some(&selection), |tx| {
            Ok(tx.create(crate::quote::QuoteNode {})?.key())
        })?;
        let children = tx.children_keys(NodeKey::ROOT)?;
        assert!(tx.is::<crate::quote::QuoteNode>(children[0]));
        assert_eq!(tx.element_data(children[0])?.indent, 2);
        assert_eq!(tx.element_data(children[0])?.format, ElementFormat::Center);
        assert_eq!(children[1], b.key());
        tx.select_end(text)?;
        crate::selection::trim_text_content_from_anchor(tx, SelectionSlot::Active, 1)?;
        assert_eq!(tx.text_content(children[0]), "on");
        Ok(())
    })?;
    Ok(())
}
#[test]
fn legacy_wrap_nodes_moves_whole_parent_runs() -> Result<(), Error> {
    let mut editor = crate::register_rich_text_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("abc")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        let selection = tx.selection().unwrap().clone();
        wrap_nodes(
            tx,
            &selection,
            |tx| Ok(tx.create(crate::quote::QuoteNode {})?.key()),
            None,
        )?;
        let quote = tx.children_keys(NodeKey::ROOT)?[0];
        assert!(tx.is::<crate::quote::QuoteNode>(quote));
        assert_eq!(tx.text_content(quote), "abc");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn replacing_nested_list_item_copies_computed_indent() -> Result<(), Error> {
    use crate::list::*;
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let wrapper = tx.create(ListItemNode::default())?;
        let nested = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("nested")?;
        tx.append(item, &[text.key()])?;
        tx.append(nested, &[item.key()])?;
        tx.append(wrapper, &[nested.key()])?;
        tx.append(list, &[wrapper.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        assert_eq!(tx.indent(item), 1);
        assert_eq!(tx.element_data(item)?.indent, 0);
        tx.select_end(text)?;
        let selection = tx.selection().cloned();
        set_blocks_type_default(tx, selection.as_ref(), |tx| {
            Ok(tx.create(Paragraph::default())?.key())
        })?;
        let paragraph = tx.children_keys(NodeKey::ROOT)?[0];
        assert!(tx.is::<Paragraph>(paragraph));
        assert_eq!(tx.indent(paragraph), 1);
        assert_eq!(tx.text_content(paragraph), "nested");
        Ok(())
    })?;
    Ok(())
}
