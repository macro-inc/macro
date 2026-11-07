use super::*;
#[test]
fn rich_markdown_history_and_snapshots_use_real_packages() -> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    let output: Value = serde_json::from_str(&core.execute(
        r##"{"kind":"Markdown","text":"# heading\n\n**bold**"}"##,
        HistoryTime(1),
    )?)?;
    assert_eq!(output["markdown"], "# heading\n\n**bold**");
    assert_eq!(output["text"], "heading\n\nbold");
    assert!(output["error"].is_null());
    let output: Value = serde_json::from_str(&core.execute(
        r#"{"kind":"Core","command":{"kind":"InsertText","text":"x"}}"#,
        HistoryTime(500),
    )?)?;
    assert!(output["text"].as_str().expect("text").starts_with('x'));
    core.execute(r#"{"kind":"Undo"}"#, HistoryTime(600))?;
    assert_eq!(
        core.editor.state().root_text_content().as_ref(),
        "heading\n\nbold"
    );
    Ok(())
}

#[test]
fn rich_profile_registers_list_style_transforms_and_preserves_failed_commands()
-> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    core.execute(
        r#"{"kind":"Core","command":{"kind":"FormatText","format":"bold"}}"#,
        HistoryTime(100),
    )?;
    let output: Value = serde_json::from_str(
        &core.execute(r#"{"kind":"List","list":"bullet"}"#, HistoryTime(200))?,
    )?;
    assert_eq!(
        output["state"]["root"]["children"][0]["children"][0]["textFormat"],
        1
    );
    let error: Value=serde_json::from_str(&core.execute(r#"{"kind":"Core","command":{"kind":"Select","anchor":{"path":[999],"offset":0,"type":"element"},"focus":{"path":[999],"offset":0,"type":"element"}}}"#,HistoryTime(300))?)?;
    assert!(error["error"].is_string());
    assert_eq!(error["state"], output["state"]);
    assert_eq!(error["selection"], output["selection"]);
    Ok(())
}

#[test]
fn rich_noop_updates_preserve_typing_history_merge() -> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    core.execute(
        r#"{"kind":"Core","command":{"kind":"InsertText","text":"a"}}"#,
        HistoryTime(100),
    )?;
    core.execute(r#"{"kind":"Indent","outdent":true}"#, HistoryTime(200))?;
    core.execute(
        r#"{"kind":"Core","command":{"kind":"InsertText","text":"b"}}"#,
        HistoryTime(300),
    )?;
    let output: Value =
        serde_json::from_str(&core.execute(r#"{"kind":"Undo"}"#, HistoryTime(400))?)?;
    assert_eq!(output["text"], "ab");
    Ok(())
}
