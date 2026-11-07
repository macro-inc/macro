use crate::*;
// LexicalSelection.test.ts: removeText / leading TextNode, trailing token / remove all text.
#[test]
fn remove_all_text_across_token_s1_18_5() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((p, leading, token), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let leading = tx.create_text("leading text")?;
        let token = tx.create_text("token text")?;
        tx.text(token)?.set_mode(TextMode::Token)?;
        tx.append(p, &[leading.key(), token.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, leading, token))
    })?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(leading, Utf16Offset(0)),
            Point::text(token, Utf16Offset(10)),
        ))))?;
        tx.remove_text()?;
        assert!(!tx.is_attached(leading));
        assert!(!tx.is_attached(token));
        assert_eq!(tx.all_text_nodes(NodeKey::ROOT).count(), 0);
        assert_eq!(tx.anchor()?, Point::element(p, ChildIndex(0)));
        assert_eq!(tx.focus()?, tx.anchor()?);
        Ok(())
    })?;
    Ok(())
}

// LexicalSelection.test.ts: removeText / partial initial and partial token.
#[test]
fn partial_initial_and_partial_token() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("leading text")?;
    let b = tx.create_text("token text")?;
    tx.text(a)?.set_mode(TextMode::Normal)?;
    tx.text(b)?.set_mode(TextMode::Token)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(4)),
        Point::text(b, Utf16Offset(6)),
    ))))?;
    tx.remove_text()?;
    assert!(tx.is_attached(a));
    assert!(!tx.is_attached(b));
    assert_eq!(
        tx.all_text_nodes(NodeKey::ROOT)
            .map(|key| tx.text_content(key).into_owned())
            .collect::<Vec<_>>(),
        vec!["lead"]
    );
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(4)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    Ok(())
}

// LexicalSelection.test.ts: removeText / partial token and partial trailing.
#[test]
fn partial_token_and_partial_trailing() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("token text")?;
    let b = tx.create_text("trailing text")?;
    tx.text(a)?.set_mode(TextMode::Token)?;
    tx.text(b)?.set_mode(TextMode::Normal)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(6)),
        Point::text(b, Utf16Offset(5)),
    ))))?;
    tx.remove_text()?;
    assert!(!tx.is_attached(a));
    assert!(tx.is_attached(b));
    assert_eq!(
        tx.all_text_nodes(NodeKey::ROOT)
            .map(|key| tx.text_content(key).into_owned())
            .collect::<Vec<_>>(),
        vec!["ing text"]
    );
    assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(0)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    Ok(())
}

// LexicalSelection.test.ts: removeText / partial initial and segmented.
#[test]
fn partial_initial_and_segmented() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("leading text")?;
    let b = tx.create_text("segmented text")?;
    tx.text(a)?.set_mode(TextMode::Normal)?;
    tx.text(b)?.set_mode(TextMode::Segmented)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(4)),
        Point::text(b, Utf16Offset(10)),
    ))))?;
    tx.remove_text()?;
    assert!(tx.is_attached(a));
    assert!(!tx.is_attached(b));
    assert_eq!(
        tx.all_text_nodes(NodeKey::ROOT)
            .map(|key| tx.text_content(key).into_owned())
            .collect::<Vec<_>>(),
        vec!["lead", "text"]
    );
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(4)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    Ok(())
}

// LexicalSelection.test.ts: removeText / remove initial only.
#[test]
fn remove_initial_only() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("leading text")?;
    let b = tx.create_text("token text")?;
    tx.text(a)?.set_mode(TextMode::Normal)?;
    tx.text(b)?.set_mode(TextMode::Token)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(0)),
        Point::text(a, Utf16Offset(12)),
    ))))?;
    tx.remove_text()?;
    assert!(!tx.is_attached(a));
    assert!(tx.is_attached(b));
    assert_eq!(
        tx.all_text_nodes(NodeKey::ROOT)
            .map(|key| tx.text_content(key).into_owned())
            .collect::<Vec<_>>(),
        vec!["token text"]
    );
    assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(0)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    Ok(())
}

