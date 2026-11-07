use super::*;
#[test]
fn tab_decisions_indent_outdent_and_move_lines_keep_selection() -> Result<(), Error> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        let a = tx.create_text("one")?;
        let lb = tx.create(LineBreak {})?;
        let b = tx.create_text("two")?;
        tx.append(code, &[a.key(), lb.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(a)?;
        assert_eq!(
            handle_key_tab(tx.view(), false)?,
            Some(TabAction::InsertTab)
        );
        tx.set_text_node_range(a, Utf16Offset(0), a, Utf16Offset(3))?;
        assert_eq!(handle_tab(tx.view(), false)?, Some(TabAction::Indent));
        tx.set_text_node_range(a, Utf16Offset(1), a, Utf16Offset(2))?;
        assert_eq!(handle_tab(tx.view(), false)?, Some(TabAction::InsertTab));
        tx.set_text_node_range(a, Utf16Offset(0), b, Utf16Offset(3))?;
        assert!(handle_multiline_indent(
            tx,
            TabAction::Indent,
            CodeIndentOptions::default()
        )?);
        assert_eq!(tx.text_content(code), "\tone\n\ttwo");
        assert_eq!(tx.anchor()?.offset(), 0);
        assert!(tx.is::<Tab>(tx.anchor()?.key()));
        assert!(handle_multiline_indent(
            tx,
            TabAction::Outdent,
            CodeIndentOptions::default()
        )?);
        assert_eq!(tx.text_content(code), "one\ntwo");
        tx.select_end(b)?;
        assert!(handle_arrow(tx, true, true)?);
        assert_eq!(tx.text_content(code), "two\none");
        assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(3)));
        assert!(handle_move_to(tx, true, true)?);
        assert_eq!(tx.anchor()?, Point::text(b, Utf16Offset(3)));
        assert_eq!(tx.focus()?, Point::text(b, Utf16Offset(0)));
        Ok(())
    })?;
    Ok(())
}
#[test]
fn code_boundaries_guard_arrows_and_leave_paragraph_home_alone() -> Result<(), Error> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        let text = tx.create_text("  abc")?;
        let p = tx.create(Paragraph {})?;
        let plain = tx.create_text("paragraph")?;
        tx.append(code, &[text.key()])?;
        tx.append(p, &[plain.key()])?;
        tx.append(NodeKey::ROOT, &[code.key(), p.key()])?;
        tx.select_start(text)?;
        assert!(handle_arrow(tx, true, true)?);
        assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(0)));
        assert!(handle_move_to(tx, true, false)?);
        assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(2)));
        assert!(handle_move_to(tx, true, false)?);
        assert_eq!(tx.anchor()?, Point::text(text, Utf16Offset(0)));
        tx.select_end(text)?;
        assert!(handle_multiline_indent(
            tx,
            TabAction::Outdent,
            CodeIndentOptions { tab_size: Some(4) }
        )?);
        assert_eq!(tx.text_content(code), "abc");
        assert_eq!(tx.anchor()?.offset(), 3);
        tx.select_end(plain)?;
        assert!(!handle_move_to(tx, true, false)?);
        assert_eq!(handle_tab(tx.view(), false)?, None);
        assert!(!insert_tab_in_code(tx)?);
        Ok(())
    })?;
    Ok(())
}
