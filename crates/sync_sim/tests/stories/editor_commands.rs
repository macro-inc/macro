use super::*;

#[test]
fn editor_commands_use_live_selections_and_converge_for_tabs_and_headless_workers() {
    for kind in [ClientKind::Tab, ClientKind::AiWorker] {
        let mut config = SimConfig::editor(741);
        let SeedDocument::Editor(state) = config.seeds.get_mut(&DocIx(0)).unwrap() else {
            panic!("editor seed");
        };
        state["root"]["children"][0]["children"][0]["text"] = serde_json::json!("hello");
        let mut writer = OpenSpec::form("a", "one");
        writer.kind = kind;
        let mut script = vec![
            Step::Open(writer),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Settle,
        ];
        for op in [
            EditorOp::Type {
                at: Pos::default(),
                text: "🦀".into(),
            },
            EditorOp::Backspace {
                at: Pos {
                    block: 0,
                    offset: 2,
                },
                count: 1,
            },
            EditorOp::DeleteRange {
                from: Pos {
                    block: 0,
                    offset: 1,
                },
                to: Pos {
                    block: 0,
                    offset: 3,
                },
            },
            EditorOp::SplitBlock {
                at: Pos {
                    block: 0,
                    offset: 1,
                },
            },
            EditorOp::Format {
                from: Pos {
                    block: 1,
                    offset: 0,
                },
                to: Pos {
                    block: 1,
                    offset: 2,
                },
                format: 0,
            },
            EditorOp::Indent {
                at: Pos {
                    block: 1,
                    offset: 0,
                },
            },
            EditorOp::Outdent {
                at: Pos {
                    block: 1,
                    offset: 0,
                },
            },
        ] {
            script.extend([
                Step::Edit {
                    client: ClientName("a".into()),
                    op: AbstractOp::Editor(op),
                },
                Step::Run(Millis(500)),
            ]);
        }
        script.push(Step::Settle);
        let outcome = verify(config, &script);
        let edits = outcome
            .events
            .iter()
            .filter_map(|event| match &event.fact {
                Fact::LocalOp {
                    client,
                    op: AbstractOp::Editor(_),
                    spans,
                } if client.0 == "a" => Some(spans),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(edits.len(), 7);
        assert!(
            edits.iter().all(|spans| !spans.is_empty()),
            "every actual command must change the document"
        );
        for name in ["a", "b"] {
            let state = &outcome.finals.clients[&ClientName(name.into())]
                .editor
                .as_ref()
                .unwrap()
                .synced_json;
            let blocks = state["root"]["children"].as_array().unwrap();
            assert_eq!(blocks.len(), 2);
            assert_eq!(blocks[0]["children"][0]["text"], "h");
            assert_eq!(blocks[1]["children"][0]["text"], "lo");
            assert_eq!(blocks[1]["children"][0]["format"], 1);
            assert_eq!(blocks[1]["indent"], 0);
        }
    }
}

#[test]
fn repeated_backspace_keeps_the_updated_cursor_across_astral_text() {
    let mut config = SimConfig::editor(742);
    let SeedDocument::Editor(state) = config.seeds.get_mut(&DocIx(0)).unwrap() else {
        panic!("editor seed");
    };
    state["root"]["children"][0]["children"][0]["text"] = serde_json::json!("a🦀bc");
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Settle,
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Backspace {
                    at: Pos {
                        block: 0,
                        offset: 4,
                    },
                    count: 2,
                }),
            },
            Step::Settle,
        ],
    );
    let state = &outcome.finals.clients[&ClientName("a".into())]
        .editor
        .as_ref()
        .unwrap()
        .synced_json;
    assert_eq!(state["root"]["children"][0]["children"][0]["text"], "ac");
}
