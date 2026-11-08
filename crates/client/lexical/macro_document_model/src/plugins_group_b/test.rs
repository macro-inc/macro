use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::{
    code::CodeNode,
    heading::HeadingNode,
    list::{ListItemNode, ListNode, ListType},
};

#[test]
fn backward_block_conversion_includes_the_first_block_without_reversing_selection()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface registry");
    editor.update(|tx| {
        let a = tx.create(Paragraph::default())?;
        let b = tx.create(Paragraph::default())?;
        let c = tx.create(Paragraph::default())?;
        let one = tx.create_text("one")?;
        let two = tx.create_text("two")?;
        tx.append(a, &[one.key()])?;
        tx.append(b, &[two.key()])?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key(), c.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(two, Utf16Offset(3)));
        range.focus = Point::text(one, Utf16Offset(0));
        tx.set_selection(Some(Selection::Range(range)))
    })?;
    let (handled, _) = editor.dispatch(&Command::Extension(ExtensionCommand::new(
        &NODE_TRANSFORM,
        BlockKind::Heading1,
    )))?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let children = state.children_keys(NodeKey::ROOT)?;
    assert!(state.is::<HeadingNode>(children[0]));
    assert!(state.is::<HeadingNode>(children[1]));
    assert!(state.is::<Paragraph>(children[2]));
    assert!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .is_backward(state)?
    );
    Ok(())
}

#[test]
fn delete_at_list_item_start_lifts_the_item_to_a_paragraph() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface registry");
    editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("item")?;
        tx.append(item, &[text.key()])?;
        tx.append(list, &[item.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_start(text)?;
        Ok(())
    })?;
    let (handled, _) = editor.dispatch(&Command::DeleteWord {
        direction: EditDirection::Backward,
        target: ModifyTarget::NoView,
        character_target: ModifyTarget::NoView,
    })?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 1);
    assert!(state.is::<Paragraph>(children[0]));
    assert_eq!(state.text_content(children[0]), "item");
    Ok(())
}

#[test]
fn code_has_one_trailing_caret_paragraph_only_on_the_application_surface() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface registry");
    editor.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(())
    })?;
    let state = editor.state().view();
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert!(state.is::<CodeNode>(children[0]));
    assert!(state.is::<Paragraph>(children[1]));
    assert_eq!(state.text_content(children[1]), "");
    let mut bare =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface registry");
    bare.update(|tx| {
        let code = tx.create(CodeNode::default())?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(())
    })?;
    assert_eq!(bare.state().view().children_keys(NodeKey::ROOT)?.len(), 1);
    Ok(())
}

#[test]
fn title_removes_extra_lines_and_unwraps_nested_paragraph_content() -> Result<(), Error> {
    let mut editor = surface::preset_builder_with_mode(EditorType::Title, EditorMode::ViewAttached)
        .build()
        .expect("surface registry");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let nested = tx.create(Paragraph::default())?;
        let text = tx.create_text("outer")?;
        let inner = tx.create_text("inner")?;
        let line = tx.create(LineBreak::default())?;
        let extra = tx.create(Paragraph::default())?;
        tx.append(nested, &[inner.key()])?;
        tx.append(p, &[text.key(), line.key(), nested.key()])?;
        tx.append(NodeKey::ROOT, &[p.key(), extra.key()])?;
        Ok(())
    })?;
    let state = editor.state().view();
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 1);
    assert_eq!(state.text_content(children[0]), "outerinner");
    assert!(
        state
            .children_keys(children[0])?
            .into_iter()
            .all(|key| state.is_text(key))
    );
    Ok(())
}

#[test]
fn enter_splits_heading_into_a_paragraph_and_preserves_the_suffix() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let heading = tx.create(HeadingNode::default())?;
        let text = tx.create_text("beforeafter")?;
        tx.append(heading, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[heading.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text, Utf16Offset(6)),
        ))))
    })?;
    let (handled, _) = editor.dispatch(&Command::Key {
        command: KeyCommand::Enter,
        event: Some(KeyEvent {
            key: "Enter".into(),
            ..KeyEvent::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 2);
    assert!(state.is::<HeadingNode>(blocks[0]));
    assert!(state.is::<Paragraph>(blocks[1]));
    assert_eq!(state.text_content(blocks[0]), "before");
    assert_eq!(state.text_content(blocks[1]), "after");
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor.offset(), 0);
    assert_eq!(
        state.top_level_element(range.anchor.key())?,
        Some(blocks[1])
    );
    Ok(())
}

#[test]
fn enter_at_heading_start_keeps_the_heading_and_caret_below_a_new_paragraph() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (text, _) = editor.update(|tx| {
        let heading = tx.create(HeadingNode::default())?;
        let text = tx.create_text("heading")?;
        tx.append(heading, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[heading.key()])?;
        tx.select_start(text)?;
        Ok(text.key())
    })?;
    editor.dispatch(&Command::Key {
        command: KeyCommand::Enter,
        event: Some(KeyEvent {
            key: "Enter".into(),
            ..KeyEvent::default()
        }),
    })?;
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 2);
    assert!(state.is::<Paragraph>(blocks[0]));
    assert!(state.is::<HeadingNode>(blocks[1]));
    assert_eq!(state.text_content(blocks[1]), "heading");
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::text(text, Utf16Offset(0))
    );
    Ok(())
}

