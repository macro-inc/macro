use super::*;
use crate::hashtag::HashtagNode;
#[test]
fn forward_transform_copies_format_but_not_style_or_detail() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("a #hello tail")?;
    tx.text(text)?
        .set_format(TextFormat::BOLD)?
        .set_style("color: red")?
        .set_detail(TextDetail::UNMERGEABLE)?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, text)?;
    let children = tx.children_keys(p)?;
    assert_eq!(children.len(), 3);
    assert_eq!(tx.text_content(children[0]), "a ");
    assert_eq!(tx.text_content(children[1]), "#hello");
    assert_eq!(tx.text_content(children[2]), " tail");
    assert!(tx.is::<HashtagNode>(children[1]));
    assert_eq!(tx.text_data(children[1])?.format, TextFormat::BOLD);
    assert_eq!(tx.text_data(children[1])?.style.as_ref(), "");
    assert_eq!(tx.text_data(children[1])?.detail, TextDetail::empty());
    Ok(())
}
#[test]
fn extending_previous_entity_selects_it_and_consumes_prefix() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let entity = tx.create(HashtagNode {})?;
    tx.text(entity)?.set_text_content("#hello")?;
    let text = tx.create_text("world tail")?;
    tx.append(p, &[entity.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, text)?;
    assert_eq!(tx.text_content(entity), "#helloworld");
    assert_eq!(tx.text_content(text), " tail");
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(entity, Utf16Offset(6))
    );
    Ok(())
}
#[test]
fn extending_entity_consumes_whole_following_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let entity = tx.create(HashtagNode {})?;
    tx.text(entity)?.set_text_content("#a")?;
    let text = tx.create_text("b")?;
    tx.append(p, &[entity.key(), text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, text)?;
    assert_eq!(tx.text_content(entity), "#ab");
    assert_eq!(tx.children_keys(p)?, vec![entity.key()]);
    Ok(())
}
#[test]
fn reverse_invalid_entity_drops_style_and_detail_and_preserves_format() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let entity = tx.create(HashtagNode {})?;
    tx.text(entity)?
        .set_text_content("invalid")?
        .set_format(TextFormat::ITALIC)?
        .set_style("color: red")?
        .set_detail(TextDetail::UNMERGEABLE)?;
    tx.append(p, &[entity.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    text_entity_reverse_transform::<HashtagNode>(&mut tx, entity)?;
    let text = tx.first_child(p).unwrap();
    assert!(tx.is_simple_text(text));
    assert_eq!(tx.text_content(text), "invalid");
    assert_eq!(tx.text_data(text)?.format, TextFormat::ITALIC);
    assert_eq!(tx.text_data(text)?.style.as_ref(), "");
    assert_eq!(tx.text_data(text)?.detail, TextDetail::empty());
    Ok(())
}
#[test]
fn reverse_valid_prefix_keeps_entity_and_splits_remainder_into_plain_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let entity = tx.create(HashtagNode {})?;
    tx.text(entity)?.set_text_content("#yes tail")?;
    tx.append(p, &[entity.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    text_entity_reverse_transform::<HashtagNode>(&mut tx, entity)?;
    assert_eq!(tx.text_content(entity), "#yes");
    let rest = tx.next_sibling(entity).unwrap();
    assert!(tx.is_simple_text(rest));
    assert_eq!(tx.text_content(rest), " tail");
    Ok(())
}
#[test]
fn reverse_adjacent_entities_both_become_simple_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let a = tx.create(HashtagNode {})?;
    let b = tx.create(HashtagNode {})?;
    tx.text(a)?.set_text_content("#a")?;
    tx.text(b)?.set_text_content("#b")?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    text_entity_reverse_transform::<HashtagNode>(&mut tx, b)?;
    let children = tx.children_keys(p)?;
    assert_eq!(children.len(), 2);
    assert!(tx.is_simple_text(children[0]));
    assert!(tx.is_simple_text(children[1]));
    assert_eq!(tx.text_content(p), "#a#b");
    Ok(())
}
#[test]
fn forward_ignores_token_mode() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("#tag")?;
    tx.text(t)?.set_mode(TextMode::Token)?;
    tx.append(p, &[t.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, t)?;
    assert_eq!(tx.first_child(p), Some(t.key()));
    assert!(tx.is::<Text>(t));
    Ok(())
}
#[test]
fn invalid_previous_entity_is_downgraded_before_scanning_current_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let previous = tx.create(HashtagNode {})?;
    tx.text(previous)?.set_text_content("#123")?;
    let current = tx.create_text(" tail")?;
    tx.append(p, &[previous.key(), current.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, current)?;
    let first = tx.first_child(p).unwrap();
    assert!(tx.is_simple_text(first));
    assert_eq!(tx.text_content(first), "#123");
    assert_eq!(tx.next_sibling(first), Some(current.key()));
    Ok(())
}
#[test]
fn nonnormal_previous_entity_is_downgraded_even_when_combined_text_matches() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let previous = tx.create(HashtagNode {})?;
    tx.text(previous)?
        .set_text_content("#a")?
        .set_mode(TextMode::Token)?;
    let current = tx.create_text("b")?;
    tx.append(p, &[previous.key(), current.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, current)?;
    let first = tx.first_child(p).unwrap();
    assert!(tx.is_simple_text(first));
    assert_eq!(tx.text_content(first), "#a");
    assert_eq!(tx.text_content(current), "b");
    Ok(())
}
#[test]
fn match_starting_in_previous_plain_sibling_is_not_split_from_current_node() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let previous = tx.create_text("#he")?;
    let current = tx.create_text("llo")?;
    tx.append(p, &[previous.key(), current.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, current)?;
    assert_eq!(tx.children_keys(p)?, vec![previous.key(), current.key()]);
    assert!(tx.is_simple_text(current));
    Ok(())
}
#[test]
fn next_entity_is_downgraded_when_combined_boundary_has_no_match() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let current = tx.create_text("plain")?;
    let next = tx.create(HashtagNode {})?;
    tx.text(next)?.set_text_content("#tag")?;
    tx.append(p, &[current.key(), next.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, current)?;
    let replacement = tx.next_sibling(current).unwrap();
    assert!(tx.is_simple_text(replacement));
    assert_eq!(tx.text_content(replacement), "#tag");
    Ok(())
}
#[test]
fn next_plain_sibling_is_marked_dirty_when_combined_boundary_has_no_match() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let ((current, next), _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let current = tx.create_text("plain")?;
        let next = tx.create_text("rest")?;
        tx.text(next)?.set_format(TextFormat::BOLD)?;
        tx.append(p, &[current.key(), next.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((current, next))
    })?;
    let mut tx = editor.transaction();
    assert!(!tx.is_dirty_leaf(next));
    text_entity_text_transform::<HashtagNode>(&mut tx, current)?;
    assert!(tx.is_dirty_leaf(next));
    Ok(())
}
#[test]
fn match_adjacent_to_previous_entity_is_skipped_before_later_match() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let previous = tx.create(HashtagNode {})?;
    tx.text(previous)?.set_text_content("#a")?;
    let current = tx.create_text("#b #c")?;
    tx.append(p, &[previous.key(), current.key()])?;
    text_entity_text_transform::<HashtagNode>(&mut tx, current)?;
    let children = tx.children_keys(p)?;
    assert_eq!(children.len(), 3);
    assert_eq!(children[0], previous.key());
    assert_eq!(tx.text_content(children[1]), "#b ");
    assert!(tx.is_simple_text(children[1]));
    assert_eq!(tx.text_content(children[2]), "#c");
    assert!(tx.is::<HashtagNode>(children[2]));
    Ok(())
}
#[test]
fn reverse_next_entity_downgrades_next_and_current() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let a = tx.create(HashtagNode {})?;
    let b = tx.create(HashtagNode {})?;
    tx.text(a)?.set_text_content("#a")?;
    tx.text(b)?.set_text_content("#b")?;
    tx.append(p, &[a.key(), b.key()])?;
    text_entity_reverse_transform::<HashtagNode>(&mut tx, a)?;
    let children = tx.children_keys(p)?;
    assert!(tx.is_simple_text(children[0]));
    assert!(tx.is_simple_text(children[1]));
    assert_eq!(tx.text_content(p), "#a#b");
    Ok(())
}
