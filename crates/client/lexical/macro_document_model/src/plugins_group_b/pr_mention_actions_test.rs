use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

fn original() -> PullRequestMentionNode {
    PullRequestMentionNode {
        id: Maybe::Value("pr-entity".into()),
        label: Maybe::Value("Original".into()),
        mention_uuid: Maybe::Value("mention-instance".into()),
        url: Maybe::Missing,
    }
}

fn command(
    key: NodeKey,
    expected: &PullRequestMentionNode,
    label: Option<&str>,
    url: Option<&str>,
) -> Result<Command, Error> {
    decode_command(
        "group-b.pr-enrich",
        &serde_json::json!({
            "key": key.index(),
            "expected": expected,
            "label": label,
            "url": url,
        })
        .to_string(),
        key.generation(),
        None,
    )?
    .ok_or(Error::Invariant("PR enrichment decoder"))
}

#[test]
fn pr_enrichment_preserves_identity_selection_and_source_tags() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let key = tx.create(original())?.key();
        let text = tx.create_text("Keep")?;
        tx.append(p, &[key, text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(key)
    })?;
    let selected = editor.state().selection().cloned();
    let update = command(
        key,
        &original(),
        Some("owner/repo#7 Resolved"),
        Some("https://github.com/owner/repo/pull/7"),
    )?;
    let (handled, commit) = editor.dispatch(&update)?;
    assert_eq!(handled, Handled::Yes);
    let actual = editor
        .state()
        .view()
        .get_or_err::<PullRequestMentionNode>(key)?;
    assert_eq!(actual.id, original().id);
    assert_eq!(actual.mention_uuid, original().mention_uuid);
    assert_eq!(actual.label, Maybe::Value("owner/repo#7 Resolved".into()));
    assert_eq!(
        actual.url,
        Maybe::Value("https://github.com/owner/repo/pull/7".into())
    );
    assert_eq!(editor.state().selection(), selected.as_ref());
    assert!(commit.tags.contains(&UpdateTag::Historic));
    assert!(commit.tags.contains(&UpdateTag::SkipDomSelection));
    assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    Ok(())
}

#[test]
fn pr_enrichment_rejects_stale_identity_and_wrong_targets_before_writes() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((key, text, detached), _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let key = tx.create(original())?.key();
        let detached = tx.create(original())?.key();
        let text = tx.create_text("Keep")?.key();
        tx.append(p, &[key, text])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((key, text, detached))
    })?;
    let mut stale = Vec::new();
    for field in ["id", "label", "url", "mention"] {
        let mut expected = original();
        match field {
            "id" => expected.id = Maybe::Value("another-entity".into()),
            "label" => expected.label = Maybe::Value("Newer label".into()),
            "url" => expected.url = Maybe::Value("https://github.com/owner/repo/pull/8".into()),
            _ => expected.mention_uuid = Maybe::Value("another-instance".into()),
        }
        stale.push(command(key, &expected, Some("Late"), None)?);
    }
    for field in ["id", "label", "url", "mention"] {
        for value in [Maybe::Missing, Maybe::Null, Maybe::Value(String::new())] {
            let mut expected = original();
            let slot = match field {
                "id" => &mut expected.id,
                "label" => &mut expected.label,
                "url" => &mut expected.url,
                _ => &mut expected.mention_uuid,
            };
            if *slot == value {
                continue;
            }
            *slot = value;
            stale.push(command(key, &expected, Some("Late"), None)?);
        }
    }
    for target in [
        text,
        detached,
        NodeKey::from_parts(KeyParts {
            index: u32::MAX,
            generation: key.generation(),
        }),
        NodeKey::from_parts(KeyParts {
            index: key.index(),
            generation: key.generation().wrapping_add(1),
        }),
    ] {
        stale.push(command(target, &original(), Some("Late"), None)?);
    }
    let before = editor.state().to_json()?;
    for update in stale {
        let (handled, commit) = editor.dispatch(&update)?;
        assert_eq!(handled, Handled::No);
        assert_eq!(editor.state().to_json()?, before);
        assert!(!commit.tags.contains(&UpdateTag::Historic));
        assert!(!commit.tags.contains(&UpdateTag::SkipDomSelection));
        assert!(!commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    }
    Ok(())
}

#[test]
fn pr_enrichment_keeps_existing_url_and_source_truthy_label_rules() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let mut prior = original();
    prior.url = Maybe::Value("https://github.com/owner/repo/pull/7".into());
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let key = tx.create(prior.clone())?.key();
        tx.append(p, &[key])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(key)
    })?;
    let update = command(
        key,
        &prior,
        Some(" "),
        Some("https://github.com/owner/repo/pull/9"),
    )?;
    let (handled, _) = editor.dispatch(&update)?;
    assert_eq!(handled, Handled::Yes);
    let actual = editor
        .state()
        .view()
        .get_or_err::<PullRequestMentionNode>(key)?;
    assert_eq!(actual.label, Maybe::Value(" ".into()));
    assert_eq!(actual.url, prior.url);
    Ok(())
}

#[test]
fn pr_enrichment_yields_without_a_source_effect_and_rejects_invalid_urls() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let key = tx.create(original())?.key();
        tx.append(p, &[key])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(key)
    })?;
    for (label, url) in [
        (None, None),
        (Some(""), None),
        (Some("Original"), None),
        (None, Some("")),
        (None, Some("https://example.invalid/not-a-pr")),
    ] {
        let before = editor.state().to_json()?;
        let (handled, commit) = editor.dispatch(&command(key, &original(), label, url)?)?;
        assert_eq!(handled, Handled::No);
        assert_eq!(editor.state().to_json()?, before);
        assert!(!commit.tags.contains(&UpdateTag::Historic));
    }
    Ok(())
}

#[test]
fn pr_enrichment_decoder_requires_the_captured_identity_and_typed_effects() {
    for json in [
        r#"{}"#,
        r#"{"key":1}"#,
        r#"{"key":1,"expected":{},"label":1}"#,
        r#"{"key":1,"expected":{},"url":false}"#,
        r#"{"key":1,"expected":{"id":7}}"#,
    ] {
        assert!(decode_command("group-b.pr-enrich", json, 1, None).is_err());
    }
}

#[test]
fn pr_enrichment_accepts_matching_null_optional_source_fields() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let mut prior = original();
    prior.label = Maybe::Null;
    prior.mention_uuid = Maybe::Null;
    let (key, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let key = tx.create(prior.clone())?.key();
        tx.append(paragraph, &[key])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(key)
    })?;
    let (handled, _) = editor.dispatch(&command(key, &prior, Some("Resolved"), None)?)?;
    assert_eq!(handled, Handled::Yes);
    let actual = editor
        .state()
        .view()
        .get_or_err::<PullRequestMentionNode>(key)?;
    assert_eq!(actual.label, Maybe::Value("Resolved".into()));
    assert_eq!(actual.mention_uuid, Maybe::Null);
    assert_eq!(actual.url, Maybe::Missing);
    Ok(())
}
