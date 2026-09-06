use super::*;
use crate::testing::fixture_sse;

#[test]
fn complete_native_fixtures_roundtrip_with_prompts_tools_and_terminal_states() {
    for name in [
        "multi_turn_1.sse",
        "multi_turn_2.sse",
        "file_operations.sse",
        "cancelled.sse",
        "mcp_servers.sse",
    ] {
        let run = CursorRunId::new(name);
        let raw = fixture_sse(name);
        let inputs: Vec<_> = crate::replay::records(&raw)
            .into_iter()
            .map(JournalInput::Sse)
            .collect();
        let mut live = ReplayMachine::default();
        let live: Vec<_> = inputs
            .iter()
            .flat_map(|input| live.push(Some(&run), input).unwrap())
            .collect();
        let stored = serde_json::to_string(&inputs).unwrap();
        let restored: Vec<JournalInput> = serde_json::from_str(&stored).unwrap();
        let mut replay = ReplayMachine::default();
        let replay: Vec<_> = restored
            .iter()
            .flat_map(|input| replay.push(Some(&run), input).unwrap())
            .collect();
        assert_eq!(live, replay, "{name}");
        assert!(
            live.iter()
                .any(|u| matches!(u, SessionUpdate::UserMessageChunk(_))),
            "original prompt missing in {name}"
        );
        assert_eq!(live, crate::replay::complete_updates(&raw, &run).unwrap());
    }
}

#[test]
fn polling_appends_only_missing_suffix_and_never_repeats_a_final_answer() {
    let run = CursorRunId::new("r");
    let mut machine = ReplayMachine::default();
    machine
        .push(
            Some(&run),
            &JournalInput::Sse(NativeRecord::scripted(CursorEvent::Assistant {
                text: "hel".into(),
            })),
        )
        .unwrap();
    let poll = JournalInput::Poll(
        r#"{"status":"FINISHED","result":"hello","unknown":{"keep":true}}"#.into(),
    );
    let updates = machine.push(Some(&run), &poll).unwrap();
    assert!(
        matches!(&updates[..], [SessionUpdate::AgentMessageChunk(c)] if matches!(&c.content, ContentBlock::Text(t) if t.text == "lo"))
    );
    assert!(machine.push(Some(&run), &poll).unwrap().is_empty());
    assert!(
        machine
            .push(
                Some(&run),
                &JournalInput::Poll(r#"{"status":"FINISHED","result":"different"}"#.into())
            )
            .is_err()
    );
}

#[test]
fn original_blocks_suppress_the_provider_prompt_echo_once_per_run() {
    let run = CursorRunId::new("r");
    let mut machine = ReplayMachine::default();
    let blocks = vec![
        ContentBlock::Text(TextContent::new("original")),
        ContentBlock::Text(TextContent::new("content")),
    ];
    assert_eq!(
        machine
            .push(Some(&run), &JournalInput::Prompt(blocks))
            .unwrap()
            .len(),
        2
    );
    assert!(
        machine
            .push(
                Some(&run),
                &JournalInput::Sse(NativeRecord::scripted(CursorEvent::Interaction(
                    InteractionUpdate::UserMessage {
                        text: "original\ncontent".into()
                    }
                )))
            )
            .unwrap()
            .is_empty()
    );
}

#[test]
fn raw_unknown_data_and_ids_survive_chunked_decode_and_serialization() {
    let raw = "id: provider-17\nevent: future-event\ndata: { this is not json\ndata: still original }\n\n";
    let records = crate::replay::chunked(raw, 1);
    assert_eq!(records, crate::replay::records(raw));
    assert_eq!(records[0].id.as_deref(), Some("provider-17"));
    assert_eq!(records[0].data, "{ this is not json\nstill original }");
    let input = JournalInput::Sse(records[0].clone());
    assert_eq!(
        serde_json::from_str::<JournalInput>(&serde_json::to_string(&input).unwrap()).unwrap(),
        input
    );
}

#[test]
fn result_requires_a_known_terminal_status_before_completeness_or_tool_cleanup() {
    let run = CursorRunId::new("run");
    for status in [
        RunStatus::Running,
        RunStatus::Creating,
        RunStatus::Unknown("PAUSED".into()),
    ] {
        let mut machine = ReplayMachine::default();
        machine
            .push(
                Some(&run),
                &JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new("go"))]),
            )
            .unwrap();
        assert!(
            machine
                .push(
                    Some(&run),
                    &JournalInput::Sse(NativeRecord::scripted(CursorEvent::Result {
                        run_id: run.clone(),
                        status,
                        text: Some("not final".into()),
                        duration_ms: None
                    }))
                )
                .is_err()
        );
        assert!(!machine.complete(&run));
        assert!(machine.terminal_status(&run).is_none());
    }
}
