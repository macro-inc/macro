use super::*;

#[test]
fn headless_cursor_restoration_after_remote_typing_uses_model_selection() {
    let mut worker = OpenSpec::form("worker", "two");
    worker.kind = ClientKind::AiWorker;
    let mut script = vec![
        Step::Open(OpenSpec::form("tab", "one")),
        Step::Open(worker),
        Step::Settle,
        Step::Edit {
            client: ClientName("worker".into()),
            op: AbstractOp::Editor(EditorOp::Select {
                from: Pos {
                    block: 0,
                    offset: 4,
                },
                to: Pos {
                    block: 0,
                    offset: 4,
                },
            }),
        },
        Step::Settle,
    ];
    let before = verify(SimConfig::editor(1), &script);
    let cursor = before.finals.clients[&ClientName("worker".into())]
        .editor
        .as_ref()
        .unwrap()
        .selection
        .as_ref()
        .expect("actual selected character");
    script.extend([
        Step::Edit {
            client: ClientName("tab".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "🦀".into(),
            }),
        },
        Step::Settle,
    ]);
    let after = verify(SimConfig::editor(1), &script);
    let editor = after.finals.clients[&ClientName("worker".into())]
        .editor
        .as_ref()
        .unwrap();
    let restored = editor.selection.as_ref().expect("restored cursor");
    for end in ["anchor", "focus"] {
        assert_eq!(cursor[end]["nodeId"], restored[end]["nodeId"]);
        let original = loro::cursor::Cursor::decode(
            &serde_json::from_value::<Vec<u8>>(cursor[end]["cursor"].clone()).unwrap(),
        )
        .unwrap();
        let current = loro::cursor::Cursor::decode(
            &serde_json::from_value::<Vec<u8>>(restored[end]["cursor"].clone()).unwrap(),
        )
        .unwrap();
        // The cached absolute position changes; the relative character must not.
        assert!(original.id.is_some());
        assert_eq!(current.id, original.id);
        assert_eq!(current.container, original.container);
        assert_eq!(current.side, original.side);
    }
    assert!(
        editor
            .synced_json
            .to_string()
            .contains("🦀initial shared editor text")
    );
    assert!(after.events.iter().any(|event| matches!(&event.fact,
        Fact::LocalOp { client, spans, .. } if client.0 == "tab" && !spans.is_empty())));
}
