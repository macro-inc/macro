//! Exact pre-existing failure; this never changes the production invariant registry.
use sync_sim::*;

#[test]
fn known_structural_undo_hides_foreign_text_and_immediate_redo_recovers_it() {
    let config = SimConfig::editor(28);
    let base = vec![
        Step::Open(OpenSpec::form("writer", "shared-profile")),
        Step::Open(OpenSpec::form("collaborator", "shared-profile")),
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("writer".into()),
            op: AbstractOp::Editor(EditorOp::SetBlock {
                at: Pos {
                    block: 0,
                    offset: 12,
                },
                kind: 0,
            }),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("collaborator".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 12,
                },
                text: "FOREIGN".into(),
            }),
        },
        Step::Run(Millis(1000)),
    ];
    let mut before_script = base.clone();
    before_script.push(Step::Settle);
    let before = Sim::new(config.clone()).run(&before_script);
    invariants::check_all(&before).unwrap();
    before.check_replay().unwrap();
    let expected = before.finals.clients[&ClientName("writer".into())]
        .editor
        .as_ref()
        .unwrap()
        .synced_json
        .clone();
    assert!(expected.to_string().contains("FOREIGN"));
    let foreign = before
        .events
        .iter()
        .find_map(|event| match &event.fact {
            Fact::LocalOp { client, spans, .. } if client.0 == "collaborator" => {
                Some(spans.clone())
            }
            _ => None,
        })
        .expect("actual collaborator edit spans");
    assert!(!foreign.is_empty());
    for redo in [false, true] {
        let mut script = base.clone();
        script.push(Step::Edit {
            client: ClientName("writer".into()),
            op: AbstractOp::Editor(EditorOp::Undo),
        });
        if redo {
            script.push(Step::Edit {
                client: ClientName("writer".into()),
                op: AbstractOp::Editor(EditorOp::Redo),
            });
        }
        script.push(Step::Settle);
        let outcome = Sim::new(config.clone()).run(&script);
        // Keep every check active. Only this exact, source-confirmed historical
        // failure is expected; another failure or an unexpected fix fails this case.
        let failures = invariants::check_all(&outcome).expect_err("strict invariant remains red");
        assert_eq!(failures.len(), 1, "{failures:#?}");
        assert_eq!(failures[0].invariant, "undo_reverts_only_own");
        assert_eq!(
            failures[0].detail,
            "undo removed another client's operations"
        );
        assert!(invariants::undo_reverts_only_own(&outcome).is_err());
        for name in ["writer", "collaborator"] {
            let state = &outcome.finals.clients[&ClientName(name.into())]
                .editor
                .as_ref()
                .unwrap()
                .synced_json;
            assert_eq!(state.to_string().contains("FOREIGN"), redo);
            if redo {
                assert_eq!(state, &expected);
            }
        }
        let server = &outcome.finals.servers[&DocIx(0)];
        for span in &foreign {
            assert!(server.oplog_vv.get(&span.peer).copied().unwrap_or(0) >= span.end);
            assert!(server.persisted_vv.get(&span.peer).copied().unwrap_or(0) >= span.end);
        }
        outcome.check_replay().unwrap();
    }
}
