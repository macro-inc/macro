use super::*;

// Port of LexicalCaret.test.ts: SiblingCaret > direction next. Explicit nodes
// preserve the origin/adjacency distinction and splice overlap behavior.
#[test]
fn upstream_sibling_caret_next() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?.key();
            let minus_two = tx.create_text("-2")?.key();
            let minus_one = tx.create_text("-1")?.key();
            let zero = tx.create_text("0")?.key();
            let one = tx.create_text("1")?.key();
            let two = tx.create_text("2")?.key();
            tx.append(NodeKey::ROOT, &[paragraph])?;
            tx.append(paragraph, &[minus_two, minus_one, zero, one, two])?;
            let caret = PointCaret::from(SiblingCaret::new(zero, CaretDirection::Next));
            assert_eq!(caret.node_at_caret(tx.view()), Some(one));
            assert_eq!(caret.parent_at_caret(tx.view()), Some(paragraph));
            assert_eq!(caret.caret_type(), CaretType::Sibling);
            assert_eq!(caret.child_caret(tx.view()), None);
            assert_eq!(caret.flipped(tx.view()).flipped(tx.view()), caret);
            assert_eq!(
                caret.flipped(tx.view()).node_at_caret(tx.view()),
                Some(zero)
            );
            assert_eq!(
                caret.parent_caret(tx.view(), RootMode::Root),
                Some(SiblingCaret::new(paragraph, CaretDirection::Next))
            );
            let nodes = NodeCaret::Sibling(caret.sibling_caret());
            assert_eq!(nodes.adjacent_nodes(tx.view()), vec![one, two]);
            assert_eq!(
                nodes
                    .siblings(tx.view())
                    .iter(tx.view())
                    .map(|c| c.unwrap().origin)
                    .collect::<Vec<_>>(),
                vec![one, two]
            );
            tx.caret_remove(caret)?;
            assert_eq!(caret.node_at_caret(tx.view()), Some(two));
            tx.caret_insert(caret, one)?;
            tx.caret_replace_or_insert(caret, one, false)?;
            assert_eq!(
                tx.children_keys(paragraph)?,
                vec![minus_two, minus_one, zero, one, two]
            );
            let a = tx.create_text("a")?.key();
            let b = tx.create_text("b")?.key();
            tx.caret_splice(caret, 2, &[a, b, one], CaretDirection::Next)?;
            assert_eq!(
                tx.children_keys(paragraph)?,
                vec![minus_two, minus_one, zero, a, b, one]
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn upstream_child_caret_previous_and_eager_siblings_survive_removal() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?.key();
            let first = tx.create_text("first")?.key();
            let second = tx.create_text("second")?.key();
            let third = tx.create_text("third")?.key();
            tx.append(NodeKey::ROOT, &[paragraph])?;
            tx.append(paragraph, &[first, second, third])?;
            let caret = ChildCaret::new(tx.view(), paragraph, CaretDirection::Previous).unwrap();
            assert!(ChildCaret::new(tx.view(), first, CaretDirection::Next).is_none());
            let point = PointCaret::from(caret);
            assert_eq!(point.node_at_caret(tx.view()), Some(third));
            assert_eq!(
                point.flipped(tx.view()),
                SiblingCaret::new(third, CaretDirection::Next).into()
            );
            assert_eq!(point.flipped(tx.view()).flipped(tx.view()), point);
            let mut cursor = NodeCaret::Child(caret).siblings(tx.view());
            assert_eq!(cursor.next(tx.view())?.unwrap().origin, third);
            tx.remove(third, false)?;
            assert_eq!(cursor.next(tx.view())?.unwrap().origin, second);
            tx.remove(second, false)?;
            assert_eq!(cursor.next(tx.view())?.unwrap().origin, first);
            tx.remove(first, false)?;
            assert_eq!(cursor.next(tx.view())?, None);
            Ok(())
        })
        .unwrap();
}

