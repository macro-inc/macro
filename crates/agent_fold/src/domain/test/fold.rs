use super::util::{CapturedFields, TURN, capturing_warnings, parse_log};
use crate::domain::fold::fold;
use crate::domain::log::{AgentSessionLog, Message};
use crate::domain::model::{
    Author, Control, ControlOutcome, FoldedMessage, MessagePart, PermissionOutcome, StopReason,
    ToolDetail, ToolStatus, TurnId,
};
use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;

/// Fold a log while capturing anything it logs at `WARN`.
fn fold_capturing_warnings(
    log: impl IntoIterator<Item = AgentSessionLog>,
) -> (Vec<FoldedMessage>, Vec<CapturedFields>) {
    capturing_warnings(|| fold(log))
}

/// The full fixture: one prompt, prose, a permission-gated terminal command,
/// a patched-in edit, closing prose, and a clean stop.
#[test]
fn folds_a_complete_turn() {
    let (messages, warnings) = fold_capturing_warnings(parse_log(TURN));

    assert_eq!(warnings, vec![], "clean log folds without warnings");
    assert_eq!(messages.len(), 2, "one user message, one agent message");

    let user = &messages[0];
    assert_eq!(user.id, TurnId(0));
    assert!(
        matches!(&user.author, Author::User { user_id: Some(id) } if id.to_string().contains("eric"))
    );
    assert_eq!(
        *user.parts,
        vec![MessagePart::Text {
            text: "list the examples and write a file".to_owned()
        }]
    );
    assert_eq!(user.stop, None, "user messages carry no stop reason");

    let agent = &messages[1];
    assert_eq!(agent.id, TurnId(0));
    assert_eq!(agent.author, Author::Agent);
    assert_eq!(agent.stop, Some(StopReason::EndTurn));

    // Streamed chunks coalesce; parts arrive in log order.
    let parts = agent.parts.as_slice();
    assert_eq!(
        parts.len(),
        5,
        "text, tool, permission, tool, text: {parts:#?}"
    );

    let MessagePart::Text { text: opening } = &parts[0] else {
        panic!("first part is prose: {:?}", parts[0]);
    };
    assert_eq!(opening, "Sure, one moment.", "chunks join into one part");

    let MessagePart::ToolUse {
        id: run_id,
        label: run_label,
        status: run_status,
        detail: run_detail,
        ..
    } = &parts[1]
    else {
        panic!("second part is the terminal call: {:?}", parts[1]);
    };
    assert_eq!(run_label, "Bash", "harness tool name outranks ACP title");
    assert_eq!(*run_status, ToolStatus::Completed);
    let ToolDetail::Terminal {
        command,
        output,
        exit_code,
    } = run_detail
    else {
        panic!("execute folds to a terminal: {run_detail:?}");
    };
    assert_eq!(command.as_deref(), Some("ls examples"));
    assert_eq!(*exit_code, Some(0));
    let output = output.as_ref().expect("output was captured");
    assert!(
        output.as_str().contains("\u{1b}[01;34m"),
        "ANSI escapes survive the fold: {:?}",
        output.as_str()
    );
    assert!(
        output.as_str().ends_with("events.rs"),
        "later updates replace earlier output snapshots"
    );

    let MessagePart::Permission {
        tool_call,
        options,
        outcome,
    } = &parts[2]
    else {
        panic!("third part is the permission prompt: {:?}", parts[2]);
    };
    assert_eq!(tool_call, run_id);
    assert_eq!(options.len(), 2);
    assert_eq!(
        *outcome,
        PermissionOutcome::Selected {
            option_id: "allow".to_owned()
        }
    );

    let MessagePart::ToolUse {
        label,
        status,
        detail,
        ..
    } = &parts[3]
    else {
        panic!("fourth part is the edit: {:?}", parts[3]);
    };
    assert_eq!(label, "Write");
    assert_eq!(*status, ToolStatus::Completed);
    let ToolDetail::Edit { diffs } = detail else {
        panic!("edit folds to diffs: {detail:?}");
    };
    // The opening frame carried nothing; the diff arrived by patch.
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].path, std::path::PathBuf::from("/repo/new.rs"));
    assert_eq!(diffs[0].old_text, None);
    assert_eq!(diffs[0].new_text, "fn main() {}");

    assert_eq!(
        parts[4],
        MessagePart::Text {
            text: "Done.".to_owned()
        }
    );
}

