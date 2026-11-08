use super::*;
#[test]
fn property_handles_toggle_formats_and_expose_current_fields() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("words")?;
    tx.append(p, &[t.key()])?;
    {
        let mut element = tx.element(p)?;
        assert_eq!(element.key(), p.key());
        element
            .set_format(ElementFormat::Center)?
            .set_style("color: red")?
            .set_direction(Some(TextDirection::Rtl))?
            .set_text_format(TextFormat::ITALIC)?
            .set_text_style("font-size: 2em")?;
        assert_eq!(element.data().format, ElementFormat::Center);
        assert_eq!(element.data().style.as_ref(), "color: red");
        assert_eq!(element.data().direction, Some(TextDirection::Rtl));
        assert_eq!(element.data().text_format, TextFormat::ITALIC);
        assert_eq!(element.data().text_style.as_ref(), "font-size: 2em");
    }
    {
        let mut text = tx.text(t)?;
        assert_eq!(text.key(), t.key());
        text.set_format_type(TextFormatType::Bold)?
            .toggle_format(TextFormatType::Italic)?
            .toggle_directionless()?
            .toggle_unmergeable()?;
        assert_eq!(text.data().format, TextFormat::BOLD | TextFormat::ITALIC);
        assert_eq!(
            text.data().detail,
            TextDetail::DIRECTIONLESS | TextDetail::UNMERGEABLE
        );
    }
    assert!(matches!(tx.element(t), Err(Error::NotAnElement(_))));
    assert!(matches!(tx.text(p), Err(Error::NotAText(_))));
    Ok(())
}
#[test]
fn base_tree_operations_and_paragraph_creation_keep_links_and_typing_style() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    let c = tx.create_text("c")?;
    tx.default_append(p.key(), &[a.key()])?;
    tx.default_insert_after(a.key(), b.key(), false)?;
    tx.default_insert_before(b.key(), c.key(), false)?;
    assert_eq!(
        tx.children(p).collect::<Vec<_>>(),
        vec![a.key(), c.key(), b.key()]
    );
    tx.default_splice(p.key(), ChildIndex(1), 1, &[])?;
    assert_eq!(tx.children(p).collect::<Vec<_>>(), vec![a.key(), b.key()]);
    tx.default_replace(b.key(), c.key(), false)?;
    assert_eq!(tx.children(p).collect::<Vec<_>>(), vec![a.key(), c.key()]);
    tx.default_remove(c.key(), true, true)?;
    assert_eq!(tx.children(p).collect::<Vec<_>>(), vec![a.key()]);
    tx.insert_range_after(a, c, Some(c.key()))?;
    assert_eq!(tx.next_sibling(a), Some(c.key()));
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.element(p)?
        .set_format(ElementFormat::Right)?
        .set_direction(Some(TextDirection::Rtl))?
        .set_style("color: blue")?;
    tx.select_start(a)?;
    assert_eq!(
        tx.try_range_at(SelectionSlot::Active)
            .expect("range")
            .anchor,
        Point::text(a, Utf16Offset(0))
    );
    tx.select_end(a)?;
    assert_eq!(
        tx.try_range_at(SelectionSlot::Active)
            .expect("range")
            .anchor,
        Point::text(a, Utf16Offset(1))
    );
    let next = tx
        .insert_new_after(p, SelectionSlot::Active, false)?
        .expect("paragraph");
    assert_eq!(tx.type_name(next)?, "paragraph");
    assert_eq!(
        tx.view().element(next).expect("element").format,
        ElementFormat::Right
    );
    assert_eq!(
        tx.view().element(next).expect("element").direction,
        Some(TextDirection::Rtl)
    );
    assert_eq!(
        tx.view().element(next).expect("element").style.as_ref(),
        "color: blue"
    );
    tx.select_next(p, None, None)?;
    assert_eq!(
        tx.try_range_at(SelectionSlot::Active)
            .expect("range")
            .anchor,
        Point::element(next, ChildIndex(0))
    );
    tx.select_previous(next, None, None)?;
    assert_eq!(
        tx.try_range_at(SelectionSlot::Active)
            .expect("range")
            .anchor,
        Point::element(p, ChildIndex(2))
    );
    let parent = tx.create_parent_element(a)?;
    assert!(tx.is::<Paragraph>(parent));
    assert!(tx.collapse_at_start(NodeKey::ROOT, SelectionSlot::Active)?);
    assert!(!tx.collapse_at_start(p, SelectionSlot::Active)?);
    tx.clear(p)?;
    assert!(tx.is_empty(p));
    Ok(())
}
#[test]
fn root_mutations_fail_without_corrupting_tree() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("text")?;
    assert!(matches!(
        tx.remove(NodeKey::ROOT, false),
        Err(Error::RemoveRoot)
    ));
    assert!(matches!(
        tx.replace(NodeKey::ROOT, p, false),
        Err(Error::ReplaceRoot)
    ));
    assert!(matches!(
        tx.insert_before(NodeKey::ROOT, p, false),
        Err(Error::InsertBeforeRoot)
    ));
    assert!(matches!(
        tx.insert_after(NodeKey::ROOT, p, false),
        Err(Error::InsertAfterRoot)
    ));
    assert!(matches!(
        tx.append(NodeKey::ROOT, &[t.key()]),
        Err(Error::RootSpliceNonBlock)
    ));
    assert!(tx.is_empty(NodeKey::ROOT));
    assert!(tx.parent(t).is_none());
    assert_eq!(Error::RemoveRoot.kind(), "RemoveRoot");
    Ok(())
}
#[test]
fn split_text_moves_selection_s1_18_2() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("Hello World")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(2)), Some(Utf16Offset(7)))?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(4)])?;
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], text.key());
        let range = tx.try_range_at(SelectionSlot::Active).expect("range");
        assert_eq!(range.anchor, Point::text(parts[0], Utf16Offset(2)));
        assert_eq!(range.focus, Point::text(parts[1], Utf16Offset(3)));
        assert_eq!(tx.text_content(parts[0]), "Hell");
        assert_eq!(tx.text_content(parts[1]), "o World");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn remove_complete_text_span_across_token_collapses_into_paragraph_s1_18_5() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((leading, token, p), _) = editor.update(|tx| {
        let leading = tx.create_text("leading text")?;
        let token = tx.create_text("token text")?;
        tx.text(token)?.set_mode(TextMode::Token)?;
        let p = tx.create(Paragraph::default())?;
        tx.append(p, &[leading.key(), token.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((leading, token, p))
    })?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection {
            cached_direction: None,
            dirty: false,
            anchor: Point::text(leading, Utf16Offset(0)),
            focus: Point::text(token, tx.text_content_size(token)),
            format: TextFormat::empty(),
            style: "".into(),
        })))?;
        // Complete sibling-span removal uses the structural primitive; the range-editing
        // remove_text convenience API belongs to WP-10.
        tx.splice(p, ChildIndex(0), 2, &[])?;
        assert!(!tx.is_attached(leading));
        assert!(!tx.is_attached(token));
        assert_eq!(tx.all_text_nodes(NodeKey::ROOT).count(), 0);
        let Some(Selection::Range(range)) = tx.try_selection_at(SelectionSlot::Active) else {
            panic!("range");
        };
        assert_eq!(range.anchor, Point::element(p, ChildIndex(0)));
        assert_eq!(range.focus, range.anchor);
        Ok(())
    })?;
    Ok(())
}

