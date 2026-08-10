use super::util::{TURN, parse_log};
use crate::domain::fold::fold;
use crate::domain::log::AgentSessionLog;
use crate::domain::model::{
    Author, FoldedMessage, MessagePart, PermissionOutcome, StopReason, ToolDetail, ToolStatus,
    TurnId,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::Level;
use tracing::field::{Field, Visit};
use tracing::subscriber::with_default;

/// Everything a captured `WARN` event carried, by field name.
type CapturedFields = HashMap<String, String>;

#[derive(Default)]
struct CapturedWarnings {
    events: Mutex<Vec<CapturedFields>>,
}

struct FieldCapture<'a>(&'a mut CapturedFields);

impl Visit for FieldCapture<'_> {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

/// A [`tracing::Subscriber`] that records every `WARN`-level event's fields,
/// so a test can assert on what the fold logged without threading it through
/// its return value.
struct TracingCapture {
    captured: Arc<CapturedWarnings>,
}

impl TracingCapture {
    fn new() -> (Self, Arc<CapturedWarnings>) {
        let captured = Arc::new(CapturedWarnings::default());
        (
            Self {
                captured: captured.clone(),
            },
            captured,
        )
    }
}

impl tracing::Subscriber for TracingCapture {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _attrs: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        if *event.metadata().level() != Level::WARN {
            return;
        }
        let mut fields = CapturedFields::default();
        event.record(&mut FieldCapture(&mut fields));
        self.captured.events.lock().unwrap().push(fields);
    }

    fn enter(&self, _span: &tracing::span::Id) {}
    fn exit(&self, _span: &tracing::span::Id) {}
}

/// Fold a log while capturing anything it logs at `WARN`.
fn fold_capturing_warnings(
    log: impl IntoIterator<Item = AgentSessionLog>,
) -> (Vec<FoldedMessage>, Vec<CapturedFields>) {
    let (subscriber, captured) = TracingCapture::new();
    let messages = with_default(subscriber, || fold(log));
    let events = captured.events.lock().unwrap().clone();
    (messages, events)
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
    assert!(matches!(&user.author, Author::User(Some(id)) if id.to_string().contains("eric")));
    assert_eq!(
        *user.parts,
        vec![MessagePart::Text(
            "list the examples and write a file".to_owned()
        )]
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

    let MessagePart::Text(opening) = &parts[0] else {
        panic!("first part is prose: {:?}", parts[0]);
    };
    assert_eq!(opening, "Sure, one moment.", "chunks join into one part");

    let MessagePart::ToolUse(run) = &parts[1] else {
        panic!("second part is the terminal call: {:?}", parts[1]);
    };
    assert_eq!(run.label, "Bash", "harness tool name outranks ACP title");
    assert_eq!(run.status, ToolStatus::Completed);
    let ToolDetail::Terminal {
        command,
        output,
        exit_code,
    } = &run.detail
    else {
        panic!("execute folds to a terminal: {:?}", run.detail);
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

    let MessagePart::Permission(permission) = &parts[2] else {
        panic!("third part is the permission prompt: {:?}", parts[2]);
    };
    assert_eq!(permission.tool_call, run.id);
    assert_eq!(permission.options.len(), 2);
    assert_eq!(
        permission.outcome,
        Some(PermissionOutcome::Selected {
            option_id: "allow".to_owned()
        })
    );

    let MessagePart::ToolUse(write) = &parts[3] else {
        panic!("fourth part is the edit: {:?}", parts[3]);
    };
    assert_eq!(write.label, "Write");
    assert_eq!(write.status, ToolStatus::Completed);
    let ToolDetail::Edit { diffs } = &write.detail else {
        panic!("edit folds to diffs: {:?}", write.detail);
    };
    // The opening frame carried nothing; the diff arrived by patch.
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].path, std::path::PathBuf::from("/repo/new.rs"));
    assert_eq!(diffs[0].old_text, None);
    assert_eq!(diffs[0].new_text, "fn main() {}");

    assert_eq!(parts[4], MessagePart::Text("Done.".to_owned()));
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

    let MessagePart::ToolUse(run) = &parts[1] else {
        panic!("tool call is present: {:?}", parts[1]);
    };
    assert_eq!(run.status, ToolStatus::Pending, "no update ever arrived");

    let MessagePart::Permission(permission) = &parts[2] else {
        panic!("permission is present: {:?}", parts[2]);
    };
    assert_eq!(permission.outcome, None, "still awaiting an answer");
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
        vec![MessagePart::Text("hello".to_owned())]
    );
}

/// An empty log folds to nothing.
#[test]
fn folds_nothing() {
    let (messages, warnings) = fold_capturing_warnings(Vec::new());
    assert_eq!(messages, vec![]);
    assert_eq!(warnings, vec![]);
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
        let (messages, warnings) = fold_capturing_warnings(parse_log(&jsonl));

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
    }
}
