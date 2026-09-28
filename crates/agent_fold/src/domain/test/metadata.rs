//! Session metadata: config-bearing responses and `session_info_update`.

use super::util::parse_log;
use crate::domain::fold::FoldMachineImpl;
use crate::domain::model::FoldEvent;
use crate::domain::ports::FoldMachine;

/// A `session/new` exchange offering two models, shaped like a real
/// recording's handshake.
const OPEN: &str = concat!(
    r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"n","method":"session/new","params":{"cwd":"/w","mcpServers":[]}}}"#,
    "\n",
    r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"n","result":{"sessionId":"s1","configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"sonnet","options":[{"value":"opus","name":"Opus","description":"big"},{"value":"sonnet","name":"Sonnet"}]}]}}}"#,
);

/// The set-model exchange the local database recorded: a request the runtime
/// rejected with "model not found".
const REJECTED_CHANGE: &str = concat!(
    r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"c","method":"session/set_config_option","params":{"sessionId":"s1","configId":"model","value":"claude-fable-5"}}}"#,
    "\n",
    r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"c","error":{"code":-32602,"message":"Invalid params: model not found: claude-fable-5"}}}"#,
);

/// The same exchange accepted: the response restates the config options with
/// the new current value.
const ACCEPTED_CHANGE: &str = concat!(
    r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"c","method":"session/set_config_option","params":{"sessionId":"s1","configId":"model","value":"opus"}}}"#,
    "\n",
    r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"c","result":{"configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"opus","options":[{"value":"opus","name":"Opus","description":"big"},{"value":"sonnet","name":"Sonnet"}]}]}}}"#,
);

fn drive(machine: &mut FoldMachineImpl, jsonl: &str) -> usize {
    let mut metadata_events = 0;
    for entry in parse_log(jsonl) {
        for event in machine.push(entry) {
            if matches!(event, FoldEvent::MetadataUpdated(_)) {
                metadata_events += 1;
            }
        }
    }
    metadata_events
}

#[test]
fn the_session_open_response_seeds_the_model_and_the_menu() {
    let mut machine = FoldMachineImpl::new();
    let events = drive(&mut machine, OPEN);

    assert_eq!(events, 1);
    let metadata = machine.metadata();
    assert_eq!(metadata.model.as_deref(), Some("sonnet"));
    assert_eq!(
        metadata
            .supported_models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        vec!["opus", "sonnet"]
    );
    assert_eq!(
        metadata.supported_models[0].description.as_deref(),
        Some("big")
    );
}

/// The same handshake with the runtime grouping its models under family
/// headers, as the Cursor agent does.
const OPEN_GROUPED: &str = concat!(
    r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"n","method":"session/new","params":{"cwd":"/w","mcpServers":[]}}}"#,
    "\n",
    r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"n","result":{"sessionId":"s1","configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"opus-5","options":[{"group":"claude-opus","name":"Claude Opus","options":[{"value":"opus-5","name":"Claude Opus 5"},{"value":"opus-4.8","name":"Claude Opus 4.8"}]},{"group":"gpt","name":"GPT","options":[{"value":"gpt-5.6","name":"GPT-5.6 Sol","description":"fast"}]}]}]}}}"#,
);

#[test]
fn grouped_models_keep_their_heading_in_listing_order() {
    let mut machine = FoldMachineImpl::new();
    let events = drive(&mut machine, OPEN_GROUPED);

    assert_eq!(events, 1);
    let metadata = machine.metadata();
    assert_eq!(metadata.model.as_deref(), Some("opus-5"));
    let listed: Vec<(&str, Option<&str>)> = metadata
        .supported_models
        .iter()
        .map(|model| (model.id.as_str(), model.group.as_deref()))
        .collect();
    assert_eq!(
        listed,
        vec![
            ("opus-5", Some("Claude Opus")),
            ("opus-4.8", Some("Claude Opus")),
            ("gpt-5.6", Some("GPT")),
        ]
    );
    assert_eq!(
        metadata.supported_models[2].description.as_deref(),
        Some("fast"),
        "the option's own fields survive grouping"
    );
}

#[test]
fn flat_models_carry_no_heading() {
    let mut machine = FoldMachineImpl::new();
    drive(&mut machine, OPEN);

    assert!(
        machine
            .metadata()
            .supported_models
            .iter()
            .all(|model| model.group.is_none())
    );
}

#[test]
fn a_rejected_model_change_moves_nothing() {
    let mut machine = FoldMachineImpl::new();
    drive(&mut machine, OPEN);
    let events = drive(&mut machine, REJECTED_CHANGE);

    assert_eq!(events, 0, "an error response is not a model change");
    assert_eq!(machine.metadata().model.as_deref(), Some("sonnet"));
}

#[test]
fn an_accepted_model_change_moves_the_model() {
    let mut machine = FoldMachineImpl::new();
    drive(&mut machine, OPEN);
    let events = drive(&mut machine, ACCEPTED_CHANGE);

    assert_eq!(events, 1);
    assert_eq!(machine.metadata().model.as_deref(), Some("opus"));
}

