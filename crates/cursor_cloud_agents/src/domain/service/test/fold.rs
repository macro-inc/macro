//! Actual served Cursor load frames, folded by the same generic machine as WASM.
use super::*;
use crate::inbound::acp::{AcpNotifier, serve_transport};
use agent_client_protocol::{Channel, RawJsonRpcMessage, TransportFrame};
use agent_fold::domain::log::{AgentSessionId, AgentSessionLog, Message};
use agent_fold::domain::model::FoldedMessage;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage};

pub(super) async fn replay(journal: Arc<dyn CursorJournal>, id: SessionId) -> Vec<FoldedMessage> {
    replay_with_tail(journal, id, None).await
}

pub(super) async fn replay_with_tail(
    journal: Arc<dyn CursorJournal>,
    id: SessionId,
    tail: Option<Vec<CursorEvent>>,
) -> Vec<FoldedMessage> {
    replay_with_runs(
        journal,
        id,
        tail.map(|events| vec![(CursorRunId::new("run"), events)]),
    )
    .await
}

pub(super) async fn replay_with_runs(
    journal: Arc<dyn CursorJournal>,
    id: SessionId,
    runs: Option<Vec<(CursorRunId, Vec<CursorEvent>)>>,
) -> Vec<FoldedMessage> {
    let notifier = AcpNotifier::new();
    let cursor = FakeCursor::new();
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(None),
        journal,
    ));
    service.restore_session(id.clone(), Some(CursorAgentId::new("agent")), None, None);
    let (agent, mut client) = Channel::duplex();
    let task = tokio::spawn(serve_transport(service.clone(), notifier, agent));
    let mut log = Vec::new();
    let mut previous = None;
    for request_id in [91, 92] {
        let request: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
            "jsonrpc":"2.0", "id":request_id, "method":"session/load",
            "params":{"sessionId":id,"cwd":"/workspace","mcpServers":[]}
        }))
        .unwrap();
        log.push(entry(Message::ToRuntime(ToRuntimeMessage::Acp(
            AcpMessage(request.clone()),
        ))));
        client
            .tx
            .unbounded_send(TransportFrame::Single(request))
            .unwrap();
        loop {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(5), client.rx.next())
                .await
                .unwrap()
                .unwrap();
            let TransportFrame::Single(frame) = frame else {
                panic!("single frame")
            };
            let value = serde_json::to_value(&frame).unwrap();
            let response = value["id"] == request_id;
            if response {
                assert!(value.get("result").is_some(), "{value}");
            }
            log.push(entry(Message::ToServer(ToServerMessage::Acp(AcpMessage(
                frame,
            )))));
            if response {
                break;
            }
        }
        assert_incremental_matches_batch(&log);
        let messages = agent_fold::domain::fold::fold(log.clone());
        if let Some(previous) = &previous {
            assert_eq!(
                previous,
                &serde_json::to_value(&messages).unwrap(),
                "repeated actual loads replace the same conversation"
            );
        }
        previous = Some(serde_json::to_value(&messages).unwrap());
    }
    if let Some(runs) = runs {
        cursor.script_run_listings(
            runs.iter()
                .rev()
                .map(|(run, _)| RunListing {
                    id: run.clone(),
                    status: RunStatus::Finished,
                })
                .collect(),
        );
        for (_, tail) in runs {
            let events = cursor.script_stream();
            for event in tail {
                events.send(event).unwrap();
            }
            drop(events);
        }
        service.sync_foreign_runs().await;
        loop {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(5), client.rx.next())
                .await
                .unwrap()
                .unwrap();
            let TransportFrame::Single(frame) = frame else {
                panic!("single frame")
            };
            let value = serde_json::to_value(&frame).unwrap();
            let complete = value["method"] == "_session/history_snapshot"
                && value["params"]["phase"] == "commit";
            log.push(entry(Message::ToServer(ToServerMessage::Acp(AcpMessage(
                frame,
            )))));
            if complete {
                break;
            }
        }
    }
    task.abort();
    assert_incremental_matches_batch(&log);
    agent_fold::domain::fold::fold(log)
}

fn entry(content: Message) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: AgentSessionId::TEST_A,
        user_id: None,
        content,
    }
}

