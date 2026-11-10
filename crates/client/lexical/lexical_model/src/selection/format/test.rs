use crate::*;

#[test]
fn formatting_two_merge_groups_preserves_upstream_element_endpoint() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((empty, paragraph, keys), _) = editor.update(|tx| {
        let empty = tx.create(Paragraph::default())?.key();
        let paragraph = tx.create(Paragraph::default())?.key();
        let mut keys = Vec::new();
        for bits in [520, 40, 552, 544, 32] {
            let key = tx.create_text("x")?.key();
            tx.text(key)?
                .set_format(TextFormat::from_bits_retain(bits))?;
            keys.push(key);
        }
        tx.append(paragraph, &keys)?;
        tx.append(NodeKey::ROOT, &[empty, paragraph])?;
        Ok((empty, paragraph, keys))
    })?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(paragraph, ChildIndex(4)),
            Point::element(empty, ChildIndex(0)),
        ))))?;
        Ok(())
    })?;
    editor.update(|tx| {
        tx.format_text(TextFormatType::Uppercase, None)?;
        // Both ports still have an element endpoint before text normalization.
        assert_eq!(tx.anchor()?, Point::element(paragraph, ChildIndex(4)));
        assert_eq!(
            tx.dirty_leaves.iter().copied().collect::<Vec<_>>(),
            vec![keys[0], keys[3], keys[1], keys[2]]
        );
        Ok(())
    })?;
    let state = editor.state();
    let range = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::text(keys[3], Utf16Offset(2)));
    assert_eq!(range.focus, Point::element(empty, ChildIndex(0)));
    let view = state.view();
    assert_eq!(view.text_content(keys[0]).as_ref(), "x");
    assert_eq!(view.text_content(keys[1]).as_ref(), "xx");
    assert_eq!(view.text_content(keys[3]).as_ref(), "xx");
    Ok(())
}

#[test]
fn format_order_retains_excluded_endpoint_rules() -> Result<(), Error> {
    for (start_offset, end_offset) in [(1, 1), (0, 0)] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("builder");
        let (keys, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?.key();
            let mut keys = Vec::new();
            for bits in [0, 8, 32] {
                let key = tx.create_text("x")?.key();
                tx.text(key)?
                    .set_format(TextFormat::from_bits_retain(bits))?;
                keys.push(key);
            }
            tx.append(p, &keys)?;
            tx.append(NodeKey::ROOT, &[p])?;
            Ok(keys)
        })?;
        editor.update(|tx| {
            tx.select_points(
                Point::text(keys[0], Utf16Offset(start_offset)),
                Point::text(keys[2], Utf16Offset(end_offset)),
            )?;
            tx.format_text(TextFormatType::Bold, None)?;
            Ok(())
        })?;
        let state = editor.state();
        let range = state
            .selection()
            .and_then(Selection::as_range)
            .expect("range");
        assert_eq!(
            range.anchor,
            Point::text(keys[usize::from(start_offset == 1)], Utf16Offset::ZERO)
        );
        assert_eq!(range.focus, Point::text(keys[2], Utf16Offset(end_offset)));
        assert_eq!(
            state.view().text(keys[0]).expect("first").format.bits(),
            u32::from(start_offset == 0)
        );
        assert_eq!(
            state.view().text(keys[2]).expect("last").format.bits(),
            32 | u32::from(end_offset == 1)
        );
    }
    Ok(())
}

