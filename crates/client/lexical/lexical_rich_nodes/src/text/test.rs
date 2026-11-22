use super::*;
#[test]
fn placeholder_and_intersection_keep_upstream_boundaries() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        assert!(can_show_placeholder(tx, false));
        assert!(!can_show_placeholder(tx, true));
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        assert!(can_show_placeholder(tx, false));
        tx.set_indent(p, 1)?;
        assert!(!can_show_placeholder(tx, false));
        tx.set_indent(p, 0)?;
        let text = tx.create_text("a😀")?;
        tx.append(p, &[text.key()])?;
        assert_eq!(root_text_content(tx), "a😀");
        assert!(!is_root_text_content_empty(tx, false, true));
        assert_eq!(
            find_text_intersection_from_characters(tx.view(), Utf16Offset(2)),
            Some((text.key(), Utf16Offset(2)))
        );
        assert_eq!(
            find_text_intersection_from_characters(tx.view(), Utf16Offset(3)),
            None
        );
        Ok(())
    })?;
    Ok(())
}
