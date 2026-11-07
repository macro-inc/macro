use super::*;

/// upstream: ListExtension/registerList, package commands dispatch at Low priority.
#[test]
fn package_command_keys_dispatch_to_mapped_handlers() -> Result<()> {
    let mut editor = list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.element(NodeKey::ROOT)?.select(None, None)?;
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &super::super::INSERT_ORDERED_LIST,
            ()
        )))?,
        Handled::Yes
    );
    let list = tx.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        tx.get::<ListNode>(list).expect("list").list_type(),
        ListType::Number
    );
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &super::super::UPDATE_LIST_START,
            super::super::UpdateListStart { list, new_start: 7 }
        )))?,
        Handled::Yes
    );
    let item = tx.first_child_or_err(list)?;
    assert_eq!(get_value(&tx, item_id(&tx, item)?)?, 7);
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &super::super::INSERT_CHECK_LIST,
            ()
        )))?,
        Handled::Yes
    );
    let check = tx.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        tx.get::<ListNode>(check).expect("check").list_type(),
        ListType::Check
    );
    assert_eq!(get_checked(&tx, item_id(&tx, item)?), Some(false));
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &super::super::INSERT_UNORDERED_LIST,
            ()
        )))?,
        Handled::Yes
    );
    let bullet = tx.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        tx.get::<ListNode>(bullet).expect("bullet").list_type(),
        ListType::Bullet
    );
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &super::super::REMOVE_LIST,
            ()
        )))?,
        Handled::Yes
    );
    assert!(tx.is::<Paragraph>(tx.first_child_or_err(NodeKey::ROOT)?));
    assert!(!update_list_start(&mut tx, NodeKey::ROOT, 2)?);
    Ok(())
}
/// upstream: registerList style transforms, first text determines marker attributes.
#[test]
fn marker_style_tracks_first_text_and_empty_selection() -> Result<()> {
    let mut editor = list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    let text = tx.create_text("styled")?;
    tx.text(text)?
        .set_format(TextFormat::BOLD)?
        .set_style("color: red")?;
    tx.append(item, &[text.key()])?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.flush()?;
    assert_eq!(tx.element_data(item)?.text_format, TextFormat::BOLD);
    assert_eq!(&*tx.element_data(item)?.text_style, "color: red");
    tx.remove(text, true)?;
    tx.select_start(item)?;
    tx.set_selection_format_at(SelectionSlot::Active, TextFormat::ITALIC)?;
    list_item_text_style_transform(&mut tx, item)?;
    assert_eq!(tx.element_data(item)?.text_format, TextFormat::ITALIC);
    Ok(())
}

/// upstream: registerListStrictIndentTransform.test.ts, excessive leading indentation flattens.
#[test]
fn strict_indent_flattens_leading_item_without_previous_leaf() -> Result<()> {
    let mut editor = list_extension(
        Editor::builder(EditorMode::Headless),
        ListConfig {
            has_strict_indent: true,
            should_preserve_numbering: false,
        },
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    set_indent(&mut tx, item, 3)?;
    assert_eq!(get_indent(&tx, item), 3);
    tx.flush()?;
    assert_eq!(get_indent(&tx, item), 0);
    assert_eq!(tx.parent(item), Some(list.key()));
    Ok(())
}

/// upstream: LexicalListItemNode.test.ts, registerList restoreNumbering=true.
#[test]
fn registered_enter_routing_consumes_restore_numbering() -> Result<()> {
    let mut editor = list_extension(
        Editor::builder(EditorMode::Headless),
        ListConfig {
            has_strict_indent: false,
            should_preserve_numbering: true,
        },
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Number, 4)?;
    let empty = create_list_item_node(&mut tx, None)?;
    let after = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[empty.key(), after.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(empty)?;
    assert!(handle_registered_insert_paragraph(&mut tx)?);
    let paragraph = tx.first_child_or_err(NodeKey::ROOT)?;
    let next = tx.next_sibling(paragraph).expect("trailing list");
    assert_eq!(tx.get::<ListNode>(next).expect("list").start(), 4);
    Ok(())
}
