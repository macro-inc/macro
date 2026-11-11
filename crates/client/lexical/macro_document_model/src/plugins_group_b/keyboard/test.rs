use super::*;
use crate::EditorType;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};

#[test]
fn ordinary_outdent_moves_plain_and_table_list_items_and_clamps_at_zero() -> Result<(), Error> {
    for in_table in [false, true] {
        let mut editor = crate::surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .build()
        .expect("surface");
        let (item, _) = editor.update(|tx| {
            let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
            let first = tx.create(ListItemNode::default())?;
            let second = tx.create(ListItemNode::default())?;
            let one = tx.create_text("one")?;
            let two = tx.create_text("two")?;
            tx.append(first, &[one.key()])?;
            tx.append(second, &[two.key()])?;
            tx.append(list, &[first.key(), second.key()])?;
            if in_table {
                use lexical_rich_nodes::table::{
                    IncludeHeaders, create_table_node_with_dimensions,
                };
                let table =
                    create_table_node_with_dimensions(tx, 1, 1, IncludeHeaders::All(false))?;
                let row = tx.first_child(table).expect("row");
                let cell = tx.first_child(row).expect("cell");
                tx.append(cell, &[list.key()])?;
                tx.append(NodeKey::ROOT, &[table.key()])?;
            } else {
                tx.append(NodeKey::ROOT, &[list.key()])?;
            }
            tx.set_indent(second, 2)?;
            tx.select_start(two)?;
            Ok(second)
        })?;
        assert_eq!(editor.state().view().indent(item), 2);
        let selection = editor.state().selection().cloned();
        for (key_tab, expected) in [(true, 1), (false, 0), (false, 0)] {
            let command = if key_tab {
                Command::Key {
                    command: KeyCommand::Tab,
                    event: Some(KeyEvent {
                        key: "Tab".into(),
                        shift: true,
                        ..KeyEvent::default()
                    }),
                }
            } else {
                Command::OutdentContent
            };
            let (handled, commit) = editor.dispatch(&command)?;
            assert_eq!(handled, Handled::Yes);
            assert_eq!(commit.default_prevented, key_tab);
            assert_eq!(editor.state().view().indent(item), expected);
            assert_eq!(editor.state().view().text_content(item), "two");
            assert_eq!(editor.state().selection(), selection.as_ref());
        }
    }
    Ok(())
}

#[test]
fn expanded_outdent_changes_each_paragraph_once_and_handles_zero_indent() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (blocks, _) = editor.update(|tx| {
        let a = tx.create(Paragraph {})?;
        let b = tx.create(Paragraph {})?;
        let one = tx.create_text("one")?;
        let two = tx.create_text("two")?;
        tx.append(a, &[one.key()])?;
        tx.append(b, &[two.key()])?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
        tx.set_indent(a, 3)?;
        tx.set_indent(b, 1)?;
        let mut range = RangeSelection::collapsed(Point::text(one, Utf16Offset(0)));
        range.focus = Point::text(two, Utf16Offset(3));
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok([a, b])
    })?;
    for expected in [[2, 0], [1, 0], [0, 0], [0, 0]] {
        let (handled, commit) = editor.dispatch(&Command::OutdentContent)?;
        assert_eq!(handled, Handled::Yes);
        assert!(!commit.default_prevented);
        assert_eq!(
            blocks.map(|key| editor.state().view().indent(key)),
            expected
        );
    }
    Ok(())
}

#[test]
fn outdent_yields_for_null_and_node_selection() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (block, _) = editor.update(|tx| {
        let block = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[block.key()])?;
        tx.set_indent(block, 2)?;
        tx.set_selection(None)?;
        Ok(block)
    })?;
    for node_selection in [false, true] {
        editor.update(|tx| {
            if node_selection {
                let mut selection = NodeSelection::new();
                selection.add(block);
                tx.set_selection(Some(Selection::Node(selection)))?;
            }
            Ok(())
        })?;
        let before = editor.state().to_json()?;
        let (handled, commit) = editor.dispatch(&Command::OutdentContent)?;
        assert_eq!(handled, Handled::No);
        assert!(!commit.default_prevented);
        assert_eq!(editor.state().to_json()?, before);
    }
    Ok(())
}

#[test]
fn ordinary_outdent_reduces_heading_and_quote_indentation() -> Result<(), Error> {
    for heading in [false, true] {
        let mut editor = crate::surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .build()
        .expect("surface");
        let (block, _) = editor.update(|tx| {
            let block = if heading {
                tx.create(HeadingNode::default())?.key()
            } else {
                tx.create(QuoteNode {})?.key()
            };
            let text = tx.create_text("keep")?;
            tx.append(block, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[block])?;
            tx.set_indent(block, 2)?;
            tx.select_start(text)?;
            Ok(block)
        })?;
        let (handled, commit) = editor.dispatch(&Command::OutdentContent)?;
        assert_eq!(handled, Handled::Yes);
        assert!(!commit.default_prevented);
        assert_eq!(editor.state().view().indent(block), 1);
        assert_eq!(editor.state().view().text_content(block), "keep");
    }
    Ok(())
}

