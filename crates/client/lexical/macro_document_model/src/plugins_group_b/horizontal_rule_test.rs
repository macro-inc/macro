//! Native controls for the Source horizontalRulePlugin and list insertion helper.
use super::*;
use crate::{EditorType, nodes::HorizontalRuleNode, surface};
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};

#[test]
fn divider_keeps_the_only_empty_caret_paragraph() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (paragraph, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(paragraph)?;
        Ok(paragraph.key())
    })?;
    let selection = editor.state().selection().cloned();
    let command = surface::decode_command(
        "group-b.horizontal-rule",
        "{}",
        paragraph.generation(),
        None,
    )?
    .expect("divider command");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let view = commit.next.view();
    let children = view.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert!(view.is::<HorizontalRuleNode>(children[0]));
    assert_eq!(children[1], paragraph);
    assert_eq!(commit.next.selection(), selection.as_ref());
    Ok(())
}

#[test]
fn divider_splits_each_actual_list_without_nesting_the_rule() -> Result<(), Error> {
    for kind in [ListType::Bullet, ListType::Number, ListType::Check] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let (_, _) = editor.update(|tx| {
            let list = tx.create(ListNode::new(kind, 1))?;
            let before = tx.create(ListItemNode::default())?;
            let after = tx.create(ListItemNode::default())?;
            let text = tx.create_text("before")?;
            let suffix = tx.create_text("after")?;
            tx.append(before, &[text.key()])?;
            tx.append(after, &[suffix.key()])?;
            tx.append(list, &[before.key(), after.key()])?;
            tx.append(NodeKey::ROOT, &[list.key()])?;
            tx.select_end(text)?;
            Ok(())
        })?;
        let generation = editor.state().max_key().generation();
        let command = surface::decode_command("group-b.horizontal-rule", "{}", generation, None)?
            .expect("divider command");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        let view = commit.next.view();
        let children = view.children_keys(NodeKey::ROOT)?;
        assert_eq!(children.len(), 3);
        assert_eq!(view.type_name(children[0])?, "task-list");
        assert!(view.is::<HorizontalRuleNode>(children[1]));
        assert_eq!(view.type_name(children[2])?, "task-list");
        assert_eq!(view.text_content(children[0]), "before");
        assert_eq!(view.text_content(children[1]), "\n");
        assert_eq!(view.text_content(children[2]), "after");
        let following_item = view.first_child(children[2]).expect("following item");
        let selection = commit
            .next
            .selection()
            .and_then(Selection::as_range)
            .expect("Source caret");
        assert_eq!(
            selection.anchor,
            Point::element(following_item, ChildIndex(0))
        );
        assert_eq!(selection.focus, selection.anchor);
    }
    Ok(())
}

#[test]
fn divider_without_a_range_still_constructs_detached_but_stale_never_constructs()
-> Result<(), Error> {
    let keys = SharedKeyCounter::new();
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .key_source(KeySource::Shared(keys.clone()))
            .build()
            .expect("surface");
    let generation = editor.state().max_key().generation();
    let stale = surface::decode_command("group-b.horizontal-rule", "{}", generation + 1, None)?
        .expect("stale divider");
    let current = surface::decode_command("group-b.horizontal-rule", "{}", generation, None)?
        .expect("current divider");
    editor.update(|tx| {
        assert!(tx.selection().is_none());
        let before = keys.last_allocated();
        assert_eq!(tx.dispatch(&stale)?, Handled::No);
        assert_eq!(keys.last_allocated(), before);
        assert_eq!(tx.dispatch(&current)?, Handled::Yes);
        let created = keys.last_allocated().expect("actual detached construction");
        assert_ne!(Some(created), before);
        assert!(tx.is::<HorizontalRuleNode>(created));
        assert!(!tx.is_attached(created));
        assert_eq!(tx.children_size(NodeKey::ROOT), 0);
        assert!(tx.selection().is_none());
        Ok(())
    })?;
    assert!(
        surface::decode_command("group-b.horizontal-rule", r#"{"key":1}"#, generation, None)
            .is_err()
    );
    assert!(surface::decode_command("group-b.horizontal-rule", "null", generation, None).is_err());
    assert!(surface::decode_command("group-b.horizontal-rule", "[]", generation, None).is_err());
    Ok(())
}
