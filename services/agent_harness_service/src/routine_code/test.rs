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
    let Err(too_large) = result(Outcome::Succeeded {
        value: json!("x".repeat(MAX_OUTPUT_BYTES)),
    }) else {
        panic!("an output over the limit fails");
    };
    assert!(too_large.contains("at most 64 KB"), "{too_large}");
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

/// Runs nothing; counts the programs it was given.
#[derive(Default)]
struct Programs(std::sync::Mutex<usize>);

#[async_trait::async_trait]
impl ProgramExecutor for Programs {
    async fn check_program(
        &self,
        _: &code_execution::domain::ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<(), code_execution::domain::Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: code_execution::domain::ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        *self.0.lock().unwrap() += 1;
        Outcome::Succeeded { value: json!({}) }
    }
}

/// Checks nothing.
struct NoChecks;

#[async_trait::async_trait]
impl ProgramChecker for NoChecks {
    fn sdk_fingerprint(&self) -> &str {
        "0.3.0+fixture"
    }

    async fn check_files(
        &self,
        _: &[code_execution::domain::SourceFile],
        _: &str,
        _: code_execution::domain::ProgramImports,
    ) -> Result<Vec<code_execution::domain::Diagnostic>, code_execution::domain::CheckError> {
        Ok(Vec::new())
    }
}

/// Records the credentials it mints: who they act as, and for which routine.
#[derive(Default)]
struct RecordedTokens(std::sync::Mutex<Vec<(CodeIdentity, Uuid)>>);

impl RoutineCredentials for RecordedTokens {
    async fn mint(
        &self,
        _: &MacroUserIdStr<'static>,
        acts_as: CodeIdentity,
        routine_id: Uuid,
        _: bool,
    ) -> anyhow::Result<String> {
        self.0.lock().unwrap().push((acts_as, routine_id));
        Ok("fixture-routine-token".into())
    }
}

#[tokio::test(start_paused = true)]
async fn a_step_waits_for_a_free_slot_before_its_credential_and_gives_up_after_five_minutes() {
    let programs = Arc::new(Programs::default());
    let code = Arc::new(
        SdkRoutineCode::new(
            Arc::clone(&programs) as Arc<dyn ProgramExecutor>,
            Arc::new(NoChecks),
            RecordedTokens::default(),
            code_execution::domain::SdkEndpoints::default(),
            Arc::new(ai_usage::NoOpUsageRecorder),
            None,
            Arc::new(NoTimeZones),
        )
        .with_slots(1),
    );
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let step = routine_program::CodeStep {
        id: None,
        title: "Label invoices".into(),
        summary: String::new(),
        source: "export async function main() {}".into(),
        knobs: Vec::new(),
        sentence: None,
    };
    let context = json!({ "run": {} });
    let routine_id = Uuid::from_u128(7);
    let run = |code: Arc<SdkRoutineCode<RecordedTokens>>| {
        let (owner, step, context) = (owner.clone(), step.clone(), context.clone());
        async move {
            code.run(
                &owner,
                CodeRun {
                    step: &step,
                    context: &context,
                    steps: &json!({}),
                    dry_run: false,
                    acts_as: CodeIdentity::Owner,
                    routine_id,
                },
            )
            .await
        }
    };

    // While every slot is taken, a step waits without minting a credential.
    let held = Arc::clone(&code.slots).acquire_owned().await.unwrap();
    let waiting = tokio::spawn(run(Arc::clone(&code)));
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert!(code.credentials.0.lock().unwrap().is_empty());
    // A slot that frees up within five minutes runs it, and the wait is kept.
    drop(held);
    let ran = waiting.await.unwrap();
    assert_eq!(ran.result, Ok(json!({})));
    assert_eq!(ran.waited_ms, Some(60_000));
    assert_eq!(*programs.0.lock().unwrap(), 1);
    // Its credential acts as the run said, stamped with its routine.
    assert_eq!(
        *code.credentials.0.lock().unwrap(),
        [(CodeIdentity::Owner, routine_id)]
    );

    // One that doesn't fails the step with the reason, and never runs it.
    let _held = Arc::clone(&code.slots).acquire_owned().await.unwrap();
    let busy = run(Arc::clone(&code)).await;
    assert_eq!(
        busy.result,
        Err(
            "Macro was busy running other routines; this run waited 5 minutes for a turn."
                .to_owned()
        )
    );
    assert_eq!(busy.waited_ms, Some(300_000));
    assert_eq!(*programs.0.lock().unwrap(), 1);
}

const PRIVATE: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

