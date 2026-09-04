//! Elicitation: the agent asking the user a question, and the answer.
//!
//! The harness idioms - which property is a select's "Other" companion, what
//! the harness reported it took - are the readers' business and are pinned
//! per reader in [`harness_readers`](super::harness_readers). These tests
//! drive the fold with the harness announced, the way a real log has it, and
//! check what the collapsed form and the transcript look like.

use super::util::{capturing_warnings, parse_log};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::model::{
    ElicitationOutcome, ElicitationPropertySchema, ElicitationRequest, ElicitationRequestId,
    FoldEvent, MessagePart, ToolDetail, ToolUseId,
};
use crate::domain::ports::FoldMachine;
use crate::testing::fixtures::ELICITATION_CLAUDE_SINGLE_SELECT;

const PROMPT: &str = r#"{"direction":"to_runtime","user_id":"macro|user@example.com","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"go"}]}}}"#;
const END_TURN: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:p","result":{"stopReason":"end_turn"}}}"#;
const ACP_READY: &str =
    r#"{"direction":"to_server","content":{"type":"event","event":"acp_ready"}}"#;

/// A session-scoped form with one of every property type, declared in an
/// order the SDK's `BTreeMap` would not preserve.
const FORM: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":7,"method":"elicitation/create","params":{"sessionId":"s","mode":"form","message":"Configure the service","requestedSchema":{"type":"object","title":"Config","description":"A few details","properties":{"zeta":{"type":"string","title":"Name","minLength":1,"maxLength":64,"pattern":"^[a-z]+$","format":"email","default":"svc"},"port":{"type":"integer","title":"Port","minimum":1024,"maximum":65535,"default":3000},"ratio":{"type":"number","minimum":0,"maximum":1},"logging":{"type":"boolean","title":"Logging","default":true},"colours":{"type":"array","title":"Colours","minItems":1,"maxItems":2,"items":{"anyOf":[{"const":"r","title":"Red"},{"const":"g","title":"Green","description":"go"}]},"default":["r"]},"plain":{"type":"array","items":{"type":"string","enum":["a","b"]}},"alpha":{"type":"string","enum":["x","y"]},"weird":{"type":"_hologram","title":"Weird","projector":"left"}},"required":["zeta","port"]}}}}"#;

fn accept(id: u64, content: &str) -> String {
    format!(
        r#"{{"direction":"to_runtime","user_id":"macro|user@example.com","content":{{"type":"acp","jsonrpc":"2.0","id":{id},"result":{{"action":"accept","content":{content}}}}}}}"#
    )
}

fn answer(id: u64, action: &str) -> String {
    format!(
        r#"{{"direction":"to_runtime","user_id":"macro|user@example.com","content":{{"type":"acp","jsonrpc":"2.0","id":{id},"result":{{"action":"{action}"}}}}}}"#
    )
}

fn error(id: u64) -> String {
    format!(
        r#"{{"direction":"to_runtime","content":{{"type":"acp","jsonrpc":"2.0","id":{id},"error":{{"code":-32602,"message":"one elicitation at a time"}}}}}}"#
    )
}

fn url(id: u64, elicitation_id: &str) -> String {
    format!(
        r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","id":{id},"method":"elicitation/create","params":{{"sessionId":"s","mode":"url","elicitationId":"{elicitation_id}","url":"https://agent.example.com/connect?e={elicitation_id}","message":"Authorize GitHub"}}}}}}"#
    )
}

fn complete(elicitation_id: &str) -> String {
    format!(
        r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"elicitation/complete","params":{{"elicitationId":"{elicitation_id}"}}}}}}"#
    )
}