fn assert_incremental_matches_batch(log: &[AgentSessionLog]) {
    use agent_fold::domain::model::FoldEvent;
    use agent_fold::domain::ports::FoldMachine;
    let mut machine = agent_fold::domain::fold::FoldMachineImpl::new();
    let mut visible: Vec<FoldedMessage> = Vec::new();
    for (i, entry) in log.iter().enumerate() {
        for event in machine.push(entry.clone()) {
            match event {
                FoldEvent::MessagesReplaced(messages) => visible = messages.into_owned(),
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
        assert_eq!(
            visible,
            agent_fold::domain::fold::fold(log[..=i].iter().cloned()),
            "actual Cursor wire prefix {i}"
        );
    }
}

#[tokio::test]
async fn actual_live_backfill_keeps_older_answer_out_of_pending_or_cancelled_prompt() {
    for (cancel, late) in [(false, false), (true, false), (false, true)] {
        let cursor = FakeCursor::new();
        let notifier = AcpNotifier::new();
        let journal = Arc::new(crate::outbound::memory_journal::MemoryJournal::default());
        let service = Arc::new(CursorSessionService::new(
            cursor.clone(),
            notifier.clone(),
            FixedRepos(None),
            journal.clone(),
        ));
        let id = service.new_session(Path::new(""), vec![]);
        service.session(&id).unwrap().state.lock().unwrap().agent =
            Some(CursorAgentId::new("agent"));
        let late_gate = if late {
            Some(cursor.script_create_gate())
        } else {
            None
        };
        if !late {
            cursor.script_run_listings(vec![RunListing {
                id: CursorRunId::new("R1"),
                status: RunStatus::Running,
            }]);
        }
        let older = cursor.script_stream();
        older
            .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
                text: "R1".into(),
            }))
            .unwrap();
        older
            .send(CursorEvent::Assistant {
                text: "older".into(),
            })
            .unwrap();
        if !cancel {
            let newer = cursor.script_stream();
            newer
                .send(CursorEvent::Assistant {
                    text: "newer".into(),
                })
                .unwrap();
            newer.send(finished("run-fake-1")).unwrap();
            newer.send(CursorEvent::Done).unwrap();
        }
        let (agent, mut client) = Channel::duplex();
        let task = tokio::spawn(serve_transport(service.clone(), notifier, agent));
        let prompt: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({"jsonrpc":"2.0","id":41,"method":"session/prompt","params":{"sessionId":id,"prompt":[{"type":"text","text":"R2"}]}})).unwrap();
        let mut log = vec![entry(Message::ToRuntime(ToRuntimeMessage::Acp(
            AcpMessage(prompt.clone()),
        )))];
        client
            .tx
            .unbounded_send(TransportFrame::Single(prompt))
            .unwrap();
        if let Some(gate) = late_gate {
            cursor
                .wait_for_calls(1, |call| matches!(call, CursorCall::CreateRun(..)))
                .await;
            cursor.script_run_listings(vec![
                RunListing {
                    id: CursorRunId::new("run-fake-1"),
                    status: RunStatus::Running,
                },
                RunListing {
                    id: CursorRunId::new("R1"),
                    status: RunStatus::Running,
                },
            ]);
            gate.send(()).unwrap();
        }
        loop {
            if journal
                .read(&id)
                .await
                .unwrap()
                .iter()
                .any(|e| matches!(e.input, JournalInput::Sse(_)))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        if cancel {
            let stop: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":id}})).unwrap();
            log.push(entry(Message::ToRuntime(ToRuntimeMessage::Acp(
                AcpMessage(stop.clone()),
            ))));
            client
                .tx
                .unbounded_send(TransportFrame::Single(stop))
                .unwrap();
            cursor
                .wait_for_calls(1, |call| matches!(call, CursorCall::CancelRun(..)))
                .await;
        }
        older.send(finished("R1")).unwrap();
        older.send(CursorEvent::Done).unwrap();
        loop {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(5), client.rx.next())
                .await
                .unwrap()
                .unwrap();
            let TransportFrame::Single(frame) = frame else {
                panic!("single frame")
            };
            let value = serde_json::to_value(&frame).unwrap();
            let done = value["id"] == 41;
            if done {
                assert!(value.get("result").is_some(), "{value}");
            }
            log.push(entry(Message::ToServer(ToServerMessage::Acp(AcpMessage(
                frame,
            )))));
            if done {
                break;
            }
        }
        assert_incremental_matches_batch(&log);
        let messages = agent_fold::domain::fold::fold(log);
        let conversation: Vec<_> = messages
            .iter()
            .filter(|m| {
                m.parts
                    .iter()
                    .any(|p| matches!(p, agent_fold::domain::model::MessagePart::Text { .. }))
            })
            .collect();
        let texts: Vec<_> = conversation
            .iter()
            .map(|m| {
                m.parts
                    .iter()
                    .filter_map(|p| match p {
                        agent_fold::domain::model::MessagePart::Text { text } => {
                            Some(text.as_str())
                        }
                        _ => None,
                    })
                    .collect::<String>()
            })
            .collect();
        assert_eq!(
            texts,
            if cancel {
                vec!["R1", "older", "R2", ""]
            } else {
                vec!["R1", "older", "R2", "newer"]
            }
        );
        assert_eq!(conversation[0].id, conversation[1].id);
        assert_eq!(conversation[2].id, conversation[3].id);
        assert_ne!(conversation[0].id, conversation[2].id);
        assert_eq!(
            conversation[1].stop,
            Some(agent_fold::domain::model::StopReason::EndTurn)
        );
        assert_eq!(
            conversation[3].stop,
            Some(if cancel {
                agent_fold::domain::model::StopReason::Cancelled
            } else {
                agent_fold::domain::model::StopReason::EndTurn
            })
        );
        if cancel {
            assert!(!cursor.calls().iter().any(|call| matches!(
                call,
                CursorCall::CreateRun(..) | CursorCall::CreateAgent(..)
            )));
        }
        task.abort();
    }
}

