use super::*;

#[test]
fn coalesces_only_compatible_code_runs_and_preserves_persisted_fields() -> Result<()> {
    let source = json!({"root":{"type":"root","children":[
        {"type":"code","language":"rust","children":[
            {"type":"code-highlight","text":"a","style":"color:red","$":{"x":1},"highlightType":"keyword"},
            {"type":"code-highlight","text":"b","style":"color:red","$":{"x":1}},
            {"type":"tab","text":"\t","detail":2},
            {"type":"code-highlight","text":"c","style":""},
            {"type":"linebreak"}
        ]},
        {"type":"paragraph","children":[{"type":"code-highlight","text":"outside","highlightType":"string"}]}
    ]}});
    assert_eq!(
        project_json(&source)?,
        json!({"root":{"type":"root","children":[
            {"type":"code","language":"rust","children":[
                {"type":"text","text":"ab","style":"color:red","$":{"x":1}},
                {"type":"tab","text":"\t","detail":2},
                {"type":"text","text":"c","style":""},
                {"type":"linebreak"}
            ]},
            {"type":"paragraph","children":[{"type":"code-highlight","text":"outside","highlightType":"string"}]}
        ]}})
    );
    Ok(())
}

#[test]
fn code_selection_counts_utf16_tabs_and_linebreaks_and_retains_identity_checks() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<lexical_rich_nodes::code::CodeNode>()
        .build()
        .expect("code editor");
    let mut tx = editor.transaction();
    let code = tx
        .create(lexical_rich_nodes::code::CodeNode::default())?
        .key();
    let emoji = tx.create_text("😀")?.key();
    let tab = tx.create(Tab::default())?.key();
    let line = tx.create(LineBreak::default())?.key();
    let text = tx.create_text("q")?.key();
    tx.append(code, &[emoji, tab, line, text])?;
    tx.append(NodeKey::ROOT, &[code])?;
    tx.commit()?;
    let json = json!({"root":{"type":"root","children":[{"type":"code","children":[
        {"type":"code-highlight","text":"😀"}, {"type":"tab","text":"\t"},
        {"type":"linebreak"}, {"type":"code-highlight","text":"q"}
    ]}]}});
    let mut selection = json!({"type":"range","anchor":{"key":"5","path":[0,3],"offset":1,"type":"text"},"focus":{"key":"1","path":[0],"offset":4,"type":"element"},"format":1,"style":"font-size:12px","isBackward":false});
    project_selection(&mut selection, &json, editor.state())?;
    assert_eq!(
        selection,
        json!({"type":"range","anchor":{"key":"1","path":[0],"offset":5,"type":"code"},"focus":{"key":"1","path":[0],"offset":5,"type":"code"},"format":1,"style":"font-size:12px","isBackward":false})
    );
    let mut wrong = json!({"type":"range","anchor":{"key":"2","path":[0,3],"offset":1,"type":"text"},"focus":{"key":"1","path":[0],"offset":4,"type":"element"}});
    assert!(project_selection(&mut wrong, &json, editor.state()).is_err());
    let mut wrong_kind = json!({"type":"range","anchor":{"key":"4","path":[0,2],"offset":0,"type":"text"},"focus":{"key":"1","path":[0],"offset":3,"type":"element"}});
    assert!(project_selection(&mut wrong_kind, &json, editor.state()).is_err());
    Ok(())
}

#[test]
fn unfamiliar_code_descendants_are_not_discarded() {
    let source = json!({"root":{"type":"code","children":[{"type":"link","children":[]}]}});
    assert!(project_json(&source).is_err());
}
