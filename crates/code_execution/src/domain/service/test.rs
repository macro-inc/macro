use super::*;
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};

struct WaitingRunner(AtomicUsize);

#[async_trait]
impl CodeRunner for WaitingRunner {
    async fn run(
        &self,
        job: ExecutionJob,
        _events: &mut EventSink,
        cancellation: CancellationToken,
    ) -> Outcome {
        self.0.fetch_add(1, Ordering::SeqCst);
        tokio::select! {
            _ = cancellation.cancelled() => Outcome::Cancelled,
            _ = sleep_until(job.deadline) => Outcome::TimedOut,
        }
    }
}

/// Passes every program, as a checker that finds nothing wrong does.
struct Passes;

#[async_trait]
impl ProgramChecker for Passes {
    fn sdk_fingerprint(&self) -> &str {
        "test"
    }

    async fn check_files(
        &self,
        _files: &[SourceFile],
        _declarations: &str,
        _imports: ProgramImports,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        Ok(Vec::new())
    }
}

fn request(timeout_ms: u64) -> ExecuteRequest {
    ExecuteRequest {
        source: "return 42;".into(),
        timeout_ms,
    }
}

#[tokio::test]
async fn validates_before_admission_and_bounds_queue() {
    let runner = Arc::new(WaitingRunner(AtomicUsize::new(0)));
    let service = ExecutionService::new(
        runner.clone(),
        Arc::new(Passes),
        Limits {
            max_running: 1,
            max_queued: 1,
            ..Limits::default()
        },
    )
    .unwrap();
    assert!(matches!(
        service.execute(request(0), RunEnvironment::default()),
        Err(AdmissionError::InvalidTimeout)
    ));
    assert!(matches!(
        service.execute(request(30_001), RunEnvironment::default()),
        Err(AdmissionError::InvalidTimeout)
    ));
    assert!(matches!(
        service.execute(
            ExecuteRequest {
                source: " ".into(),
                timeout_ms: 1
            },
            RunEnvironment::default()
        ),
        Err(AdmissionError::InvalidSource)
    ));
    let mut first = service
        .execute(request(10_000), RunEnvironment::default())
        .unwrap();
    while !matches!(first.events.recv().await.unwrap().kind, EventKind::Started) {}
    let second = service
        .execute(request(10_000), RunEnvironment::default())
        .unwrap();
    assert!(matches!(
        service.execute(request(1), RunEnvironment::default()),
        Err(AdmissionError::Busy)
    ));
    assert_eq!(runner.0.load(Ordering::SeqCst), 1);
    drop(first);
    drop(second);
    service.shutdown().await;
    assert!(matches!(
        service.execute(request(1), RunEnvironment::default()),
        Err(AdmissionError::ShuttingDown)
    ));
}

#[tokio::test]
async fn queued_deadline_does_not_start_another_process() {
    let runner = Arc::new(WaitingRunner(AtomicUsize::new(0)));
    let service = ExecutionService::new(
        runner.clone(),
        Arc::new(Passes),
        Limits {
            max_running: 1,
            max_queued: 1,
            ..Limits::default()
        },
    )
    .unwrap();
    let mut first = service
        .execute(request(10_000), RunEnvironment::default())
        .unwrap();
    while !matches!(first.events.recv().await.unwrap().kind, EventKind::Started) {}
    let mut second = service
        .execute(request(20), RunEnvironment::default())
        .unwrap();
    let mut terminal = None;
    while let Some(event) = second.events.recv().await {
        if let EventKind::Finished { outcome } = event.kind {
            terminal = Some(outcome)
        }
    }
    assert!(matches!(terminal, Some(Outcome::TimedOut)));
    assert_eq!(runner.0.load(Ordering::SeqCst), 1);
    drop(first);
    service.shutdown().await;
}

#[test]
fn advisory_progress_cannot_consume_the_log_budget() {
    let (sender, mut receiver) = mpsc::channel(5);
    let mut sink = EventSink {
        run_id: RunId(uuid::Uuid::now_v7()),
        sender,
        sequence: 0,
        remaining: 2,
        remaining_progress: 2,
    };
    sink.progress(serde_json::json!({"event": 1}));
    sink.progress(serde_json::json!({"event": 2}));
    sink.emit(EventKind::Log {
        level: LogLevel::Info,
        message: "still works".into(),
    })
    .unwrap();
    sink.emit(EventKind::Log {
        level: LogLevel::Info,
        message: "second log".into(),
    })
    .unwrap();
    assert_eq!(receiver.try_recv().unwrap().sequence, 0);
    assert_eq!(receiver.try_recv().unwrap().sequence, 1);
    assert_eq!(receiver.try_recv().unwrap().sequence, 2);
    assert_eq!(receiver.try_recv().unwrap().sequence, 3);
    assert!(receiver.try_recv().is_err());
}

