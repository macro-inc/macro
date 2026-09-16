use super::*;
use crate::testing::fixture_sse;

#[test]
fn fake_wire_encoder_matches_recorded_vocabulary() {
    for name in [
        "multi_turn_1.sse",
        "file_operations.sse",
        "cancelled.sse",
        "mcp_servers.sse",
    ] {
        for record in crate::testing::fixture_records(name) {
            let event = record.decode();
            let encoded = crate::testing::raw_record(event.clone());
            assert_eq!(encoded.decode(), event, "{name}: {record:?}");
            assert_eq!(encoded.event, record.event);
        }
    }
    let user =
        crate::testing::raw_record(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "hello".into(),
        }));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&user.data).unwrap(),
        serde_json::json!({"type": "user-message-appended", "userMessage": {"text": "hello"}})
    );
    let result = crate::testing::raw_record(CursorEvent::Result {
        run_id: CursorRunId::new("r"),
        status: RunStatus::Finished,
        text: Some("answer".into()),
        duration_ms: Some(42),
        git: None,
    });
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&result.data).unwrap(),
        serde_json::json!({"runId": "r", "status": "FINISHED", "text": "answer", "durationMs": 42, "git": null})
    );
}

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
            &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
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
            .unwrap()
            .is_empty(),
        "a divergent answer is reported, never guessed at or replaced"
    );
    assert_eq!(machine.runs[&run].text, "hello");
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
                &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Interaction(
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
                    &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Result {
                        run_id: run.clone(),
                        status,
                        text: Some("not final".into()),
                        duration_ms: None,
                        git: None,
                    }))
                )
                .is_err()
        );
        assert!(!machine.complete(&run));
        assert!(machine.terminal_status(&run).is_none());
    }
}

#[test]
fn streamed_answer_and_pr_metadata_are_not_duplicated() {
    let run = CursorRunId::new("artifact-run");
    let mut machine = ReplayMachine::default();
    let answer = "Added hi.\n<img src=\"/opt/cursor/artifacts/readme.webp\" />\nPR is up.";
    machine
        .push(
            Some(&run),
            &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                text: answer.into(),
            })),
        )
        .unwrap();
    let result = JournalInput::Sse(NativeRecord {
        event: "result".into(),
        id: None,
        data: serde_json::json!({
            "runId": run.as_str(), "status": "FINISHED",
            "text": answer,
            "git": {"branches": [{"repoUrl": "github.com/macro-inc/macro", "branch": "readme-hi", "prUrl": "https://github.com/macro-inc/macro/pull/6369"}]}
        }).to_string(),
    });
    let updates = machine.push(Some(&run), &result).unwrap();
    assert!(
        updates.is_empty(),
        "the result must not duplicate the streamed answer"
    );
    assert_eq!(
        machine.pull_request_url(),
        Some("https://github.com/macro-inc/macro/pull/6369")
    );
    assert_eq!(machine.terminal_status(&run), Some(RunStatus::Finished));
    assert_eq!(machine.runs[&run].text, answer);
    assert!(machine.push(Some(&run), &result).unwrap().is_empty());
}

/// Cursor drops the image it streamed from the run's final text. Seen live
/// twice, once with the `src` an absolute path under Cursor's artifact
/// directory and once with it a bare file name, so neither shape can be the
/// thing that identifies a dropped image. Both runs failed to project, and
/// because the frame was already journaled neither session could ever load
/// or be prompted again.
#[test]
fn final_text_without_the_streamed_image_is_the_same_answer() {
    for source in ["/opt/cursor/artifacts/pr_6408.webp", "screenshot.png"] {
        let run = CursorRunId::new("image-run");
        let mut machine = ReplayMachine::default();
        let streamed = format!(
            "Here's proof from the GitHub files view.\n\n<img src=\"{source}\" alt=\"the README diff\" />\n\n**PR:** https://github.com/macro-inc/macro/pull/6408"
        );
        let restated = "Here's proof from the GitHub files view.\n\n**PR:** https://github.com/macro-inc/macro/pull/6408";
        machine
            .push(
                Some(&run),
                &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: streamed.clone(),
                })),
            )
            .unwrap();
        let result = JournalInput::Sse(NativeRecord {
            event: "result".into(),
            id: None,
            data: serde_json::json!({
                "runId": run.as_str(), "status": "FINISHED", "text": restated,
            })
            .to_string(),
        });
        let updates = machine.push(Some(&run), &result).unwrap();
        assert!(
            updates.is_empty(),
            "restating the answer without the image must not repeat it"
        );
        assert_eq!(machine.terminal_status(&run), Some(RunStatus::Finished));
        assert_eq!(
            machine.runs[&run].text, streamed,
            "the streamed answer, image included, stays the answer of record"
        );
    }
}

