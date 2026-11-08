use super::*;
#[test]
fn offsets_preserve_utf16_text_boundaries_and_block_widths() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let a = tx.create_text("a😀")?;
        let lb = tx.create(LineBreak {})?;
        let b = tx.create_text("b")?;
        tx.append(p, &[a.key(), lb.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let view = create_offset_view(tx, 1)?;
        let range = view
            .create_selection_from_offsets(tx, Utf16Offset(1), Utf16Offset(5), None)
            .unwrap();
        assert_eq!(range.anchor, Point::text(a, Utf16Offset(1)));
        assert_eq!(range.focus, Point::text(b, Utf16Offset(1)));
        assert_eq!(
            view.get_offsets_from_selection(tx, &range),
            (Some(Utf16Offset(1)), Some(Utf16Offset(5)))
        );
        assert!(
            view.create_selection_from_offsets(tx, Utf16Offset(6), Utf16Offset(6), None)
                .is_none()
        );
        let inline = view
            .create_selection_from_offsets(tx, Utf16Offset(4), Utf16Offset(4), None)
            .unwrap();
        assert_eq!(inline.anchor, Point::element(p, ChildIndex(4)));
        assert_eq!(
            view.create_selection_from_offsets(tx, Utf16Offset(1), Utf16Offset(2), Some(&view))
                .unwrap()
                .anchor,
            Point::text(a, Utf16Offset(1))
        );
        Ok(())
    })?;
    Ok(())
}