#[test]
fn a_restated_identical_config_reports_nothing() {
    let mut machine = FoldMachineImpl::new();
    drive(&mut machine, OPEN);
    // The same current value and menu, restated by an unrelated change.
    let restated = OPEN.replace(r#""id":"n""#, r#""id":"n2""#);
    let events = drive(&mut machine, &restated);

    assert_eq!(events, 0);
}

/// An `available_commands_update` carrying two commands, one with an input
/// hint, shaped like the harness's own advertisement.
const COMMANDS: &str = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"qc","description":"Quality gate.","input":null},{"name":"compact","description":"Free up context","input":{"hint":"<optional instructions>"}}]}}}}"#;

#[test]
fn advertised_commands_land_in_the_metadata() {
    let mut machine = FoldMachineImpl::new();
    let events = drive(&mut machine, COMMANDS);

    assert_eq!(events, 1);
    let commands = &machine.metadata().available_commands;
    assert_eq!(
        commands
            .iter()
            .map(|command| command.name.as_str())
            .collect::<Vec<_>>(),
        vec!["qc", "compact"]
    );
    assert_eq!(commands[0].input_hint, None);
    assert_eq!(
        commands[1].input_hint.as_deref(),
        Some("<optional instructions>")
    );
}

#[test]
fn a_restated_identical_command_list_reports_nothing() {
    let mut machine = FoldMachineImpl::new();
    drive(&mut machine, COMMANDS);
    let events = drive(&mut machine, COMMANDS);

    assert_eq!(events, 0);
}

#[test]
fn a_fresh_advertisement_replaces_the_command_list() {
    let replacement = COMMANDS.replace(r#""name":"qc""#, r#""name":"qc2""#);
    let mut machine = FoldMachineImpl::new();
    drive(&mut machine, COMMANDS);
    let events = drive(&mut machine, &replacement);

    assert_eq!(events, 1, "a changed list is a real update");
    assert_eq!(
        machine.metadata().available_commands[0].name,
        "qc2",
        "latest advertisement wins wholesale"
    );
}

#[test]
fn system_events_move_the_status_and_repeats_report_nothing() {
    let event = |name: &str| {
        format!(r#"{{"direction":"to_server","content":{{"type":"event","event":"{name}"}}}}"#)
    };
    let mut machine = FoldMachineImpl::new();

    assert_eq!(drive(&mut machine, &event("acp_ready")), 1);
    assert_eq!(machine.metadata().status.as_deref(), Some("acp_ready"));

    assert_eq!(drive(&mut machine, &event("acp_ready")), 0);

    assert_eq!(drive(&mut machine, &event("disconnected")), 1);
    assert_eq!(machine.metadata().status.as_deref(), Some("disconnected"));
}

#[test]
fn session_info_updates_set_and_clear_the_title() {
    let update = |body: &str| {
        format!(
            r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"s1","update":{{"sessionUpdate":"session_info_update"{body}}}}}}}}}"#
        )
    };
    let mut machine = FoldMachineImpl::new();

    assert_eq!(
        drive(&mut machine, &update(r#","title":"Fix the tests""#)),
        1
    );
    assert_eq!(machine.metadata().title.as_deref(), Some("Fix the tests"));

    // Absent means unchanged, not cleared.
    assert_eq!(
        drive(
            &mut machine,
            &update(r#","updatedAt":"2026-08-13T00:00:00Z""#)
        ),
        0
    );
    assert_eq!(machine.metadata().title.as_deref(), Some("Fix the tests"));

    assert_eq!(drive(&mut machine, &update(r#","title":null"#)), 1);
    assert_eq!(machine.metadata().title, None);
}

/// Request ids restart per connection. A set-config left unanswered by a dead
/// connection must not swallow a new connection's response that reuses its id.
#[test]
fn a_reconnect_clears_pending_correlation() {
    let log = concat!(
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:3","method":"session/set_config_option","params":{"sessionId":"s1","configId":"model","value":"opus"}}}"#,
        "\n",
        // The connection dies unanswered and a new one begins.
        r#"{"direction":"to_server","content":{"type":"event","event":"acp_ready"}}"#,
        "\n",
        // The new connection's prompt lands on the reused id.
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:3","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"hi"}]}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"agent_session:3","result":{"stopReason":"end_turn"}}}"#,
    );

    let mut machine = FoldMachineImpl::new();
    for entry in parse_log(log) {
        let _ = machine.push(entry);
    }

    let agent = machine
        .messages()
        .iter()
        .find(|message| message.author == crate::domain::model::Author::Agent)
        .expect("the new connection's turn derived");
    assert_eq!(
        agent.stop,
        Some(crate::domain::model::StopReason::EndTurn),
        "the prompt's response closed the turn instead of being eaten as a config response"
    );
    assert_eq!(machine.metadata().model, None, "no config ever resolved");
}
