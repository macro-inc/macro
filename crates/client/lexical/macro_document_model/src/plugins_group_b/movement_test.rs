use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::{
    code::CodeNode,
    list::{ListItemNode, ListNode, ListType},
};
use serde_json::json;

#[test]
fn gap_insertion_rechecks_neighbor_keys_and_adds_one_undoable_caret_block() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((first, second), _) = editor.update(|tx| {
        let first = tx.create(CodeNode::default())?;
        let second = tx.create(CodeNode::default())?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        Ok((first.key(), second.key()))
    })?;
    let command = decode_command(
        "group-b.move",
        &json!({"action":"gap","previous":first.index(),"next":second.index()}).to_string(),
        first.generation(),
        None,
    )?
    .expect("command");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::HistoryPush));
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 4);
    assert!(state.is::<Paragraph>(*blocks.get(1).expect("gap")));
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret")
            .anchor
            .key(),
        *blocks.get(1).expect("gap")
    );
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().view().children_keys(NodeKey::ROOT)?.len(), 4);
    Ok(())
}

#[test]
fn same_list_reorder_keeps_nested_wrappers_attached_and_rejects_its_own_group() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((list, a, wrapper, b, c), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let a = tx.create(ListItemNode::default())?;
        let b = tx.create(ListItemNode::default())?;
        let c = tx.create(ListItemNode::default())?;
        let nested = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let wrapper = tx.create(ListItemNode::default())?;
        let child = tx.create(ListItemNode::default())?;
        let ta = tx.create_text("A")?;
        let tb = tx.create_text("B")?;
        let tc = tx.create_text("C")?;
        let tn = tx.create_text("nested")?;
        tx.append(a, &[ta.key()])?;
        tx.append(b, &[tb.key()])?;
        tx.append(c, &[tc.key()])?;
        tx.append(child, &[tn.key()])?;
        tx.append(nested, &[child.key()])?;
        tx.append(wrapper, &[nested.key()])?;
        tx.append(list, &[a.key(), wrapper.key(), b.key(), c.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok((list.key(), a.key(), wrapper.key(), b.key(), c.key()))
    })?;
    let noop = decode_command(
        "group-b.move",
        &json!({"action":"move","source":a.index(),"target":wrapper.index(),"before":false})
            .to_string(),
        a.generation(),
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&noop)?.0, Handled::No);
    let command = decode_command(
        "group-b.move",
        &json!({"action":"move","source":a.index(),"target":b.index(),"before":false}).to_string(),
        a.generation(),
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert_eq!(
        editor.state().view().children_keys(list)?,
        vec![b, a, wrapper, c]
    );
    assert_eq!(editor.state().view().text_content(wrapper), "nested");
    Ok(())
}

#[test]
fn swipe_moves_nested_children_with_the_item_and_restores_them_when_outdenting() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((list, a, b, wrapper, c), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let a = tx.create(ListItemNode::default())?;
        let b = tx.create(ListItemNode::default())?;
        let c = tx.create(ListItemNode::default())?;
        let nested = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let child = tx.create(ListItemNode::default())?;
        let wrapper = tx.create(ListItemNode::default())?;
        for (item, label) in [(a, "A"), (b, "B"), (c, "C"), (child, "nested")] {
            let text = tx.create_text(label)?;
            tx.append(item, &[text.key()])?;
        }
        tx.append(nested, &[child.key()])?;
        tx.append(wrapper, &[nested.key()])?;
        tx.append(list, &[a.key(), b.key(), wrapper.key(), c.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok((list.key(), a.key(), b.key(), wrapper.key(), c.key()))
    })?;
    let command = decode_command(
        "group-b.move",
        &json!({"action":"swipe","key":b.index(),"outdent":false}).to_string(),
        b.generation(),
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let state = editor.state().view();
    assert_eq!(state.indent(b), 1);
    assert_eq!(state.next_sibling(b), Some(wrapper));
    assert_eq!(state.text_content(wrapper), "nested");
    let command = decode_command(
        "group-b.move",
        &json!({"action":"swipe","key":b.index(),"outdent":true}).to_string(),
        b.generation(),
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert_eq!(
        editor.state().view().children_keys(list)?,
        vec![a, b, wrapper, c]
    );
    assert_eq!(editor.state().view().indent(b), 0);
    Ok(())
}

#[test]
fn drop_insertion_and_paste_share_one_transaction_and_reject_retired_keys() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((a, b), _) = editor.update(|tx| {
        let a = tx.create(Paragraph::default())?;
        let b = tx.create(Paragraph::default())?;
        let first = tx.create_text("first")?;
        let second = tx.create_text("second")?;
        tx.append(a, &[first.key()])?;
        tx.append(b, &[second.key()])?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
        tx.select_start(a)?;
        Ok((a.key(), b.key()))
    })?;
    let mut payload = ClipboardPayload::default();
    payload.data.insert("text/plain".into(), " **bold**".into());
    payload.data.insert(
        "application/x-macro-drop".into(),
        json!({"key":b.index(),"generation":b.generation(),"before":false}).to_string(),
    );
    editor.dispatch(&Command::Paste(payload.clone()))?;
    assert_eq!(editor.state().view().text_content(a), "first");
    assert_eq!(editor.state().view().text_content(b), "second bold");
    assert!(editor.state().view().all_text_nodes(b).any(|key| {
        editor
            .state()
            .view()
            .text(key)
            .is_some_and(|text| text.format.contains(TextFormat::BOLD))
    }));
    let before = editor.state().to_json()?;
    payload.data.insert(
        "application/x-macro-drop".into(),
        json!({"key":b.index(),"generation":b.generation()+1,"before":false}).to_string(),
    );
    editor.dispatch(&Command::Paste(payload))?;
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}