/// A restatement that also adds text is still a restatement: the added part
/// cannot be told from the rewritten part, so the stream the user watched
/// arrive is kept whole rather than spliced. The session stays projectable,
/// which is the property that matters.
#[test]
fn a_restatement_that_also_adds_text_keeps_the_streamed_answer() {
    let run = CursorRunId::new("restated-run");
    let mut machine = ReplayMachine::default();
    let streamed = "Shipped.\n\n<img src=\"proof.webp\" />";
    machine
        .push(
            Some(&run),
            &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                text: streamed.into(),
            })),
        )
        .unwrap();
    let result = JournalInput::Sse(NativeRecord {
        event: "result".into(),
        id: None,
        data: serde_json::json!({
            "runId": run.as_str(), "status": "FINISHED", "text": "Shipped. Tests pass.",
        })
        .to_string(),
    });
    assert!(machine.push(Some(&run), &result).unwrap().is_empty());
    assert_eq!(machine.runs[&run].text, streamed);
    assert_eq!(machine.terminal_status(&run), Some(RunStatus::Finished));
}

#[test]
fn polling_preserves_pr_metadata() {
    let run = CursorRunId::new("poll-run");
    let mut machine = ReplayMachine::default();
    let poll = JournalInput::Poll(serde_json::json!({
        "status": "FINISHED", "result": "Done",
        "git": {"branches": [{"repoUrl": "github.com/macro-inc/macro", "branch": "readme-hi", "prUrl": "https://github.com/macro-inc/macro/pull/6369"}]}
    }).to_string());
    let updates = machine.push(Some(&run), &poll).unwrap();
    assert_eq!(
        machine.pull_request_url(),
        Some("https://github.com/macro-inc/macro/pull/6369")
    );
    assert!(
        updates
            .iter()
            .any(|u| matches!(u, SessionUpdate::AgentMessageChunk(_)))
    );
    assert!(machine.push(Some(&run), &poll).unwrap().is_empty());
}

/// A divergent final answer leaves the captured stream alone, but the run
/// still ended and its branch still has a PR - those are facts of their own,
/// and a session that refused them could never load again, because the frame
/// carrying them is already journaled.
#[test]
fn divergent_terminal_text_keeps_the_captured_answer_and_the_terminal_facts() {
    for polling in [false, true] {
        let run = CursorRunId::new("divergent");
        let mut machine = ReplayMachine::default();
        machine
            .push(
                Some(&run),
                &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: "captured answer".into(),
                })),
            )
            .unwrap();
        let git = serde_json::json!({"branches": [{
            "repoUrl": "github.com/macro-inc/macro", "branch": "feature",
            "prUrl": "https://github.com/macro-inc/macro/pull/12"
        }]});
        let input = if polling {
            JournalInput::Poll(
                serde_json::json!({
                    "status": "FINISHED", "result": "different answer", "git": git,
                })
                .to_string(),
            )
        } else {
            JournalInput::Sse(NativeRecord {
                event: "result".into(), id: None,
                data: serde_json::json!({
                    "runId": run.as_str(), "status": "FINISHED", "text": "different answer", "git": git,
                }).to_string(),
            })
        };
        machine
            .push(Some(&run), &input)
            .expect("a divergent answer is reported, not fatal");
        assert_eq!(machine.runs[&run].text, "captured answer");
        assert_eq!(machine.terminal_status(&run), Some(RunStatus::Finished));
        assert_eq!(
            machine.pull_request_url(),
            Some("https://github.com/macro-inc/macro/pull/12")
        );
    }
}

/// A stream interruption is a fact about the connection, not the conversation:
/// it is durable so a gap in a transcript is explicable, and it must add
/// nothing to the transcript it explains — on capture or on any later replay.
#[test]
fn a_stream_interruption_projects_to_nothing() {
    let run = CursorRunId::new("run");
    let interruption = JournalInput::StreamInterrupted {
        reason: "error decoding response body".into(),
        last_event_id: Some("1713033006000-0".into()),
        attempt: 2,
    };
    let mut machine = ReplayMachine::default();
    assert!(
        machine
            .push(
                Some(&run),
                &JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: "before".into()
                }))
            )
            .unwrap()
            .len()
            == 1
    );
    assert!(machine.push(Some(&run), &interruption).unwrap().is_empty());
    assert!(machine.push(None, &interruption).unwrap().is_empty());
    assert!(!machine.complete(&run), "no outcome was invented either");
    // Durability is the point, so the variant has to survive the journal's
    // own encoding unchanged.
    let encoded = serde_json::to_string(&interruption).unwrap();
    assert_eq!(
        serde_json::from_str::<JournalInput>(&encoded).unwrap(),
        interruption
    );
}
