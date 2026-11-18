use super::*;

#[test]
fn registered_insert_paragraph_exits_empty_lists() -> Result<()> {
    for list_type in [ListType::Check, ListType::Bullet, ListType::Number] {
        let mut editor =
            list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
                .build()
                .expect("registered list editor");
        let mut tx = editor.transaction();
        let list = create_list_node(&mut tx, list_type, 1)?;
        let item = create_list_item_node(&mut tx, None)?;
        tx.append(list, &[item.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_start(item)?;
        assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
        let paragraph = tx.first_child_or_err(NodeKey::ROOT)?;
        assert!(tx.is::<Paragraph>(paragraph));
        assert_eq!(tx.children(NodeKey::ROOT).count(), 1);
        assert!(tx.children(paragraph).next().is_none());
        let range = tx
            .selection()
            .and_then(Selection::as_range)
            .expect("paragraph range");
        assert_eq!(range.anchor, Point::element(paragraph, ChildIndex(0)));
        assert_eq!(range.focus, range.anchor);
    }
    Ok(())
}

#[derive(Clone, Default)]
struct DispatchLog(Vec<&'static str>);

struct EditorObserver;
impl Plugin for EditorObserver {
    fn name(&self) -> &'static str {
        "list-test.editor-observer"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::InsertParagraph,
            priority: CommandPriority::Editor,
            placement: Placement::Before,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled> {
        tx.extension_mut::<DispatchLog>()?.0.push("editor");
        Ok(Handled::No)
    }
}

struct RichFallback;
impl Plugin for RichFallback {
    fn name(&self) -> &'static str {
        "list-test.rich-fallback"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::InsertParagraph,
            priority: CommandPriority::Editor,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled> {
        tx.extension_mut::<DispatchLog>()?.0.push("rich");
        let handled =
            crate::rich_text::insert_paragraph(tx).map_err(|crate::Error::Model(error)| error)?;
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}

struct HighStop;
impl Plugin for HighStop {
    fn name(&self) -> &'static str {
        "list-test.high-stop"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::InsertParagraph,
            priority: CommandPriority::High,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled> {
        tx.extension_mut::<DispatchLog>()?.0.push("high");
        Ok(Handled::Yes)
    }
}

#[test]
fn populated_list_yields_to_editor_observer_then_actual_rich_insertion() -> Result<()> {
    let mut editor = list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
        .extension_state(DispatchLog::default())
        .plugin(EditorObserver)
        .plugin(RichFallback)
        .build()
        .expect("registered list editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    let text = tx.create_text("row")?;
    tx.append(item, &[text.key()])?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_end(text)?;
    assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
    assert_eq!(tx.extension::<DispatchLog>()?.0, ["editor", "rich"]);
    let items = tx.children_keys(list)?;
    assert_eq!(items.len(), 2);
    assert_eq!(items[0], item.key());
    assert_eq!(tx.text_content(items[0]), "row");
    assert_eq!(tx.text_content(items[1]), "");
    Ok(())
}

#[test]
fn handled_high_listener_prevents_list_and_editor_handlers() -> Result<()> {
    let mut editor = list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
        .extension_state(DispatchLog::default())
        .plugin(EditorObserver)
        .plugin(RichFallback)
        .plugin(HighStop)
        .build()
        .expect("registered list editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(item)?;
    assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
    assert_eq!(tx.extension::<DispatchLog>()?.0, ["high"]);
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, [list.key()]);
    assert_eq!(tx.children_keys(list)?, [item.key()]);
    Ok(())
}

#[test]
fn empty_list_handler_stops_editor_fallback_and_preserves_typing_attributes() -> Result<()> {
    let mut editor = list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
        .extension_state(DispatchLog::default())
        .plugin(EditorObserver)
        .plugin(RichFallback)
        .build()
        .expect("registered list editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Check, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(item)?;
    tx.set_selection_format_at(SelectionSlot::Active, TextFormat::BOLD)?;
    tx.set_selection_style_at(SelectionSlot::Active, "color: red")?;
    assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
    assert!(tx.extension::<DispatchLog>()?.0.is_empty());
    let paragraph = tx.first_child_or_err(NodeKey::ROOT)?;
    assert!(tx.is::<Paragraph>(paragraph));
    assert_eq!(tx.element_data(paragraph)?.text_format, TextFormat::BOLD);
    assert_eq!(&*tx.element_data(paragraph)?.text_style, "color: red");
    Ok(())
}

#[test]
fn registered_numbering_option_controls_the_trailing_list() -> Result<()> {
    for (restore_numbering, expected_start) in [(false, 1), (true, 4)] {
        let mut editor = list_extension(
            Editor::builder(EditorMode::Headless),
            ListConfig {
                has_strict_indent: false,
                should_preserve_numbering: restore_numbering,
            },
        )
        .build()
        .expect("registered numbered list editor");
        let mut tx = editor.transaction();
        let list = create_list_node(&mut tx, ListType::Number, 4)?;
        let empty = create_list_item_node(&mut tx, None)?;
        let after = create_list_item_node(&mut tx, None)?;
        let text = tx.create_text("after")?;
        tx.append(after, &[text.key()])?;
        tx.append(list, &[empty.key(), after.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_start(empty)?;
        assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
        let paragraph = tx.first_child_or_err(NodeKey::ROOT)?;
        assert!(tx.is::<Paragraph>(paragraph));
        let trailing = tx.next_sibling(paragraph).expect("trailing list");
        assert_eq!(
            tx.get::<ListNode>(trailing).expect("numbered list").start(),
            expected_start
        );
        assert_eq!(tx.children_keys(trailing)?, [after.key()]);
        assert_eq!(tx.first_child(after), Some(text.key()));
    }
    Ok(())
}

#[test]
fn nested_empty_item_exits_one_level_with_parent_content_retained() -> Result<()> {
    for list_type in [ListType::Check, ListType::Bullet, ListType::Number] {
        let mut editor =
            list_extension(Editor::builder(EditorMode::Headless), ListConfig::default())
                .build()
                .expect("registered nested list editor");
        let mut tx = editor.transaction();
        let outer = create_list_node(&mut tx, list_type, 1)?;
        let parent = create_list_item_node(&mut tx, None)?;
        let text = tx.create_text("parent")?;
        let nested = create_list_node(&mut tx, list_type, 1)?;
        let empty = create_list_item_node(&mut tx, None)?;
        tx.append(nested, &[empty.key()])?;
        tx.append(parent, &[text.key(), nested.key()])?;
        tx.append(outer, &[parent.key()])?;
        tx.append(NodeKey::ROOT, &[outer.key()])?;
        tx.select_start(empty)?;
        assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
        assert_eq!(tx.children_keys(NodeKey::ROOT)?, [outer.key()]);
        let items = tx.children_keys(outer)?;
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], parent.key());
        assert_eq!(tx.children_keys(parent)?, [text.key()]);
        assert!(tx.is::<ListItemNode>(items[1]));
        assert_eq!(tx.children(items[1]).count(), 0);
        let range = tx
            .selection()
            .and_then(Selection::as_range)
            .expect("nested exit range");
        assert_eq!(range.anchor, Point::element(items[1], ChildIndex(0)));
        assert_eq!(range.focus, range.anchor);
    }
    Ok(())
}

#[test]
fn builders_without_list_registration_keep_their_rich_fallback() -> Result<()> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .extension_state(DispatchLog::default())
        .plugin(EditorObserver)
        .plugin(RichFallback)
        .build()
        .expect("nodes-only builder");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let item = create_list_item_node(&mut tx, None)?;
    tx.append(list, &[item.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.select_start(item)?;
    assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
    assert_eq!(tx.extension::<DispatchLog>()?.0, ["editor", "rich"]);
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, [list.key()]);
    assert_eq!(tx.children(list).count(), 2);
    Ok(())
}
