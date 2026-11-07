use super::*;
#[test]
fn code_line_navigation_and_home_toggle_use_utf16_and_direction() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(crate::code::CodeNode::default())?;
        let tab = tx.create(Tab {})?;
        let text = tx.create_text("  אב😀")?;
        let line = tx.create(LineBreak {})?;
        let tail = tx.create_text("end")?;
        tx.append(code, &[tab.key(), text.key(), line.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        assert!(is_code_text(tx, text.key()));
        assert!(!is_code_text(tx, tab.key()));
        assert!(is_code_line_node(tx, tab.key()));
        assert_eq!(first_code_node_of_line(tx, text.key()), tab.key());
        assert_eq!(last_code_node_of_line(tx, tab.key()), text.key());
        assert_eq!(first_code_node_of_line(tx, line.key()), line.key());
        assert_eq!(code_line_direction(tx, tab.key()), Some(TextDirection::Rtl));
        assert_eq!(end_of_code_in_line(tx, tab.key())?, text.key());
        assert!(end_of_code_in_line(tx, line.key()).is_err());
        assert_eq!(
            start_of_code_in_line(tx, text.key(), Utf16Offset(5))?,
            Some((text.key(), Utf16Offset(2)))
        );
        assert_eq!(start_of_code_in_line(tx, text.key(), Utf16Offset(2))?, None);
        assert_eq!(
            start_of_code_in_line(tx, text.key(), Utf16Offset(0))?,
            Some((text.key(), Utf16Offset(2)))
        );
        assert_eq!(
            start_of_code_in_line(tx, tail.key(), Utf16Offset(0))?,
            Some((line.key(), Utf16Offset(1)))
        );
        Ok(())
    })?;
    Ok(())
}
