use super::*;

#[test]
fn native_checklist_coverage_distinguishes_task_rows_from_unknown_wrappers() {
    let session = NativeEditorSession::new(
        application::application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    let mut root = serde_json::json!({"type":"root","children":[
        {"type":"list","listType":"check","start":1,"children":[
            {"type":"listitem","value":1,"checked":false,"children":[{"type":"text","text":"plain"}]},
            {"type":"listitem","value":1,"checked":false,"children":[{"type":"document-mention","blockName":"task","documentId":"task-fixture"}]},
            {"type":"listitem","value":1,"checked":false,"children":[{"type":"document-mention","blockName":"md","documentId":"document-fixture"}]},
            {"type":"listitem","value":1,"children":[{"type":"list","listType":"check","start":1,"children":[
                {"type":"listitem","value":1,"checked":false,"children":[{"type":"text","text":"nested"}]}
            ]}]},
            {"type":"listitem","value":1,"checked":false,"children":[{"type":"document-mention","blockName":"task","documentId":""}]}
        ]}
    ]});
    for (index, id) in [
        "plain-row",
        "task-row",
        "document-row",
        "wrapper-row",
        "empty-task-row",
    ]
    .into_iter()
    .enumerate()
    {
        root["children"][0]["children"][index]["$"] = serde_json::json!({"id": id});
    }
    root["children"][0]["children"][3]["children"][0]["children"][0]["$"] =
        serde_json::json!({"id":"nested-row"});
    for (index, input) in [
        FfiInput::Start,
        FfiInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        FfiInput::SetState {
            root: serde_json::from_value(root).unwrap(),
        },
    ]
    .into_iter()
    .enumerate()
    {
        let output = session
            .handle(
                FfiNow {
                    mono_ms: index as u64 + 1,
                    wall_ms: 1_000_001 + index as i64,
                },
                input,
            )
            .unwrap();
        for effect in output.view {
            if let FfiViewEffect::Error { message } = effect {
                panic!("{message}");
            }
        }
    }
    let keys = [
        "plain-row",
        "task-row",
        "document-row",
        "wrapper-row",
        "empty-task-row",
        "nested-row",
    ]
    .into_iter()
    .map(|id| {
        let FfiQueryReply::Nodes { keys, .. } = session
            .query(FfiQuery::NodeById { id: id.to_owned() })
            .unwrap()
        else {
            panic!("node id")
        };
        assert_eq!(keys.len(), 1, "{id}");
        keys[0]
    })
    .collect();
    let before = match session.query(FfiQuery::State).unwrap() {
        FfiQueryReply::State { root } => serde_json::to_value(root).unwrap(),
        _ => panic!("state"),
    };
    let FfiQueryReply::ListMarkers { markers } =
        session.query(FfiQuery::ListMarkers { keys }).unwrap()
    else {
        panic!("markers")
    };
    assert_eq!(
        markers
            .into_iter()
            .map(|marker| marker.checklist_target)
            .collect::<Vec<_>>(),
        [
            FfiChecklistTarget::Plain,
            FfiChecklistTarget::Task,
            FfiChecklistTarget::Plain,
            FfiChecklistTarget::Unknown,
            FfiChecklistTarget::Task,
            FfiChecklistTarget::Plain,
        ]
    );
    let after = match session.query(FfiQuery::State).unwrap() {
        FfiQueryReply::State { root } => serde_json::to_value(root).unwrap(),
        _ => panic!("state"),
    };
    assert_eq!(before, after);
}