#[test]
fn result_budget_must_fit_in_a_frame() {
    assert!(matches!(
        Limits {
            max_frame_bytes: 16 * 1024,
            ..Limits::default()
        }
        .validate(),
        Err(AdmissionError::InvalidLimits)
    ));
    assert!(matches!(
        Limits {
            max_frame_bytes: 16 * 1024,
            max_result_bytes: 16 * 1024,
            ..Limits::default()
        }
        .validate(),
        Err(AdmissionError::InvalidLimits)
    ));
    assert!(
        Limits {
            max_frame_bytes: 16 * 1024,
            max_result_bytes: 16 * 1024 - RESULT_FRAME_OVERHEAD,
            ..Limits::default()
        }
        .validate()
        .is_ok()
    );
}

/// Runs every program at once, returning what it was given.
struct Echoes(AtomicUsize);

#[async_trait]
impl CodeRunner for Echoes {
    async fn run(
        &self,
        job: ExecutionJob,
        _events: &mut EventSink,
        _cancellation: CancellationToken,
    ) -> Outcome {
        self.0.fetch_add(1, Ordering::SeqCst);
        Outcome::Succeeded {
            value: serde_json::json!(job.request.source),
        }
    }
}

/// Answers every check the same way, keeping what it was asked to check.
struct Answers {
    answer: fn() -> Result<Vec<Diagnostic>, CheckError>,
    checked: std::sync::Mutex<Vec<(Vec<SourceFile>, String, ProgramImports)>>,
}

#[async_trait]
impl ProgramChecker for Answers {
    fn sdk_fingerprint(&self) -> &str {
        "test"
    }

    async fn check_files(
        &self,
        files: &[SourceFile],
        declarations: &str,
        imports: ProgramImports,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        self.checked
            .lock()
            .unwrap()
            .push((files.to_vec(), declarations.to_owned(), imports));
        (self.answer)()
    }
}

async fn finish(mut handle: ExecutionHandle) -> Outcome {
    while let Some(event) = handle.events.recv().await {
        if let EventKind::Finished { outcome } = event.kind {
            return outcome;
        }
    }
    panic!("no terminal event");
}

#[tokio::test]
async fn a_program_with_type_errors_never_runs() {
    let runner = Arc::new(Echoes(AtomicUsize::new(0)));
    let checker = Arc::new(Answers {
        answer: || {
            Ok(vec![Diagnostic {
                file: Some("main.ts".into()),
                message: "TS2339 [ERROR]: Property 'classify' does not exist on type 'AiNamespace'.\n  await macro.ai.classify({ input: 'x' });\n                 ~~~~~~~~\n    at main.ts:2:18".into(),
            }])
        },
        checked: Default::default(),
    });
    let service =
        ExecutionService::new(runner.clone(), checker.clone(), Limits::default()).unwrap();
    let source = "export async function main({ macro }: CodeContext) {\n  await macro.ai.classify({ input: 'x' });\n}\n";
    let outcome = finish(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 10_000,
                },
                RunEnvironment {
                    session_id: Some(uuid::Uuid::now_v7()),
                    execution_id: Some(uuid::Uuid::now_v7()),
                    ..RunEnvironment::default()
                },
            )
            .unwrap(),
    )
    .await;
    let Outcome::Failed { error } = outcome else {
        panic!("expected a failure, got {outcome:?}");
    };
    assert_eq!(error.code, FailureCode::Compile);
    assert!(
        error.message.starts_with(
            "The program wasn't run: it doesn't type-check against the Macro SDK. Fix these errors and run it again.\n\nTS2339 [ERROR]: Property 'classify' does not exist on type 'AiNamespace'.\n  await macro.ai.classify({ input: 'x' });\n                 ~~~~~~~~\n    at main.ts:2:18\n  AiNamespace has: "
        ) && error.message.contains("decide"),
        "{}",
        error.message
    );
    assert_eq!(runner.0.load(Ordering::SeqCst), 0);
    let checked = checker.checked.lock().unwrap();
    assert_eq!(checked.len(), 1);
    let (files, declarations, imports) = &checked[0];
    assert_eq!(
        files,
        &vec![SourceFile {
            name: "main.ts".into(),
            source: source.into(),
        }]
    );
    assert!(declarations.contains("session: ReturnType<Macro['agentSessions']['byId']>;"));
    assert!(declarations.contains("execution: CodeExecution;"));
    assert_eq!(*imports, ProgramImports::SdkAndHandlebars);
}

