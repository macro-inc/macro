use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

fn booking(label: Maybe<String>) -> BookingLinkMentionNode {
    BookingLinkMentionNode {
        profile_id: Maybe::Value("fixture-profile".into()),
        slug: Maybe::Null,
        label,
        url: "https://example.test/app/book/fixture-profile/url-slug".into(),
        host: None,
    }
}

fn command(key: NodeKey, label: &str) -> Result<Command, Error> {
    decode_command(
        "group-b.booking-mention-label",
        &serde_json::json!({ "key": key.index(), "label": label }).to_string(),
        key.generation(),
        None,
    )?
    .ok_or(Error::Invariant("booking label decoder"))
}

#[test]
fn booking_label_preserves_other_fields_and_selection_with_source_tags() -> Result<(), Error> {
    for previous in [Maybe::Missing, Maybe::Null, Maybe::Value(String::new())] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("registered Macro surface");
        let (key, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph {})?;
            let target = tx.create(booking(previous))?;
            let text = tx.create_text("Keep")?;
            tx.append(paragraph, &[target.key(), text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.select_end(text)?;
            Ok(target.key())
        })?;
        let selection = editor.state().selection().cloned();
        let (handled, commit) = editor.dispatch(&command(key, "Resolved label")?)?;
        assert_eq!(handled, Handled::Yes);
        let actual = editor
            .state()
            .view()
            .get_or_err::<BookingLinkMentionNode>(key)?;
        assert_eq!(actual.profile_id, Maybe::Value("fixture-profile".into()));
        assert_eq!(actual.slug, Maybe::Null);
        assert_eq!(
            actual.url,
            "https://example.test/app/book/fixture-profile/url-slug"
        );
        assert_eq!(actual.label, Maybe::Value("Resolved label".into()));
        assert_eq!(editor.state().selection(), selection.as_ref());
        assert!(commit.tags.contains(&UpdateTag::Historic));
        assert!(commit.tags.contains(&UpdateTag::SkipDomSelection));
        assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    }
    Ok(())
}

#[test]
fn booking_label_keeps_whitespace_truthy_and_adds_no_tags_for_noops() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registered Macro surface");
    let (key, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let target = tx.create(booking(Maybe::Value("Saved".into())))?;
        tx.append(paragraph, &[target.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(target.key())
    })?;
    for label in ["", "Saved"] {
        let before = editor.state().view().export_json(NodeKey::ROOT)?;
        let (handled, commit) = editor.dispatch(&command(key, label)?)?;
        assert_eq!(handled, Handled::No);
        assert_eq!(editor.state().view().export_json(NodeKey::ROOT)?, before);
        assert!(!commit.tags.contains(&UpdateTag::Historic));
        assert!(!commit.tags.contains(&UpdateTag::SkipDomSelection));
        assert!(!commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    }
    let (handled, commit) = editor.dispatch(&command(key, " ")?)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::Historic));
    assert!(commit.tags.contains(&UpdateTag::SkipDomSelection));
    assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<BookingLinkMentionNode>(key)?
            .label,
        Maybe::Value(" ".into())
    );
    Ok(())
}

#[test]
fn booking_label_uses_live_key_and_kind_without_a_pr_identity_guard() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registered Macro surface");
    let ((key, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let target = tx.create(booking(Maybe::Missing))?;
        let text = tx.create_text("Keep")?;
        tx.append(paragraph, &[target.key(), text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((target.key(), text.key()))
    })?;
    let stale = NodeKey::from_parts(KeyParts {
        index: key.index(),
        generation: key.generation() + 1,
    });
    let missing = NodeKey::from_parts(KeyParts {
        index: u32::MAX,
        generation: key.generation(),
    });
    for rejected in [NodeKey::ROOT, text, stale, missing] {
        let before = editor.state().view().export_json(NodeKey::ROOT)?;
        let (handled, commit) = editor.dispatch(&command(rejected, "Late")?)?;
        assert_eq!(handled, Handled::No);
        assert_eq!(editor.state().view().export_json(NodeKey::ROOT)?, before);
        assert!(!commit.tags.contains(&UpdateTag::Historic));
    }
    // The Source effect checks the current key and class, not captured own data.
    editor.update(|tx| {
        let mut target = tx.get_mut::<BookingLinkMentionNode>(key)?;
        target.profile_id = Maybe::Value("updated-profile".into());
        target.url = "https://example.test/updated".into();
        Ok(())
    })?;
    let (handled, _) = editor.dispatch(&command(key, "Resolved")?)?;
    assert_eq!(handled, Handled::Yes);
    let actual = editor
        .state()
        .view()
        .get_or_err::<BookingLinkMentionNode>(key)?;
    assert_eq!(actual.profile_id, Maybe::Value("updated-profile".into()));
    assert_eq!(actual.url, "https://example.test/updated");
    assert_eq!(actual.label, Maybe::Value("Resolved".into()));
    editor.update(|tx| tx.remove(key, false))?;
    let (handled, _) = editor.dispatch(&command(key, "Removed")?)?;
    assert_eq!(handled, Handled::No);
    Ok(())
}

#[test]
fn booking_label_requires_a_closed_object_payload() {
    for json in [
        r#"[1,"Label"]"#,
        "[]",
        "null",
        r#"{"key":1}"#,
        r#"{"label":"Label"}"#,
        r#"{"key":1,"label":false}"#,
        r#"{"key":1,"label":{}}"#,
        r#"{"key":1,"label":null}"#,
        r#"{"key":1,"label":1}"#,
        r#"{"key":1,"label":"Label","extra":true}"#,
        r#"{"key":-1,"label":"Label"}"#,
        r#"{"key":1.5,"label":"Label"}"#,
        r#"{"key":4294967296,"label":"Label"}"#,
    ] {
        assert!(
            decode_command("group-b.booking-mention-label", json, 1, None).is_err(),
            "{json}"
        );
    }
}