#[tokio::test]
async fn accepted_newer_run_survives_partial_crash_load_then_actual_sync_without_stealing_turn() {
    let (service, _, _) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let session = service.session(&id).unwrap();
    service.ensure_journal(&id, &session).await.unwrap();
    service
        .capture(
            &id,
            &session,
            None,
            JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new("R2"))]),
            false,
        )
        .await
        .unwrap();
    let r1 = CursorRunId::new("R1");
    let r2 = CursorRunId::new("R2");
    service
        .capture(
            &id,
            &session,
            Some(&r2),
            JournalInput::PromptAccepted(2),
            false,
        )
        .await
        .unwrap();
    let opened = CursorEvent::ToolCall(ToolCallEvent {
        call_id: "old-tool".into(),
        name: "shell".into(),
        args: None,
        result: None,
        status: None,
        truncated: Truncation::default(),
    });
    let prefix = vec![
        CursorEvent::Interaction(InteractionUpdate::UserMessage { text: "R1".into() }),
        CursorEvent::Assistant { text: "ol".into() },
        opened.clone(),
    ];
    for event in &prefix {
        service
            .capture(
                &id,
                &session,
                Some(&r1),
                JournalInput::Sse(crate::domain::journal::NativeRecord::scripted(
                    event.clone(),
                )),
                false,
            )
            .await
            .unwrap();
    }
    let loaded = replay(service.journal.clone(), id.clone()).await;
    assert_eq!(
        loaded.len(),
        2,
        "R2 must remain deferred beyond the unfinished R1"
    );
    assert_eq!(
        loaded[0].parts.first(),
        Some(&agent_fold::domain::model::MessagePart::Text { text: "R1".into() })
    );
    assert!(
        loaded[1].stop.is_none(),
        "a queued acceptance is not a terminal fact for R1"
    );
    let CursorEvent::ToolCall(mut completed) = opened else {
        unreachable!()
    };
    completed.status = Some("completed".into());
    completed.result = Some(serde_json::json!("done"));
    let mut recovered = prefix;
    recovered.extend([
        CursorEvent::Assistant { text: "der".into() },
        CursorEvent::ToolCall(completed),
        finished("R1"),
        CursorEvent::Done,
    ]);
    let messages = replay_with_runs(
        service.journal.clone(),
        id,
        Some(vec![
            (r1, recovered),
            (
                r2,
                vec![
                    CursorEvent::Assistant {
                        text: "newer".into(),
                    },
                    finished("R2"),
                    CursorEvent::Done,
                ],
            ),
        ]),
    )
    .await;
    let texts: Vec<_> = messages
        .iter()
        .map(|m| {
            m.parts
                .iter()
                .filter_map(|p| match p {
                    agent_fold::domain::model::MessagePart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<String>()
        })
        .collect();
    assert_eq!(texts, ["R1", "older", "R2", "newer"]);
    assert_eq!(messages[0].id, messages[1].id);
    assert_eq!(messages[2].id, messages[3].id);
    assert_ne!(messages[0].id, messages[2].id);
    assert_eq!(
        messages[1].stop,
        Some(agent_fold::domain::model::StopReason::EndTurn)
    );
    assert_eq!(
        messages[3].stop,
        Some(agent_fold::domain::model::StopReason::EndTurn)
    );
}

#[tokio::test]
async fn load_waiting_for_active_snapshot_replays_one_copy_through_fold() {
    let cursor = FakeCursor::new();
    let notifier = AcpNotifier::new();
    let journal = Arc::new(crate::outbound::memory_journal::MemoryJournal::default());
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(None),
        journal.clone(),
    ));
    let id = service.new_session(Path::new(""), vec![]);
    service.session(&id).unwrap().state.lock().unwrap().agent = Some(CursorAgentId::new("agent"));
    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("R1"),
        status: RunStatus::Running,
    }]);
    let older = cursor.script_stream();
    older
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "question".into(),
        }))
        .unwrap();
    older
        .send(CursorEvent::Assistant {
            text: "answer".into(),
        })
        .unwrap();
    let (agent, mut client) = Channel::duplex();
    let task = tokio::spawn(serve_transport(service.clone(), notifier, agent));
    let producer = tokio::spawn({
        let service = service.clone();
        async move { service.sync_foreign_runs().await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if journal
                .read(&id)
                .await
                .unwrap()
                .iter()
                .filter(|e| matches!(e.input, JournalInput::Sse(_)))
                .count()
                >= 2
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        service.has_active_turn(),
        "snapshot producer holds the turn gate"
    );
    let request: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc":"2.0", "id":91, "method":"session/load",
        "params":{"sessionId":id,"cwd":"/workspace","mcpServers":[]}
    }))
    .unwrap();
    let mut log = vec![entry(Message::ToRuntime(ToRuntimeMessage::Acp(
        AcpMessage(request.clone()),
    )))];
    client
        .tx
        .unbounded_send(TransportFrame::Single(request))
        .unwrap();
    older.send(finished("R1")).unwrap();
    older.send(CursorEvent::Done).unwrap();
    let mut methods = Vec::new();
    loop {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(5), client.rx.next())
            .await
            .unwrap()
            .unwrap();
        let TransportFrame::Single(frame) = frame else {
            panic!("single frame")
        };
        let value = serde_json::to_value(&frame).unwrap();
        let response = value["id"] == 91;
        methods.push((
            value["method"].as_str().unwrap_or("response").to_owned(),
            value["params"]["phase"].as_str().unwrap_or("").to_owned(),
        ));
        if response {
            assert!(value.get("result").is_some(), "{value}");
        }
        log.push(entry(Message::ToServer(ToServerMessage::Acp(AcpMessage(
            frame,
        )))));
        if response {
            break;
        }
    }
    producer.await.unwrap();
    task.abort();
    let begin = methods
        .iter()
        .position(|(m, p)| m == "_session/history_snapshot" && p == "begin")
        .unwrap();
    let commit = methods
        .iter()
        .position(|(m, p)| m == "_session/history_snapshot" && p == "commit")
        .unwrap();
    assert!(begin < commit);
    assert!(
        methods[begin + 1..commit]
            .iter()
            .any(|(m, _)| m == "session/update")
    );
    assert!(
        methods[commit + 1..methods.len() - 1]
            .iter()
            .any(|(m, _)| m == "session/update")
    );
    assert_incremental_matches_batch(&log);
    let messages = agent_fold::domain::fold::fold(log);
    assert_eq!(
        messages.len(),
        2,
        "snapshot and load must display one conversation copy"
    );
    assert_eq!(
        messages[0].parts.iter().cloned().collect::<Vec<_>>(),
        vec![agent_fold::domain::model::MessagePart::Text {
            text: "question".into()
        }]
    );
    assert_eq!(
        messages[1].parts.iter().cloned().collect::<Vec<_>>(),
        vec![agent_fold::domain::model::MessagePart::Text {
            text: "answer".into()
        }]
    );
    assert_eq!(
        messages[1].stop,
        Some(agent_fold::domain::model::StopReason::EndTurn)
    );
}