#[test]
fn text_offsets_slices_selection_and_direction() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?.key();
            let text = tx.create_text("a😀bc")?.key();
            tx.append(NodeKey::ROOT, &[paragraph])?;
            tx.append(paragraph, &[text])?;
            let anchor = TextPointCaret::new(
                tx.view(),
                text,
                CaretDirection::Next,
                TextOffsetSpec::At(Utf16Offset(1)),
            )?;
            let focus =
                TextPointCaret::new(tx.view(), text, CaretDirection::Next, TextOffsetSpec::End)?;
            assert_eq!(focus.offset, Utf16Offset(5));
            assert!(anchor.is_extendable(tx.view())?);
            assert!(!focus.is_extendable(tx.view())?);
            assert!(
                TextPointCaret::new(
                    tx.view(),
                    text,
                    CaretDirection::Next,
                    TextOffsetSpec::At(Utf16Offset(2))
                )
                .is_err()
            );
            assert!(
                text_node_offset(
                    tx.view(),
                    text,
                    TextOffsetSpec::At(Utf16Offset(99)),
                    OffsetMode::Error
                )
                .is_err()
            );
            assert_eq!(
                text_node_offset(
                    tx.view(),
                    text,
                    TextOffsetSpec::At(Utf16Offset(99)),
                    OffsetMode::Clamp
                )?,
                Utf16Offset(5)
            );
            assert!(CaretRange::new(anchor.into(), focus.flipped().into()).is_err());
            let range = CaretRange::new(anchor.into(), focus.into())?;
            let (slice, other) = range.text_slices(tx.view())?;
            let slice = slice.unwrap();
            assert_eq!(slice.slice_indices(), Utf16Offset(1)..Utf16Offset(5));
            assert_eq!(slice.text_content(tx.view())?, "😀bc");
            assert_eq!(slice.text_content_size(), 4);
            assert_eq!(other, None);
            assert_eq!(
                compare_point_caret_next(tx.view(), anchor.into(), focus.into())?,
                Ordering::Less
            );
            assert_eq!(
                range
                    .in_direction(tx.view(), CaretDirection::Previous)
                    .in_direction(tx.view(), CaretDirection::Next),
                range
            );
            tx.set_selection_from_caret_range(range)?;
            assert_eq!(
                caret_range_from_selection(tx.view(), tx.range_selection()?)?,
                range
            );
            tx.set_point_from_caret(PointRole::Focus, anchor.into())?;
            assert!(tx.range_selection()?.is_collapsed());
            tx.update_range_selection_from_caret_range(range)?;
            assert_eq!(
                point_from_caret(tx.view(), &anchor.into())?,
                Point::text(text, Utf16Offset(1))
            );
            assert_eq!(
                caret_from_point(
                    tx.view(),
                    &Point::text(text, Utf16Offset(1)),
                    CaretDirection::Next
                )?,
                anchor.into()
            );
            let returned = tx.remove_text_slice(slice)?;
            assert_eq!(returned.offset, Utf16Offset(1));
            assert_eq!(tx.text_content(text), "a");
            Ok(())
        })
        .unwrap();
}

#[test]
fn range_cursor_is_eager_and_walks_both_element_edges() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?.key();
            let first = tx.create_text("first")?.key();
            let second = tx.create_text("second")?.key();
            tx.append(NodeKey::ROOT, &[paragraph])?;
            tx.append(paragraph, &[first, second])?;
            let start = PointCaret::from(
                ChildCaret::new(tx.view(), NodeKey::ROOT, CaretDirection::Next).unwrap(),
            );
            let range = CaretRange::extend(tx.view(), start);
            let carets = range
                .node_carets(tx.view(), RootMode::Root)?
                .iter(tx.view())
                .collect::<Result<Vec<_>, _>>()?;
            assert_eq!(
                carets,
                vec![
                    ChildCaret {
                        origin: paragraph,
                        direction: CaretDirection::Next
                    }
                    .into(),
                    SiblingCaret::new(first, CaretDirection::Next).into(),
                    SiblingCaret::new(second, CaretDirection::Next).into(),
                    SiblingCaret::new(paragraph, CaretDirection::Next).into()
                ]
            );
            let mut cursor = range.node_carets(tx.view(), RootMode::Root)?;
            assert_eq!(cursor.next(tx.view())?, carets.first().copied());
            assert_eq!(cursor.next(tx.view())?.unwrap().origin(), first);
            tx.remove(first, false)?;
            assert_eq!(cursor.next(tx.view())?.unwrap().origin(), second);
            tx.remove(second, false)?;
            assert_eq!(cursor.next(tx.view())?.unwrap().origin(), paragraph);
            assert_eq!(cursor.next(tx.view())?, None);
            Ok(())
        })
        .unwrap();
}

