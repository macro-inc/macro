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

mod real_deno {
    //! The adapter over the real checker and executor, against a fake API:
    //! the step contract type-checks, code runs with its inputs, writes
    //! follow the step's scopes, and every call lands in the journal.

    use std::path::PathBuf;

    use code_execution::domain::{ExecutionService, Limits};
    use code_execution::outbound::deno::{DenoRunner, check::DenoChecker};
    use routine_program::{RoutineProgram, WriteScope};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::*;

    struct FixedToken;

    impl RoutineCredentials for FixedToken {
        async fn mint(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<String> {
            Ok("fixture-routine-token".into())
        }
    }

    async fn code(host: &str) -> (tempfile::TempDir, SdkRoutineCode<FixedToken>) {
        let root = tempfile::tempdir().unwrap();
        let which = tokio::process::Command::new("which")
            .arg("deno")
            .output()
            .await
            .unwrap();
        assert!(which.status.success(), "Deno 2.9.6 must be on PATH");
        let deno = PathBuf::from(String::from_utf8(which.stdout).unwrap().trim());
        let runner = DenoRunner::new(deno.clone(), root.path().join("runs"), 128)
            .await
            .unwrap();
        let executor = ExecutionService::new(Arc::new(runner), Limits::default()).unwrap();
        let checker = DenoChecker::new(deno, root.path().join("checks"), 1, 64 * 1024)
            .await
            .unwrap();
        let hosts = ["cognition", "email", "storage"]
            .map(|name| (name.to_owned(), host.to_owned()))
            .into();
        let code = SdkRoutineCode::new(
            Arc::new(executor),
            Arc::new(checker),
            FixedToken,
            hosts,
            Arc::new(ai_usage::NoOpUsageRecorder),
            None,
        );
        (root, code)
    }

    async fn request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0; 4096];
            let count = stream.read(&mut buffer).await.unwrap();
            assert_ne!(count, 0);
            bytes.extend_from_slice(&buffer[..count]);
            let text = String::from_utf8_lossy(&bytes);
            if let Some(end) = text.find("\r\n\r\n") {
                let length = text[..end]
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or_default();
                if bytes.len() >= end + 4 + length {
                    return text.into_owned();
                }
            }
        }
    }

    async fn respond(stream: &mut TcpStream, body: &str) {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
    }

    const SOURCE: &str = r#"
export async function main({ macro, trigger, steps }: StepContext) {
  const decision = await macro.ai.decide({
    input: { subject: trigger?.email?.subject },
    questions: { invoice: "Is this an invoice?" },
  });
  const invoice = (decision.probabilities.invoice ?? 0) >= 0.5;
  if (invoice) {
    await macro._client.email.createLabel({ body: { label_name: "Invoices" } });
  }
  let deleted = "deleted";
  try {
    await macro._client.storage.deleteDocument({ path: { document_id: "d" } });
  } catch (error) {
    deleted = String(error);
  }
  return { invoice, earlier: steps.first ?? null, deleted };
}
"#;

    fn step(writes: Vec<WriteScope>) -> routine_program::CodeStep {
        let program = RoutineProgram::from_task(&json!({ "steps": [{
            "type": "code", "title": "Label invoices", "source": SOURCE, "writes": writes,
        }] }))
        .unwrap();
        program.code_steps()[0].clone()
    }

    fn owner() -> MacroUserIdStr<'static> {
        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn the_step_contract_type_checks_sdk_calls() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        assert_eq!(code.check(SOURCE).await.unwrap(), Vec::<String>::new());
        let problems = code
            .check(
                "export async function main({ macro }: StepContext) { return macro.ai.guess({}); }",
            )
            .await
            .unwrap();
        assert!(
            problems[0].contains("Property 'guess' does not exist"),
            "{problems:?}"
        );
        assert_eq!(
            code.sdk().unwrap().as_str(),
            code_execution::domain::sdk_fingerprint()
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_step_runs_with_its_inputs_and_journals_each_call() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut decide, _) = listener.accept().await.unwrap();
            let request_text = request(&mut decide).await;
            assert!(
                request_text.starts_with("POST /decisions "),
                "{request_text}"
            );
            assert!(request_text.contains("Invoice #42"));
            assert!(
                request_text
                    .to_ascii_lowercase()
                    .contains("authorization: bearer fixture-routine-token")
            );
            respond(&mut decide, r#"{"probabilities":{"invoice":0.9}}"#).await;
            let (mut label, _) = listener.accept().await.unwrap();
            assert!(request(&mut label).await.starts_with("POST /email/labels "));
            respond(&mut label, r#"{"id":"label-1"}"#).await;
            // The storage write is refused in the process; nothing else arrives.
            assert!(
                tokio::time::timeout(Duration::from_millis(500), listener.accept())
                    .await
                    .is_err()
            );
        });
        let (_root, code) = code(&host).await;
        let trigger = json!({ "entity_id": "thread-1", "email": { "subject": "Invoice #42" } });
        let outcome = code
            .run(
                &owner(),
                CodeRun {
                    step: &step(vec![WriteScope::Email]),
                    trigger: Some(&trigger),
                    steps: &json!({ "first": { "count": 2 } }),
                    dry_run: false,
                },
            )
            .await;
        let output = outcome.result.unwrap();
        assert_eq!(output["invoice"], true);
        assert_eq!(output["earlier"], json!({ "count": 2 }));
        assert!(
            output["deleted"]
                .as_str()
                .unwrap()
                .contains("can't make changes in storage")
        );
        let calls: Vec<_> = outcome
            .calls
            .iter()
            .map(|call| (call.operation.as_str(), call.write, call.status))
            .collect();
        assert_eq!(
            calls,
            [
                ("cognition.decisions", false, CallStatus::Completed),
                ("email.createLabel", true, CallStatus::Completed),
                ("storage.deleteDocument", true, CallStatus::Refused),
            ]
        );
        assert!(outcome.calls[0].duration_ms.is_some());
        server.await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_dry_run_shows_what_the_step_would_change() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut decide, _) = listener.accept().await.unwrap();
            assert!(request(&mut decide).await.starts_with("POST /decisions "));
            respond(&mut decide, r#"{"probabilities":{"invoice":0.9}}"#).await;
            assert!(
                tokio::time::timeout(Duration::from_millis(500), listener.accept())
                    .await
                    .is_err()
            );
        });
        let (_root, code) = code(&host).await;
        let trigger = json!({ "entity_id": "thread-1", "email": { "subject": "Invoice #42" } });
        let outcome = code
            .run(
                &owner(),
                CodeRun {
                    step: &step(vec![WriteScope::Email]),
                    trigger: Some(&trigger),
                    steps: &json!({}),
                    dry_run: true,
                },
            )
            .await;
        assert!(outcome.result.is_ok(), "{:?}", outcome.result);
        let statuses: Vec<_> = outcome.calls.iter().map(|call| call.status).collect();
        assert_eq!(
            statuses,
            [
                CallStatus::Completed,
                CallStatus::Skipped,
                CallStatus::Skipped
            ]
        );
        server.await.unwrap();
    }
}
