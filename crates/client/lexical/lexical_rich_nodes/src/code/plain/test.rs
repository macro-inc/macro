use super::*;
#[test]
fn plain_code_preserves_separators_and_never_creates_highlights() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(crate::code::CodeNode::default())?;
        let nodes = plainify_code_content(tx, "\t a\r\n\n😀\t")?;
        assert_eq!(
            nodes
                .iter()
                .map(|key| tx.type_name(*key).unwrap())
                .collect::<Vec<_>>(),
            vec!["tab", "text", "linebreak", "linebreak", "text", "tab"]
        );
        tx.append(code, &nodes)?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        assert_eq!(tx.text_content(code), "\t a\r\n\n😀\t");
        Ok(())
    })?;
    Ok(())
}
#[test]
fn outdent_shifts_both_text_points_and_clamps_inside_indentation() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("   😀x")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(1)),
            Point::text(text, Utf16Offset(5)),
        ))))?;
        assert!(!outdent_leading_spaces(tx, text.key(), 0)?);
        assert!(outdent_leading_spaces(tx, text.key(), 2)?);
        assert_eq!(tx.text_content(text), " 😀x");
        assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(0)));
        assert_eq!(tx.focus()?, Point::text(text, Utf16Offset(3)));
        assert!(outdent_leading_spaces(tx, text.key(), 4)?);
        assert!(!outdent_leading_spaces(tx, text.key(), 4)?);
        Ok(())
    })?;
    Ok(())
}
