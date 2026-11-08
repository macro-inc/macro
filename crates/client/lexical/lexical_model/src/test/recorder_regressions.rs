use crate::*;

// LexicalElementNode.test.ts: splice selects the surviving boundary, whereas
// insertBefore adjusts parent element offsets. Direct insertion does not.
#[test]
fn splice_and_sibling_insertion_keep_distinct_selection_rules() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        tx.append(p, &[a.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_points(
            Point::text(b, Utf16Offset(1)),
            Point::text(b, Utf16Offset(1)),
        )?;
        tx.splice(p, ChildIndex(1), 1, &[])?;
        assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(1)));
        tx.select_points(
            Point::element(p, ChildIndex(1)),
            Point::element(p, ChildIndex(1)),
        )?;
        let c = tx.create_text("c")?;
        tx.splice(p, ChildIndex(0), 0, &[c.key()])?;
        assert_eq!(tx.anchor()?, Point::element(p, ChildIndex(1)));
        let d = tx.create_text("d")?;
        tx.insert_before(c, d, true)?;
        assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(0)));
        Ok(())
    })?;
    Ok(())
}

// LexicalTextNode.test.ts: detached split and composition ownership.
#[test]
fn detached_split_moves_composition_to_last_part() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let text = tx.create_text("abc")?;
        tx.set_composition_key(Some(text.key()))?;
        let parts = tx
            .text(text)?
            .split_text(&[Utf16Offset(1), Utf16Offset(2)])?;
        assert_eq!(parts.len(), 3);
        assert_eq!(tx.text_content(parts[0]), "a");
        assert_eq!(tx.text_content(parts[1]), "b");
        assert_eq!(tx.text_content(parts[2]), "c");
        assert_eq!(tx.parent(parts[0]), None);
        assert_eq!(tx.parent(parts[1]), None);
        assert_eq!(tx.parent(parts[2]), None);
        assert_eq!(tx.composition_key(), Some(parts[2]));
        Ok(())
    })?;
    Ok(())
}

// LexicalTextNode.test.ts: prepending a merged sibling leaves the receiver's
// own selection offset unchanged; points in the removed sibling are remapped.
#[test]
fn merge_previous_preserves_receiver_offset() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create_text("1")?;
        let b = tx.create_text("2")?;
        tx.append(p, &[a.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(b)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
        tx.text(b)?.merge_with_sibling(a)?;
        assert_eq!(tx.text_content(b), "12");
        assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(1)));
        assert_eq!(tx.focus()?, Point::text(b, Utf16Offset(1)));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn transient_selection_cleared_before_commit_is_a_noop() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?.select(None, None)?;
        tx.set_selection(None)
    })?;
    assert!(commit.is_noop());
    assert!(!commit.selection_changed);
    Ok(())
}

#[test]
fn attached_segmented_split_keeps_last_part_composing() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abcd")?;
        tx.text(text)?.set_mode(TextMode::Segmented)?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_composition_key(Some(text.key()))?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(2)])?;
        assert_eq!(parts.len(), 2);
        assert_eq!(tx.composition_key(), Some(parts[1]));
        assert_eq!(tx.text_content(parts[0]), "ab");
        assert_eq!(tx.text_content(parts[1]), "cd");
        assert_eq!(tx.parent(parts[0]), Some(p.key()));
        assert_eq!(tx.parent(parts[1]), Some(p.key()));
        Ok(())
    })?;
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct RequiredContent;
impl NodeType for RequiredContent {
    const TYPE: &'static str = "required-content";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for RequiredContent {
    element_node_base!();
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
}

#[test]
fn empty_splice_does_not_remove_a_required_content_parent() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<RequiredContent>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let element = tx.create(RequiredContent)?;
    tx.append(NodeKey::ROOT, &[element.key()])?;
    tx.select_points(
        Point::element(NodeKey::ROOT, ChildIndex(0)),
        Point::element(NodeKey::ROOT, ChildIndex(0)),
    )?;
    tx.splice(element, ChildIndex(0), 0, &[])?;
    assert!(tx.is_attached(element));
    assert_eq!(tx.parent(element), Some(NodeKey::ROOT));
    assert_eq!(tx.children_size(element), 0);
    Ok(())
}
