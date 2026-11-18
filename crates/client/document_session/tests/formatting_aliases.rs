#![cfg(feature = "application")]

use document_session::register_editor_commands;
use lexical_model::*;
use lexical_rich_nodes::link::{LinkAttributes, LinkNode, create_link_node};
use macro_document_model::{EditorType, surface};

#[test]
fn named_code_format_runs_existing_link_policy_and_core_formatting() -> Result<(), Error> {
    let mut editor = register_editor_commands(surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .build()
    .expect("actual surface registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "https://example.com", LinkAttributes::default())?;
        let label = tx.create_text("label")?;
        let tail = tx.create_text(" tail")?;
        tx.append(link, &[label.key()])?;
        tx.append(paragraph, &[link.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(label, Utf16Offset(0)));
        range.focus = Point::text(label, Utf16Offset(5));
        tx.set_selection(Some(Selection::Range(range)))
    })?;
    let command = surface::decode_command(
        "group-b.format-text",
        r#""code""#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("known formatting alias");
    assert!(matches!(
        &command,
        Command::FormatText(TextFormatType::Code)
    ));
    let (handled, _) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let view = editor.state().view();
    assert_eq!(view.text_content(NodeKey::ROOT), "label tail");
    assert!(view.nodes_of_type::<LinkNode>().is_empty());
    let selected = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("actual range");
    assert_eq!(selected.text_content(view)?, "label");
    assert!(selected.format.contains(TextFormat::CODE));
    Ok(())
}

#[test]
fn named_element_format_preserves_backward_range_and_formats_both_blocks() -> Result<(), Error> {
    let mut editor = register_editor_commands(surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .build()
    .expect("actual surface registry");
    let ((first, second, anchor, focus), _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let a = tx.create_text("first")?;
        let b = tx.create_text("second")?;
        tx.append(first, &[a.key()])?;
        tx.append(second, &[b.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        let anchor = Point::text(b, Utf16Offset(6));
        let focus = Point::text(a, Utf16Offset(0));
        let mut range = RangeSelection::collapsed(anchor);
        range.focus = focus;
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok((first.key(), second.key(), anchor, focus))
    })?;
    let command = surface::decode_command(
        "group-b.format-element",
        r#""center""#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("known formatting alias");
    let (handled, _) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let view = editor.state().view();
    assert_eq!(view.element_data(first)?.format, ElementFormat::Center);
    assert_eq!(view.element_data(second)?.format, ElementFormat::Center);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("actual range");
    assert_eq!(range.anchor, anchor);
    assert_eq!(range.focus, focus);
    assert!(range.is_backward(view)?);
    Ok(())
}
