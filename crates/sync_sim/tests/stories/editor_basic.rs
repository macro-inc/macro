use super::*;

#[test]
fn real_editor_sessions_converge_after_concurrent_astral_typing() {
    let outcome = verify(
        SimConfig::editor(701),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 1,
                    },
                    text: "a🦀e\u{301}".into(),
                }),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 2,
                    },
                    text: "b🛰️".into(),
                }),
            },
            Step::Settle,
        ],
    );
    let a = outcome.finals.clients[&ClientName("a".into())]
        .editor
        .as_ref()
        .unwrap();
    let b = outcome.finals.clients[&ClientName("b".into())]
        .editor
        .as_ref()
        .unwrap();
    assert_eq!(a.synced_json, b.synced_json);
    assert_eq!(a.synced_json, a.reconstructed);
    let json = a.synced_json.to_string();
    assert!(json.contains("a🦀e"));
    assert!(json.contains("b🛰️"));
    assert!(a.can_undo && b.can_undo);

    let mut damaged = outcome.clone();
    damaged
        .finals
        .clients
        .get_mut(&ClientName("b".into()))
        .unwrap()
        .editor
        .as_mut()
        .unwrap()
        .synced_json["root"]["children"][0]["children"][0]["text"] = serde_json::json!("damaged");
    assert!(invariants::editor_states_equal(&damaged).is_err());
    assert!(invariants::projection_consistent(&damaged).is_err());
    damaged
        .finals
        .clients
        .get_mut(&ClientName("b".into()))
        .unwrap()
        .editor = None;
    assert!(invariants::editor_states_equal(&damaged).is_err());
    assert!(invariants::projection_consistent(&damaged).is_err());
}

#[test]
fn abstract_editor_positions_back_off_utf16_surrogate_interiors() {
    let mut config = SimConfig::editor(702);
    let SeedDocument::Editor(state) = config.seeds.get_mut(&DocIx(0)).unwrap() else {
        panic!("editor seed");
    };
    state["root"]["children"][0]["children"][0]["text"] = serde_json::json!("a🦀z");
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 2,
                    },
                    text: "X".into(),
                }),
            },
            Step::Settle,
        ],
    );
    let editor = outcome.finals.clients[&ClientName("a".into())]
        .editor
        .as_ref()
        .unwrap();
    assert_eq!(
        editor.synced_json["root"]["children"][0]["children"][0]["text"],
        "aX🦀z"
    );
}

#[test]
fn editor_wal_survives_a_durable_append_and_tab_crash() {
    let outcome = verify(
        SimConfig::editor(703),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 1,
                    },
                    text: "durable 🦀".into(),
                }),
            },
            Step::Run(Millis(80)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Net(NetStep::Heal(ClientName("a".into()))),
            Step::Reopen {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    assert!(
        outcome.finals.clients[&ClientName("b".into())]
            .editor
            .as_ref()
            .unwrap()
            .synced_json
            .to_string()
            .contains("durable 🦀")
    );
    assert!(outcome.stats.adoptions > 0);
}

#[test]
fn headless_editor_uses_model_selection_before_typing() {
    let mut ai = OpenSpec::form("ai", "memory");
    ai.kind = ClientKind::AiWorker;
    let outcome = verify(
        SimConfig::editor(704),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(ai),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("ai".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 3,
                    },
                    text: "headless edit".into(),
                }),
            },
            Step::Settle,
        ],
    );
    assert!(
        outcome.finals.clients[&ClientName("a".into())]
            .editor
            .as_ref()
            .unwrap()
            .synced_json
            .to_string()
            .contains("headless edit")
    );
}