/// Cutting the log mid-turn - a live session, or one that died - still yields
/// everything folded so far, with the in-flight states left visible.
#[test]
fn folds_an_interrupted_turn() {
    // Drop the final two frames: the closing prose and the prompt response.
    let mut log = parse_log(TURN);
    log.truncate(log.len() - 2);
    let (messages, warnings) = fold_capturing_warnings(log);

    assert_eq!(warnings, vec![]);
    assert_eq!(messages.len(), 2);

    let agent = &messages[1];
    assert_eq!(agent.stop, None, "no response, no stop reason");

    // Cut earlier, before the first tool call resolves: the call stays
    // pending and the permission stays unanswered. Both are renderable
    // states, not errors.
    let mut log = parse_log(TURN);
    log.truncate(9);
    let (messages, warnings) = fold_capturing_warnings(log);

    assert_eq!(warnings, vec![]);
    let agent = &messages[1];
    let parts = agent.parts.as_slice();

    let MessagePart::ToolUse { status, .. } = &parts[1] else {
        panic!("tool call is present: {:?}", parts[1]);
    };
    assert_eq!(*status, ToolStatus::Pending, "no update ever arrived");

    let MessagePart::Permission { outcome, .. } = &parts[2] else {
        panic!("permission is present: {:?}", parts[2]);
    };
    assert_eq!(
        *outcome,
        PermissionOutcome::Pending,
        "still awaiting an answer"
    );
}

#[test]
fn folds_session_controls_as_typed_parts() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","id":"m","method":"session/set_config_option","params":{"sessionId":"s","configId":"model","value":"opus"}}}"#,
        "\n",
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","id":"c","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"/compact"}]}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"c","result":{"stopReason":"end_turn"}}}"#,
        "\n",
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s"}}}"#,
    ));

    let messages = fold(log);
    assert_eq!(messages.len(), 3);
    assert_eq!(
        messages[0].parts.as_slice(),
        &[MessagePart::Control {
            control: Control::SetModel {
                model: "opus".to_owned()
            },
            // The set-model request never got a response in this log.
            outcome: ControlOutcome::Pending,
        }]
    );
    assert_eq!(
        messages[1].parts.as_slice(),
        &[MessagePart::Control {
            control: Control::Compact,
            outcome: ControlOutcome::Accepted,
        }]
    );
    assert_eq!(
        messages[2].parts.as_slice(),
        &[MessagePart::Control {
            control: Control::Stop,
            outcome: ControlOutcome::Accepted,
        }]
    );
    assert_eq!(messages[0].id, TurnId(0));
    assert_eq!(messages[1].id, TurnId(1));
    assert_eq!(messages[2].id, TurnId(2));
}

/// A stop pressed before the agent's first chunk - a window over ten seconds
/// wide, since a session's first prompt spends that creating the Cursor agent.
///
/// The turn has no agent message to stamp, so the close has to mint one. Left
/// unstamped, the newest turn message is the user's prompt, which every reader
/// takes to mean the agent is still working: the composer keeps its stop
/// affordance, and each further click stacks another Stopped line onto a
/// session that can never settle.
#[test]
fn a_stop_before_the_agent_speaks_still_settles_the_turn() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"do a big job"}]}}}"#,
        "\n",
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s"}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"cancelled"}}}"#,
    ));

    let messages = fold(log);
    assert_eq!(messages.len(), 3, "prompt, stop control, minted reply");
    let reply = &messages[2];
    assert!(matches!(reply.author, Author::Agent));
    assert_eq!(
        reply.id,
        TurnId(0),
        "the reply belongs to the prompt's turn"
    );
    assert_eq!(reply.stop, Some(StopReason::Cancelled));
    assert_eq!(
        reply.parts.as_slice(),
        &[MessagePart::Text {
            text: String::new()
        }],
        "nothing was said, so there is nothing to render but the stop"
    );
}