/// The `initialize` exchange that names the harness, so the fold reads the
/// frames that follow with that harness's reader.
fn announce(agent_name: &str) -> String {
    format!(
        r#"{{"direction":"to_runtime","content":{{"type":"acp","jsonrpc":"2.0","id":"i","method":"initialize","params":{{"protocolVersion":1,"clientCapabilities":{{}}}}}}}}
{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","id":"i","result":{{"protocolVersion":1,"agentCapabilities":{{}},"agentInfo":{{"name":"{agent_name}","version":"0"}}}}}}}}"#
    )
}

fn lines(parts: &[&str]) -> String {
    parts.join("\n")
}

/// Push a log, returning the machine and how many metadata events it reported.
fn drive(jsonl: &str) -> (FoldMachineImpl, usize) {
    let mut machine = FoldMachineImpl::new();
    let mut metadata_events = 0;
    for entry in parse_log(jsonl) {
        for event in machine.push(entry) {
            if matches!(event, FoldEvent::MetadataUpdated(_)) {
                metadata_events += 1;
            }
        }
    }
    (machine, metadata_events)
}

fn elicitations(machine: &FoldMachineImpl) -> Vec<&MessagePart> {
    machine
        .messages()
        .iter()
        .flat_map(|message| message.parts.iter())
        .filter(|part| matches!(part, MessagePart::Elicitation { .. }))
        .collect()
}

#[test]
fn a_form_request_becomes_a_pending_part_and_the_live_slot() {
    let (machine, metadata_events) = drive(&lines(&[PROMPT, FORM]));

    assert_eq!(metadata_events, 1, "the slot filling is a metadata change");
    let parts = elicitations(&machine);
    assert_eq!(parts.len(), 1);
    let MessagePart::Elicitation {
        request_id,
        tool_call,
        message,
        request,
        outcome,
        reported,
        tool_outcome,
    } = parts[0]
    else {
        unreachable!()
    };
    assert_eq!(*request_id, ElicitationRequestId::Number(7));
    assert_eq!(*tool_call, None);
    assert_eq!(message, "Configure the service");
    assert_eq!(*outcome, ElicitationOutcome::Pending);
    assert_eq!(*reported, None);
    assert_eq!(*tool_outcome, None, "no tool is under review");

    let pending = machine
        .metadata()
        .pending_elicitation
        .as_ref()
        .expect("the slot is filled");
    assert_eq!(pending.request_id, ElicitationRequestId::Number(7));
    assert_eq!(pending.turn, 0);
    assert_eq!(pending.message, "Configure the service");
    assert_eq!(pending.request, *request);
}

#[test]
fn the_schema_mirror_keeps_declaration_order_and_every_property_type() {
    let (machine, _) = drive(&lines(&[PROMPT, FORM]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request: ElicitationRequest::Form { schema },
        ..
    } = parts[0]
    else {
        panic!("a form: {:?}", parts[0]);
    };

    assert_eq!(schema.title.as_deref(), Some("Config"));
    assert_eq!(schema.description.as_deref(), Some("A few details"));
    assert_eq!(schema.required, ["zeta", "port"]);
    // The agent's order, not the BTreeMap's alphabetical one.
    assert_eq!(
        schema
            .properties
            .iter()
            .map(|property| property.name.as_str())
            .collect::<Vec<_>>(),
        [
            "zeta", "port", "ratio", "logging", "colours", "plain", "alpha", "weird"
        ]
    );

    let by_name = |name: &str| {
        schema
            .properties
            .iter()
            .find(|property| property.name == name)
            .unwrap_or_else(|| panic!("{name} is present"))
    };

    let zeta = by_name("zeta");
    assert_eq!(zeta.title.as_deref(), Some("Name"));
    assert_eq!(
        zeta.schema,
        ElicitationPropertySchema::String {
            min_length: Some(1),
            max_length: Some(64),
            pattern: Some("^[a-z]+$".to_owned()),
            format: Some("email".to_owned()),
            default: Some("svc".to_owned()),
            options: Vec::new(),
            custom_field: None,
        }
    );
    assert_eq!(
        by_name("port").schema,
        ElicitationPropertySchema::Integer {
            minimum: Some(1024),
            maximum: Some(65535),
            default: Some(3000),
        }
    );
    assert_eq!(
        by_name("ratio").schema,
        ElicitationPropertySchema::Number {
            minimum: Some(0.0),
            maximum: Some(1.0),
            default: None,
        }
    );
    assert_eq!(
        by_name("logging").schema,
        ElicitationPropertySchema::Boolean {
            default: Some(true)
        }
    );
    let ElicitationPropertySchema::MultiSelect {
        min_items,
        max_items,
        options,
        default,
        custom_field,
    } = &by_name("colours").schema
    else {
        panic!("an anyOf array is a multi-select");
    };
    assert_eq!((*min_items, *max_items), (Some(1), Some(2)));
    assert_eq!(
        options
            .iter()
            .map(|option| (option.value.as_str(), option.title.as_deref()))
            .collect::<Vec<_>>(),
        [("r", Some("Red")), ("g", Some("Green"))]
    );
    assert_eq!(options[1].description.as_deref(), Some("go"));
    assert_eq!(default, &["r"]);
    assert_eq!(*custom_field, None);
    let ElicitationPropertySchema::MultiSelect { options, .. } = &by_name("plain").schema else {
        panic!("an enum array is a multi-select");
    };
    assert_eq!(
        options
            .iter()
            .map(|option| (option.value.as_str(), option.title.is_none()))
            .collect::<Vec<_>>(),
        [("a", true), ("b", true)]
    );
    let ElicitationPropertySchema::String { options, .. } = &by_name("alpha").schema else {
        panic!("an enum string is a single select");
    };
    assert_eq!(options.len(), 2);
    let ElicitationPropertySchema::Unrecognized { type_name, raw } = &by_name("weird").schema
    else {
        panic!("an unknown type is preserved raw");
    };
    assert_eq!(type_name, "_hologram");
    assert_eq!(raw["projector"], "left");
    assert_eq!(by_name("weird").title.as_deref(), Some("Weird"));
}

#[test]
fn accept_resolves_the_part_with_its_content_and_frees_the_slot() {
    let (machine, metadata_events) = drive(&lines(&[
        PROMPT,
        FORM,
        &accept(7, r#"{"zeta":"svc","port":8080}"#),
    ]));

    assert_eq!(metadata_events, 2, "filled, then cleared");
    let parts = elicitations(&machine);
    let MessagePart::Elicitation { outcome, .. } = parts[0] else {
        unreachable!()
    };
    assert_eq!(
        *outcome,
        ElicitationOutcome::Accepted {
            content: Some(serde_json::json!({ "zeta": "svc", "port": 8080 })),
        }
    );
    assert_eq!(machine.metadata().pending_elicitation, None);
}

#[test]
fn decline_cancel_and_error_each_resolve_and_free_the_slot() {
    for (log, expected) in [
        (answer(7, "decline"), ElicitationOutcome::Declined),
        (answer(7, "cancel"), ElicitationOutcome::Cancelled),
        (
            error(7),
            ElicitationOutcome::Errored {
                message: "one elicitation at a time".to_owned(),
            },
        ),
        (answer(7, "_shrug"), ElicitationOutcome::Unrecognized),
    ] {
        let (machine, _) = drive(&lines(&[PROMPT, FORM, &log]));
        let parts = elicitations(&machine);
        let MessagePart::Elicitation { outcome, .. } = parts[0] else {
            unreachable!()
        };
        assert_eq!(*outcome, expected);
        assert_eq!(machine.metadata().pending_elicitation, None);
    }
}

#[test]
fn a_second_request_gets_a_part_but_never_the_slot() {
    let second = FORM.replace(r#""id":7"#, r#""id":8"#);
    let (machine, _) = drive(&lines(&[PROMPT, FORM, &second, &error(8)]));

    let parts = elicitations(&machine);
    assert_eq!(parts.len(), 2, "both requests are in the transcript");
    let MessagePart::Elicitation { outcome, .. } = parts[1] else {
        unreachable!()
    };
    assert!(matches!(outcome, ElicitationOutcome::Errored { .. }));
    assert_eq!(
        machine
            .metadata()
            .pending_elicitation
            .as_ref()
            .map(|pending| pending.request_id.clone()),
        Some(ElicitationRequestId::Number(7)),
        "the first question still owns the slot"
    );
}

#[test]
fn the_turn_ending_clears_the_slot_but_leaves_the_part_pending() {
    let (machine, metadata_events) = drive(&lines(&[PROMPT, FORM, END_TURN]));

    assert_eq!(metadata_events, 2);
    assert_eq!(machine.metadata().pending_elicitation, None);
    let parts = elicitations(&machine);
    let MessagePart::Elicitation { outcome, .. } = parts[0] else {
        unreachable!()
    };
    assert_eq!(*outcome, ElicitationOutcome::Pending);
}

#[test]
fn a_late_answer_after_the_turn_ended_still_resolves_the_part() {
    let (machine, _) = drive(&lines(&[PROMPT, FORM, END_TURN, &answer(7, "decline")]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation { outcome, .. } = parts[0] else {
        unreachable!()
    };
    assert_eq!(*outcome, ElicitationOutcome::Declined);
}

#[test]
fn a_reconnect_forgets_the_question_because_its_id_died_with_the_connection() {
    let (machine, _) = drive(&lines(&[PROMPT, FORM, ACP_READY, &answer(7, "decline")]));

    assert_eq!(machine.metadata().pending_elicitation, None);
    let parts = elicitations(&machine);
    let MessagePart::Elicitation { outcome, .. } = parts[0] else {
        unreachable!()
    };
    assert_eq!(
        *outcome,
        ElicitationOutcome::Pending,
        "an answer on a dead connection's id correlates with nothing"
    );
}

#[test]
fn a_url_consent_then_completion_walks_accepted_to_completed() {
    let (machine, _) = drive(&lines(&[
        PROMPT,
        &url(3, "gh-1"),
        &answer(3, "accept"),
        &complete("gh-1"),
        &complete("gh-1"),
        &complete("unknown"),
    ]));

    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request, outcome, ..
    } = parts[0]
    else {
        unreachable!()
    };
    assert_eq!(
        *request,
        ElicitationRequest::Url {
            elicitation_id: "gh-1".to_owned(),
            url: "https://agent.example.com/connect?e=gh-1".to_owned(),
        }
    );
    assert_eq!(*outcome, ElicitationOutcome::Completed);
}

#[test]
fn a_declined_url_is_never_completed() {
    let (machine, _) = drive(&lines(&[
        PROMPT,
        &url(3, "gh-1"),
        &answer(3, "decline"),
        &complete("gh-1"),
    ]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation { outcome, .. } = parts[0] else {
        unreachable!()
    };
    assert_eq!(*outcome, ElicitationOutcome::Declined);
}

#[test]
fn an_unknown_mode_is_kept_raw() {
    let raw = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":9,"method":"elicitation/create","params":{"sessionId":"s","mode":"_hologram","message":"Look","projector":"left"}}}"#;
    let (machine, _) = drive(&lines(&[PROMPT, raw]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation { request, .. } = parts[0] else {
        unreachable!()
    };
    let ElicitationRequest::Unrecognized { mode, raw } = request else {
        panic!("unknown modes are preserved: {request:?}");
    };
    assert_eq!(mode, "_hologram");
    assert_eq!(raw["projector"], "left");
}

/// The real Claude Code recording: `AskUserQuestion` opens a tool call, the
/// elicitation names it, and the adapter reports which answer it took.
#[test]
fn claude_code_absorbs_the_ask_user_question_tool_call() {
    let (messages, warnings) =
        capturing_warnings(|| fold(parse_log(ELICITATION_CLAUDE_SINGLE_SELECT)));
    assert_eq!(warnings, vec![], "the recording folds cleanly");

    let agent = &messages[1];
    let kinds: Vec<&str> = agent
        .parts
        .iter()
        .map(|part| match part {
            MessagePart::Text { .. } => "text",
            MessagePart::Elicitation { .. } => "elicitation",
            MessagePart::ToolUse { .. } => "tool_use",
            _ => "other",
        })
        .collect();
    assert_eq!(
        kinds,
        ["text", "elicitation", "text"],
        "the question took the tool row's place; no separate tool card: {:#?}",
        agent.parts
    );

    let MessagePart::Elicitation {
        request_id,
        tool_call,
        message,
        request,
        outcome,
        reported,
        ..
    } = &agent.parts[1]
    else {
        unreachable!()
    };
    assert_eq!(*request_id, ElicitationRequestId::Number(0));
    assert_eq!(
        *tool_call,
        Some(ToolUseId("toolu_01JYzP4A82LetDUgqvnRXguU".to_owned()))
    );
    assert_eq!(message, "What is the best colour?");

    // The `question_0` / `question_0_custom` pair collapsed to one required
    // select that allows a custom answer.
    let ElicitationRequest::Form { schema } = request else {
        panic!("a form");
    };
    assert_eq!(schema.properties.len(), 1);
    assert_eq!(schema.properties[0].name, "question_0");
    assert_eq!(schema.properties[0].title.as_deref(), Some("Best colour"));
    assert_eq!(schema.required, ["question_0"]);
    let ElicitationPropertySchema::String {
        options,
        custom_field,
        ..
    } = &schema.properties[0].schema
    else {
        panic!("a select");
    };
    assert_eq!(custom_field.as_deref(), Some("question_0_custom"));
    assert_eq!(
        options
            .iter()
            .map(|option| option.value.as_str())
            .collect::<Vec<_>>(),
        ["Red", "Blue", "Green"]
    );

    // The recording's client sent both keys; the adapter took the custom text
    // and said so through its tool result.
    assert_eq!(
        *outcome,
        ElicitationOutcome::Accepted {
            content: Some(serde_json::json!({ "question_0": "Red", "question_0_custom": "blue" })),
        }
    );
    assert_eq!(
        *reported,
        Some(serde_json::json!({ "What is the best colour?": "blue" }))
    );
}

#[test]
fn claude_code_recording_streams_the_slot_open_then_closed() {
    let (machine, metadata_events) = drive(ELICITATION_CLAUDE_SINGLE_SELECT);
    assert!(
        metadata_events >= 2,
        "the slot filled and cleared: {metadata_events}"
    );
    assert_eq!(machine.metadata().pending_elicitation, None);
}

/// Hand-shaped from `claude-agent-acp` 0.64's `askUserQuestionsToCreateRequest`:
/// two questions, the second multi-select, each with its `_custom` companion.
const CLAUDE_TWO_QUESTIONS: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":1,"method":"elicitation/create","params":{"mode":"form","sessionId":"s","toolCallId":"toolu_ask","message":"Please answer the following questions.","requestedSchema":{"type":"object","properties":{"question_0":{"type":"string","title":"Approach","description":"Which approach?","oneOf":[{"const":"A","title":"A"},{"const":"B","title":"B"}]},"question_0_custom":{"type":"string","title":"Other","description":"Type your own answer instead of choosing an option above (optional).","_meta":{"_askUserQuestionCustomAnswer":{"questionId":"question_0","isCustomAnswer":true}}},"question_1":{"type":"array","description":"Which features?","items":{"anyOf":[{"const":"auth","title":"auth"},{"const":"logging","title":"logging"}]}},"question_1_custom":{"type":"string","title":"Other","description":"Type your own answer instead of choosing an option above (optional).","_meta":{"_askUserQuestionCustomAnswer":{"questionId":"question_1","isCustomAnswer":true}}}}}}}}"#;

/// Hand-shaped from `codex-acp` 1.8's `buildUserInputRequest`: Codex's own
/// marker namespace and `__other` suffix, `required` naming only the question
/// without a companion.
const CODEX_REQUEST_USER_INPUT: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"c-1","method":"elicitation/create","params":{"sessionId":"s","toolCallId":"item_9","mode":"form","message":"Input requested","requestedSchema":{"type":"object","properties":{"target":{"type":"string","title":"Target","description":"Where should this deploy?","oneOf":[{"const":"staging","title":"staging"},{"const":"prod","title":"prod","description":"Careful"}],"_meta":{"codex":{"isOther":true,"isSecret":false}}},"target__other":{"type":"string","title":"Other","description":"Type your own answer instead of choosing an option above.","_meta":{"codex":{"questionId":"target","isOtherAnswer":true,"isSecret":false}}},"region":{"type":"string","title":"Region","description":"Which region?","oneOf":[{"const":"us","title":"us"},{"const":"eu","title":"eu"}],"_meta":{"codex":{"isOther":false,"isSecret":false}}}},"required":["region"]},"_meta":{"codex":{"autoResolutionMs":null}}}}}"#;

#[test]
fn claude_code_collapses_every_question_including_multi_select() {
    let (machine, _) = drive(&lines(&[
        &announce("@agentclientprotocol/claude-agent-acp"),
        PROMPT,
        CLAUDE_TWO_QUESTIONS,
    ]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request: ElicitationRequest::Form { schema },
        ..
    } = parts[0]
    else {
        panic!("a form");
    };
    assert_eq!(
        schema
            .properties
            .iter()
            .map(|property| property.name.as_str())
            .collect::<Vec<_>>(),
        ["question_0", "question_1"],
        "both companions folded away"
    );
    assert_eq!(schema.required, ["question_0", "question_1"]);
    let ElicitationPropertySchema::String { custom_field, .. } = &schema.properties[0].schema
    else {
        panic!("a select");
    };
    assert_eq!(custom_field.as_deref(), Some("question_0_custom"));
    assert_eq!(
        schema.properties[1].description.as_deref(),
        Some("Which features?")
    );
    let ElicitationPropertySchema::MultiSelect {
        options,
        custom_field,
        ..
    } = &schema.properties[1].schema
    else {
        panic!("a multi-select: {:?}", schema.properties[1].schema);
    };
    assert_eq!(options.len(), 2);
    assert_eq!(custom_field.as_deref(), Some("question_1_custom"));
}

#[test]
fn codex_companions_are_recognized_by_their_own_marker() {
    let (machine, _) = drive(&lines(&[
        &announce("@agentclientprotocol/codex-acp"),
        PROMPT,
        CODEX_REQUEST_USER_INPUT,
    ]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request_id,
        tool_call,
        request: ElicitationRequest::Form { schema },
        ..
    } = parts[0]
    else {
        panic!("a form");
    };
    assert_eq!(*request_id, ElicitationRequestId::Str("c-1".to_owned()));
    // Codex never opened a tool_call for this id; the part still records it.
    assert_eq!(*tool_call, Some(ToolUseId("item_9".to_owned())));
    assert_eq!(
        schema
            .properties
            .iter()
            .map(|property| property.name.as_str())
            .collect::<Vec<_>>(),
        ["target", "region"]
    );
    // Codex required only `region`; the collapsed `target` joins it.
    assert_eq!(schema.required, ["region", "target"]);
    let ElicitationPropertySchema::String { custom_field, .. } = &schema.properties[0].schema
    else {
        panic!("a select");
    };
    assert_eq!(custom_field.as_deref(), Some("target__other"));
    let ElicitationPropertySchema::String { custom_field, .. } = &schema.properties[1].schema
    else {
        panic!("a select");
    };
    assert_eq!(
        *custom_field, None,
        "a question without a companion stays plain"
    );
}

#[test]
fn the_shared_marker_collapses_a_companion_whoever_the_harness_is() {
    // No `initialize`: an unknown harness, read generically. The marker
    // Claude Code left un-namespaced is enough.
    let (machine, _) = drive(&lines(&[PROMPT, CLAUDE_TWO_QUESTIONS]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request: ElicitationRequest::Form { schema },
        ..
    } = parts[0]
    else {
        panic!("a form");
    };
    assert_eq!(schema.properties.len(), 2, "both companions folded away");
}

#[test]
fn an_unknown_harness_does_not_guess_companions_from_names_alone() {
    // Codex's frames without Codex announced: its namespaced marker and its
    // `__other` suffix are its own conventions, not the neutral reading.
    let (machine, _) = drive(&lines(&[PROMPT, CODEX_REQUEST_USER_INPUT]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request: ElicitationRequest::Form { schema },
        ..
    } = parts[0]
    else {
        panic!("a form");
    };
    assert_eq!(
        schema
            .properties
            .iter()
            .map(|property| property.name.as_str())
            .collect::<Vec<_>>(),
        ["target", "target__other", "region"],
        "every property is kept as declared"
    );
}

#[test]
fn a_question_asked_under_a_subagent_takes_the_nested_calls_place() {
    // Claude Code attributes the subagent's `AskUserQuestion` to the `Agent`
    // call through `parentToolUseId`; the elicitation names that nested id.
    let agent_call = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"toolu_agent","title":"Agent","kind":"think","status":"in_progress","rawInput":{"prompt":"decide"},"_meta":{"claudeCode":{"toolName":"Agent","subagent":true}}}}}}"#;
    let nested_ask = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"toolu_ask","title":"AskUserQuestion","kind":"other","status":"in_progress","_meta":{"claudeCode":{"toolName":"AskUserQuestion","parentToolUseId":"toolu_agent"}}}}}}"#;
    let (machine, _) = drive(&lines(&[
        &announce("@agentclientprotocol/claude-agent-acp"),
        PROMPT,
        agent_call,
        nested_ask,
        CLAUDE_TWO_QUESTIONS,
    ]));

    let agent = &machine.messages()[1];
    assert_eq!(agent.parts.len(), 1, "one subagent row: {:#?}", agent.parts);
    let MessagePart::ToolUse {
        detail: ToolDetail::Subagent { children, .. },
        ..
    } = &agent.parts[0]
    else {
        panic!("the Agent call: {:?}", agent.parts[0]);
    };
    assert_eq!(children.len(), 1);
    let MessagePart::Elicitation { tool_call, .. } = &children[0] else {
        panic!("the question replaced the nested call: {:?}", children[0]);
    };
    assert_eq!(*tool_call, Some(ToolUseId("toolu_ask".to_owned())));
    assert_eq!(
        machine
            .metadata()
            .pending_elicitation
            .as_ref()
            .map(|pending| pending.turn),
        Some(0)
    );
}

#[test]
fn a_bare_text_field_titled_other_without_a_select_is_left_alone() {
    let lone = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":2,"method":"elicitation/create","params":{"mode":"form","sessionId":"s","message":"Name?","requestedSchema":{"type":"object","properties":{"name_custom":{"type":"string","title":"Other"}}}}}}"#;
    let (machine, _) = drive(&lines(&[
        &announce("@agentclientprotocol/claude-agent-acp"),
        PROMPT,
        lone,
    ]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        request: ElicitationRequest::Form { schema },
        ..
    } = parts[0]
    else {
        panic!("a form");
    };
    assert_eq!(schema.properties.len(), 1, "nothing to collapse onto");
    assert_eq!(schema.properties[0].name, "name_custom");
}

// --- a Macro user tool's review ---

/// Macro's in-process agent calling `CreateCalendarEvent` natively: the
/// call opens as a user tool, answered pending until the review lands.
const CREATE_EVENT_CALL: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"macro":{"toolName":"CreateCalendarEvent"}},"toolCallId":"toolu_evt","sessionUpdate":"tool_call","title":"CreateCalendarEvent","kind":"edit","status":"in_progress","rawInput":{"title":"Q3 sync","time":{"kind":"allDay","startDate":"2026-08-20","endDate":"2026-08-21"}}}}}}"#;