// LexicalCaret.test.ts: $splitAtPointCaretNext > Splits a TextNode in the middle.
#[test]
fn upstream_split_text_and_paragraph() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?.key();
            let text = tx.create_text("test")?.key();
            tx.append(NodeKey::ROOT, &[paragraph])?;
            tx.append(paragraph, &[text])?;
            let caret = TextPointCaret::new(
                tx.view(),
                text,
                CaretDirection::Next,
                TextOffsetSpec::At(Utf16Offset(2)),
            )?;
            let split = tx
                .split_at_point_caret_next(caret.into(), SplitAtPointCaretNextOptions::default())?
                .unwrap();
            assert_eq!(split, SiblingCaret::new(text, CaretDirection::Next).into());
            assert_eq!(tx.text_content(text), "te");
            let right = tx.next_sibling(text).unwrap();
            assert_eq!(tx.text_content(right), "st");
            tx.split_at_point_caret_next(split.into(), SplitAtPointCaretNextOptions::default())?;
            let next_paragraph = tx.next_sibling(paragraph).unwrap();
            assert_eq!(tx.children_keys(paragraph)?, vec![text]);
            assert_eq!(tx.children_keys(next_paragraph)?, vec![right]);
            assert_eq!(
                normalize_caret(
                    tx.view(),
                    ChildCaret {
                        origin: next_paragraph,
                        direction: CaretDirection::Next
                    }
                    .into()
                )?,
                TextPointCaret {
                    origin: right,
                    offset: Utf16Offset(0),
                    direction: CaretDirection::Next
                }
                .into()
            );
            assert_eq!(
                child_caret_at_index(
                    tx.view(),
                    next_paragraph,
                    ChildIndex(99),
                    CaretDirection::Next
                )?,
                SiblingCaret::new(right, CaretDirection::Next).into()
            );
            assert_eq!(
                SiblingCaret::new(right, CaretDirection::Next).rewind(tx.view())?,
                ChildCaret {
                    origin: next_paragraph,
                    direction: CaretDirection::Next
                }
                .into()
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn upstream_remove_partial_segmented_text_and_merge_blocks() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let left = tx.create(Paragraph::default())?.key();
            let right = tx.create(Paragraph::default())?.key();
            let a = tx.create_text("hello")?.key();
            let b = tx.create_text("world")?.key();
            tx.text(b)?.set_mode(TextMode::Segmented)?;
            tx.append(NodeKey::ROOT, &[left, right])?;
            tx.append(left, &[a])?;
            tx.append(right, &[b])?;
            let range = CaretRange::new(
                TextPointCaret {
                    origin: a,
                    offset: Utf16Offset(2),
                    direction: CaretDirection::Next,
                }
                .into(),
                TextPointCaret {
                    origin: b,
                    offset: Utf16Offset(3),
                    direction: CaretDirection::Next,
                }
                .into(),
            )?;
            let result = tx.remove_text_from_caret_range(range, SliceMode::RemoveEmptySlices)?;
            assert!(result.is_collapsed());
            assert_eq!(tx.text_content(left), "held");
            assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![left]);
            assert!(!tx.is_attached(b));
            assert_eq!(
                tx.view().text_data(tx.last_child(left).unwrap())?.mode,
                TextMode::Normal
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn caret_boundaries_comparison_and_split_policies() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?.key();
            let q = tx.create(Paragraph::default())?.key();
            let a = tx.create_text("abc")?.key();
            let b = tx.create_text("xyz")?.key();
            tx.append(NodeKey::ROOT, &[p, q])?;
            tx.append(p, &[a])?;
            tx.append(q, &[b])?;
            let start = ChildCaret::new(tx.view(), p, CaretDirection::Next).unwrap();
            let end = SiblingCaret::new(p, CaretDirection::Next);
            assert_eq!(start.caret_type(), CaretType::Child);
            assert_eq!(start.child_caret(tx.view()), Some(start));
            assert_eq!(start.parent_at_caret(tx.view()), Some(p));
            assert_eq!(
                start.adjacent_caret(tx.view()),
                Some(SiblingCaret::new(a, CaretDirection::Next))
            );
            assert!(start.is_same_node_caret(&PointCaret::from(start)));
            assert!(start.is_same_point_caret(&PointCaret::from(start)));
            assert_eq!(start.sibling_caret(), end);
            assert_eq!(start.flipped(tx.view()).flipped(tx.view()), start.into());
            assert_eq!(end.parent_caret(tx.view(), RootMode::Root), None);
            assert_eq!(
                PointCaret::from(end).child_caret_or_self(tx.view()),
                start.into()
            );
            assert_eq!(
                NodeCaret::Sibling(SiblingCaret::new(a, CaretDirection::Next))
                    .adjacent_sibling_or_parent_sibling(tx.view(), RootMode::Root),
                Some((
                    NodeCaret::Child(ChildCaret {
                        origin: q,
                        direction: CaretDirection::Next
                    }),
                    -1
                ))
            );
            assert_eq!(
                compare_point_caret_next(tx.view(), start.into(), end.into())?,
                Ordering::Less
            );
            assert_eq!(
                compare_point_caret_next(
                    tx.view(),
                    start.into(),
                    SiblingCaret::new(a, CaretDirection::Next).into()
                )?,
                Ordering::Less
            );
            assert_eq!(
                compare_point_caret_next(
                    tx.view(),
                    SiblingCaret::new(a, CaretDirection::Next).into(),
                    start.into()
                )?,
                Ordering::Greater
            );
            assert_eq!(
                compare_point_caret_next(
                    tx.view(),
                    end.into(),
                    SiblingCaret::new(q, CaretDirection::Next).into()
                )?,
                Ordering::Less
            );
            assert!(
                caret_from_point(
                    tx.view(),
                    &Point::text(p, Utf16Offset(0)),
                    CaretDirection::Next
                )
                .is_err()
            );
            assert!(
                caret_from_point(
                    tx.view(),
                    &Point::element(a, ChildIndex(0)),
                    CaretDirection::Next
                )
                .is_err()
            );
            let detached = tx.create_text("detached")?.key();
            assert!(
                compare_point_caret_next(
                    tx.view(),
                    SiblingCaret::new(detached, CaretDirection::Next).into(),
                    start.into()
                )
                .is_err()
            );
            assert_eq!(
                tx.split_at_point_caret_next(
                    start.into(),
                    SplitAtPointCaretNextOptions {
                        should_split: |_, _, _| false,
                        ..Default::default()
                    }
                )?,
                Some(
                    ChildCaret {
                        origin: NodeKey::ROOT,
                        direction: CaretDirection::Next
                    }
                    .into()
                )
            );
            assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p, q]);
            let root = ChildCaret::new(tx.view(), NodeKey::ROOT, CaretDirection::Next).unwrap();
            assert_eq!(
                tx.split_at_point_caret_next(root.into(), Default::default())?,
                None
            );
            let empty = tx.create(Paragraph::default())?.key();
            tx.append(NodeKey::ROOT, &[empty])?;
            let empty_start = ChildCaret::new(tx.view(), empty, CaretDirection::Next).unwrap();
            tx.split_at_point_caret_next(
                empty_start.into(),
                SplitAtPointCaretNextOptions {
                    remove_empty_destination: true,
                    ..Default::default()
                },
            )?;
            assert!(!tx.is_attached(empty));
            Ok(())
        })
        .unwrap();
}