/// The same stop once the agent has managed a single thought: the message
/// already exists, so nothing is minted and the thought is kept.
#[test]
fn a_stop_after_the_agent_speaks_stamps_the_message_it_has() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"do a big job"}]}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"hmm"}}}}}"#,
        "\n",
        r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s"}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"cancelled"}}}"#,
    ));

    let messages = fold(log);
    assert_eq!(messages.len(), 3, "prompt, reply, stop control");
    let reply = &messages[1];
    assert_eq!(reply.stop, Some(StopReason::Cancelled));
    assert_eq!(
        reply.parts.as_slice(),
        &[MessagePart::Thought {
            text: "hmm".to_owned()
        }]
    );
}

#[test]
fn a_rejected_control_reports_the_runtime_error() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:m1","method":"session/set_config_option","params":{"sessionId":"s","configId":"model","value":"claude-fable-5"}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:m1","error":{"code":-32602,"message":"Invalid params: model not found: claude-fable-5"}}}"#,
    ));

    let messages = fold(log);
    assert_eq!(messages.len(), 1);
    assert_eq!(
        messages[0].request_id.as_ref().map(|id| id.as_str()),
        Some("agent_session:m1"),
        "a control-plane id is surfaced for correlation"
    );
    let [MessagePart::Control { outcome, .. }] = messages[0].parts.as_slice() else {
        panic!("one control part: {:?}", messages[0].parts);
    };
    assert_eq!(
        *outcome,
        ControlOutcome::Rejected {
            message: "Invalid params: model not found: claude-fable-5".to_owned()
        }
    );
}

#[test]
fn an_accepted_control_resolves_and_the_same_frame_moves_the_metadata() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:m1","method":"session/set_config_option","params":{"sessionId":"s","configId":"model","value":"opus"}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:m1","result":{"configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"opus","options":[{"value":"opus","name":"Opus"}]}]}}}"#,
    ));

    let messages = fold(log);
    let [MessagePart::Control { outcome, .. }] = messages[0].parts.as_slice() else {
        panic!("one control part: {:?}", messages[0].parts);
    };
    assert_eq!(*outcome, ControlOutcome::Accepted);
}

/// Every ACP tool kind this fold has a bespoke rendering for, plus a call
/// with no kind at all - which ACP defaults to `other`, same as a kind this
/// fold does not model.
#[test]
fn folds_every_official_tool_kind() {
    fn tool_call(id: &str, kind_and_fields: &str) -> String {
        format!(
            r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"s","update":{{"sessionUpdate":"tool_call","toolCallId":"{id}","title":"{id}","status":"completed",{kind_and_fields}}}}}}}}}"#
        )
    }

    let log = parse_log(&[
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"hi"}]}}}"#.to_owned(),
        tool_call(
            "del",
            r#""kind":"delete","locations":[{"path":"/repo/dead.rs"}]"#,
        ),
        tool_call(
            "mv",
            r#""kind":"move","locations":[{"path":"/repo/from.rs"},{"path":"/repo/to.rs"}]"#,
        ),
        tool_call(
            "search",
            r#""kind":"search","locations":[{"path":"/repo/a.rs"}],"content":[{"type":"content","content":{"type":"text","text":"1 match"}}]"#,
        ),
        tool_call(
            "fetch",
            r#""kind":"fetch","content":[{"type":"content","content":{"type":"text","text":"page body"}}]"#,
        ),
        tool_call(
            "think",
            r#""kind":"think","content":[{"type":"content","content":{"type":"text","text":"reasoning aloud"}}]"#,
        ),
        tool_call(
            "mystery",
            r#""content":[{"type":"content","content":{"type":"text","text":"how should this work?"}}],"rawInput":{"foo":"bar"}"#,
        ),
    ].join("\n"));

    let (messages, warnings) = fold_capturing_warnings(log);
    assert_eq!(
        warnings,
        vec![],
        "every official kind folds without a warning"
    );

    let agent = &messages[1];
    assert_eq!(
        agent.parts.len(),
        6,
        "one part per tool call: {:#?}",
        agent.parts
    );
    insta::assert_debug_snapshot!(agent.parts);
}

