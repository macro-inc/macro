use super::*;

static PARSED: StateKey<u32> = StateKey::new("stored-probe", |value| {
    value
        .and_then(serde_json::Value::as_str)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
});
static UNRELATED: StateKey<bool> = StateKey::new("unrelated", |value| {
    value.and_then(serde_json::Value::as_bool).unwrap_or(false)
});

#[test]
fn read_memo_does_not_change_attach_verify_or_local_storage()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let seed = Editor::builder(EditorMode::Headless)
        .initial_state(
            serde_json::from_value(json!({"root":{
                "type":"root","version":1,"$":{"stored-probe":"4"},
                "children":[{"type":"paragraph","version":1,"children":[]}]
            }}))
            .expect("literal serialized state"),
        )
        .build()?;
    let doc = new_doc(1)?;
    LoroProjection::initialize(&doc, seed.state(), &PLAIN, 0)?;
    let initial = reconstruct_state(&doc, &PLAIN)?;
    let initial_vv = doc.oplog_vv();
    let mut editor = Editor::builder(EditorMode::Headless)
        .initial_state(initial.clone())
        .build()?;
    assert_eq!(editor.state().view().get_state(NodeKey::ROOT, &PARSED)?, 4);
    assert_eq!(
        synced_json(editor.state(), &PLAIN)?.root["$"]["stored-probe"],
        4
    );
    let mut projection = LoroProjection::attach(&doc, editor.state(), &PLAIN)?;
    projection
        .check(&doc, editor.state())
        .expect("full stored comparison");
    projection
        .check_nodes(&doc, editor.state(), &[NodeKey::ROOT])
        .expect("incremental stored comparison");
    assert_eq!(doc.oplog_vv(), initial_vv);
    assert_eq!(reconstruct_state(&doc, &PLAIN)?, initial);

    let (_, commit) = editor.update(|tx| tx.set_state(NodeKey::ROOT, &UNRELATED, true))?;
    assert!(
        projection
            .local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?
            .changed
    );
    assert_eq!(
        reconstruct_state(&doc, &PLAIN)?.root["$"],
        json!({"stored-probe":"4","unrelated":true})
    );
    projection
        .check(&doc, editor.state())
        .expect("later write keeps unrelated raw slot");

    // The peer changes only the raw spelling. Typed equality must not erase it.
    let remote = fork_doc(&doc, 2)?;
    let from = remote.oplog_vv();
    let state = remote.get_map("root").get("$").expect("root state slot");
    let Some(Container::Map(state)) = state.as_container() else {
        panic!("expected root state map");
    };
    state.insert("stored-probe", "04")?;
    remote.commit_with(loro::CommitOptions::new().timestamp(2));
    let update = remote.export(ExportMode::updates(&from))?;
    let (_, changes) = projection.remote(&doc, editor.state(), &update)?;
    assert!(!changes.changes.is_empty());
    assert!(
        projection.check(&doc, editor.state()).is_err(),
        "raw values still compare strictly"
    );
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core.apply(
        Input::ApplyRemote {
            changes: changes.changes.clone(),
            options: UpdateOptions {
                skip_transforms: false,
                tags: TagSet::from_tags([UpdateTag::Collaboration]),
            },
        },
        HistoryTime(2),
    )?;
    projection.bind_created(changes, &[])?;
    assert_eq!(core.state().view().get_state(NodeKey::ROOT, &PARSED)?, 4);
    assert_eq!(
        core.state().view().export_stored_json(NodeKey::ROOT)?["$"]["stored-probe"],
        "04"
    );
    projection
        .check(&doc, core.state())
        .expect("remote raw alias is retained");
    let remote_vv = doc.oplog_vv();
    assert!(
        !projection
            .local_commit(&doc, &output.commits, FIXUP_ORIGIN, 2)?
            .changed
    );
    assert_eq!(doc.oplog_vv(), remote_vv);
    assert!(
        projection
            .take_remote(&doc, core.state())?
            .changes
            .is_empty()
    );
    Ok(())
}
