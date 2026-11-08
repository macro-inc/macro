use crate::*;
#[test]
fn clearing_one_formatted_text_does_not_reformat_its_neighbor() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let selected = tx.create_text("a")?;
    let next = tx.create_text("a")?;
    tx.text(selected)?.set_format(TextFormat::BOLD)?;
    tx.append(paragraph, &[selected.key(), next.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let mut range = RangeSelection::new(
        Point::text(selected, Utf16Offset(0)),
        Point::text(selected, Utf16Offset(1)),
    );
    range.format = TextFormat::ITALIC;
    range.style = "color: red".into();
    tx.set_selection(Some(Selection::Range(range)))?;
    tx.insert_text("")?;
    let Some(Selection::Range(range)) = tx.selection() else {
        panic!("range selection");
    };
    assert_eq!(range.format, TextFormat::ITALIC);
    assert_eq!(range.style.as_ref(), "color: red");
    assert_eq!(tx.children_keys(paragraph)?, vec![next.key()]);
    assert_eq!(tx.view().text_data(next)?.format, TextFormat::empty());
    assert_eq!(tx.text_content(next), "a");
    Ok(())
}

#[test]
fn block_paste_trims_trailing_break_using_captured_block_identity() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        let line = tx.create(LineBreak {})?;
        tx.append(paragraph, &[text.key(), line.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(text)?;
        Ok(())
    })?;
    editor.update(|tx| {
        let pasted = tx.create(Paragraph::default())?;
        let text = tx.create_text("b")?;
        tx.append(pasted, &[text.key()])?;
        tx.insert_nodes(&[pasted.key()])
    })?;
    assert_eq!(editor.state().root_text_content().as_ref(), "ab");
    Ok(())
}

#[test]
fn clearing_multiple_text_nodes_preserves_typing_attributes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let first = tx.create_text("a")?;
    let last = tx.create_text("b")?;
    tx.text(first)?.set_format(TextFormat::ITALIC)?;
    tx.append(paragraph, &[first.key(), last.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let mut range = RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::text(last, Utf16Offset(0)),
    );
    range.format = TextFormat::BOLD | TextFormat::ITALIC;
    tx.set_selection(Some(Selection::Range(range)))?;
    tx.insert_text("")?;
    assert_eq!(
        tx.range_selection()?.format,
        TextFormat::BOLD | TextFormat::ITALIC
    );
    Ok(())
}

#[test]
fn segmented_end_replacement_preserves_the_new_active_selection_attributes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let first = tx.create_text("a")?;
    tx.text(first)?.set_format(TextFormat::CODE)?;
    let last = tx.create_text("bc")?;
    tx.text(last)?.set_mode(TextMode::Segmented)?;
    tx.append(paragraph, &[first.key(), last.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let range = RangeSelection::new(
        Point::text(first, Utf16Offset(0)),
        Point::text(last, Utf16Offset(1)),
    );
    tx.set_selection(Some(Selection::Range(range)))?;
    tx.insert_text("x")?;
    assert_eq!(tx.text_content(first), "x");
    assert_eq!(tx.view().text_data(first)?.format, TextFormat::CODE);
    assert_eq!(tx.range_selection()?.format, TextFormat::empty());
    Ok(())
}