/// The review the finisher asks for that call: a form scoped to it, with
/// the flat fields, the `_macro/json` draft field, and `_meta.macro.userTool`
/// naming the tool and carrying the draft.
const CREATE_EVENT_REVIEW: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":9,"method":"elicitation/create","params":{"sessionId":"s","toolCallId":"toolu_evt","mode":"form","message":"Create calendar event?","requestedSchema":{"type":"object","title":"Create calendar event","properties":{"title":{"type":"string","title":"title","default":"Q3 sync"},"draft":{"type":"_macro/json","title":"draft"}},"required":["title"]},"_meta":{"macro":{"userTool":{"name":"CreateCalendarEvent","draft":{"title":"Q3 sync","time":{"kind":"allDay","startDate":"2026-08-20","endDate":"2026-08-21"}}}}}}}}"#;

/// The same review with no call open for it to absorb.
const ORPHAN_REVIEW: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":9,"method":"elicitation/create","params":{"sessionId":"s","toolCallId":"toolu_gone","mode":"form","message":"Create calendar event?","requestedSchema":{"type":"object","properties":{"title":{"type":"string","default":"Q3 sync"}}},"_meta":{"macro":{"userTool":{"name":"CreateCalendarEvent","draft":{"title":"Q3 sync"}}}}}}}"#;

