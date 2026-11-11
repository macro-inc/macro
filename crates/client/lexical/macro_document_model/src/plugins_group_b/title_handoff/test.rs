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

fn remove(editor: &mut Editor, key: NodeKey) -> Result<Commit, Error> {
    let command = surface::decode_command(
        "group-b.remove-leading-empty-paragraph",
        &serde_json::json!({ "key": key.parts().index }).to_string(),
        key.parts().generation,
        None,
    )?
    .expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    Ok(commit)
}

#[test]
fn remove_captured_paragraph_removes_it_outside_history() -> Result<(), Error> {
    let mut editor = editor();
    let ((empty, second), _) = editor.update(|tx| {
        let empty = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("Second body line")?;
        tx.append(second, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[empty.key(), second.key()])?;
        Ok((empty.key(), second.key()))
    })?;
    let commit = remove(&mut editor, empty)?;
    assert!(commit.tags.contains(&UpdateTag::Historic));
    assert_eq!(
        commit.next.view().children_keys(NodeKey::ROOT)?,
        vec![second]
    );
    Ok(())
}

/// Source captures the key at keydown and removes that node in a microtask
/// without revalidating: a paragraph that gained text or moved still goes,
/// and a newly leading paragraph stays.
#[test]
fn remove_captured_paragraph_targets_the_captured_key_after_a_race() -> Result<(), Error> {
    let mut editor = editor();
    let ((captured, other), _) = editor.update(|tx| {
        let captured = tx.create(Paragraph::default())?;
        let other = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[captured.key(), other.key()])?;
        Ok((captured.key(), other.key()))
    })?;
    let (leader, _) = editor.update(|tx| {
        let leaf = tx.create_text("typed meanwhile")?;
        tx.append(captured, &[leaf.key()])?;
        let leader = tx.create(Paragraph::default())?;
        tx.insert_before(captured, leader, false)?;
        Ok(leader.key())
    })?;
    let commit = remove(&mut editor, captured)?;
    assert_eq!(
        commit.next.view().children_keys(NodeKey::ROOT)?,
        vec![leader, other]
    );
    Ok(())
}

#[test]
fn remove_captured_paragraph_ignores_a_node_that_is_gone() -> Result<(), Error> {
    let mut editor = editor();
    let ((captured, _), _) = editor.update(|tx| {
        let captured = tx.create(Paragraph::default())?;
        let other = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[captured.key(), other.key()])?;
        Ok((captured.key(), other.key()))
    })?;
    editor.update(|tx| tx.remove(captured, false))?;
    let before = editor.state().to_json()?;
    let commit = remove(&mut editor, captured)?;
    assert!(commit.tags.contains(&UpdateTag::Historic));
    assert!(commit.changes.mutations.is_empty());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn title_handoff_rejects_unexpected_payloads() {
    for name in ["group-b.focus-start", "group-b.prepend-paragraph"] {
        assert!(decode(name, r#"{"key":1}"#, 0).is_err());
        assert!(decode(name, "null", 0).is_err());
        assert!(decode(name, "[]", 0).is_err());
    }
    let remove = "group-b.remove-leading-empty-paragraph";
    assert!(decode(remove, "{}", 0).is_err());
    assert!(decode(remove, "[1]", 0).is_err());
    assert!(decode(remove, r#"{"key":"1"}"#, 0).is_err());
    assert!(decode(remove, r#"{"key":1,"extra":0}"#, 0).is_err());
    assert!(decode("other.action", "{}", 0).expect("unknown").is_none());
}
