use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

#[test]
fn equation_updates_only_the_expression_and_yields_for_empty_or_wrong_targets() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((equation, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let equation = tx.create(EquationNode {
            equation: Maybe::Value("x".into()),
            inline: false,
        })?;
        let text = tx.create_text("keep")?;
        tx.append(paragraph, &[equation.key(), text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((equation, text))
    })?;
    for (key, value, expected) in [
        (equation.key(), "y^2", Handled::Yes),
        (equation.key(), "", Handled::No),
        (text.key(), "wrong", Handled::No),
    ] {
        let command = decode_command(
            "group-b.equation",
            &serde_json::json!({"key":key.index(),"equation":value,"inline":true}).to_string(),
            key.generation(),
            None,
        )?
        .expect("equation command");
        let (handled, _) = editor.dispatch(&command)?;
        assert_eq!(handled, expected);
        let node = editor.state().view().get_or_err::<EquationNode>(equation)?;
        assert_eq!(node.equation, Maybe::Value("y^2".into()));
        assert!(!node.inline);
    }
    Ok(())
}

#[test]
fn names_update_attached_mentions_with_exact_ids_and_source_tags() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor
        .update(|tx| {
            let p = tx.create(Paragraph {})?;
            let first = tx.create(UserMentionNode {
                user_id: Maybe::Value("literal|Identity".into()),
                display_name: "old".into(),
                ..UserMentionNode::default()
            })?;
            let second = tx.create(UserMentionNode {
                user_id: Maybe::Value("literal|Identity".into()),
                display_name: "old".into(),
                ..UserMentionNode::default()
            })?;
            let different = tx.create(UserMentionNode {
                user_id: Maybe::Value("literal|identity".into()),
                display_name: "keep".into(),
                ..UserMentionNode::default()
            })?;
            let detached = tx.create(UserMentionNode {
                user_id: Maybe::Value("literal|Identity".into()),
                display_name: "detached".into(),
                ..UserMentionNode::default()
            })?;
            tx.append(p, &[first.key(), second.key(), different.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            let command = decode_command(
                "group-b.user-display-names",
                r#"{"names":{"literal|Identity":" ","literal|identity":""}}"#,
                first.key().generation(),
                None,
            )?
            .expect("names command");
            assert_eq!(tx.dispatch(&command)?, Handled::Yes);
            assert_eq!(tx.get_or_err::<UserMentionNode>(first)?.display_name, " ");
            assert_eq!(tx.get_or_err::<UserMentionNode>(second)?.display_name, " ");
            assert_eq!(
                tx.get_or_err::<UserMentionNode>(different)?.display_name,
                "keep"
            );
            assert_eq!(
                tx.get_or_err::<UserMentionNode>(detached)?.display_name,
                "detached"
            );
            Ok(())
        })
        .map(|(_, commit)| {
            assert!(commit.tags.contains(&UpdateTag::Historic));
            assert!(commit.tags.contains(&UpdateTag::SkipDomSelection));
            assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
        })?;
    Ok(())
}

#[test]
fn empty_names_are_handled_without_changing_content() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let before = editor.state().to_json()?;
    let command = decode_command(
        "group-b.user-display-names",
        r#"{"names":{}}"#,
        NodeKey::ROOT.generation(),
        None,
    )?
    .expect("names command");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(editor.state().to_json()?, before);
    assert!(commit.tags.contains(&UpdateTag::Historic));
    assert!(commit.tags.contains(&UpdateTag::SkipDomSelection));
    assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    Ok(())
}

#[test]
fn legacy_missing_and_null_ids_use_source_property_lookup_keys() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let missing = tx.create(UserMentionNode {
            user_id: Maybe::Missing,
            display_name: "Missing".into(),
            ..UserMentionNode::default()
        })?;
        let null = tx.create(UserMentionNode {
            user_id: Maybe::Null,
            display_name: "Null".into(),
            ..UserMentionNode::default()
        })?;
        tx.append(p, &[missing.key(), null.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let command = decode_command(
            "group-b.user-display-names",
            r#"{"names":{"undefined":"Missing Fresh","null":"Null Fresh"}}"#,
            missing.key().generation(),
            None,
        )?
        .expect("names command");
        assert_eq!(tx.dispatch(&command)?, Handled::Yes);
        assert_eq!(
            tx.get_or_err::<UserMentionNode>(missing)?.display_name,
            "Missing Fresh"
        );
        assert_eq!(
            tx.get_or_err::<UserMentionNode>(missing)?.user_id,
            Maybe::Missing
        );
        assert_eq!(
            tx.get_or_err::<UserMentionNode>(null)?.display_name,
            "Null Fresh"
        );
        assert_eq!(tx.get_or_err::<UserMentionNode>(null)?.user_id, Maybe::Null);
        Ok(())
    })?;
    Ok(())
}