fn tool_update(id: &str, status: &str, raw_output: &str) -> String {
    format!(
        r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"s","update":{{"_meta":{{"macro":{{"toolName":"CreateCalendarEvent"}}}},"toolCallId":"{id}","sessionUpdate":"tool_call_update","status":"{status}","rawOutput":{raw_output}}}}}}}}}"#
    )
}

fn draft() -> serde_json::Value {
    serde_json::json!({"title": "Q3 sync", "time": {"kind": "allDay", "startDate": "2026-08-20", "endDate": "2026-08-21"}})
}

#[test]
fn a_form_scoped_to_a_user_tool_call_is_that_tools_review() {
    let (machine, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        CREATE_EVENT_CALL,
        CREATE_EVENT_REVIEW,
    ]));

    let agent = &machine.messages()[1];
    assert_eq!(
        agent.parts.len(),
        1,
        "the review took the call's row: {:#?}",
        agent.parts
    );
    let MessagePart::Elicitation {
        tool_call,
        request,
        outcome,
        tool_outcome,
        ..
    } = &agent.parts[0]
    else {
        panic!("a question: {:?}", agent.parts[0]);
    };
    assert_eq!(*tool_call, Some(ToolUseId("toolu_evt".to_owned())));
    assert_eq!(*outcome, ElicitationOutcome::Pending);
    assert_eq!(*tool_outcome, None, "the tool has not run yet");
    let ElicitationRequest::UserTool {
        tool,
        draft: reviewed,
        schema,
    } = request
    else {
        panic!("a user tool review: {request:?}");
    };
    assert_eq!(tool, "CreateCalendarEvent");
    assert_eq!(**reviewed, draft(), "the draft is the call's own arguments");
    assert_eq!(schema.title.as_deref(), Some("Create calendar event"));
    let names: Vec<&str> = schema
        .properties
        .iter()
        .map(|property| property.name.as_str())
        .collect();
    assert_eq!(
        names,
        ["title", "draft"],
        "the flat form is kept for a client without a composer"
    );
    assert!(
        matches!(
            schema.properties[1].schema,
            ElicitationPropertySchema::Unrecognized { ref type_name, .. } if type_name == "_macro/json"
        ),
        "the draft field is Macro's extension type: {:?}",
        schema.properties[1].schema
    );

    let pending = machine
        .metadata()
        .pending_elicitation
        .as_ref()
        .expect("the review is the live question");
    assert_eq!(
        pending.request, *request,
        "the slot carries the same typed request"
    );
}