/// Signs each token with the claims the real signer signs, under the local
/// test key.
struct SignedTokens;

impl RoutineCredentials for SignedTokens {
    async fn mint(
        &self,
        _: &MacroUserIdStr<'static>,
        acts_as: CodeIdentity,
        routine_id: Uuid,
        dry_run: bool,
    ) -> anyhow::Result<String> {
        let (agent_id, scope) = routine_claims(acts_as, dry_run);
        macro_auth::macro_api_token::encode_macro_api_token(
            macro_auth::macro_api_token::EncodeMacroApiTokenArgs {
                fusionauth_id: "fixture".into(),
                macro_user_id: "macro|owner@example.com".into(),
                organization_id: None,
                issuer: "fixture".into(),
                private_key: PRIVATE.into(),
                expiry_seconds: 60,
                agent_id,
                agent_via: None,
                agent_correlation_id: None,
                agent_session_id: None,
                routine_id: Some(routine_id),
                agent_scope: scope.map(|scope| scope.as_str().to_owned()),
            },
        )
    }
}

/// Keeps the token each program was run with.
#[derive(Default)]
struct RunTokens(std::sync::Mutex<Vec<String>>);

#[async_trait::async_trait]
impl ProgramExecutor for RunTokens {
    async fn check_program(
        &self,
        _: &code_execution::domain::ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<(), code_execution::domain::Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: code_execution::domain::ExecuteRequest,
        environment: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        self.0.lock().unwrap().push(environment.token);
        Outcome::Succeeded { value: json!({}) }
    }
}