// LexicalSelection.test.ts: removeText / remove trailing token only.
#[test]
fn remove_trailing_token_only() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("leading text")?;
    let b = tx.create_text("token text")?;
    tx.text(a)?.set_mode(TextMode::Normal)?;
    tx.text(b)?.set_mode(TextMode::Token)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(b, Utf16Offset(0)),
        Point::text(b, Utf16Offset(10)),
    ))))?;
    tx.remove_text()?;
    assert!(tx.is_attached(a));
    assert!(!tx.is_attached(b));
    assert_eq!(
        tx.all_text_nodes(NodeKey::ROOT)
            .map(|key| tx.text_content(key).into_owned())
            .collect::<Vec<_>>(),
        vec!["leading text"]
    );
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(12)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    Ok(())
}
#[test]
fn removing_detached_range_does_not_replace_the_active_selection() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("abcdef")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(t, Utf16Offset(6)),
    ))))?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(t, Utf16Offset(1)),
        Point::text(t, Utf16Offset(3)),
    )));
    tx.remove_text_at(slot)?;
    assert_eq!(tx.text_content(t), "adef");
    assert_eq!(tx.anchor_at(slot)?, Point::text(t, Utf16Offset(1)));
    assert_eq!(tx.anchor()?, Point::text(t, Utf16Offset(6)));
    Ok(())
}
#[test]
fn deleting_middle_token_prefers_the_previous_text_end() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("left")?;
    let b = tx.create_text("token")?;
    let c = tx.create_text("right")?;
    tx.text(b)?.set_mode(TextMode::Token)?;
    tx.append(p, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(b, Utf16Offset(0)),
        Point::text(b, Utf16Offset(5)),
    ))))?;
    tx.remove_text()?;
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(4)));
    assert_eq!(tx.children_keys(p)?, vec![a.key(), c.key()]);
    Ok(())
}
#[test]
fn cross_block_deletion_keeps_first_block_and_removes_empty_wrappers() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let first = tx.create(Paragraph::default())?;
    let wrapper = tx.create(Paragraph::default())?;
    let last = tx.create(Paragraph::default())?;
    let a = tx.create_text("ab")?;
    let b = tx.create_text("cd")?;
    tx.append(first, &[a.key()])?;
    tx.append(last, &[b.key()])?;
    tx.append(wrapper, &[last.key()])?;
    tx.append(NodeKey::ROOT, &[first.key(), wrapper.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(1)),
        Point::text(b, Utf16Offset(1)),
    ))))?;
    tx.remove_text()?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![first.key()]);
    assert_eq!(tx.text_content(first), "ad");
    assert!(!tx.is_attached(wrapper));
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(1)));
    Ok(())
}
#[test]
fn fully_removed_first_text_still_preserves_its_partial_selected_block() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let first = tx.create(Paragraph::default())?;
    let last = tx.create(Paragraph::default())?;
    let a = tx.create_text("ab")?;
    let b = tx.create_text("cd")?;
    tx.append(first, &[a.key()])?;
    tx.append(last, &[b.key()])?;
    tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(0)),
        Point::text(b, Utf16Offset(1)),
    ))))?;
    tx.remove_text()?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![first.key()]);
    assert_eq!(tx.text_content(first), "d");
    assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(0)));
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct NonEmptyBlock {}
impl NodeType for NonEmptyBlock {
    const TYPE: &'static str = "non-empty-block";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for NonEmptyBlock {
    element_node_base!();
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
}