#[test]
fn a_reviewed_tools_own_result_lands_on_the_question() {
    let accepted = accept(
        9,
        r#"{"title":"Q3 planning","draft":"{\"title\":\"Q3 planning\"}"}"#,
    );
    let created = r#"{"UserAction":{"eventId":"evt-1","title":"Q3 planning"}}"#;
    let (machine, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        CREATE_EVENT_CALL,
        CREATE_EVENT_REVIEW,
        &accepted,
        &tool_update("toolu_evt", "completed", created),
        END_TURN,
    ]));

    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        outcome,
        tool_outcome,
        ..
    } = parts[0]
    else {
        unreachable!()
    };
    assert!(
        matches!(outcome, ElicitationOutcome::Accepted { content: Some(_) }),
        "the user's answer: {outcome:?}"
    );
    assert_eq!(
        *tool_outcome,
        Some(crate::domain::model::UserToolOutcome::Completed {
            result: serde_json::json!({"eventId": "evt-1", "title": "Q3 planning"}),
        }),
        "the created event, read as the tool's user-tool response"
    );
    assert!(
        machine.metadata().pending_elicitation.is_none(),
        "answered and the turn over: nothing to offer"
    );
}

#[test]
fn a_declined_review_and_a_failed_tool_read_as_such() {
    let (declined, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        CREATE_EVENT_CALL,
        CREATE_EVENT_REVIEW,
        &answer(9, "decline"),
        &tool_update("toolu_evt", "completed", r#""Rejected""#),
    ]));
    let MessagePart::Elicitation {
        outcome,
        tool_outcome,
        ..
    } = elicitations(&declined)[0]
    else {
        unreachable!()
    };
    assert_eq!(*outcome, ElicitationOutcome::Declined);
    assert_eq!(
        *tool_outcome,
        Some(crate::domain::model::UserToolOutcome::Rejected)
    );

    let (failed, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        CREATE_EVENT_CALL,
        CREATE_EVENT_REVIEW,
        &accept(9, "{}"),
        &tool_update(
            "toolu_evt",
            "failed",
            r#"{"error":"Failed to create the calendar event: no writable calendar"}"#,
        ),
    ]));
    let MessagePart::Elicitation { tool_outcome, .. } = elicitations(&failed)[0] else {
        unreachable!()
    };
    assert_eq!(
        *tool_outcome,
        Some(crate::domain::model::UserToolOutcome::Failed {
            message: "Failed to create the calendar event: no writable calendar".to_owned(),
        })
    );
}

