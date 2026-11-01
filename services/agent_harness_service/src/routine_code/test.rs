use code_execution::domain::{ExecutionFailure, FailureCode};
use serde_json::json;

use super::*;

fn activity(id: u64, operation: &str, status: &str) -> Value {
    let (service, operation) = operation.split_once('.').unwrap();
    json!({ "id": id, "service": service, "operation": operation, "status": status })
}

#[test]
fn activity_becomes_calls_with_timing_and_outcome() {
    let mut journal = Journal::default();
    journal.observe(
        activity(1, "cognition.decisions", "started"),
        Duration::from_millis(10),
    );
    journal.observe(
        activity(2, "email.archiveThread", "skipped"),
        Duration::from_millis(12),
    );
    journal.observe(
        activity(3, "storage.deleteDocument", "refused"),
        Duration::from_millis(13),
    );
    journal.observe(
        activity(4, "email.createLabel", "started"),
        Duration::from_millis(14),
    );
    journal.observe(
        activity(1, "cognition.decisions", "completed"),
        Duration::from_millis(250),
    );
    journal.observe(
        activity(4, "email.createLabel", "failed"),
        Duration::from_millis(30),
    );
    let summary: Vec<_> = journal
        .calls
        .iter()
        .map(|call| {
            (
                call.operation.as_str(),
                call.write,
                call.status,
                call.started_ms,
                call.duration_ms,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                "cognition.decisions",
                false,
                CallStatus::Completed,
                10,
                Some(240)
            ),
            (
                "email.archiveThread",
                true,
                CallStatus::Skipped,
                12,
                Some(0)
            ),
            (
                "storage.deleteDocument",
                true,
                CallStatus::Refused,
                13,
                Some(0)
            ),
            ("email.createLabel", true, CallStatus::Failed, 14, Some(16)),
        ]
    );
    assert_eq!(journal.calls[0].label, "Classify content");
    assert!(!journal.truncated);
}

#[test]
fn unfinished_calls_stay_unknown_and_unlisted_operations_count_as_writes() {
    let mut journal = Journal::default();
    journal.observe(
        activity(1, "email.notAnOperation", "started"),
        Duration::ZERO,
    );
    assert_eq!(journal.calls[0].status, CallStatus::Unknown);
    assert!(journal.calls[0].write);
    assert_eq!(journal.calls[0].label, "email.notAnOperation");
    journal.observe(json!({ "truncated": true }), Duration::ZERO);
    journal.observe(json!({ "unexpected": "frame" }), Duration::ZERO);
    assert!(journal.truncated);
    assert_eq!(journal.calls.len(), 1);
}

#[test]
fn the_journal_is_bounded() {
    let mut journal = Journal::default();
    for id in 0..=MAX_CALLS as u64 {
        journal.observe(
            activity(id, "cognition.decisions", "started"),
            Duration::ZERO,
        );
    }
    assert_eq!(journal.calls.len(), MAX_CALLS);
    assert!(journal.truncated);
}

#[test]
fn outcomes_become_outputs_or_bounded_reasons() {
    assert_eq!(
        result(Outcome::Succeeded {
            value: json!({ "total": 1 })
        }),
        Ok(json!({ "total": 1 }))
    );
    assert_eq!(
        result(Outcome::Succeeded {
            value: json!("x".repeat(MAX_OUTPUT_BYTES))
        }),
        Ok(Value::Null)
    );
    let Err(message) = result(Outcome::Failed {
        error: ExecutionFailure::new(FailureCode::Runtime, "e".repeat(MAX_MESSAGE_CHARS + 5)),
    }) else {
        panic!("expected a failure");
    };
    assert_eq!(message.chars().count(), MAX_MESSAGE_CHARS + 1);
    assert_eq!(
        result(Outcome::TimedOut),
        Err("The step ran out of time (30 seconds).".to_owned())
    );
}

#[test]
fn rewrites_read_the_declarations_the_errors_name() {
    let names = quoted_names(&[
        "TS2339 [ERROR]: Property 'create' does not exist on type 'TaskNamespace'.".into(),
        "TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'Macro<MacroOpts>'.".into(),
        "TS2339 [ERROR]: Property 'create' does not exist on type 'TaskNamespace'.".into(),
    ]);
    assert_eq!(names, ["create", "TaskNamespace", "string", "Macro"]);
    let declarations = sdk_declarations(
        &names.iter().map(String::as_str).collect::<Vec<_>>(),
        REWRITE_DECLARATION_BYTES,
    );
    assert!(
        declarations
            .iter()
            .any(|(_, text)| text.contains("class TaskNamespace"))
    );
    assert!(
        declarations
            .iter()
            .map(|(_, text)| text.len())
            .sum::<usize>()
            <= REWRITE_DECLARATION_BYTES
    );
}