#[test]
fn empty_quote_enter_exits_to_paragraph() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let quote = tx.create(lexical_rich_nodes::quote::QuoteNode::default())?;
        tx.append(NodeKey::ROOT, &[quote.key()])?;
        tx.select_start(quote)?;
        Ok(())
    })?;
    editor.dispatch(&Command::Key {
        command: KeyCommand::Enter,
        event: Some(KeyEvent {
            key: "Enter".into(),
            ..KeyEvent::default()
        }),
    })?;
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 1);
    assert!(state.is::<Paragraph>(blocks[0]));
    Ok(())
}

#[test]
fn block_indent_stops_one_level_beyond_previous_sibling() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (second, _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let text = tx.create_text("indent")?;
        tx.append(second, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        tx.select_start(text)?;
        Ok(second.key())
    })?;
    editor.dispatch(&Command::IndentContent)?;
    editor.dispatch(&Command::IndentContent)?;
    assert_eq!(editor.state().view().indent(second), 1);
    Ok(())
}

#[test]
fn document_version_upgrade_preserves_other_root_state_and_environment_tags() -> Result<(), Error> {
    use serde_json::json;
    use std::sync::Arc;
    static OTHER: StateKey<String> = StateKey::new("unrelated", |value| {
        value
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .into()
    });
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        tx.set_state(NodeKey::ROOT, &OTHER, "keep".into())?;
        tx.set_state(
            NodeKey::ROOT,
            &DOCUMENT_METADATA,
            Arc::new(json!({"version": 2, "environmentTags": ["dev"]})),
        )?;
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(())
    })?;
    let state = editor.state().view();
    let metadata = state.get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
    assert_eq!(
        metadata.as_ref(),
        &json!({"version": 10.0, "environmentTags": ["dev"]})
    );
    assert_eq!(state.get_state(NodeKey::ROOT, &OTHER)?, "keep");
    assert!(
        include_str!(
            "../../../../../../apps/web/src/lib/core/component/LexicalMarkdown/version.ts"
        )
        .contains("export const MARKDOWN_VERSION_COUNTER = 10.0;")
    );
    editor.update(|tx| {
        tx.set_state(
            NodeKey::ROOT,
            &DOCUMENT_METADATA,
            Arc::new(json!({"version": 12, "environmentTags": ["future"]})),
        )
    })?;
    assert_eq!(
        editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?
            .get("version"),
        Some(&json!(12))
    );
    Ok(())
}

#[test]
fn diff_delete_at_start_restores_blocks_in_source_order_and_removes_replacement()
-> Result<(), Error> {
    use crate::nodes::{DiffDeleteNode, DiffInsertNode, DiffNode};
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let before = tx.create(Paragraph::default())?;
        let diff = tx.create(DiffNode::default())?;
        let deleted = tx.create(DiffDeleteNode::default())?;
        let inserted = tx.create(DiffInsertNode::default())?;
        let a = tx.create(Paragraph::default())?;
        let b = tx.create(Paragraph::default())?;
        let one = tx.create_text("one")?;
        let two = tx.create_text("two")?;
        tx.append(a, &[one.key()])?;
        tx.append(b, &[two.key()])?;
        tx.append(deleted, &[a.key(), b.key()])?;
        tx.append(diff, &[deleted.key(), inserted.key()])?;
        tx.append(NodeKey::ROOT, &[before.key(), diff.key()])?;
        tx.select_start(one)?;
        Ok(())
    })?;
    let (handled, _) = editor.dispatch(&Command::DeleteCharacter {
        direction: EditDirection::Backward,
        target: ModifyTarget::NoView,
    })?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert!(blocks.iter().all(|key| state.is::<Paragraph>(*key)));
    // Source repeatedly inserts after the same sibling, so two restored blocks reverse.
    assert_eq!(
        blocks
            .iter()
            .map(|key| state.text_content(*key).to_string())
            .collect::<Vec<_>>(),
        ["", "two", "one"]
    );
    assert_eq!(
        state.text_content(
            editor
                .state()
                .selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor
                .key()
        ),
        "one"
    );
    Ok(())
}
