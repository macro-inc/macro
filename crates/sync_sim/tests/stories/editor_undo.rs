use super::*;

#[test]
fn collaborative_history_preserves_remote_text_and_reports_actual_removed_ids() {
    for redo in [false, true] {
        let mut config = SimConfig::editor(731 + u64::from(redo));
        let SeedDocument::Editor(state) = config.seeds.get_mut(&DocIx(0)).unwrap() else {
            panic!("editor seed");
        };
        state["root"]["children"][0]["children"][0]["text"] = serde_json::json!("start");
        let mut script = vec![
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Settle,
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 5,
                    },
                    text: " alice🦀".into(),
                }),
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 0,
                    },
                    text: "bob ".into(),
                }),
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Undo),
            },
        ];
        if redo {
            script.extend([
                Step::Run(Millis(500)),
                Step::Edit {
                    client: ClientName("a".into()),
                    op: AbstractOp::Editor(EditorOp::Redo),
                },
            ]);
        }
        script.push(Step::Settle);
        let outcome = verify(config, &script);
        let removed = outcome
            .events
            .iter()
            .find_map(|event| match &event.fact {
                Fact::UndoApplied {
                    client,
                    redo: false,
                    removed,
                } if client.0 == "a" => Some(removed),
                _ => None,
            })
            .expect("real successful undo observation");
        assert!(
            !removed.is_empty(),
            "the actual removed characters must be observed"
        );
        if redo {
            assert!(
                outcome
                    .events
                    .iter()
                    .any(|event| matches!(event.fact, Fact::UndoApplied { redo: true, .. }))
            );
        }
        for name in ["a", "b"] {
            let state = &outcome.finals.clients[&ClientName(name.into())]
                .editor
                .as_ref()
                .unwrap()
                .synced_json;
            let text = state["root"]["children"][0]["children"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|node| node["text"].as_str())
                .collect::<String>();
            assert_eq!(
                text,
                if redo {
                    "bob start alice🦀"
                } else {
                    "bob start"
                }
            );
        }
        let foreign = outcome
            .events
            .iter()
            .find_map(|event| match &event.fact {
                Fact::LocalOp { client, spans, .. } if client.0 == "b" && !spans.is_empty() => {
                    Some(spans[0].clone())
                }
                _ => None,
            })
            .unwrap();
        let mut damaged = outcome.clone();
        let removed = damaged
            .events
            .iter_mut()
            .find_map(|event| match &mut event.fact {
                Fact::UndoApplied { removed, .. } => Some(removed),
                _ => None,
            })
            .unwrap();
        removed.push(foreign);
        assert!(invariants::undo_reverts_only_own(&damaged).is_err());
    }
}

#[test]
fn empty_collaborative_history_does_not_report_an_applied_undo() {
    let outcome = verify(
        SimConfig::editor(733),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Settle,
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Undo),
            },
            Step::Settle,
        ],
    );
    assert!(
        !outcome
            .events
            .iter()
            .any(|event| matches!(event.fact, Fact::UndoApplied { .. }))
    );
}

#[test]
fn undo_of_a_new_text_node_observes_the_node_and_its_astral_character() {
    let mut config = SimConfig::editor(734);
    let SeedDocument::Editor(state) = config.seeds.get_mut(&DocIx(0)).unwrap() else {
        panic!("editor seed");
    };
    state["root"]["children"][0]["children"] = serde_json::json!([]);
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Settle,
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 0,
                        offset: 0,
                    },
                    text: "🦀".into(),
                }),
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Undo),
            },
            Step::Settle,
        ],
    );
    let removed = outcome
        .events
        .iter()
        .find_map(|event| match &event.fact {
            Fact::UndoApplied {
                redo: false,
                removed,
                ..
            } => Some(removed),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        removed.len(),
        2,
        "one real node identity and one Unicode character identity"
    );
}

#[test]
fn redo_restores_the_selection_after_the_original_split_commit() {
    let outcome = verify(
        SimConfig::editor(735),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Settle,
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::SplitBlock {
                    at: Pos {
                        block: 0,
                        offset: 0,
                    },
                }),
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Undo),
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Redo),
            },
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(
        &event.fact,
        Fact::EditorSelectionObserved {
            history: 2,
            changed: true,
            ..
        }
    )));
    let mut damaged = outcome.clone();
    let selection = damaged
        .events
        .iter_mut()
        .find_map(|event| match &mut event.fact {
            Fact::EditorSelectionObserved {
                history: 2,
                selection,
                ..
            } => Some(selection),
            _ => None,
        })
        .unwrap();
    *selection = serde_json::json!([["wrong-node", false, 0], ["wrong-node", false, 0]]);
    assert!(invariants::redo_restores_selection(&damaged).is_err());
}

#[test]
fn repeated_equal_trees_keep_distinct_history_selection_lineage() {
    let mut script = vec![Step::Open(OpenSpec::form("a", "one")), Step::Settle];
    for offset in [0, 2] {
        script.extend([
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos { block: 0, offset },
                    text: "x".into(),
                }),
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::Backspace {
                    at: Pos {
                        block: 0,
                        offset: offset + 1,
                    },
                    count: 1,
                }),
            },
            Step::Run(Millis(500)),
        ]);
    }
    for _ in 0..4 {
        script.push(Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::Editor(EditorOp::Undo),
        });
    }
    for _ in 0..4 {
        script.push(Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::Editor(EditorOp::Redo),
        });
    }
    script.push(Step::Settle);
    let outcome = verify(SimConfig::editor(736), &script);
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(
                &event.fact,
                Fact::EditorSelectionObserved {
                    history: 2,
                    changed: true,
                    ..
                }
            ))
            .count(),
        4
    );
}