#[test]
fn remove_slice_preserves_empty_anchor_and_token_removal_collapses() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?.key();
            let a = tx.create_text("abc")?.key();
            let b = tx.create_text("token")?.key();
            tx.text(b)?.set_mode(TextMode::Token)?;
            tx.append(NodeKey::ROOT, &[p])?;
            tx.append(p, &[a, b])?;
            let range = CaretRange::new(
                TextPointCaret {
                    origin: a,
                    offset: Utf16Offset(0),
                    direction: CaretDirection::Next,
                }
                .into(),
                TextPointCaret {
                    origin: a,
                    offset: Utf16Offset(3),
                    direction: CaretDirection::Next,
                }
                .into(),
            )?;
            let collapsed =
                tx.remove_text_from_caret_range(range, SliceMode::PreserveEmptyTextSliceCaret)?;
            assert_eq!(
                collapsed.anchor,
                TextPointCaret {
                    origin: a,
                    offset: Utf16Offset(0),
                    direction: CaretDirection::Next
                }
                .into()
            );
            assert!(tx.is_attached(a));
            assert_eq!(tx.text_content(a), "");
            let token = CaretRange::new(
                TextPointCaret {
                    origin: b,
                    offset: Utf16Offset(1),
                    direction: CaretDirection::Next,
                }
                .into(),
                TextPointCaret {
                    origin: b,
                    offset: Utf16Offset(2),
                    direction: CaretDirection::Next,
                }
                .into(),
            )?;
            let result = tx.remove_text_from_caret_range(token, SliceMode::RemoveEmptySlices)?;
            assert!(result.is_collapsed());
            assert!(!tx.is_attached(b));
            assert_eq!(tx.children_keys(p)?, vec![a]);
            assert_eq!(
                tx.remove_text_from_caret_range(result, SliceMode::RemoveEmptySlices)?,
                result
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn replacing_node_clones_active_selection_but_remove_text_restores_identity() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?.key();
            let a = tx.create_text("leading")?.key();
            let b = tx.create_text("segmented")?.key();
            tx.text(b)?.set_mode(TextMode::Segmented)?;
            tx.append(NodeKey::ROOT, &[p])?;
            tx.append(p, &[a, b])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::new(
                Point::text(a, Utf16Offset(2)),
                Point::text(b, Utf16Offset(3)),
            ))))?;
            assert_eq!(tx.selection_replacements(), 0);
            tx.remove_text()?;
            assert_eq!(tx.selection_replacements(), 0);
            let replacement = tx.create_text("replacement")?.key();
            tx.replace(a, replacement, false)?;
            assert_eq!(tx.selection_replacements(), 1);
            Ok(())
        })
        .unwrap();
}
