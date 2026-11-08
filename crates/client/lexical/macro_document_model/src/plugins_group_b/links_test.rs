use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::link::{AutoLinkNode, LinkAttributes, LinkNode, create_link_node};

#[test]
fn email_typing_defers_link_creation_until_the_caret_leaves_the_match() -> Result<(), Error> {
    let email = "user@example.com";
    let incomplete = email
        .strip_suffix('m')
        .expect("incomplete example-domain fixture");
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text(&format!("{incomplete} b"))?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text, Utf16Offset(15)),
        ))))?;
        Ok(text.key())
    })?;
    editor.update(|tx| tx.insert_text("m"))?;
    assert_eq!(
        editor.state().view().text_content(NodeKey::ROOT),
        "user@example.com b"
    );
    assert_eq!(
        editor.state().view().nodes_of_type::<AutoLinkNode>().len(),
        0
    );
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text, Utf16Offset(18)),
        ))))?;
        tx.insert_text("!")
    })?;
    let state = editor.state().view();
    assert_eq!(state.text_content(NodeKey::ROOT), "user@example.com b!");
    let links = state.nodes_of_type::<LinkNode>();
    assert_eq!(links.len(), 1);
    let link = links.first().expect("link");
    assert_eq!(state.text_content(*link), "user@example.com");
    assert_eq!(
        state.get::<LinkNode>(*link).expect("link").url,
        "mailto:user@example.com"
    );
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(state.text_content(range.anchor.key()), " b!");
    assert_eq!(range.anchor.offset(), 3);
    Ok(())
}

#[test]
fn autolink_preserves_utf16_offsets_and_typing_format_after_an_emoji_prefix() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("😀 example.com done")?;
        tx.text(text)?.set_format(TextFormat::BOLD)?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(19)));
        range.format = TextFormat::BOLD;
        tx.set_selection(Some(Selection::Range(range)))
    })?;
    let state = editor.state().view();
    assert_eq!(state.text_content(NodeKey::ROOT), "😀 example.com done");
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.format, TextFormat::BOLD);
    assert_eq!(state.text_content(range.anchor.key()), " done");
    assert_eq!(range.anchor.offset(), 5);
    Ok(())
}

#[test]
fn unlink_keeps_entire_formatted_labels_literal_and_preserves_the_range() -> Result<(), Error> {
    use crate::nodes::UnlinkedTextNode;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "https://example.com", LinkAttributes::default())?;
        let first = tx.create_text("click")?;
        tx.text(first)?.set_format(TextFormat::BOLD)?;
        let last = tx.create_text(" here")?;
        tx.append(link, &[first.key(), last.key()])?;
        tx.append(p, &[link.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(first, Utf16Offset(0)));
        range.focus = Point::text(last, Utf16Offset(5));
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(first.key())
    })?;
    let command = decode_command(
        "group-b.link",
        "{\"action\":\"unlink\"}",
        key.generation(),
        None,
    )?
    .expect("unlink");
    editor.dispatch(&command)?;
    let state = editor.state().view();
    assert_eq!(state.text_content(NodeKey::ROOT), "click here");
    assert!(state.nodes_of_type::<LinkNode>().is_empty());
    let texts: Vec<_> = state.all_text_nodes(NodeKey::ROOT).collect();
    assert_eq!(texts.len(), 2);
    for key in &texts {
        assert!(state.is::<UnlinkedTextNode>(*key));
    }
    assert!(
        state
            .text(*texts.first().expect("first"))
            .expect("text")
            .format
            .contains(TextFormat::BOLD)
    );
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.text_content(state)?, "click here");
    Ok(())
}

#[test]
fn plain_code_text_is_never_autolinked_without_a_model_tokenizer() -> Result<(), Error> {
    use crate::nodes::{create_custom_code_node, set_custom_code};
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("text"))?;
        set_custom_code(tx, code, Some("text"), "https://example.com")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(())
    })?;
    assert!(
        editor
            .state()
            .view()
            .nodes_of_type::<AutoLinkNode>()
            .is_empty()
    );
    assert!(editor.state().view().nodes_of_type::<LinkNode>().is_empty());
    Ok(())
}