#[test]
fn decorator_delete_selects_next_then_previous_and_restores_an_empty_root() -> Result<(), Error> {
    let mut editor = surface::preset_builder_with_mode(EditorType::Markdown, EditorMode::Headless)
        .build()
        .expect("surface");
    let ((before, rule, after), _) = editor.update(|tx| {
        let before = tx.create(Paragraph {})?;
        let before_text = tx.create_text("before")?;
        tx.append(before, &[before_text.key()])?;
        let rule = tx.create(HorizontalRuleNode::default())?;
        let after = tx.create(Paragraph {})?;
        let after_text = tx.create_text("after")?;
        tx.append(after, &[after_text.key()])?;
        tx.append(NodeKey::ROOT, &[before.key(), rule.key(), after.key()])?;
        Ok((before_text.key(), rule.key(), after_text.key()))
    })?;
    let command = decode_command(
        "group-b.decorator-delete",
        &format!("{{\"key\":{}}}", rule.index()),
        rule.generation(),
        None,
    )?
    .expect("delete");
    editor.update(|tx| {
        assert_eq!(tx.dispatch(&command)?, Handled::Yes);
        assert!(!tx.is_attached(rule));
        assert_eq!(
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor,
            Point::text(after, Utf16Offset(0))
        );
        Ok(())
    })?;
    editor.update(|tx| {
        let paragraph = tx.parent(after).expect("paragraph");
        tx.remove(paragraph, false)?;
        let rule = tx.create(HorizontalRuleNode::default())?;
        tx.append(NodeKey::ROOT, &[rule.key()])?;
        let command = decode_command(
            "group-b.decorator-delete",
            &format!("{{\"key\":{}}}", rule.key().index()),
            rule.key().generation(),
            None,
        )?
        .expect("delete");
        assert_eq!(tx.dispatch(&command)?, Handled::Yes);
        assert_eq!(
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor,
            Point::text(before, Utf16Offset(6))
        );
        Ok(())
    })?;
    editor.update(|tx| {
        let paragraph = tx.parent(before).expect("paragraph");
        tx.remove(paragraph, false)?;
        let rule = tx.create(HorizontalRuleNode::default())?;
        tx.append(NodeKey::ROOT, &[rule.key()])?;
        let command = decode_command(
            "group-b.decorator-delete",
            &format!("{{\"key\":{}}}", rule.key().index()),
            rule.key().generation(),
            None,
        )?
        .expect("delete");
        assert_eq!(tx.dispatch(&command)?, Handled::Yes);
        let paragraph = tx.first_child(NodeKey::ROOT).expect("restored paragraph");
        assert!(tx.is::<Paragraph>(paragraph));
        assert_eq!(tx.children_size(NodeKey::ROOT), 1);
        assert_eq!(
            tx.selection()
                .and_then(Selection::as_range)
                .expect("range")
                .anchor,
            Point::element(paragraph, ChildIndex(0))
        );
        Ok(())
    })?;
    Ok(())
}
