use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::heading::{HeadingNode, HeadingTagType};

#[test]
fn exterior_focus_keeps_an_empty_root_unchanged() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let before = editor.state().to_json()?;
    let command = surface::decode_command("group-b.focus-end", "{}", 0, None)?.expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.is_noop());
    assert_eq!(editor.state().to_json()?, before);
    assert!(editor.state().selection().is_none());
    Ok(())
}

#[test]
fn exterior_focus_uses_source_type_and_text_checks_and_selects_in_the_same_commit()
-> Result<(), Error> {
    for (heading, text, expected_children) in [
        (false, "", 1),
        (false, "body", 2),
        (true, "", 2),
        (false, "\n", 2),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let ((original, leaf), _) = editor.update(|tx| {
            let paragraph = if heading {
                tx.create(HeadingNode {
                    tag: HeadingTagType::H1,
                })?
                .key()
            } else {
                tx.create(Paragraph::default())?.key()
            };
            let leaf = tx.create_text(text)?;
            tx.text(leaf)?.set_mode(TextMode::Token)?;
            tx.append(paragraph, &[leaf.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph])?;
            Ok((paragraph, leaf.key()))
        })?;
        let command = surface::decode_command("group-b.focus-end", "{}", 0, None)?.expect("action");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        let view = commit.next.view();
        let children = view.children_keys(NodeKey::ROOT)?;
        assert_eq!(children.len(), expected_children);
        assert_eq!(children[0], original);
        let range = commit
            .next
            .selection()
            .and_then(Selection::as_range)
            .expect("same-commit selection");
        let target = if expected_children == 1 {
            assert_eq!(
                view.children_size(original),
                1,
                "empty text, not empty children"
            );
            Point::text(leaf, Utf16Offset::ZERO)
        } else {
            let last = *children.last().expect("paragraph");
            assert_eq!(view.type_name(last)?, "paragraph");
            assert_eq!(view.children_size(last), 0);
            Point::element(last, ChildIndex(0))
        };
        assert_eq!(range.anchor, target);
        assert_eq!(range.focus, target);
    }
    Ok(())
}

#[test]
fn exterior_focus_rejects_unexpected_payload_fields() {
    assert!(decode("group-b.focus-end", r#"{"key":1}"#).is_err());
    assert!(decode("group-b.focus-end", "null").is_err());
    assert!(decode("other.action", "{}").expect("unknown").is_none());
}