/// An edit call that never reports a diff content block — Claude Code's
/// `Write` — synthesizes a whole-file diff from `rawInput`'s
/// `{filePath, content}`, on the opening frame or a later patch.
#[test]
fn synthesizes_a_write_diff_from_raw_input() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"hi"}]}}}"#,
        "\n",
        // Opened with the raw input already present, no diff content ever.
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"w","title":"write","kind":"edit","status":"in_progress","rawInput":{"filePath":"/repo/readme.md","content":"hello\n"}}}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call_update","toolCallId":"w","status":"completed"}}}}"#,
    ));

    let messages = fold(log);
    let MessagePart::ToolUse { detail, .. } = &messages[1].parts[0] else {
        panic!("first part is the write: {:?}", messages[1].parts);
    };
    let ToolDetail::Edit { diffs } = detail else {
        panic!("write folds to an edit: {detail:?}");
    };
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].path, std::path::PathBuf::from("/repo/readme.md"));
    assert_eq!(
        diffs[0].old_text, None,
        "prior contents are not on the wire"
    );
    assert_eq!(diffs[0].new_text, "hello\n");
}

/// A reported diff block wins over the synthesized raw-input diff.
#[test]
fn reported_diffs_beat_the_synthesized_write_diff() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"hi"}]}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"e","title":"edit","kind":"edit","status":"in_progress","rawInput":{"filePath":"/repo/a.rs","content":"whole file"}}}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call_update","toolCallId":"e","status":"completed","content":[{"type":"diff","path":"/repo/a.rs","oldText":"old","newText":"new"}]}}}}"#,
    ));

    let messages = fold(log);
    let MessagePart::ToolUse { detail, .. } = &messages[1].parts[0] else {
        panic!("first part is the edit: {:?}", messages[1].parts);
    };
    let ToolDetail::Edit { diffs } = detail else {
        panic!("edit folds to diffs: {detail:?}");
    };
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].old_text.as_deref(), Some("old"));
    assert_eq!(diffs[0].new_text, "new");
}

/// A patch for a tool call that was never opened is logged, not fatal.
#[test]
fn reports_a_patch_before_open() {
    let log = parse_log(concat!(
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"hi"}]}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call_update","toolCallId":"ghost","status":"completed"}}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}}}"#,
    ));
    let (messages, warnings) = fold_capturing_warnings(log);

    assert_eq!(warnings.len(), 1, "one warning for the unopened patch");
    let error = warnings[0]
        .get("error")
        .expect("the warning names the error");
    assert!(
        error.contains("PatchBeforeOpen") && error.contains("ghost"),
        "warning identifies the unopened tool call: {error}"
    );

    // The fold carried on around it.
    assert_eq!(messages.len(), 2);
    assert_eq!(
        *messages[1].parts,
        vec![MessagePart::Text {
            text: "hello".to_owned()
        }]
    );
}

/// An empty log folds to nothing.
#[test]
fn folds_nothing() {
    let (messages, warnings) = fold_capturing_warnings(Vec::new());
    assert_eq!(messages, vec![]);
    assert_eq!(warnings, vec![]);
}

