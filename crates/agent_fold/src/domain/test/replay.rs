//! Transactional load semantics shared by server and browser folds.
use super::util::{TURN, parse_log};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::log::{AgentSessionId, AgentSessionLog};
use crate::domain::model::{FoldEvent, FoldedMessage, MessagePart};
use crate::domain::ports::FoldMachine;
use serde_json::{Value, json};

fn frame(direction: &str, body: Value) -> AgentSessionLog {
    let mut content = body;
    content["type"] = json!("acp");
    content["jsonrpc"] = json!("2.0");
    parse_log(&json!({"direction":direction,"content":content}).to_string())
        .pop()
        .unwrap()
}
fn request(method: &str, id: Value) -> AgentSessionLog {
    frame(
        "to_runtime",
        json!({"id":id,"method":method,"params":{"sessionId":"s","cwd":"/","mcpServers":[]}}),
    )
}
fn result(id: Value) -> AgentSessionLog {
    frame("to_server", json!({"id":id,"result":{}}))
}
fn update(kind: &str, text: &str) -> AgentSessionLog {
    frame(
        "to_server",
        json!({"method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":kind,"content":{"type":"text","text":text}}}}),
    )
}
fn event(name: &str) -> AgentSessionLog {
    parse_log(&json!({"direction":"to_server","content":{"type":"event","event":name}}).to_string())
        .pop()
        .unwrap()
}
fn replay(id: Value) -> Vec<AgentSessionLog> {
    vec![
        request("initialize", json!(0)),
        result(json!(0)),
        request("session/load", id.clone()),
        update("user_message_chunk", "question"),
        update("user_message_chunk", " one"),
        update("agent_thought_chunk", "thinking"),
        update("agent_message_chunk", "answer one"),
        update("user_message_chunk", "question two"),
        update("agent_message_chunk", "answer two"),
        result(id),
    ]
}
fn apply(visible: &mut Vec<FoldedMessage>, event: FoldEvent<'_>) {
    match event {
        FoldEvent::MessagesReplaced(messages) => *visible = messages.into_owned(),
        FoldEvent::NewMessage(message) => visible.push(message.into_owned()),
        FoldEvent::MessageUpdate(message) => {
            let at = visible
                .iter()
                .position(|old| old.id() == message.id())
                .unwrap();
            visible[at] = message.into_owned();
        }
        FoldEvent::MetadataUpdated(_) => {}
    }
}
#[test]
fn repeated_loads_replace_and_every_incremental_prefix_matches_batch() {
    let mut log: Vec<_> = parse_log(TURN).into_iter().collect();
    let boundary = log.len();
    log.extend(replay(json!(1)));
    log.extend(replay(json!(1)));
    let mut machine = FoldMachineImpl::new();
    let mut visible = vec![];
    let mut replacements = 0;
    for (i, entry) in log.iter().enumerate() {
        for event in machine.push(entry.clone()) {
            replacements += usize::from(matches!(event, FoldEvent::MessagesReplaced(_)));
            apply(&mut visible, event.into_owned());
        }
        assert_eq!(visible, machine.messages());
        assert_eq!(visible, fold(log[..=i].iter().cloned()));
    }
    assert_eq!(replacements, 2);
    assert_eq!(visible, fold(log[boundary..].iter().cloned()));
    assert_eq!(visible.len(), 4);
    assert_eq!(
        visible[0].parts.first(),
        Some(&MessagePart::Text {
            text: "question one".into()
        })
    );
    assert!(visible[1].stop.is_some());
    assert!(visible[3].stop.is_none());
    assert_eq!(machine.next_turn_id().0, 2);
}
#[test]
fn incomplete_failed_and_disconnected_loads_preserve_committed_history() {
    let old: Vec<_> = parse_log(TURN).into_iter().collect();
    for ending in [
        None,
        Some(frame(
            "to_server",
            json!({"id":1,"error":{"code":-32603,"message":"failed"}}),
        )),
        Some(event("disconnected")),
        Some(event("acp_ready")),
        Some(request("initialize", json!(0))),
    ] {
        let mut log = old.clone();
        let mut candidate = replay(json!(1));
        candidate.pop();
        log.extend(candidate);
        if let Some(ending) = ending {
            log.push(ending);
        }
        assert_eq!(fold(log), fold(old.clone()));
    }
}
#[test]
fn initialization_new_and_resume_do_not_replace_history() {
    for method in ["initialize", "session/new", "session/resume"] {
        let mut log: Vec<_> = parse_log(TURN).into_iter().collect();
        let old = fold(log.clone());
        log.extend([request(method, json!(42)), result(json!(42))]);
        assert_eq!(fold(log), old);
    }
}
#[test]
fn response_correlation_is_scoped_to_direction_session_and_connection() {
    let mut machine = FoldMachineImpl::new();
    for entry in parse_log(TURN) {
        machine.push(entry);
    }
    let old = machine.messages().to_vec();
    machine.push(request("session/load", json!(7)));
    machine.push(update("agent_message_chunk", "hidden"));
    let mut other = result(json!(7));
    other.agent_session_id = AgentSessionId::TEST_B;
    assert!(machine.push(other).is_empty());
    assert!(
        machine
            .push(frame("to_runtime", json!({"id":7,"result":{}})))
            .is_empty()
    );
    assert!(machine.push(result(json!(8))).is_empty());
    assert_eq!(machine.messages(), old);
    machine.push(event("disconnected"));
    machine.push(result(json!(7)));
    machine.push(event("acp_ready"));
    machine.push(request("session/resume", json!(7)));
    machine.push(result(json!(7)));
    assert_eq!(machine.messages(), old);
    // Reusing an ID on a fresh connection commits only the new candidate.
    machine.push(request("session/load", json!(7)));
    machine.push(update("agent_message_chunk", "fresh"));
    assert!(matches!(
        machine.push(result(json!(7)))[0],
        FoldEvent::MessagesReplaced(_)
    ));
    assert_eq!(machine.messages().len(), 1);
}
#[test]
fn foreign_acp_session_updates_do_not_enter_candidate_and_empty_load_clears_history() {
    let mut machine = FoldMachineImpl::new();
    for entry in parse_log(TURN) {
        machine.push(entry);
    }
    machine.push(request("session/load", json!(3)));
    machine.push(frame("to_server", json!({"method":"session/update","params":{"sessionId":"other","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"foreign"}}}})));
    let events = machine.push(result(json!(3)));
    assert!(matches!(&events[0], FoldEvent::MessagesReplaced(messages) if messages.is_empty()));
    assert!(machine.messages().is_empty());
}

#[test]
fn shared_browser_fixture_commits_only_completed_loads_and_keeps_tools() {
    let log = parse_log(include_str!("../../../fixtures/load_replacement.jsonl"));
    let messages = fold(log);
    let texts: Vec<_> = messages
        .iter()
        .flat_map(|message| message.parts.iter())
        .filter_map(|part| match part {
            MessagePart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(texts, ["question", "answer", "next", "continued"]);
    assert!(
        messages
            .iter()
            .flat_map(|message| message.parts.iter())
            .any(|part| matches!(
                part,
                MessagePart::ToolUse {
                    status: crate::domain::model::ToolStatus::Completed,
                    ..
                }
            ))
    );
    assert_eq!(messages.len(), 4);
}

#[test]
fn replay_metadata_is_staged_and_replaces_old_metadata_only_on_success() {
    let info = |title| {
        frame(
            "to_server",
            json!({"method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"session_info_update","title":title}}}),
        )
    };
    let mut machine = FoldMachineImpl::new();
    machine.push(info("old"));
    machine.push(request("session/load", json!(9)));
    assert!(machine.push(info("failed candidate")).is_empty());
    assert_eq!(machine.metadata().title.as_deref(), Some("old"));
    machine.push(frame(
        "to_server",
        json!({"id":9,"error":{"code":-32603,"message":"failed"}}),
    ));
    assert_eq!(machine.metadata().title.as_deref(), Some("old"));
    machine.push(request("session/load", json!(9)));
    machine.push(info("committed"));
    machine.push(result(json!(9)));
    assert_eq!(machine.metadata().title.as_deref(), Some("committed"));
    machine.push(request("session/load", json!(10)));
    machine.push(result(json!(10)));
    assert_eq!(
        machine.metadata().title,
        None,
        "old metadata does not leak into a fresh replay"
    );
}

#[test]
fn live_chunks_after_load_continue_the_last_replayed_turn() {
    let mut machine = FoldMachineImpl::new();
    for entry in replay(json!(1)) {
        machine.push(entry);
    }
    machine.push(update("agent_message_chunk", " continued"));
    assert_eq!(machine.messages().len(), 4);
    assert_eq!(machine.next_turn_id().0, 2);
    assert_eq!(
        machine.messages()[3].parts.first(),
        Some(&MessagePart::Text {
            text: "answer two continued".into()
        })
    );
}

#[test]
fn malformed_load_results_match_session_machine_rejection_and_quarantine_late_frames() {
    use agent_client_protocol::schema::v1::LoadSessionResponse;
    for malformed in [json!(null), json!(42), json!("invalid"), json!(false)] {
        assert!(serde_json::from_value::<LoadSessionResponse>(malformed.clone()).is_err());
        let mut machine = FoldMachineImpl::new();
        for entry in parse_log(TURN) {
            machine.push(entry);
        }
        let old = machine.messages().to_vec();
        machine.push(request("session/load", json!(7)));
        machine.push(update("user_message_chunk", "partial"));
        assert!(
            machine
                .push(frame("to_server", json!({"id":7,"result":malformed})))
                .is_empty()
        );
        // Neither a late chunk nor a second result can resurrect this attempt.
        assert!(
            machine
                .push(update("agent_message_chunk", "late"))
                .is_empty()
        );
        assert!(machine.push(result(json!(7))).is_empty());
        assert_eq!(machine.messages(), old);
        machine.push(request("session/load", json!(7)));
        machine.push(update("agent_message_chunk", "valid retry"));
        assert!(matches!(
            machine.push(result(json!(7)))[0],
            FoldEvent::MessagesReplaced(_)
        ));
    }
}

#[test]
fn late_replay_is_quarantined_after_failure_disconnect_and_initialization_at_every_prefix() {
    for boundary in [
        frame(
            "to_server",
            json!({"id":7,"error":{"code":-32603,"message":"failed"}}),
        ),
        event("disconnected"),
        event("acp_ready"),
        request("initialize", json!(0)),
    ] {
        let mut log = parse_log(TURN);
        let old = fold(log.clone());
        log.extend([
            request("session/load", json!(7)), update("user_message_chunk", "partial"), boundary,
            update("agent_message_chunk", "late after boundary"),
            event("acp_ready"), update("agent_message_chunk", "late after ready"),
            request("initialize", json!(0)), result(json!(0)),
            update("agent_thought_chunk", "late after init"),
            frame("to_server", json!({"method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"late","title":"late tool","kind":"read","status":"pending"}}})),
            frame("to_server", json!({"method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"session_info_update","title":"late title"}}})),
            result(json!(7)),
        ]);
        let mut machine = FoldMachineImpl::new();
        let mut visible = vec![];
        for (index, entry) in log.iter().enumerate() {
            for event in machine.push(entry.clone()) {
                apply(&mut visible, event);
            }
            assert_eq!(visible, fold(log[..=index].iter().cloned()));
        }
        assert_eq!(visible, old);
        assert_ne!(machine.metadata().title.as_deref(), Some("late title"));
        // Reuse the same request ID in the new epoch; only the new replay commits.
        machine.push(request("session/load", json!(7)));
        machine.push(update("agent_message_chunk", "fresh replay"));
        machine.push(result(json!(7)));
        assert_eq!(machine.messages().len(), 1);
    }
}

#[test]
fn quarantine_ends_only_at_a_valid_live_boundary_without_resetting_history() {
    for method in ["session/prompt", "session/new", "session/resume"] {
        let mut machine = FoldMachineImpl::new();
        for entry in parse_log(TURN) {
            machine.push(entry);
        }
        let old = machine.messages().to_vec();
        machine.push(request("session/load", json!(7)));
        machine.push(frame(
            "to_server",
            json!({"id":7,"error":{"code":-32603,"message":"failed"}}),
        ));
        machine.push(event("acp_ready"));
        machine.push(request("initialize", json!(0)));
        machine.push(result(json!(0)));
        if method == "session/prompt" {
            // An invalid or foreign-session prompt does not release quarantine.
            machine.push(request(method, json!(8)));
            machine.push(frame(
                "to_runtime",
                json!({"id":8,"method":method,"params":{"sessionId":"other","prompt":[]}}),
            ));
            assert!(
                machine
                    .push(update("agent_message_chunk", "still late"))
                    .is_empty()
            );
            machine.push(frame("to_runtime", json!({"id":8,"method":method,"params":{"sessionId":"s","prompt":[{"type":"text","text":"live prompt"}]}})));
        } else {
            machine.push(request(method, json!(8)));
            assert!(
                machine
                    .push(update("agent_message_chunk", "late before open response"))
                    .is_empty()
            );
            machine.push(frame("to_server", json!({"id":8,"result":false})));
            assert!(
                machine
                    .push(update(
                        "agent_message_chunk",
                        "late after malformed open response"
                    ))
                    .is_empty()
            );
            machine.push(request(method, json!(8)));
            assert!(machine.push(result(json!(99))).is_empty());
            let body = if method == "session/new" {
                json!({"sessionId":"s"})
            } else {
                json!({})
            };
            machine.push(frame("to_server", json!({"id":8,"result":body})));
            assert_eq!(machine.messages(), old);
        }
        assert!(
            !machine
                .push(update("agent_message_chunk", "live reply"))
                .is_empty()
        );
        assert_eq!(&machine.messages()[..old.len()], &old);
    }
}

#[test]
fn load_optional_field_fallback_matches_generic_session_machine() {
    // ACP's schema defaults malformed optional fields rather than rejecting
    // the response. The fold must not be stricter than SessionMachine.
    for body in [
        json!({}),
        json!({"configOptions":"invalid"}),
        json!({"modes":false}),
    ] {
        assert!(
            serde_json::from_value::<agent_client_protocol::schema::v1::LoadSessionResponse>(
                body.clone()
            )
            .is_ok()
        );
        let mut machine = FoldMachineImpl::new();
        machine.push(request("session/load", json!(7)));
        machine.push(update("agent_message_chunk", "replayed"));
        assert!(matches!(
            machine.push(frame("to_server", json!({"id":7,"result":body})))[0],
            FoldEvent::MessagesReplaced(_)
        ));
    }
}

#[test]
fn legacy_success_then_failed_hydration_preserves_full_history_until_standard_empty_load() {
    let mut log = parse_log(TURN);
    let expected = fold(log.clone());
    assert!(!expected.is_empty());
    log.push(event("disconnected"));
    log.push(request("initialize", json!(0)));
    log.push(result(json!(0)));
    let mut legacy = request("session/load", json!(1));
    legacy.legacy_load = true;
    log.push(legacy);
    log.push(result(json!(1)));
    assert_eq!(fold(log.clone()), expected);
    log.extend([
        request("initialize", json!(0)),
        result(json!(0)),
        request("session/load", json!(1)),
        update("user_message_chunk", "partial hydration"),
        update("agent_message_chunk", "must not appear"),
        frame(
            "to_server",
            json!({"id":1,"error":{"code":-32603,"message":"history unavailable"}}),
        ),
    ]);
    assert_eq!(fold(log.clone()), expected);
    // No provider identity or proprietary marker is needed, even for an empty replay.
    log.extend([
        request("initialize", json!(0)),
        result(json!(0)),
        request("session/load", json!(1)),
        result(json!(1)),
    ]);
    let mut machine = FoldMachineImpl::new();
    let mut visible = vec![];
    let mut replacements = 0;
    for (index, entry) in log.iter().enumerate() {
        for event in machine.push(entry.clone()) {
            replacements += usize::from(matches!(event, FoldEvent::MessagesReplaced(_)));
            apply(&mut visible, event.into_owned());
        }
        assert_eq!(visible, fold(log[..=index].iter().cloned()));
    }
    assert_eq!(replacements, 1);
    assert!(visible.is_empty());
}

#[test]
fn persisted_legacy_context_fixture_matches_browser_history() {
    let log = parse_log(include_str!("../../../fixtures/legacy_load_context.jsonl"));
    let expected = fold(log[..6].iter().cloned());
    assert_eq!(expected.len(), 4);
    for end in 6..log.len() {
        assert_eq!(fold(log[..end].iter().cloned()), expected, "prefix {end}");
    }
    assert!(fold(log).is_empty());
}

#[test]
fn generic_terminal_facts_restore_stops_without_changing_load_success_semantics() {
    use crate::domain::model::StopReason;
    for (outcome, expected) in [
        (json!({"kind":"finished"}), StopReason::EndTurn),
        (json!({"kind":"cancelled"}), StopReason::Cancelled),
        (
            json!({"kind":"failed","message":"provider failed"}),
            StopReason::Failed {
                message: "provider failed".into(),
            },
        ),
    ] {
        let mut log = vec![
            request("session/load", json!(1)),
            update("user_message_chunk", "question"),
            update("agent_message_chunk", "answer"),
        ];
        log.push(frame(
            "to_server",
            json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":outcome}}),
        ));
        log.push(result(json!(1)));
        let mut machine = FoldMachineImpl::new();
        let mut visible = Vec::new();
        for (i, entry) in log.iter().enumerate() {
            for event in machine.push(entry.clone()) {
                apply(&mut visible, event.into_owned());
            }
            assert_eq!(visible, fold(log[..=i].iter().cloned()));
        }
        assert_eq!(visible[1].stop, Some(expected));
        // A subsequent ordinary successful empty load still clears history.
        log.extend([request("session/load", json!(2)), result(json!(2))]);
        assert!(fold(log).is_empty());
    }
}

#[test]
fn absent_terminal_fact_retains_partial_tail_for_continuation_and_failed_load_discards_facts() {
    let mut log = vec![
        request("session/load", json!(1)),
        update("user_message_chunk", "question"),
        update("agent_message_chunk", "hel"),
        result(json!(1)),
    ];
    assert_eq!(fold(log.clone())[1].stop, None);
    log.push(update("agent_message_chunk", "lo"));
    let complete = frame(
        "to_server",
        json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}),
    );
    log.push(complete.clone());
    let finished = fold(log.clone());
    assert_eq!(finished.len(), 2);
    assert_eq!(
        finished[1].parts.first(),
        Some(&MessagePart::Text {
            text: "hello".into()
        })
    );
    assert_eq!(
        finished[1].stop,
        Some(crate::domain::model::StopReason::EndTurn)
    );
    log.extend([
        request("session/load", json!(2)),
        update("user_message_chunk", "wrong"),
        update("agent_message_chunk", "wrong"),
        complete,
        frame(
            "to_server",
            json!({"id":2,"error":{"code":-32603,"message":"failed"}}),
        ),
    ]);
    assert_eq!(fold(log), finished);
}

#[test]
fn recovered_user_boundaries_open_new_turns_and_never_echo_a_correlated_prompt() {
    let mut log = vec![
        request("session/load", json!(1)),
        update("user_message_chunk", "older"),
        update("agent_message_chunk", "answer"),
        result(json!(1)),
        frame(
            "to_server",
            json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}),
        ),
        update("user_message_chunk", "newer"),
        update("agent_message_chunk", "next answer"),
        frame(
            "to_server",
            json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}),
        ),
    ];
    let recovered = fold(log.clone());
    assert_eq!(recovered.len(), 4);
    assert_eq!(recovered[0].id, recovered[1].id);
    assert_eq!(recovered[2].id, recovered[3].id);
    assert_ne!(recovered[0].id, recovered[2].id);
    log.push(frame("to_runtime", json!({"id":9,"method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"local"}]}})));
    log.push(update("user_message_chunk", "local"));
    log.push(update("agent_message_chunk", "live answer"));
    log.push(frame("to_server", json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}})));
    let pending = fold(log.clone());
    assert_eq!(pending.len(), 6);
    assert!(
        pending[5].stop.is_none(),
        "a lifecycle fact cannot complete a correlated pending prompt"
    );
    log.push(frame(
        "to_server",
        json!({"id":9,"result":{"stopReason":"end_turn"}}),
    ));
    assert_eq!(
        fold(log)[5].stop,
        Some(crate::domain::model::StopReason::EndTurn)
    );
}

fn snapshot(id: &str, phase: &str) -> AgentSessionLog {
    frame(
        "to_server",
        json!({"method":"_session/history_snapshot","params":{"sessionId":"s","snapshotId":id,"phase":phase}}),
    )
}

#[test]
fn history_snapshot_stages_older_history_and_restores_pending_request_after_it() {
    let mut log = vec![frame(
        "to_runtime",
        json!({"id":31,"method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"new question"}]}}),
    )];
    let pending = fold(log.clone());
    log.extend([snapshot("a", "begin"), update("user_message_chunk", "old question"), update("agent_message_chunk", "old answer"), frame("to_server", json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}))]);
    assert_eq!(fold(log.clone()), pending, "history is hidden until commit");
    log.push(snapshot("wrong", "commit"));
    assert_eq!(
        fold(log.clone()),
        pending,
        "unmatched commit cannot replace"
    );
    log.push(snapshot("a", "commit"));
    let staged = fold(log.clone());
    assert_eq!(staged.len(), 3);
    assert_eq!(staged[0].id, staged[1].id);
    assert_eq!(
        staged[2].parts.first(),
        Some(&MessagePart::Text {
            text: "new question".into()
        })
    );
    log.extend([
        update("agent_message_chunk", "new answer"),
        frame(
            "to_server",
            json!({"id":31,"result":{"stopReason":"end_turn"}}),
        ),
    ]);
    let mut machine = FoldMachineImpl::new();
    let mut visible = Vec::new();
    for (i, entry) in log.iter().enumerate() {
        for event in machine.push(entry.clone()) {
            apply(&mut visible, event.into_owned());
        }
        assert_eq!(visible, fold(log[..=i].iter().cloned()));
    }
    assert_eq!(visible.len(), 4);
    assert_ne!(visible[0].id, visible[2].id);
    assert_eq!(visible[2].id, visible[3].id);
}

#[test]
fn incomplete_history_snapshot_never_commits_on_response_or_disconnect() {
    for disconnect in [false, true] {
        let pending_request = frame(
            "to_runtime",
            json!({"id":31,"method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"pending"}]}}),
        );
        let mut log = vec![
            pending_request,
            snapshot("a", "begin"),
            update("user_message_chunk", "wrong"),
            update("agent_message_chunk", "wrong"),
        ];
        if disconnect {
            log.push(event("disconnected"));
        } else {
            log.push(frame(
                "to_server",
                json!({"id":31,"error":{"code":-32603,"message":"failed"}}),
            ));
        }
        let expected = fold(log.clone());
        log.extend([
            update("agent_message_chunk", "late"),
            snapshot("a", "commit"),
        ]);
        assert_eq!(fold(log.clone()), expected);
        log.extend([
            request("initialize", json!(40)),
            result(json!(40)),
            request("session/load", json!(41)),
            result(json!(41)),
        ]);
        assert!(
            fold(log).is_empty(),
            "standard successful empty load still replaces"
        );
    }
}

#[test]
fn overlapping_snapshot_contents_never_enter_load_candidate() {
    for begin_before_load in [false, true] {
        for succeeds in [false, true] {
            let mut log = replay(json!(1));
            let previous = fold(log.clone());
            if begin_before_load {
                log.extend([
                    snapshot("overlap", "begin"),
                    update("user_message_chunk", "partial"),
                ]);
            }
            log.push(request("session/load", json!(2)));
            if !begin_before_load {
                log.push(snapshot("overlap", "begin"));
            }
            log.extend([
                update("user_message_chunk", "question"),
                update("agent_message_chunk", "snapshot answer"),
                snapshot("wrong", "commit"),
                update("agent_message_chunk", "still snapshot"),
                snapshot("overlap", "commit"),
                update("user_message_chunk", "question"),
                update("agent_message_chunk", "load answer"),
            ]);
            assert_eq!(fold(log.clone()), previous);
            log.push(if succeeds {
                result(json!(2))
            } else {
                frame(
                    "to_server",
                    json!({"id":2,"error":{"code":-32603,"message":"failed"}}),
                )
            });
            let mut machine = FoldMachineImpl::new();
            let mut visible = Vec::new();
            for (i, entry) in log.iter().enumerate() {
                for event in machine.push(entry.clone()) {
                    apply(&mut visible, event.into_owned());
                }
                assert_eq!(visible, fold(log[..=i].iter().cloned()));
            }
            if succeeds {
                assert_eq!(visible.len(), 2);
                assert_eq!(
                    visible[1].parts.iter().cloned().collect::<Vec<_>>(),
                    vec![MessagePart::Text {
                        text: "load answer".into()
                    }]
                );
            } else {
                assert_eq!(visible, previous);
            }
        }
    }
}
