use super::*;
use crate::nodes::HorizontalRuleNode;
use crate::{EditorType, surface};

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .build()
        .expect("surface")
}

#[test]
fn focus_start_keeps_an_empty_root_unchanged() -> Result<(), Error> {
    let mut editor = editor();
    let before = editor.state().to_json()?;
    let command = surface::decode_command("group-b.focus-start", "{}", 0, None)?.expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.is_noop());
    assert_eq!(editor.state().to_json()?, before);
    assert!(editor.state().selection().is_none());
    Ok(())
}

#[test]
fn focus_start_selects_the_start_of_the_first_paragraph() -> Result<(), Error> {
    let mut editor = editor();
    let (leaf, _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("First body line")?;
        tx.append(first, &[leaf.key()])?;
        let second = tx.create(Paragraph::default())?;
        let other = tx.create_text("Second body line")?;
        tx.append(second, &[other.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        tx.select_end(second)?;
        Ok(leaf.key())
    })?;
    let command = surface::decode_command("group-b.focus-start", "{}", 0, None)?.expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let range = commit
        .next
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::text(leaf, Utf16Offset::ZERO));
    assert_eq!(range.focus, Point::text(leaf, Utf16Offset::ZERO));
    Ok(())
}

#[test]
fn focus_start_selects_a_leading_stopping_block_decorator() -> Result<(), Error> {
    let mut editor = editor();
    let (rule, _) = editor.update(|tx| {
        let rule = tx.create(HorizontalRuleNode::default())?;
        let paragraph = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("after")?;
        tx.append(paragraph, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[rule.key(), paragraph.key()])?;
        Ok(rule.key())
    })?;
    let command = surface::decode_command("group-b.focus-start", "{}", 0, None)?.expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let Some(Selection::Node(nodes)) = commit.next.selection() else {
        panic!("node selection");
    };
    assert_eq!(nodes.keys().collect::<Vec<_>>(), vec![rule]);
    Ok(())
}

#[test]
fn prepend_paragraph_inserts_an_empty_paragraph_before_the_first_child() -> Result<(), Error> {
    let mut editor = editor();
    let (original, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("First body line")?;
        tx.append(paragraph, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    let command =
        surface::decode_command("group-b.prepend-paragraph", "{}", 0, None)?.expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let view = commit.next.view();
    let children = view.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert_eq!(children[1], original);
    let prepended = children[0];
    assert_eq!(view.type_name(prepended)?, "paragraph");
    // Source normalization removes the empty text node, leaving an element caret.
    assert_eq!(view.children_size(prepended), 0);
    let range = commit
        .next
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::element(prepended, ChildIndex(0)));
    assert_eq!(range.focus, Point::element(prepended, ChildIndex(0)));
    Ok(())
}

#[test]
fn prepend_paragraph_appends_into_an_empty_root() -> Result<(), Error> {
    let mut editor = editor();
    let command =
        surface::decode_command("group-b.prepend-paragraph", "{}", 0, None)?.expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let view = commit.next.view();
    let children = view.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 1);
    assert_eq!(view.type_name(children[0])?, "paragraph");
    Ok(())
}

#[test]
fn remove_leading_empty_paragraph_removes_it_outside_history() -> Result<(), Error> {
    let mut editor = editor();
    let (second, _) = editor.update(|tx| {
        let empty = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("Second body line")?;
        tx.append(second, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[empty.key(), second.key()])?;
        Ok(second.key())
    })?;
    let command = surface::decode_command("group-b.remove-leading-empty-paragraph", "{}", 0, None)?
        .expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::Historic));
    let view = commit.next.view();
    assert_eq!(view.children_keys(NodeKey::ROOT)?, vec![second]);
    Ok(())
}

#[test]
fn remove_leading_empty_paragraph_keeps_text_indent_and_a_sole_block() -> Result<(), Error> {
    for (text, indent, blocks) in [("x", 0, 2), ("", 1, 2), ("", 0, 1)] {
        let mut editor = editor();
        editor.update(|tx| {
            let first = tx.create(Paragraph::default())?;
            if !text.is_empty() {
                let leaf = tx.create_text(text)?;
                tx.append(first, &[leaf.key()])?;
            }
            tx.set_indent(first, indent)?;
            tx.append(NodeKey::ROOT, &[first.key()])?;
            if blocks == 2 {
                let second = tx.create(Paragraph::default())?;
                tx.append(NodeKey::ROOT, &[second.key()])?;
            }
            Ok(())
        })?;
        let before = editor.state().to_json()?;
        let command =
            surface::decode_command("group-b.remove-leading-empty-paragraph", "{}", 0, None)?
                .expect("action");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        assert!(commit.is_noop(), "{text:?} {indent} {blocks}");
        assert_eq!(editor.state().to_json()?, before);
    }
    Ok(())
}

#[test]
fn title_handoff_rejects_unexpected_payloads() {
    for name in [
        "group-b.focus-start",
        "group-b.prepend-paragraph",
        "group-b.remove-leading-empty-paragraph",
    ] {
        assert!(decode(name, r#"{"key":1}"#).is_err());
        assert!(decode(name, "null").is_err());
        assert!(decode(name, "[]").is_err());
    }
    assert!(decode("other.action", "{}").expect("unknown").is_none());
}