/// How many `session/update` notifications a log carries - the frames that
/// stream the agent's own content, and so the sign that a recording has
/// something for the fold to find.
fn agent_updates(log: &[AgentSessionLog]) -> usize {
    log.iter()
        .filter(|entry| match &entry.content {
            Message::ToServer(ToServerMessage::Acp(acp)) => matches!(
                &acp.0,
                RawJsonRpcMessage::Notification(notification)
                    if &*notification.method == "session/update"
            ),
            _ => false,
        })
        .count()
}

/// Replays every locally recorded session, when any exist.
///
/// The recordings live outside the repository (`~/.agent_runtime_sessions`),
/// so this is a no-op wherever they are absent - CI included. Locally it is
/// the drift alarm: a recording that folds with a warning means the harness
/// is emitting something this fold does not yet understand.
#[test]
fn replays_local_recordings() {
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let dir = std::path::Path::new(&home).join(".agent_runtime_sessions");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
        {
            continue;
        }
        let jsonl = std::fs::read_to_string(&path).expect("recording is readable");
        let log = parse_log(&jsonl);
        let streamed = agent_updates(&log);
        let (messages, warnings) = fold_capturing_warnings(log);

        assert_eq!(
            warnings,
            vec![],
            "recording {} folds with a warning",
            path.display()
        );
        for message in &messages {
            assert!(
                !message.parts.is_empty(),
                "recording {} folded an empty message",
                path.display()
            );
        }

        // Folding to nothing is the failure the other assertions cannot see:
        // they are all "for each message", so zero messages passes them all.
        // A recording that streamed agent content and derived none of it is
        // the shape of a fold that has stopped understanding the protocol -
        // which is exactly what a `session/load` recording used to do.
        if streamed > 0 {
            assert!(
                !messages.is_empty(),
                "recording {} streams {streamed} agent updates but folds to no messages",
                path.display()
            );
        }
    }
}

/// The exchange the local database recorded after a switch to a provider
/// whose credentials were broken: the prompt is answered with a JSON-RPC
/// error and nothing else ever arrives.
const FAILED_PROMPT: &str = concat!(
    r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"hi"}]}}}"#,
    "\n",
    r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","error":{"code":-32603,"message":"Internal error: Bad Request: bad request: Authorization header is badly formatted"}}}"#,
);

/// A turn whose prompt errors is over, and says why.
///
/// The bug this pins: the turn used to be left with no stop reason at all,
/// which every reader takes to mean "still running" — so one failed prompt
/// wedged the composer against a turn that had already died, and the error
/// itself was dropped on the floor.
#[test]
fn a_prompt_answered_with_an_error_ends_its_turn() {
    let messages = fold(parse_log(FAILED_PROMPT));

    assert_eq!(messages.len(), 2, "the prompt, and the turn that failed");
    let agent = messages.last().expect("an agent message");
    assert_eq!(agent.author, Author::Agent);
    assert_eq!(
        agent.stop,
        Some(StopReason::Failed {
            message: "Internal error: Bad Request: bad request: Authorization header is badly \
                      formatted"
                .to_owned()
        }),
        "the runtime's own words, carried verbatim"
    );
}

/// The failure lands on whatever the agent had already said, rather than
/// opening a second message beside it.
#[test]
fn a_turn_that_had_started_talking_fails_in_place() {
    let chunk = concat!(
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","#,
        r#""params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"working"}}}}}"#,
    );
    let (prompt, error) = FAILED_PROMPT
        .split_once('\n')
        .expect("the fixture has two frames");
    let log = format!("{prompt}\n{chunk}\n{error}");

    let messages = fold(parse_log(&log));

    assert_eq!(messages.len(), 2, "no extra message for the failure");
    let agent = messages.last().expect("an agent message");
    assert!(matches!(agent.stop, Some(StopReason::Failed { .. })));
    assert_eq!(
        agent.parts.first(),
        Some(&MessagePart::Text {
            text: "working".to_owned()
        }),
        "what the agent managed to say is kept"
    );
}