#[test]
fn format_order_retains_single_token_and_tab_points() -> Result<(), Error> {
    for mode in [TextMode::Normal, TextMode::Token] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("builder");
        let (key, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?.key();
            let key = tx.create_text("xyz")?.key();
            tx.text(key)?.set_mode(mode)?;
            tx.append(p, &[key])?;
            tx.append(NodeKey::ROOT, &[p])?;
            Ok(key)
        })?;
        editor.update(|tx| {
            tx.select_points(
                Point::text(key, Utf16Offset(0)),
                Point::text(key, Utf16Offset(3)),
            )?;
            tx.format_text(TextFormatType::Bold, None)?;
            Ok(())
        })?;
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range");
        assert_eq!(range.anchor, Point::text(key, Utf16Offset(0)));
        assert_eq!(range.focus, Point::text(key, Utf16Offset(3)));
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let key = tx.create(Tab::default())?.key();
        tx.append(p, &[key])?;
        tx.append(NodeKey::ROOT, &[p])?;
        Ok(key)
    })?;
    editor.update(|tx| {
        tx.select_points(
            Point::text(key, Utf16Offset(0)),
            Point::text(key, Utf16Offset(1)),
        )?;
        tx.format_text(TextFormatType::Bold, None)?;
        Ok(())
    })?;
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::text(key, Utf16Offset(0)));
    assert_eq!(range.focus, Point::text(key, Utf16Offset(1)));
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct NonFormattingText;
impl NodeType for NonFormattingText {
    const TYPE: &'static str = "non-formatting-text";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for NonFormattingText {
    text_node_base!();
    fn can_have_format(&self, _: TextView<'_>) -> bool {
        false
    }
}

#[test]
fn format_order_retains_skipped_last_text_fallback() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NonFormattingText>()
        .build()
        .expect("builder");
    let ((p, a, b, skipped), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let a = tx.create_text("aa")?.key();
        let b = tx.create_text("b")?.key();
        let skipped = tx.create(NonFormattingText)?.key();
        tx.text(b)?.set_format(TextFormat::ITALIC)?;
        tx.text(skipped)?.set_text_content("c")?;
        tx.text(skipped)?.set_format(TextFormat::SUBSCRIPT)?;
        tx.append(p, &[a, b, skipped])?;
        tx.append(NodeKey::ROOT, &[p])?;
        Ok((p, a, b, skipped))
    })?;
    editor.update(|tx| {
        tx.select_points(
            Point::text(a, Utf16Offset(1)),
            Point::element(p, ChildIndex(3)),
        )?;
        tx.format_text(TextFormatType::Bold, None)?;
        Ok(())
    })?;
    let state = editor.state();
    let range = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.focus, Point::text(b, Utf16Offset(1)));
    assert_eq!(
        state.view().text(skipped).expect("skipped").format,
        TextFormat::SUBSCRIPT
    );
    Ok(())
}

#[test]
fn format_order_retains_skipped_first_text_target() -> Result<(), Error> {
    for element_start in [false, true] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .node::<NonFormattingText>()
            .build()
            .expect("builder");
        let ((p, skipped, middle, last), _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?.key();
            let skipped = tx.create(NonFormattingText)?.key();
            tx.text(skipped)?.set_text_content("aa")?;
            let middle = tx.create_text("b")?.key();
            tx.text(middle)?.set_format(TextFormat::ITALIC)?;
            let last = tx.create_text("cc")?.key();
            tx.text(last)?.set_format(TextFormat::SUBSCRIPT)?;
            tx.append(p, &[skipped, middle, last])?;
            tx.append(NodeKey::ROOT, &[p])?;
            Ok((p, skipped, middle, last))
        })?;
        editor.update(|tx| {
            let start = if element_start {
                Point::element(p, ChildIndex(0))
            } else {
                Point::text(skipped, Utf16Offset(1))
            };
            tx.select_points(start, Point::text(last, Utf16Offset(1)))?;
            tx.format_text(TextFormatType::Bold, None)?;
            Ok(())
        })?;
        let state = editor.state();
        let range = state
            .selection()
            .and_then(Selection::as_range)
            .expect("range");
        assert_eq!(range.anchor, Point::text(middle, Utf16Offset(0)));
        assert_eq!(range.focus, Point::text(last, Utf16Offset(1)));
        assert_eq!(
            state.view().text(skipped).expect("skipped").format,
            TextFormat::empty()
        );
    }
    Ok(())
}