#[tokio::test]
async fn a_program_that_checks_runs() {
    let runner = Arc::new(Echoes(AtomicUsize::new(0)));
    let checker = Arc::new(Answers {
        answer: || Ok(Vec::new()),
        checked: Default::default(),
    });
    let service =
        ExecutionService::new(runner.clone(), checker.clone(), Limits::default()).unwrap();
    let outcome = finish(
        service
            .execute(request(10_000), RunEnvironment::default())
            .unwrap(),
    )
    .await;
    assert!(
        matches!(&outcome, Outcome::Succeeded { value } if value == "return 42;"),
        "{outcome:?}"
    );
    assert_eq!(runner.0.load(Ordering::SeqCst), 1);
    let checked = checker.checked.lock().unwrap();
    assert_eq!(checked.len(), 1);
    // A public run has no session, so its context declares none.
    assert!(!checked[0].1.contains("session"));
}

#[tokio::test]
async fn an_unavailable_checker_fails_the_run_instead_of_running_it_unchecked() {
    for (answer, code, message) in [
        (
            (|| Err(CheckError::Busy)) as fn() -> Result<Vec<Diagnostic>, CheckError>,
            FailureCode::Limit,
            "The program wasn't run: Macro is busy type-checking other programs. Run it again shortly.",
        ),
        (
            || Err(CheckError::Internal),
            FailureCode::Internal,
            "The program wasn't run: type-checking it failed. Run it again shortly.",
        ),
    ] {
        let runner = Arc::new(Echoes(AtomicUsize::new(0)));
        let checker = Arc::new(Answers {
            answer,
            checked: Default::default(),
        });
        let service = ExecutionService::new(runner.clone(), checker, Limits::default()).unwrap();
        let outcome = finish(
            service
                .execute(request(10_000), RunEnvironment::default())
                .unwrap(),
        )
        .await;
        let Outcome::Failed { error } = outcome else {
            panic!("expected a failure, got {outcome:?}");
        };
        assert_eq!(error.code, code);
        assert_eq!(error.message, message);
        assert_eq!(runner.0.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn an_unattended_program_runs_without_another_check() {
    let runner = Arc::new(Echoes(AtomicUsize::new(0)));
    let checker = Arc::new(Answers {
        answer: || Err(CheckError::Internal),
        checked: Default::default(),
    });
    let service =
        ExecutionService::new(runner.clone(), checker.clone(), Limits::default()).unwrap();
    let outcome = finish(
        service
            .execute(
                request(10_000),
                RunEnvironment {
                    unattended: Some(Unattended {
                        arguments: serde_json::Map::new(),
                        dry_run: false,
                    }),
                    ..RunEnvironment::default()
                },
            )
            .unwrap(),
    )
    .await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    assert!(checker.checked.lock().unwrap().is_empty());
}

#[test]
fn every_operation_gets_at_least_one_call() {
    assert!(matches!(
        Limits {
            max_calls_per_operation: 0,
            ..Limits::default()
        }
        .validate(),
        Err(AdmissionError::InvalidLimits)
    ));
}

/// A member the SDK type doesn't have comes back with the members it has, so
/// the model can fix the call without reading the type first.
#[test]
fn a_missing_sdk_member_lists_what_the_type_has() {
    let failure = type_errors(&[Diagnostic {
        file: Some("main.ts".into()),
        message: "TS2339 [ERROR]: Property 'documents' does not exist on type 'SearchNamespace'.\n  const [doc] = await macro.search.documents('Q4 plan');\n                                   ~~~~~~~~~\n    at main.ts:3:36".into(),
    }]);
    assert_eq!(failure.code, FailureCode::Compile);
    assert!(
        failure
            .message
            .contains("    at main.ts:3:36\n  SearchNamespace has: page, all"),
        "{}",
        failure.message
    );
    // The checker's own suggestion is enough.
    let suggested = type_errors(&[Diagnostic {
        file: Some("main.ts".into()),
        message: "TS2551 [ERROR]: Property 'pag' does not exist on type 'SearchNamespace'. Did you mean 'page'?\n    at main.ts:3:36".into(),
    }]);
    assert!(!suggested.message.contains("has:"), "{}", suggested.message);
}

/// A program checked ahead of its run isn't checked again when it runs, and
/// one that fails its precheck is never run.
#[tokio::test]
async fn a_prechecked_program_runs_without_another_check() {
    let runner = Arc::new(Echoes(AtomicUsize::new(0)));
    let checker = Arc::new(Answers {
        answer: || Ok(Vec::new()),
        checked: Default::default(),
    });
    let service =
        ExecutionService::new(runner.clone(), checker.clone(), Limits::default()).unwrap();
    let shape = ContextShape {
        session: true,
        execution: true,
    };
    let environment = || RunEnvironment {
        session_id: Some(uuid::Uuid::now_v7()),
        execution_id: Some(uuid::Uuid::now_v7()),
        ..RunEnvironment::default()
    };
    service
        .check_program(&request(10_000), shape, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(checker.checked.lock().unwrap().len(), 1);
    let outcome = finish(service.execute(request(10_000), environment()).unwrap()).await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    assert_eq!(checker.checked.lock().unwrap().len(), 1);
    // The pass was for one run: the next one is checked again.
    let outcome = finish(service.execute(request(10_000), environment()).unwrap()).await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    assert_eq!(checker.checked.lock().unwrap().len(), 2);
    // A pass for another shape doesn't count.
    service
        .check_program(
            &request(10_000),
            ContextShape::default(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    finish(service.execute(request(10_000), environment()).unwrap()).await;
    assert_eq!(checker.checked.lock().unwrap().len(), 4);
    assert_eq!(runner.0.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_failed_precheck_reports_the_type_errors() {
    let checker = Arc::new(Answers {
        answer: || {
            Ok(vec![Diagnostic {
                file: Some("main.ts".into()),
                message: "TS2304 [ERROR]: Cannot find name 'nope'.\n    at main.ts:1:1".into(),
            }])
        },
        checked: Default::default(),
    });
    let service = ExecutionService::new(
        Arc::new(Echoes(AtomicUsize::new(0))),
        checker,
        Limits::default(),
    )
    .unwrap();
    let Err(Outcome::Failed { error }) = service
        .check_program(
            &request(10_000),
            ContextShape::default(),
            CancellationToken::new(),
        )
        .await
    else {
        panic!("expected type errors");
    };
    assert_eq!(error.code, FailureCode::Compile);
    assert!(error.message.contains("Cannot find name 'nope'."));
}

/// A precheck takes the executor's admission like a run, so one executor's
/// callers can't fill the checker the others share.
#[tokio::test]
async fn a_precheck_counts_against_admission() {
    let service = ExecutionService::new(
        Arc::new(WaitingRunner(AtomicUsize::new(0))),
        Arc::new(Passes),
        Limits {
            max_running: 1,
            max_queued: 1,
            ..Limits::default()
        },
    )
    .unwrap();
    let mut first = service
        .execute(request(10_000), RunEnvironment::default())
        .unwrap();
    while !matches!(first.events.recv().await.unwrap().kind, EventKind::Started) {}
    let second = service
        .execute(request(10_000), RunEnvironment::default())
        .unwrap();
    let Err(Outcome::Failed { error }) = service
        .check_program(
            &request(10_000),
            ContextShape::default(),
            CancellationToken::new(),
        )
        .await
    else {
        panic!("expected busy");
    };
    assert_eq!(error.code, FailureCode::Limit);
    drop(first);
    drop(second);
    service.shutdown().await;
}

/// A program can't turn its check off.
#[tokio::test]
async fn a_program_that_turns_checking_off_is_refused() {
    let checker = Arc::new(Answers {
        answer: || Ok(Vec::new()),
        checked: Default::default(),
    });
    let service = ExecutionService::new(
        Arc::new(Echoes(AtomicUsize::new(0))),
        checker.clone(),
        Limits::default(),
    )
    .unwrap();
    let Err(Outcome::Failed { error }) = service
        .check_program(
            &ExecuteRequest {
                source: "// @ts-nocheck\nexport async function main() { return {data: 1}; }".into(),
                timeout_ms: 10_000,
            },
            ContextShape::default(),
            CancellationToken::new(),
        )
        .await
    else {
        panic!("expected a refusal");
    };
    assert_eq!(error.code, FailureCode::Compile);
    assert!(error.message.contains("@ts-nocheck"), "{}", error.message);
    assert!(checker.checked.lock().unwrap().is_empty());
}