/// The review is a request the agent sends directly from the tool's task,
/// while the `tool_call` notification queues through the turn loop, so the
/// question can reach the log first. The call still folds into the question:
/// one row, and the call's result lands on it.
#[test]
fn a_tool_call_arriving_after_its_review_is_absorbed_into_the_question() {
    let created = r#"{"UserAction":{"eventId":"evt-1","title":"Q3 sync"}}"#;
    let (machine, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        CREATE_EVENT_REVIEW,
        CREATE_EVENT_CALL,
        &accept(9, "{}"),
        &tool_update("toolu_evt", "completed", created),
    ]));

    let agent = &machine.messages()[1];
    assert_eq!(
        agent.parts.len(),
        1,
        "the late call took the question's row, not its own: {:#?}",
        agent.parts
    );
    let MessagePart::Elicitation {
        tool_call,
        request,
        outcome,
        tool_outcome,
        ..
    } = &agent.parts[0]
    else {
        panic!("a question: {:?}", agent.parts[0]);
    };
    assert_eq!(*tool_call, Some(ToolUseId("toolu_evt".to_owned())));
    assert!(matches!(request, ElicitationRequest::UserTool { .. }));
    assert!(matches!(outcome, ElicitationOutcome::Accepted { .. }));
    assert_eq!(
        *tool_outcome,
        Some(crate::domain::model::UserToolOutcome::Completed {
            result: serde_json::json!({"eventId": "evt-1", "title": "Q3 sync"}),
        }),
        "the call's updates reach the question it was absorbed into"
    );
}

