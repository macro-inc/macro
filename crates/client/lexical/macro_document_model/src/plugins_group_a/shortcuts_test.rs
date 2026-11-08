use crate::EditorType;
use lexical_model::*;
use lexical_rich_nodes::{
    heading::HeadingNode,
    list::{ListNode, ListType},
};

#[test]
fn typed_heading_and_inline_format_shortcuts_publish_in_the_original_input_chain()
-> Result<(), Error> {
    for (input, heading) in [("# ", true), ("**bold**", false)] {
        let mut editor = crate::surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .build()
        .expect("surface");
        editor.update(|tx| {
            tx.clear(NodeKey::ROOT)?;
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(p)
        })?;
        let mut last = None;
        for ch in input.chars() {
            let (_, commit) = editor.update(|tx| tx.insert_text(&ch.to_string()))?;
            assert!(
                commit.follow_up_error.is_none(),
                "{:?}",
                commit.follow_up_error
            );
            last = Some(commit);
        }
        let commit = last.expect("typing commit");
        assert!(
            commit
                .chain()
                .any(|entry| entry.tags.contains(&UpdateTag::HistoryPush))
        );
        if heading {
            let first = editor
                .state()
                .view()
                .first_child(NodeKey::ROOT)
                .expect("heading");
            assert!(editor.state().view().is::<HeadingNode>(first));
            assert_eq!(editor.state().root_text_content().as_ref(), "");
        } else {
            assert_eq!(editor.state().root_text_content().as_ref(), "bold");
            let key = editor
                .state()
                .view()
                .first_descendant(NodeKey::ROOT)
                .expect("text");
            assert!(
                editor
                    .state()
                    .view()
                    .text_data(key)?
                    .format
                    .contains(TextFormat::BOLD)
            );
        }
    }
    Ok(())
}
#[test]
fn macro_numbered_list_enter_precedes_normalize_enter_and_preserves_the_start() -> Result<(), Error>
{
    let mut editor = crate::surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    editor.update(|tx| {
        tx.clear(NodeKey::ROOT)?;
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("6.")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)
    })?;
    let (handled, _) = editor.dispatch(&Command::Key {
        command: KeyCommand::Enter,
        event: Some(KeyEvent {
            key: "Enter".into(),
            ..Default::default()
        }),
    })?;
    assert_eq!(handled, Handled::Yes);
    let first = editor
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("list");
    let list = editor
        .state()
        .view()
        .get::<ListNode>(first)
        .expect("list payload");
    assert_eq!(list.list_type(), ListType::Number);
    assert_eq!(list.start(), 6);
    Ok(())
}

#[test]
fn macro_enter_matches_interior_and_expanded_markers_but_requires_a_paragraph() -> Result<(), Error>
{
    for (anchor, focus, heading) in [
        (0, 0, false),
        (1, 1, false),
        (0, 2, false),
        (2, 0, false),
        (2, 2, true),
    ] {
        let mut editor = crate::surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .build()
        .expect("surface");
        editor.update(|tx| {
            tx.clear(NodeKey::ROOT)?;
            let p = if heading {
                tx.create(HeadingNode {
                    tag: lexical_rich_nodes::heading::HeadingTagType::H2,
                })?
                .key()
            } else {
                tx.create(Paragraph::default())?.key()
            };
            let text = tx.create_text("6.")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::new(
                Point::text(text, Utf16Offset(anchor)),
                Point::text(text, Utf16Offset(focus)),
            ))))
        })?;
        editor.dispatch(&Command::Key {
            command: KeyCommand::Enter,
            event: Some(KeyEvent {
                key: "Enter".into(),
                ..Default::default()
            }),
        })?;
        let first = editor
            .state()
            .view()
            .first_child(NodeKey::ROOT)
            .expect("first block");
        if heading {
            assert!(editor.state().view().is::<HeadingNode>(first));
        } else {
            assert_eq!(
                editor
                    .state()
                    .view()
                    .get::<ListNode>(first)
                    .expect("numbered list")
                    .start(),
                6
            );
        }
    }
    Ok(())
}