/// A dry run's token can't write, whatever the code does in its process:
/// a service refuses each write it sends, and still serves its reads. A real
/// run's token writes as before.
#[tokio::test]
async fn a_dry_run_token_is_refused_every_write() {
    use tower::ServiceExt;

    let tokens = Arc::new(RunTokens::default());
    let code = SdkRoutineCode::new(
        Arc::clone(&tokens) as Arc<dyn ProgramExecutor>,
        Arc::new(NoChecks),
        SignedTokens,
        code_execution::domain::SdkEndpoints::default(),
        Arc::new(ai_usage::NoOpUsageRecorder),
        None,
        Arc::new(NoTimeZones),
    );
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let step = routine_program::CodeStep {
        id: None,
        title: "Label invoices".into(),
        summary: String::new(),
        source: "export async function main() {}".into(),
        knobs: Vec::new(),
        sentence: None,
    };
    for (dry_run, acts_as) in [
        (true, CodeIdentity::Agent),
        (true, CodeIdentity::Owner),
        (false, CodeIdentity::Owner),
    ] {
        let ran = code
            .run(
                &owner,
                CodeRun {
                    step: &step,
                    context: &json!({ "run": {} }),
                    steps: &json!({}),
                    dry_run,
                    acts_as,
                    routine_id: Uuid::from_u128(7),
                },
            )
            .await;
        assert_eq!(ran.result, Ok(json!({})));
    }
    let api = axum::Router::new()
        .route(
            "/email/messages",
            axum::routing::post(|| async { axum::http::StatusCode::OK }),
        )
        .route(
            "/email/threads/{id}",
            axum::routing::get(|| async { axum::http::StatusCode::OK })
                .delete(|| async { axum::http::StatusCode::OK }),
        )
        .route(
            "/search",
            axum::routing::post(|| async { axum::http::StatusCode::OK }),
        )
        .layer(axum::middleware::from_fn_with_state(
            macro_auth::middleware::decode_jwt::JwtValidationArgs::testing_macro_token(
                "fixture", PUBLIC,
            ),
            agent_correlation::inbound::enforce_signed_scope,
        ));
    let status = |token: String, method: &'static str, path: &'static str| {
        let api = api.clone();
        async move {
            api.oneshot(
                axum::http::Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", format!("Bearer {token}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }
    };
    let minted = tokens.0.lock().unwrap().clone();
    let [agent_dry_run, owner_dry_run, real] = minted.try_into().unwrap();
    for token in [agent_dry_run, owner_dry_run] {
        for (method, path) in [("POST", "/email/messages"), ("DELETE", "/email/threads/1")] {
            assert_eq!(
                status(token.clone(), method, path).await,
                axum::http::StatusCode::FORBIDDEN,
                "{method} {path}"
            );
        }
        for (method, path) in [("GET", "/email/threads/1"), ("POST", "/search")] {
            assert_eq!(
                status(token.clone(), method, path).await,
                axum::http::StatusCode::OK,
                "{method} {path}"
            );
        }
    }
    assert_eq!(
        status(real, "POST", "/email/messages").await,
        axum::http::StatusCode::OK
    );
}

/// Owners without calendars: every owner reads UTC.
struct NoTimeZones;

#[async_trait::async_trait]
impl OwnerTimeZones for NoTimeZones {
    async fn time_zone(&self, _: &MacroUserIdStr<'static>) -> Option<String> {
        None
    }
}

mod real_deno {
    //! The adapter over the real checker and executor, against a fake API:
    //! the step contract type-checks, code runs with its inputs, a dry run
    //! holds back writes, and every call lands in the journal.

    use std::path::PathBuf;

    use code_execution::domain::{ExecutionService, Limits};
    use code_execution::outbound::deno::{DenoRunner, check::DenoChecker};
    use routine_program::RoutineProgram;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::*;

    struct FixedToken;

    impl RoutineCredentials for FixedToken {
        async fn mint(
            &self,
            _: &MacroUserIdStr<'static>,
            _: CodeIdentity,
            _: Uuid,
            _: bool,
        ) -> anyhow::Result<String> {
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
        let checker = Arc::new(
            DenoChecker::new(deno, root.path().join("checks"), 1, 4, 64 * 1024)
                .await
                .unwrap(),
        );
        let executor =
            ExecutionService::new(Arc::new(runner), checker.clone(), Limits::default()).unwrap();
        let endpoints = code_execution::domain::SdkEndpoints {
            hosts: ["cognition", "email", "storage"]
                .map(|name| (name.to_owned(), host.to_owned()))
                .into(),
            ..Default::default()
        };
        let code = SdkRoutineCode::new(
            Arc::new(executor),
            checker,
            FixedToken,
            endpoints,
            Arc::new(ai_usage::NoOpUsageRecorder),
            None,
            Arc::new(NoTimeZones),
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
export async function main({ macro, trigger, steps, run }: StepContext) {
  const subject = trigger.kind === "event" ? trigger.item.email?.subject : undefined;
  const decision = await macro.ai.decide({
    input: { subject, at: run.at, timezone: run.timezone },
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
  return { invoice, earlier: steps.first ?? null, deleted, dryRun: run.dryRun };
}
"#;

    fn step() -> routine_program::CodeStep {
        let program = RoutineProgram::from_task(&json!({ "steps": [{
            "type": "code", "title": "Label invoices", "source": SOURCE,
        }] }))
        .unwrap();
        program.code_steps()[0].clone()
    }

    fn owner() -> MacroUserIdStr<'static> {
        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
    }

    fn program(steps: serde_json::Value) -> RoutineProgram {
        let mut program = RoutineProgram::from_task(&json!({ "steps": steps })).unwrap();
        program.assign_step_ids();
        program
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn the_step_contract_type_checks_sdk_calls() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        // `SOURCE` reads the output of an earlier step named "First".
        let checked = |source: &str| {
            program(json!([
                { "type": "code", "title": "First", "source": "export async function main() { return { count: 2 }; }" },
                { "type": "code", "title": "Label invoices", "source": source },
            ]))
        };
        assert_eq!(
            code.check_program(&checked(SOURCE)).await.unwrap(),
            Vec::new()
        );
        let failing = code
            .check_program(&checked(
                "export async function main({ macro }: StepContext) { return macro.ai.guess({}); }",
            ))
            .await
            .unwrap();
        assert_eq!(failing.len(), 1);
        assert!(
            failing[0].problems[0].contains("Property 'guess' does not exist"),
            "{failing:?}"
        );
        assert_eq!(failing[0].index, 1);
        assert!(failing[0].problems[0].contains("at step_1.ts:1:"));
        // The routine's own run context is typed; the old trigger shape isn't.
        let old = code
            .check_program(&checked(
                "export async function main({ trigger }: StepContext) { return trigger.entity_id; }",
            ))
            .await
            .unwrap();
        assert!(!old.is_empty());
        // The runner calls `main` with the context, so a step whose `main`
        // takes something else, or that has none, fails here, not every run.
        for source in [
            "export async function main(value: string) { return value.toUpperCase(); }",
            "export async function run() { return 1; }",
            "export default async function main(context: StepContext) { return 1; }",
        ] {
            assert_eq!(
                code.check_program(&checked(source)).await.unwrap().len(),
                1,
                "{source}"
            );
        }
        assert_eq!(
            code.sdk().unwrap(),
            routine_program::code_version(code_execution::domain::sdk_fingerprint())
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn each_step_reads_the_typed_outputs_of_the_steps_before_it() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        let routine = |read: &str| {
            program(json!([
                { "type": "code", "title": "Count", "source": "export async function main({ run }: StepContext) { return { count: 3, since: new Date(run.at) }; }" },
                { "type": "code", "title": "Report", "source": format!("export async function main({{ steps }}: StepContext) {{ {read} }}") },
            ]))
        };
        // `since` is a Date, so the next step reads it as its JSON string.
        assert_eq!(
            code.check_program(&routine(
                "const n: number = steps.count.count; const s: string = steps.count.since; return n + s.length;"
            ))
            .await
            .unwrap(),
            Vec::new()
        );
        let failing = code
            .check_program(&routine("return steps.count.total;"))
            .await
            .unwrap();
        assert_eq!(failing.len(), 1, "{failing:?}");
        assert_eq!((failing[0].index, failing[0].title.as_str()), (1, "Report"));
        assert!(failing[0].problems[0].contains("Property 'total' does not exist"));
    }

    /// A channel message is typed, so a field the event doesn't carry fails
    /// the check; every read the code-step guide has taught still checks,
    /// so saved routines that make them aren't rewritten when the contract
    /// changes.
    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn an_event_message_is_typed_and_the_reads_the_guide_taught_still_check() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        let step = |body: &str| {
            program(json!([{
                "type": "code",
                "title": "Read the event",
                "source": format!(
                    "export async function main({{ trigger }}: StepContext) {{\n  if (trigger.kind !== 'event') return null;\n  {body}\n}}\n"
                ),
            }]))
        };
        for body in [
            // What the guide teaches now.
            "const reply: boolean = trigger.item.message.is_reply; const root: string = trigger.item.message.root_id; return { reply, root, id: trigger.item.message_id ?? null };",
            "if (trigger.item.message.is_reply) return { skipped: true }; return { text: trigger.item.message.text.toUpperCase() };",
            "return { parent: trigger.item.thread_parent?.text ?? null, by: trigger.item.thread_parent?.sender ?? null };",
            // What it taught before: `thread_id`, and the other events' items.
            "if (trigger.item.message.thread_id !== trigger.item.message_id) return { skipped: true }; return { thread: trigger.item.message.thread_id };",
            "const message = trigger.item.message; return { from: message.sender.toLowerCase(), text: message.text, channel: trigger.item.channel.name };",
            "if (!trigger.item.message?.text || trigger.item.message.unavailable) return null; return trigger.item.message.text.length;",
            "return { name: trigger.item.item.name, status: trigger.item.item.properties?.Status, body: trigger.item.item.content };",
            "if (!trigger.item.email || trigger.item.email.unavailable) return null; return { subject: trigger.item.email.subject, from: trigger.item.email.from?.email, labels: trigger.item.email.labels };",
            "return { title: trigger.item.call?.title, people: trigger.item.call?.participants?.length, lines: trigger.item.call?.transcript?.join('\\n') };",
            "const { message } = trigger.item; return { edited: message.edited, files: message.attachments, at: message.sent_at };",
        ] {
            assert_eq!(
                code.check_program(&step(body)).await.unwrap(),
                Vec::new(),
                "{body}"
            );
        }
        for (body, field) in [
            ("return trigger.item.message.isReply;", "isReply"),
            ("return trigger.item.message.parent_id;", "parent_id"),
            ("return trigger.item.message.id;", "id"),
            ("return trigger.item.thread_parent?.thread;", "thread"),
        ] {
            let failing = code.check_program(&step(body)).await.unwrap();
            assert_eq!(failing.len(), 1, "{body}");
            assert!(
                failing[0].problems[0].contains(&format!("Property '{field}' does not exist")),
                "{failing:?}"
            );
        }
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
            // A step runs with its owner's access: every write is sent.
            let (mut delete, _) = listener.accept().await.unwrap();
            assert!(request(&mut delete).await.starts_with("DELETE "));
            respond(&mut delete, "{}").await;
        });
        let (_root, code) = code(&host).await;
        let context = json!({
            "run": { "id": "run-1", "at": "2026-11-01T09:00:00Z", "timezone": "Europe/Paris", "dryRun": false, "previous": null, "lastSucceededAt": null },
            "routine": { "id": "routine-1", "name": "Label invoices" },
            "trigger": { "kind": "event", "event": "email.message_received", "item": { "entity_id": "thread-1", "email": { "subject": "Invoice #42" } } },
        });
        let outcome = code
            .run(
                &owner(),
                CodeRun {
                    step: &step(),
                    context: &context,
                    steps: &json!({ "first": { "count": 2 } }),
                    dry_run: false,
                    acts_as: CodeIdentity::Agent,
                    routine_id: Uuid::from_u128(1),
                },
            )
            .await;
        let output = outcome.result.unwrap();
        assert_eq!(output["invoice"], true);
        assert_eq!(output["earlier"], json!({ "count": 2 }));
        assert_eq!(output["dryRun"], false);
        assert_eq!(output["deleted"], "deleted");
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
                ("storage.deleteDocument", true, CallStatus::Completed),
            ]
        );
        assert!(outcome.calls[0].duration_ms.is_some());
        server.await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_step_reads_its_knobs_typed_and_gets_their_values() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        let knobbed = |source: &str| {
            program(json!([{
                "type": "code", "title": "Triage", "source": source,
                "knobs": [
                    { "type": "choice", "name": "priority", "label": "Priority", "value": "High", "options": ["Low", "High"] },
                    { "type": "number", "name": "days", "label": "Days", "value": 7 },
                ],
            }]))
        };
        let reads = "export async function main({ knobs }: StepContext) { return { priority: knobs.priority, days: knobs.days + 1 }; }";
        assert_eq!(
            code.check_program(&knobbed(reads)).await.unwrap(),
            Vec::new()
        );
        // A choice is the union of its options, and there are no other knobs.
        for wrong in [
            "export async function main({ knobs }: StepContext) { return knobs.priority === 'Urgent'; }",
            "export async function main({ knobs }: StepContext) { return knobs.color; }",
        ] {
            assert!(
                !code
                    .check_program(&knobbed(wrong))
                    .await
                    .unwrap()
                    .is_empty(),
                "{wrong}"
            );
        }
        let routine = knobbed(reads);
        let outcome = code
            .run(
                &owner(),
                CodeRun {
                    step: routine.code_steps()[0],
                    context: &json!({ "run": {} }),
                    steps: &json!({}),
                    dry_run: false,
                    acts_as: CodeIdentity::Agent,
                    routine_id: Uuid::from_u128(1),
                },
            )
            .await;
        assert_eq!(
            outcome.result.unwrap(),
            json!({ "priority": "High", "days": 8 })
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_step_reads_an_entity_knob_as_the_sdk_handle_for_its_item() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        let knobbed = |source: &str, entity_types: serde_json::Value| {
            program(json!([{
                "type": "code", "title": "Post bugs", "source": source,
                "knobs": [{
                    "type": "entity", "name": "bugs", "label": "Channel to post in",
                    "entity_types": entity_types, "value": { "type": "channel", "id": "c1" },
                }],
            }]))
        };
        let posts = "export async function main({ knobs }: StepContext) { await knobs.bugs.send('Open bugs'); return knobs.bugs.id; }";
        assert_eq!(
            code.check_program(&knobbed(posts, json!(["channel"])))
                .await
                .unwrap(),
            Vec::new()
        );
        // A channel is a Channel: code can't treat it as an id or another
        // kind, and a knob that may be a document can't be posted to.
        for (wrong, entity_types, problem) in [
            (
                "export async function main({ knobs }: StepContext) { return knobs.bugs.toUpperCase(); }",
                json!(["channel"]),
                "Property 'toUpperCase' does not exist",
            ),
            (
                "export async function main({ knobs }: StepContext) { return knobs.bugs.rows(); }",
                json!(["channel"]),
                "Property 'rows' does not exist",
            ),
            (
                posts,
                json!(["channel", "document"]),
                "Property 'send' does not exist",
            ),
        ] {
            let failing = code
                .check_program(&knobbed(wrong, entity_types))
                .await
                .unwrap();
            assert_eq!(failing.len(), 1, "{wrong}");
            assert!(failing[0].problems[0].contains(problem), "{failing:?}");
        }
        let routine = knobbed(
            "export async function main({ macro, knobs }: StepContext) { return { id: knobs.bugs.id, handle: knobs.bugs.constructor === macro.channels.byId('x').constructor }; }",
            json!(["channel"]),
        );
        let outcome = code
            .run(
                &owner(),
                CodeRun {
                    step: routine.code_steps()[0],
                    context: &json!({ "run": {} }),
                    steps: &json!({}),
                    dry_run: false,
                    acts_as: CodeIdentity::Agent,
                    routine_id: Uuid::from_u128(1),
                },
            )
            .await;
        assert_eq!(
            outcome.result.unwrap(),
            json!({ "id": "c1", "handle": true })
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn every_entity_knob_kind_reaches_code_as_the_handle_its_type_names() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        let run = async |routine: &RoutineProgram| {
            code.run(
                &owner(),
                CodeRun {
                    step: routine.code_steps()[0],
                    context: &json!({ "run": {} }),
                    steps: &json!({}),
                    dry_run: false,
                    acts_as: CodeIdentity::Agent,
                    routine_id: Uuid::from_u128(1),
                },
            )
            .await
        };
        // One knob per kind: the type checks as the handle `factory` names,
        // and the bootstrap hands over that very handle.
        let kinds = routine_program::EntityKind::ALL;
        let knobs: Vec<_> = kinds
            .iter()
            .enumerate()
            .map(|(i, kind)| {
                json!({
                    "type": "entity", "name": format!("k{i}"), "label": format!("Item {i}"),
                    "entity_types": [kind], "value": { "type": kind, "id": format!("id-{i}") },
                })
            })
            .collect();
        let reads = kinds
            .iter()
            .enumerate()
            .map(|(i, kind)| {
                let (namespace, method) = kind.factory();
                format!(
                    "k{i}: knobs.k{i}.constructor === macro.{namespace}.{method}('x').constructor && knobs.k{i}.id"
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let every = program(json!([{
            "type": "code", "title": "Read every kind",
            "source": format!("export async function main({{ macro, knobs }}: StepContext) {{ return {{ {reads} }}; }}"),
            "knobs": knobs,
        }]));
        assert_eq!(code.check_program(&every).await.unwrap(), Vec::new());
        let expected: serde_json::Map<_, _> = (0..kinds.len())
            .map(|i| (format!("k{i}"), json!(format!("id-{i}"))))
            .collect();
        assert_eq!(
            run(&every).await.result.unwrap(),
            serde_json::Value::Object(expected)
        );
        // A knob allowing several kinds is their union: code narrows it by
        // `entityType` before calling what only an email thread has.
        let any = |source: &str| {
            program(json!([{
                "type": "code", "title": "Archive it", "source": source,
                "knobs": [{
                    "type": "entity", "name": "item", "label": "Item",
                    "entity_types": ["email_thread", "task", "crm_company"],
                    "value": { "type": "email_thread", "id": "t1" },
                }],
            }]))
        };
        let narrowed = any(
            "export async function main({ knobs }: StepContext) { if (knobs.item.entityType === 'email_thread') return { kind: knobs.item.entityType, archive: typeof knobs.item.archive }; return { kind: knobs.item.entityType }; }",
        );
        assert_eq!(code.check_program(&narrowed).await.unwrap(), Vec::new());
        assert_eq!(
            run(&narrowed).await.result.unwrap(),
            json!({ "kind": "email_thread", "archive": "function" })
        );
        let unnarrowed = code
            .check_program(&any(
                "export async function main({ knobs }: StepContext) { await knobs.item.archive(); }",
            ))
            .await
            .unwrap();
        assert_eq!(unnarrowed.len(), 1, "{unnarrowed:?}");
        assert!(
            unnarrowed[0].problems[0].contains("Property 'archive' does not exist"),
            "{unnarrowed:?}"
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_step_posts_in_the_channel_its_knob_names_and_follows_a_swap() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let (paths, mut posted) = tokio::sync::mpsc::unbounded_channel();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let text = request(&mut stream).await;
                paths
                    .send(text.lines().next().unwrap_or_default().to_owned())
                    .unwrap();
                respond(&mut stream, r#"{"id":"message-1"}"#).await;
            }
        });
        let (_root, code) = code(&host).await;
        let posting = |channel: &str| {
            program(json!([{
                "type": "code", "title": "Post open bugs",
                "source": "export async function main({ knobs }: StepContext) { await knobs.bugs.send('3 open bugs'); return { posted: knobs.bugs.id }; }",
                "knobs": [{
                    "type": "entity", "name": "bugs", "label": "Channel to post in",
                    "entity_types": ["channel"], "value": { "type": "channel", "id": channel },
                }],
                "sentence": "Post open bugs in {bugs}.",
            }]))
        };
        // The owner swaps bug-reports for triage in the settings; the code
        // is the same, and the next run posts in the new channel.
        for channel in [
            "0199a1b2-0000-7000-8000-00000000b065",
            "0199a1b2-0000-7000-8000-0000000071a6",
        ] {
            let routine = posting(channel);
            assert_eq!(code.check_program(&routine).await.unwrap(), Vec::new());
            let outcome = code
                .run(
                    &owner(),
                    CodeRun {
                        step: routine.code_steps()[0],
                        context: &json!({ "run": {} }),
                        steps: &json!({}),
                        dry_run: false,
                        acts_as: CodeIdentity::Agent,
                        routine_id: Uuid::from_u128(1),
                    },
                )
                .await;
            assert_eq!(outcome.result.unwrap(), json!({ "posted": channel }));
            let line = posted.recv().await.unwrap();
            assert!(
                line.starts_with(&format!("POST /messages/channel/{channel} ")),
                "{line}"
            );
        }
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
        let context = json!({
            "run": { "id": "run-1", "at": "2026-11-01T09:00:00Z", "timezone": "Europe/Paris", "dryRun": false, "previous": null, "lastSucceededAt": null },
            "routine": { "id": "routine-1", "name": "Label invoices" },
            "trigger": { "kind": "event", "event": "email.message_received", "item": { "entity_id": "thread-1", "email": { "subject": "Invoice #42" } } },
        });
        let outcome = code
            .run(
                &owner(),
                CodeRun {
                    step: &step(),
                    context: &context,
                    steps: &json!({}),
                    dry_run: true,
                    acts_as: CodeIdentity::Agent,
                    routine_id: Uuid::from_u128(1),
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

    /// Catalog routines are offered as they are, and the CreateRoutine example
    /// and the Compose Routines skill's example step are copied by agents, so
    /// all of them must check against today's SDK. The skill's step is checked
    /// by its source, with the title, knobs and sentence its example gives it.
    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn every_catalog_routine_and_example_step_type_checks() {
        let (_root, code) = code("http://127.0.0.1:9").await;
        for routine in routine_program::CATALOG.iter() {
            let Some(step) = &routine.code else { continue };
            let program = program(json!([routine_program::Step::Code(step.clone())]));
            let problems = code.check_program(&program).await.unwrap();
            assert_eq!(problems, Vec::new(), "catalog routine {}", routine.key);
        }
        let doc = include_str!("../../../../crates/routines/src/create_routine.md");
        let (_, example) = doc.split_once("Its `steps` string holds:\n").unwrap();
        let steps: serde_json::Value = serde_json::from_str(example.trim()).unwrap();
        let problems = code.check_program(&program(steps)).await.unwrap();
        assert_eq!(problems, Vec::new(), "the CreateRoutine example");
        // The Compose Routines skill's example step, as code mode carries it
        // after the routines guide.
        let routines = agent_code_mode::domain::sdk_documentation()
            .iter()
            .find(|doc| doc.name == "routines")
            .unwrap();
        let guide = agent_code_mode::domain::with_attached_skill(routines)
            .guide
            .unwrap();
        let (_, rest) = guide.split_once("        source: `").unwrap();
        let (source, _) = rest.split_once("`,\n").unwrap();
        let steps = json!([{
            "type": "code",
            "title": "Post the bug",
            "summary": "Posts a message that reports a bug in the triage channel.",
            "knobs": [{ "type": "text", "name": "channel", "label": "Channel to post bugs in", "value": "bug-triage" }],
            "sentence": "Post the message in {channel}.",
            "source": source,
        }]);
        let problems = code.check_program(&program(steps)).await.unwrap();
        assert_eq!(problems, Vec::new(), "the Compose Routines example");
    }
}

#[test]
fn a_draft_reads_the_symbols_it_names_then_the_types_they_name() {
    let reference = symbol_references(
        &[
            "TaskNamespace.search".to_owned(),
            "UserNamespace.list".to_owned(),
            "TaskNamespace.search".to_owned(),
        ],
        "",
        DRAFT_REFERENCE_BYTES,
    );

    // Their entities' indexes, so the writer sees what `UserNamespace`
    // really has.
    assert!(reference.starts_with("## tasks\n"));
    assert!(reference.contains("\n## users\n"));
    assert!(reference.contains("`UserNamespace.search`"));
    assert!(!reference.contains("ReadCodeDocs"));
    // A method's reference is headed by its full name, once, and its options
    // type, which the reference names, follows.
    assert_eq!(reference.matches("## `TaskNamespace.search`\n").count(), 1);
    assert!(reference.contains("## `SearchOpts`\n"));

    // A property value's union is two types away from the method that
    // returns it.
    let properties = symbol_references(
        &["PropertiedEntity.properties".to_owned()],
        "",
        DRAFT_REFERENCE_BYTES,
    );
    assert!(properties.contains("## `EntityPropertyWithDefinition`\n"));
    assert!(properties.contains("## `properties.PropertyValue`\n"));
    assert!(reference.ends_with(
        "Macro's SDK has none of these; use what the indexes and references name instead: `UserNamespace.list`\n"
    ));
    assert!(reference.len() <= DRAFT_REFERENCE_BYTES + 256);
    assert_eq!(symbol_references(&[], "", DRAFT_REFERENCE_BYTES), "");
}

#[test]
fn a_draft_is_not_shown_an_index_it_already_has() {
    let users = entity_index("UserNamespace").unwrap();
    let shown = format!("the guide\n{users}\n");
    let reference = symbol_references(
        &["UserNamespace.search".to_owned()],
        &shown,
        DRAFT_REFERENCE_BYTES,
    );
    assert!(reference.starts_with("## `UserNamespace.search`\n"));
}

#[test]
fn an_area_reads_its_index_guidance_and_declarations_without_imports() {
    let reference = area_reference(&["tasks".to_owned()]);

    assert!(reference.starts_with("## tasks\n"));
    let files: Vec<&str> = reference
        .lines()
        .filter_map(|line| line.strip_prefix("// @macro-inc/sdk/"))
        .collect();
    assert_eq!(
        files,
        [
            "src/entities/task-templates/namespace.d.ts",
            "src/entities/tasks/namespace.d.ts",
            "src/entities/time/namespace.d.ts",
            "src/entities/task-templates/task-template.d.ts",
            "src/entities/tasks/task.d.ts",
            "src/entities/time/errors.d.ts",
            "src/entities/time/report.d.ts",
            "src/entities/time/task-time.d.ts",
            "src/entities/time/time-entry.d.ts",
            "src/entities/time/timer.d.ts"
        ]
    );
    assert!(reference.contains("class TaskNamespace "));
    assert!(reference.contains("class TaskTemplateNamespace "));
    assert!(reference.contains("class TaskTemplate "));
    assert!(reference.contains("class TimeEntry "));
    assert!(!reference.lines().any(|line| line.starts_with("import ")));
    assert!(reference.len() <= ONE_AREA_BYTES + IMPORTED_TYPE_BYTES + 256);
}

#[test]
fn an_area_brings_the_generated_types_its_declarations_import() {
    let reference = area_reference(&["ai".to_owned()]);

    assert!(reference.contains("class AiNamespace "));
    let (_, types) = reference
        .split_once("The generated types those declarations import:\n\n")
        .unwrap();
    assert!(types.contains("## `DecisionRequest`\n"));
}

#[test]
fn areas_are_found_by_directory_once_each_and_unknown_ones_skipped() {
    // `agentSessions` lives in `agent-sessions`, `foreignEntities` in
    // `foreign`.
    let sessions = area_reference(&["agentSessions".to_owned()]);
    assert!(sessions.contains("// @macro-inc/sdk/src/entities/agent-sessions/namespace.d.ts\n"));
    let foreign = area_reference(&["foreignEntities".to_owned()]);
    assert!(foreign.contains("// @macro-inc/sdk/src/entities/foreign/namespace.d.ts\n"));

    let twice = area_reference(&[
        "tasks".to_owned(),
        " tasks ".to_owned(),
        "notAnArea".to_owned(),
    ]);
    assert_eq!(twice, area_reference(&["tasks".to_owned()]));
    assert_eq!(area_reference(&["notAnArea".to_owned()]), "");

    let every: Vec<String> = AREAS.keys().map(|name| (*name).to_owned()).collect();
    assert!(area_reference(&every).len() <= AREA_REFERENCE_BYTES + IMPORTED_TYPE_BYTES + 256);
}

#[test]
fn the_area_list_names_each_area_and_when_to_use_it() {
    let areas = sdk_areas();
    assert!(areas.lines().any(|line| line.starts_with("- `tasks`: ")));
    assert!(areas.lines().any(|line| line.starts_with("- `email`: ")));
    assert_eq!(areas.lines().count(), AREAS.len());
}

#[test]
fn an_import_line_gives_the_generated_names_it_takes() {
    assert_eq!(
        generated_imports(
            "import type { DecisionRequest, type Choice as Picked } from '../../../generated/cognition/types.gen';"
        ),
        ["DecisionRequest"]
    );
    assert_eq!(
        generated_imports("import { a,\tb, } from \"../generated/x\""),
        ["a", "b"]
    );
    // An aliased name is one the SDK has its own class for.
    assert!(
        generated_imports(
            "import type { CalendarEvent as CalendarEventRecord } from '../../generated/calendar/types.gen';"
        )
        .is_empty()
    );
    // Only the generated clients' types: the SDK's own come with its areas.
    assert!(generated_imports("import type { Macro } from '../../macro';").is_empty());
    assert!(generated_imports("import * as all from '../generated/x';").is_empty());
}