#[test]
fn right_arrow_escapes_inline_code_and_inserts_a_trailing_space() -> Result<(), Error> {
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .build()
        .expect("keyboard fixture");
    let (code, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let code = tx.create_text("code")?;
        tx.text(code)?.set_format(TextFormat::CODE)?;
        tx.append(paragraph, &[code.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(code, Utf16Offset(4)));
        range.format = TextFormat::CODE;
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(code)
    })?;
    let (handled, commit) = editor.dispatch(&Command::Key {
        command: KeyCommand::ArrowRight,
        event: Some(KeyEvent {
            key: "ArrowRight".into(),
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let view = editor.state().view();
    assert_eq!(view.text_content(NodeKey::ROOT), "code ");
    assert_eq!(view.text(code).expect("code").format, TextFormat::CODE);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(range.is_collapsed());
    assert_eq!(range.anchor.offset(), 1);
    assert!(!range.has_format(TextFormatType::Code));
    let selected = view.text(range.anchor.key()).expect("selected plain text");
    assert_eq!(selected.text.as_str(), " ");
    assert_eq!(selected.format, TextFormat::empty());
    assert_eq!(selected.style.as_ref(), "");
    Ok(())
}

#[test]
fn right_arrow_escapes_inline_code_and_reuses_a_trailing_space() -> Result<(), Error> {
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .build()
        .expect("keyboard fixture");
    let (code, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let code = tx.create_text("code")?;
        tx.text(code)?.set_format(TextFormat::CODE)?;
        tx.append(paragraph, &[code.key()])?;
        let right = tx.create_text(" ")?;
        tx.append(paragraph, &[right.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(code, Utf16Offset(4)));
        range.format = TextFormat::CODE;
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(code)
    })?;
    let (handled, commit) = editor.dispatch(&Command::Key {
        command: KeyCommand::ArrowRight,
        event: Some(KeyEvent {
            key: "ArrowRight".into(),
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let view = editor.state().view();
    assert_eq!(view.text_content(NodeKey::ROOT), "code ");
    assert_eq!(view.text(code).expect("code").format, TextFormat::CODE);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(range.is_collapsed());
    assert_eq!(range.anchor.offset(), 1);
    assert!(!range.has_format(TextFormatType::Code));
    let selected = view.text(range.anchor.key()).expect("selected plain text");
    assert_eq!(selected.text.as_str(), " ");
    assert_eq!(selected.format, TextFormat::empty());
    assert_eq!(selected.style.as_ref(), "");
    Ok(())
}

#[test]
fn right_arrow_inserts_space_at_start_of_text_after_inline_code() -> Result<(), Error> {
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .build()
        .expect("keyboard fixture");
    let (code, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let code = tx.create_text("code")?;
        tx.text(code)?.set_format(TextFormat::CODE)?;
        tx.append(paragraph, &[code.key()])?;
        let right = tx.create_text("after")?;
        tx.append(paragraph, &[right.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(right, Utf16Offset(0)));
        range.format = TextFormat::empty();
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(code)
    })?;
    let (handled, commit) = editor.dispatch(&Command::Key {
        command: KeyCommand::ArrowRight,
        event: Some(KeyEvent {
            key: "ArrowRight".into(),
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let view = editor.state().view();
    assert_eq!(view.text_content(NodeKey::ROOT), "code after");
    assert_eq!(view.text(code).expect("code").format, TextFormat::CODE);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(range.is_collapsed());
    assert_eq!(range.anchor.offset(), 1);
    assert!(!range.has_format(TextFormatType::Code));
    let selected = view.text(range.anchor.key()).expect("selected plain text");
    assert_eq!(selected.text.as_str(), " after");
    assert_eq!(selected.format, TextFormat::empty());
    assert_eq!(selected.style.as_ref(), "");
    Ok(())
}

#[test]
fn right_arrow_reuses_space_from_element_boundary_after_inline_code() -> Result<(), Error> {
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .build()
        .expect("keyboard fixture");
    let (code, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let code = tx.create_text("code")?;
        tx.text(code)?.set_format(TextFormat::CODE)?;
        tx.append(paragraph, &[code.key()])?;
        let right = tx.create_text(" ")?;
        tx.append(paragraph, &[right.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::element(paragraph, ChildIndex(1)));
        range.format = TextFormat::empty();
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(code)
    })?;
    let (handled, commit) = editor.dispatch(&Command::Key {
        command: KeyCommand::ArrowRight,
        event: Some(KeyEvent {
            key: "ArrowRight".into(),
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let view = editor.state().view();
    assert_eq!(view.text_content(NodeKey::ROOT), "code ");
    assert_eq!(view.text(code).expect("code").format, TextFormat::CODE);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(range.is_collapsed());
    assert_eq!(range.anchor.offset(), 1);
    assert!(!range.has_format(TextFormatType::Code));
    let selected = view.text(range.anchor.key()).expect("selected plain text");
    assert_eq!(selected.text.as_str(), " ");
    assert_eq!(selected.format, TextFormat::empty());
    assert_eq!(selected.style.as_ref(), "");
    Ok(())
}

#[test]
fn right_arrow_escapes_raw_inline_code_when_selection_format_is_clear() -> Result<(), Error> {
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .build()
        .expect("keyboard fixture");
    let (code, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let code = tx.create_text("code")?;
        tx.text(code)?.set_format(TextFormat::CODE)?;
        tx.append(paragraph, &[code.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(code, Utf16Offset(4)));
        range.format = TextFormat::empty();
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(code)
    })?;
    let (handled, commit) = editor.dispatch(&Command::Key {
        command: KeyCommand::ArrowRight,
        event: Some(KeyEvent {
            key: "ArrowRight".into(),
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let view = editor.state().view();
    assert_eq!(view.text_content(NodeKey::ROOT), "code ");
    assert_eq!(view.text(code).expect("code").format, TextFormat::CODE);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(range.is_collapsed());
    assert_eq!(range.anchor.offset(), 1);
    assert!(!range.has_format(TextFormatType::Code));
    let selected = view.text(range.anchor.key()).expect("selected plain text");
    assert_eq!(selected.text.as_str(), " ");
    assert_eq!(selected.format, TextFormat::empty());
    assert_eq!(selected.style.as_ref(), "");
    Ok(())
}

#[test]
fn right_arrow_preserves_other_typing_formats_and_style() -> Result<(), Error> {
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .build()
        .expect("keyboard fixture");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let text = tx.create_text("code")?;
        tx.text(text)?.set_format(TextFormat::CODE)?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(4)));
        range.format = TextFormat::CODE
            | TextFormat::HIGHLIGHT
            | TextFormat::STRIKETHROUGH
            | TextFormat::BOLD
            | TextFormat::ITALIC;
        range.style = "color: red;".into();
        tx.set_selection(Some(Selection::Range(range)))
    })?;
    let (handled, commit) = editor.dispatch(&Command::Key {
        command: KeyCommand::ArrowRight,
        event: Some(KeyEvent {
            key: "ArrowRight".into(),
            shift: true,
            ctrl: true,
            meta: true,
            alt: true,
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.default_prevented);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.format, TextFormat::BOLD | TextFormat::ITALIC);
    assert_eq!(range.style.as_ref(), "color: red;");
    let view = editor.state().view();
    let space = view.text(range.anchor.key()).expect("space");
    assert_eq!(space.text.as_str(), " ");
    assert_eq!(space.format, TextFormat::empty());
    assert_eq!(space.style.as_ref(), "");
    Ok(())
}

#[test]
fn right_arrow_yields_without_a_collapsed_escape_boundary() -> Result<(), Error> {
    for scenario in 0..5 {
        let mut editor = register(Editor::builder(EditorMode::ViewAttached))
            .build()
            .expect("keyboard fixture");
        editor.update(|tx| {
            let paragraph = tx.create(Paragraph {})?;
            let text = tx.create_text("code")?;
            tx.text(text)?.set_format(TextFormat::CODE)?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(2)));
            range.format = TextFormat::CODE;
            let selection = match scenario {
                0 => None,
                1 => {
                    let mut nodes = NodeSelection::new();
                    nodes.add(paragraph);
                    Some(Selection::Node(nodes))
                }
                2 => {
                    range.anchor = Point::text(text, Utf16Offset(0));
                    Some(Selection::Range(range))
                }
                3 => Some(Selection::Range(range)),
                _ => {
                    tx.text(text)?.set_format(TextFormat::empty())?;
                    range.anchor = Point::text(text, Utf16Offset(4));
                    range.focus = range.anchor;
                    range.format = TextFormat::empty();
                    Some(Selection::Range(range))
                }
            };
            tx.set_selection(selection)
        })?;
        let before = editor.state().to_json()?;
        let selection = editor.state().selection().cloned();
        let (handled, commit) = editor.dispatch(&Command::Key {
            command: KeyCommand::ArrowRight,
            event: Some(KeyEvent {
                key: "ArrowRight".into(),
                ..KeyEvent::default()
            }),
        })?;
        assert_eq!(handled, Handled::No, "scenario {scenario}");
        assert!(!commit.default_prevented, "scenario {scenario}");
        assert_eq!(editor.state().to_json()?, before, "scenario {scenario}");
        assert_eq!(
            editor.state().selection(),
            selection.as_ref(),
            "scenario {scenario}"
        );
    }
    Ok(())
}
