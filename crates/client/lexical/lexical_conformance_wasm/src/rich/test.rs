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

#[test]
fn rich_host_deletion_sorts_dom_points_before_restoring_direction() -> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    core.execute(
        r#"{"kind":"Core","command":{"kind":"InsertText","text":"é"}}"#,
        HistoryTime(100),
    )?;
    let output: Value = serde_json::from_str(&core.execute(r#"{"kind":"Delete","unit":"character","backward":true,"target":{"path":[0,0],"offset":0,"type":"text"}}"#, HistoryTime(200))?)?;
    assert_eq!(output["text"], "e");
    assert_eq!(output["selection"]["anchor"]["offset"], 1);
    Ok(())
}

#[test]
fn rich_final_row_deletion_reports_dangling_table_selection() -> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    core.execute(r#"{"kind":"Table","rows":1,"columns":1}"#, HistoryTime(100))?;
    core.execute(r#"{"kind":"TableSelect","anchor":{"path":[1,0,0],"offset":0,"type":"element"},"focus":{"path":[1,0,0],"offset":0,"type":"element"}}"#, HistoryTime(200))?;
    let output: Value = serde_json::from_str(&core.execute(
        r#"{"kind":"TableEdit","action":"deleteRow","after":true}"#,
        HistoryTime(300),
    )?)?;
    assert!(output["error"].is_null());
    assert_eq!(output["selection"]["type"], "table");
    assert!(output["selection"]["table"].is_null());
    assert!(output["selection"]["anchor"]["path"].is_null());
    assert_eq!(output["selection"]["anchor"]["offset"], 0);
    Ok(())
}

#[test]
fn rich_backspace_after_a_table_preserves_following_code() -> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    core.execute(
        r#"{"kind":"Markdown","text":"```js\nlet x = 1;\n```","preserve":true,"merge":true}"#,
        HistoryTime(100),
    )?;
    core.execute(r#"{"kind":"Table","rows":1,"columns":1}"#, HistoryTime(200))?;
    let output: Value = serde_json::from_str(&core.execute(
        r#"{"kind":"Delete","unit":"character","backward":true,"target":null}"#,
        HistoryTime(300),
    )?)?;
    assert_eq!(output["state"]["root"]["children"][2]["type"], "code");
    assert_eq!(output["state"]["root"]["children"][2]["language"], "js");
    Ok(())
}

#[test]
fn rich_paste_at_a_cleared_cell_boundary_requires_a_leaf_block() -> Result<(), BoundaryError> {
    let mut core = RichHandle::create()?;
    core.execute(r#"{"kind":"Table","rows":1,"columns":1}"#, HistoryTime(100))?;
    core.execute(r#"{"kind":"Core","command":{"kind":"Select","anchor":{"path":[1,0,0,0],"offset":0,"type":"element"},"focus":{"path":[1,0,0,0],"offset":0,"type":"element"}}}"#, HistoryTime(200))?;
    let previous: Value = serde_json::from_str(&core.execute(
        r#"{"kind":"TableClear","cells":[{"path":[1,0,0],"offset":0,"type":"element"}]}"#,
        HistoryTime(300),
    )?)?;
    let output: Value = serde_json::from_str(&core.execute(r#"{"kind":"Paste","nodes":[{"type":"code","version":1,"children":[{"type":"code-highlight","version":1,"text":"a","detail":0,"format":0,"mode":"normal","style":"","highlightType":"keyword"}],"direction":null,"format":"","indent":0,"language":"javascript"}]}"#, HistoryTime(400))?)?;
    assert!(output["error"].is_string());
    assert_eq!(output["state"], previous["state"]);
    assert_eq!(output["selection"], previous["selection"]);
    Ok(())
}