// Removing all children of a nonempty element cascades its removal. The
// surviving preceding block becomes the caret origin and merge destination.
#[test]
fn deletion_merges_into_surviving_preceding_block() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NonEmptyBlock>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let previous = tx.create(Paragraph::default())?;
    let left = tx.create_text("left")?;
    let removed = tx.create(NonEmptyBlock::default())?;
    let token = tx.create_text("x")?;
    tx.text(token)?.set_mode(TextMode::Token)?;
    let next = tx.create(Paragraph::default())?;
    let right = tx.create_text("right")?;
    tx.append(previous, &[left.key()])?;
    tx.append(removed, &[token.key()])?;
    tx.append(next, &[right.key()])?;
    tx.append(NodeKey::ROOT, &[previous.key(), removed.key(), next.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(token, Utf16Offset(0)),
        Point::text(right, Utf16Offset(1)),
    ))))?;
    tx.remove_text()?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![previous.key()]);
    assert_eq!(tx.text_content(previous), "leftight");
    assert_eq!(tx.anchor()?, Point::text(left, Utf16Offset(4)));
    Ok(())
}

#[test]
fn node_selection_deletion_moves_only_active_selection() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let a = tx.create_text("left")?;
    let b = tx.create_text("middle")?;
    let c = tx.create_text("right")?;
    tx.append(p, &[a.key(), b.key(), c.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(b);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert!(tx.selection().and_then(Selection::as_node).is_some());
    tx.delete_nodes()?;
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(4)));
    let mut nodes = NodeSelection::new();
    nodes.add(c);
    let slot = tx.detach_selection(Selection::Node(nodes));
    tx.delete_nodes_at(slot)?;
    assert!(!tx.is_attached(c));
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(4)));
    assert!(tx.selection_at(slot)?.expect("detached").is_node());
    Ok(())
}

#[test]
fn cross_block_deletion_merges_below_the_common_ancestor() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let wrapper = tx.create(Paragraph::default())?;
    let nested = tx.create(Paragraph::default())?;
    let last = tx.create(Paragraph::default())?;
    let lead = tx.create_text("lead")?;
    let a = tx.create_text("first")?;
    let b = tx.create_text("last")?;
    tx.append(nested, &[a.key()])?;
    tx.append(wrapper, &[lead.key(), nested.key()])?;
    tx.append(last, &[b.key()])?;
    tx.append(NodeKey::ROOT, &[wrapper.key(), last.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(2)),
        Point::text(b, Utf16Offset(2)),
    ))))?;
    tx.remove_text()?;
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![wrapper.key()]);
    assert_eq!(
        tx.children_keys(wrapper)?,
        vec![lead.key(), nested.key(), b.key()]
    );
    assert_eq!(tx.text_content(a), "fi");
    assert_eq!(tx.text_content(b), "st");
    assert_eq!(tx.anchor()?, Point::text(a, Utf16Offset(2)));
    Ok(())
}

#[test]
fn deletion_merges_the_separator_before_an_unentered_block() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let q = tx.create(Paragraph::default())?;
    let a = tx.create_text("first")?;
    let b = tx.create_text("second")?;
    tx.append(p, &[a.key()])?;
    tx.append(q, &[b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(2)),
        Point::element(q, ChildIndex(0)),
    ))))?;
    tx.remove_text()?;
    // Pinned upstream removes the paragraph separator and preserves the end block text.
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key()]);
    assert_eq!(tx.text_content(p), "fisecond");
    Ok(())
}

#[test]
fn collapsed_remove_reports_selection_update_without_dirty_nodes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)
    })?;
    let (_, commit) = editor.update(|tx| tx.remove_text())?;
    assert!(commit.selection_changed);
    assert!(commit.changes.is_empty());
    assert!(commit.changes.mutations.is_empty());
    Ok(())
}