/// A review that came without its draft takes it from the late call.
#[test]
fn a_late_call_fills_a_review_that_came_without_a_draft() {
    let bare_review = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":9,"method":"elicitation/create","params":{"sessionId":"s","toolCallId":"toolu_evt","mode":"form","message":"Create calendar event?","requestedSchema":{"type":"object","properties":{"title":{"type":"string"}}},"_meta":{"macro":{"userTool":{"name":"CreateCalendarEvent"}}}}}}"#;
    let (machine, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        bare_review,
        CREATE_EVENT_CALL,
    ]));
    let MessagePart::Elicitation { request, .. } = elicitations(&machine)[0] else {
        unreachable!()
    };
    let ElicitationRequest::UserTool {
        draft: reviewed, ..
    } = request
    else {
        panic!("a user tool review: {request:?}");
    };
    assert_eq!(**reviewed, draft());
}

#[test]
fn a_review_with_no_call_to_absorb_is_still_a_review_from_its_meta() {
    let (machine, _) = drive(&lines(&[&announce("macro-inmem"), PROMPT, ORPHAN_REVIEW]));
    let parts = elicitations(&machine);
    let MessagePart::Elicitation {
        tool_call, request, ..
    } = parts[0]
    else {
        unreachable!()
    };
    assert_eq!(*tool_call, Some(ToolUseId("toolu_gone".to_owned())));
    let ElicitationRequest::UserTool { tool, draft, .. } = request else {
        panic!("a user tool review: {request:?}");
    };
    assert_eq!(tool, "CreateCalendarEvent");
    assert_eq!(**draft, serde_json::json!({"title": "Q3 sync"}));
}

#[test]
fn a_form_scoped_to_an_ordinary_tool_call_stays_a_form() {
    // A Macro tool that is not a user tool, asked about with no `_meta.macro.userTool`.
    let read_call = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"macro":{"toolName":"ReadContent"}},"toolCallId":"toolu_read","sessionUpdate":"tool_call","title":"ReadContent","kind":"read","status":"in_progress","rawInput":{"documentId":"d"}}}}}"#;
    let question = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":3,"method":"elicitation/create","params":{"sessionId":"s","toolCallId":"toolu_read","mode":"form","message":"Which section?","requestedSchema":{"type":"object","properties":{"section":{"type":"string"}}}}}}"#;
    let (machine, _) = drive(&lines(&[
        &announce("macro-inmem"),
        PROMPT,
        read_call,
        question,
    ]));
    let MessagePart::Elicitation { request, .. } = elicitations(&machine)[0] else {
        unreachable!()
    };
    assert!(
        matches!(request, ElicitationRequest::Form { .. }),
        "not a user tool: {request:?}"
    );
}