/// upstream: ElementNode.clear calls getWritable even when it has no children.
#[test]
fn clearing_an_empty_element_marks_it_intentionally_dirty() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (_, commit) = editor.update(|tx| {
        tx.clear(NodeKey::ROOT)?;
        Ok(())
    })?;
    assert_eq!(
        commit.changes.dirty_elements.get(&NodeKey::ROOT),
        Some(&DirtyIntent::Intentional)
    );
    assert_eq!(
        commit.changes.mutations.get(&NodeKey::ROOT),
        Some(&Mutation::Updated)
    );
    Ok(())
}

/// upstream: #6031 cross-parent move decrements element offsets in the old parent.
#[test]
fn moving_a_child_updates_selection_in_its_source_parent() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let source = tx.create(Paragraph::default())?;
    let target = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    let c = tx.create_text("c")?;
    tx.append(source, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[source.key(), target.key()])?;
    tx.element(source)?
        .select(Some(ChildIndex(3)), Some(ChildIndex(3)))?;
    let line = tx.create(LineBreak {})?;
    tx.append(target, &[line.key()])?;
    tx.insert_before(line, a, true)?;
    assert_eq!(tx.anchor()?, Point::text(c, Utf16Offset(1)));
    assert_eq!(tx.focus()?, Point::text(c, Utf16Offset(1)));
    Ok(())
}

/// upstream: #6031 inserting an existing sibling in the same position is a no-op.
#[test]
fn no_op_sibling_move_keeps_an_end_of_parent_caret_in_range() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.element(p)?
        .select(Some(ChildIndex(2)), Some(ChildIndex(2)))?;
    tx.insert_before(b, a, true)?;
    assert_eq!(tx.children_keys(p)?, vec![a.key(), b.key()]);
    assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(1)));
    Ok(())
}

/// upstream: replace without includeChildren selects the last descendant,
/// preserving the original offset (the helper name does not imply end offset).
#[test]
fn replacing_an_element_preserves_offset_in_the_last_text_descendant() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    assert!(!tx.has_dirty_nodes());
    let old = tx.create(Paragraph::default())?;
    let first = tx.create(LineBreak::default())?;
    let last = tx.create(LineBreak::default())?;
    tx.append(old, &[first.key(), last.key()])?;
    tx.append(NodeKey::ROOT, &[old.key()])?;
    tx.element(old)?
        .select(Some(ChildIndex(1)), Some(ChildIndex(1)))?;
    let new = tx.create(Paragraph::default())?;
    let prefix = tx.create_text("prefix")?;
    tx.append(new, &[prefix.key()])?;
    tx.replace(old, new, false)?;
    assert_eq!(tx.anchor()?, Point::text(prefix, Utf16Offset(1)));
    assert_eq!(tx.focus()?, Point::text(prefix, Utf16Offset(1)));
    assert!(tx.has_dirty_nodes());
    Ok(())
}

#[test]
fn splice_text_only_moves_an_existing_range_selection() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("abc")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .splice_text(Utf16Offset(1)..Utf16Offset(2), "x", true)?;
    assert!(tx.selection().is_none());
    let mut selection = NodeSelection::new();
    selection.add(text.key());
    tx.set_selection(Some(Selection::Node(selection)))?;
    tx.text(text)?
        .splice_text(Utf16Offset(1)..Utf16Offset(2), "y", true)?;
    assert!(matches!(tx.selection(), Some(Selection::Node(_))));
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    tx.text(text)?
        .splice_text(Utf16Offset(1)..Utf16Offset(2), "z", true)?;
    assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(2)));
    assert_eq!(tx.focus()?, Point::text(text, Utf16Offset(2)));
    assert_eq!(tx.text_content(text), "azc");
    Ok(())
}
