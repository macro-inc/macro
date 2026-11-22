//! Literal Source DateMention picker observation: day 20 picked in the app
//! markdown-sync editor (browser timezone UTC).
use crate::{EditorType, plugins_group_b::decode_command, surface};
use lexical_model::*;
use serde_json::{Value, json};

fn editor_with_date() -> Result<(Editor, NodeKey, NodeKey), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let input = json!({"root":{"type":"root","version":1,"direction":null,"format":"","indent":0,"children":[{
        "type":"paragraph","version":1,"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","children":[
            {"type":"text","version":1,"text":"Before ","format":0,"detail":0,"mode":"normal","style":""},
            {"type":"date-mention","version":1,"date":"2026-09-15T16:00:00.000Z","displayFormat":"Sep 15","mentionUuid":"m1"},
            {"type":"text","version":1,"text":" after","format":0,"detail":0,"mode":"normal","style":""}
        ]
    }]}});
    let state = editor.parse_editor_state_str(&input.to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    let view = editor.state().view();
    let paragraph = view.children_keys(NodeKey::ROOT)?[0];
    let date = view.children_keys(paragraph)?[1];
    Ok((editor, paragraph, date))
}

fn command(key: NodeKey) -> Result<Command, Error> {
    Ok(decode_command(
        "group-b.date-mention",
        &json!({"key": key.index(), "date": "2026-09-20T00:00:00.000Z", "displayFormat": "Sun, Sep 20, 2026"}).to_string(),
        key.generation(),
        None,
    )?
    .expect("date mention command"))
}

#[test]
fn date_mention_sets_date_and_display_format_without_tags() -> Result<(), Error> {
    let (mut editor, _, date) = editor_with_date()?;
    let (handled, commit) = editor.dispatch(&command(date)?)?;
    assert_eq!(handled, Handled::Yes);
    let actual = serde_json::to_value(editor.state().to_json()?)?;
    let node = &actual["root"]["children"][0]["children"][1];
    assert_eq!(node["type"], Value::from("date-mention"));
    assert_eq!(node["date"], Value::from("2026-09-20T00:00:00.000Z"));
    assert_eq!(node["displayFormat"], Value::from("Sun, Sep 20, 2026"));
    assert_eq!(node["mentionUuid"], Value::from("m1"));
    assert!(commit.tags.iter().next().is_none());
    Ok(())
}

#[test]
fn date_mention_yields_for_non_date_targets() -> Result<(), Error> {
    let (mut editor, paragraph, _) = editor_with_date()?;
    assert_eq!(editor.dispatch(&command(paragraph)?)?.0, Handled::No);
    Ok(())
}

#[test]
fn date_mention_rejects_positional_payloads() {
    let error = decode_command(
        "group-b.date-mention",
        r#"[1, "2026-09-20T00:00:00.000Z", "Sun, Sep 20, 2026"]"#,
        0,
        None,
    );
    assert!(matches!(error, Err(Error::Invariant(_))), "{error:?}");
}
