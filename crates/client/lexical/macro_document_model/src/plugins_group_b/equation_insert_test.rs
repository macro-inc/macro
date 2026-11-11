use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

fn command(equation: &str, inline: bool) -> Result<Command, Error> {
    decode_command(
        "group-b.equation-insert",
        &serde_json::json!({"equation": equation, "inline": inline}).to_string(),
        0,
        None,
    )?
    .ok_or(Error::Invariant("equation insertion decoder"))
}

#[test]
fn equation_insert_splits_the_actual_text_selection_for_both_display_modes() -> Result<(), Error> {
    for (inline, expanded, previous) in [
        (true, false, false),
        (false, false, false),
        (true, true, false),
        (false, true, false),
        (true, false, true),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let (text, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph {})?;
            let text = tx.create_text(if expanded {
                "beforeCUTafter"
            } else {
                "beforeafter"
            })?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::new(
                Point::text(text.key(), Utf16Offset(6)),
                Point::text(text.key(), Utf16Offset(if expanded { 9 } else { 6 })),
            ))))?;
            Ok(text.key())
        })?;
        let insert = command("x^2", inline)?;
        let (handled, commit) = if previous {
            editor.update(|tx| {
                tx.set_selection(None)?;
                tx.dispatch(&insert)
            })?
        } else {
            editor.dispatch(&insert)?
        };
        assert_eq!(handled, Handled::Yes);
        let state = editor.state().view();
        let parent = state.parent(text).expect("paragraph");
        let children: Vec<_> = state.children(parent).collect();
        assert_eq!(children.len(), 3);
        assert_eq!(state.text_content(children[0]), "before");
        let equation = state.get_or_err::<EquationNode>(children[1])?;
        assert_eq!(equation.equation, Maybe::Value("x^2".into()));
        assert_eq!(equation.inline, inline);
        assert_eq!(state.text_content(children[2]), "after");
        let selection = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range");
        assert!(selection.is_collapsed());
        assert_eq!(selection.anchor, Point::text(children[2], Utf16Offset(0)));
        assert_eq!(commit.tags, TagSet::default());
    }
    Ok(())
}

#[test]
fn equation_insert_without_selection_uses_the_root_end_and_keeps_empty_payload() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (handled, _) = editor.dispatch(&command("", true)?)?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let equations: Vec<_> = state
        .descendants(NodeKey::ROOT)
        .filter(|(key, _)| state.is::<EquationNode>(*key))
        .map(|(key, _)| key)
        .collect();
    assert_eq!(equations.len(), 1);
    assert_eq!(
        state.get_or_err::<EquationNode>(equations[0])?.equation,
        Maybe::Value(String::new())
    );
    assert!(state.is::<Paragraph>(state.parent(equations[0]).expect("paragraph")));
    Ok(())
}

#[test]
fn equation_insert_rejects_missing_malformed_and_unknown_payload_fields() {
    for json in [
        r#"{}"#,
        r#"["x",true]"#,
        r#"{"equation":"x"}"#,
        r#"{"equation":null,"inline":true}"#,
        r#"{"equation":"x","inline":true,"extra":1}"#,
    ] {
        assert!(decode_command("group-b.equation-insert", json, 0, None).is_err());
    }
}
