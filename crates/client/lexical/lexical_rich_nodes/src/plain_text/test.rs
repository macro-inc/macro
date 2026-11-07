use super::*;
#[test]
fn plain_enter_inserts_line_break_without_splitting_block() -> crate::Result<()> {
    let mut editor = register_plain_text(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("ab")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    assert!(enter_applies(&tx));
    assert!(insert_paragraph(&mut tx)?);
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key()]);
    assert_eq!(tx.text_content(p), "a\nb");
    let children = tx.children_keys(p)?;
    assert!(tx.is::<LineBreak>(children[1]));
    Ok(())
}
#[test]
fn null_selection_plain_handlers_are_unhandled_but_select_all_is_handled() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    assert!(!controlled_text_insertion(&mut tx, "x")?);
    assert!(!delete_character(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView
    )?);
    assert!(!delete_word(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView,
        ModifyTarget::NoView
    )?);
    assert!(!delete_line(
        &mut tx,
        EditDirection::Forward,
        ModifyTarget::NoView,
        ModifyTarget::NoView
    )?);
    assert!(!remove_text(&mut tx)?);
    assert!(!insert_line_break(&mut tx, false)?);
    assert!(!insert_paragraph(&mut tx)?);
    assert!(!enter_applies(&tx));
    assert!(!delete_key_applies(&tx));
    assert_eq!(backspace_action(&tx), BackspaceAction::NotHandled);
    assert_eq!(arrow_horizontal(&tx, true, true)?, ArrowOutcome::NotHandled);
    cut_selection(&mut tx)?;
    assert!(select_all(&mut tx)?);
    assert!(tx.selection().unwrap().is_range());
    Ok(())
}
#[test]
fn node_selection_plain_handlers_preserve_nodes() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("keep")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(p);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert!(!controlled_text_insertion(&mut tx, "x")?);
    assert!(!delete_character(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView
    )?);
    assert!(!delete_word(
        &mut tx,
        EditDirection::Backward,
        ModifyTarget::NoView,
        ModifyTarget::NoView
    )?);
    assert!(!delete_line(
        &mut tx,
        EditDirection::Forward,
        ModifyTarget::NoView,
        ModifyTarget::NoView
    )?);
    assert!(!remove_text(&mut tx)?);
    assert!(!insert_line_break(&mut tx, false)?);
    assert!(!insert_paragraph(&mut tx)?);
    assert!(!enter_applies(&tx));
    assert!(!delete_key_applies(&tx));
    assert_eq!(backspace_action(&tx), BackspaceAction::NotHandled);
    cut_selection(&mut tx)?;
    assert_eq!(tx.text_content(p), "keep");
    assert_eq!(tx.first_child(NodeKey::ROOT), Some(p.key()));
    Ok(())
}
#[test]
fn plain_backspace_never_outdents_and_range_insertion_is_handled() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("abc")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_indent(p, 2)?;
    tx.select_start(t)?;
    assert_eq!(backspace_action(&tx), BackspaceAction::DeleteCharacter);
    assert!(delete_key_applies(&tx));
    assert!(controlled_text_insertion(&mut tx, "x")?);
    assert_eq!(tx.text_content(p), "xabc");
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(1)))?;
    cut_selection(&mut tx)?;
    assert_eq!(tx.text_content(p), "abc");
    assert_eq!(tx.indent(p), 2);
    Ok(())
}