#[test]
fn removing_between_empty_paragraph_starts_merges_the_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let last = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(first, ChildIndex(0)),
            Point::element(last, ChildIndex(0)),
        ))))?;
        tx.remove_text()?;
        assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![first.key()]);
        assert_eq!(tx.anchor()?, Point::element(first, ChildIndex(0)));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn root_boundary_replacement_preserves_the_first_paragraph_identity() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let last = tx.create(Paragraph::default())?;
        let text = tx.create_text("old")?;
        tx.append(last, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(0)),
            Point::element(last, ChildIndex(1)),
        ))))?;
        tx.insert_text("new")?;
        assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![first.key()]);
        assert_eq!(tx.text_content(first), "new");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn collapsed_root_removal_keeps_its_element_coordinate() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))
    })?;
    let (_, commit) = editor.update(|tx| tx.remove_text())?;
    assert_eq!(
        commit
            .next
            .selection()
            .and_then(Selection::as_range)
            .unwrap()
            .anchor,
        Point::element(NodeKey::ROOT, ChildIndex(1))
    );
    Ok(())
}

#[test]
fn equivalent_container_boundaries_do_not_remove_the_first_line_break() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let line = tx.create(LineBreak::default())?;
        tx.append(p, &[line.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(0)),
        ))))?;
        tx.remove_text()?;
        assert_eq!(tx.children_keys(p)?, vec![line.key()]);
        Ok(())
    })?;
    Ok(())
}

#[test]
fn interior_surrogate_selection_can_be_ordered_but_not_edited() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("😀")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(1)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        Ok((p.key(), text.key()))
    })?;
    let state = editor.state();
    assert!(
        Point::text(text, Utf16Offset(1))
            .is_before(state.view(), &Point::element(NodeKey::ROOT, ChildIndex(1)))?
    );
    assert!(editor.update(|tx| tx.insert_text("x")).is_err());
    assert_eq!(editor.state().text_content(p), "😀");
    Ok(())
}

#[test]
fn range_removal_marks_leaves_inside_completely_selected_blocks() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (middle_text, _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let middle = tx.create(Paragraph::default())?;
        let last = tx.create(Paragraph::default())?;
        let first_text = tx.create_text("first")?;
        let middle_text = tx.create_text("middle")?;
        let last_text = tx.create_text("last")?;
        tx.append(first, &[first_text.key()])?;
        tx.append(middle, &[middle_text.key()])?;
        tx.append(last, &[last_text.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), middle.key(), last.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(first_text, Utf16Offset(1)),
            Point::text(last_text, Utf16Offset(1)),
        ))))?;
        Ok(middle_text.key())
    })?;
    let (_, commit) = editor.update(|tx| tx.remove_text())?;
    assert!(commit.changes.dirty_leaves.contains(&middle_text));
    assert_eq!(
        commit.changes.mutations.get(&middle_text),
        Some(&Mutation::Destroyed)
    );
    Ok(())
}

#[test]
fn root_child_range_removes_the_selected_paragraph_identity() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("old")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(1)),
            Point::element(NodeKey::ROOT, ChildIndex(0)),
        ))))?;
        Ok(p.key())
    })?;
    let (_, commit) = editor.update(|tx| tx.remove_text())?;
    assert!(commit.next.children_keys(NodeKey::ROOT)?.is_empty());
    assert_eq!(commit.changes.mutations.get(&p), Some(&Mutation::Destroyed));
    Ok(())
}

#[test]
fn removal_collapses_at_the_preceding_text_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let tab = tx.create(Tab::default())?;
        let text = tx.create_text("abc")?;
        tx.append(p, &[tab.key(), text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(2)),
            Point::element(p, ChildIndex(1)),
        ))))?;
        tx.remove_text()?;
        assert_eq!(tx.anchor()?, Point::text(tab, Utf16Offset(1)));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn removing_a_root_child_range_collapses_inside_the_following_paragraph() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let next = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[first.key(), next.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(NodeKey::ROOT, ChildIndex(0)),
            Point::element(NodeKey::ROOT, ChildIndex(1)),
        ))))?;
        tx.remove_text()?;
        assert_eq!(tx.anchor()?, Point::element(next, ChildIndex(0)));
        Ok(())
    })?;
    Ok(())
}
