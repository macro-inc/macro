use super::*;

// Real-runtime tests are opt-in so machines without Deno can run the pure Rust
// suite. CI/local verification must also run `cargo test -p code_execution -- --ignored`.
async fn setup(limits: Limits) -> (tempfile::TempDir, ExecutionService) {
    let root = tempfile::tempdir().unwrap();
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let runner = DenoRunner::new(binary, root.path().to_owned(), 128)
        .await
        .unwrap();
    (
        root,
        ExecutionService::new(std::sync::Arc::new(runner), limits).unwrap(),
    )
}

async fn run(
    service: &ExecutionService,
    source: &str,
    timeout_ms: u64,
) -> (Vec<ExecutionEvent>, Outcome) {
    let mut handle = service
        .execute(ExecuteRequest {
            source: source.into(),
            timeout_ms,
        })
        .unwrap();
    let mut events = Vec::new();
    loop {
        let event = tokio::time::timeout(std::time::Duration::from_secs(10), handle.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let EventKind::Finished { outcome } = event.kind {
            return (events, outcome);
        }
        events.push(event);
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn typescript_logs_progress_result_and_cleanup() {
    let (root, service) = setup(Limits::default()).await;
    let (events, outcome) = run(&service, "const n: number = 6; console.log('working'); progress({step: 1}); await Promise.resolve(); return n * 7;", 5000).await;
    assert!(matches!(outcome, Outcome::Succeeded { value } if value == 42));
    assert!(
        events
            .iter()
            .any(|e| matches!(&e.kind, EventKind::Log { message, .. } if message == "working"))
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(&e.kind, EventKind::Progress { value } if value["step"] == 1))
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn denies_ambient_io_and_runtime_imports() {
    let (_root, service) = setup(Limits::default()).await;
    for source in [
        "return Deno.env.get('PATH');",
        "return Deno.readTextFile('/etc/passwd');",
        "await Deno.writeTextFile('/tmp/macro-code-execution-forbidden', 'bad');",
        "return await fetch('http://127.0.0.1:38123');",
        "return new Deno.Command('/bin/true').output();",
        "return await import('file:///etc/passwd');",
        "const fs = await import('node:fs'); return fs.readFileSync('/etc/passwd', 'utf8');",
        "import secret from '/etc/passwd'; return secret;",
    ] {
        let (_, outcome) = run(&service, source, 5000).await;
        assert!(
            matches!(outcome, Outcome::Failed { .. }),
            "allowed forbidden source: {source}"
        );
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn times_out_cancels_and_reaps_busy_processes() {
    let (root, service) = setup(Limits::default()).await;
    let (_, outcome) = run(&service, "while (true) {}", 300).await;
    assert!(matches!(outcome, Outcome::TimedOut));
    let mut handle = service
        .execute(ExecuteRequest {
            source: "console.log('ready'); while(true) {}".into(),
            timeout_ms: 5000,
        })
        .unwrap();
    while !matches!(
        handle.events.recv().await.unwrap().kind,
        EventKind::Log { .. }
    ) {}
    handle.cancellation.cancel();
    loop {
        if let EventKind::Finished { outcome } = handle.events.recv().await.unwrap().kind {
            assert!(matches!(outcome, Outcome::Cancelled));
            break;
        }
    }
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn bounds_untrusted_output_and_rejects_forged_protocol() {
    let (_root, service) = setup(Limits {
        max_frame_bytes: 16 * 1024,
        ..Limits::default()
    })
    .await;
    for source in [
        "console.log('x'.repeat(20000));",
        "while (true) console.log('spam');",
        "Deno.stdout.writeSync(new TextEncoder().encode('not json\\n'));",
        "Deno.stdout.writeSync(new TextEncoder().encode('{\"type\":\"started\"}\\n'));",
        "return Promise.all(Array.from({length: 17}, () => host.call('test', {})));",
    ] {
        let (_, outcome) = run(&service, source, 5000).await;
        assert!(
            matches!(outcome, Outcome::Failed { error } if matches!(error.code, FailureCode::Limit | FailureCode::Protocol))
        );
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_printed_result_cannot_claim_completion_while_the_process_is_running() {
    let (root, service) = setup(Limits::default()).await;
    let (_, outcome) = run(&service,
        "Deno.stdout.writeSync(new TextEncoder().encode('{\"type\":\"result\",\"value\":42}\\n')); while(true) {}", 500).await;
    assert!(matches!(outcome, Outcome::TimedOut));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rejects_replies_not_owned_by_the_execution() {
    let (_root, service) = setup(Limits::default()).await;
    let mut handle = service
        .execute(ExecuteRequest {
            source: "return await host.call('test.wait', {});".into(),
            timeout_ms: 5000,
        })
        .unwrap();
    while !matches!(
        handle.events.recv().await.unwrap().kind,
        EventKind::HostCall { .. }
    ) {}
    handle
        .replies
        .send(HostReply {
            id: CallId(999),
            result: HostResult::Ok { value: Value::Null },
        })
        .await
        .unwrap();
    loop {
        if let EventKind::Finished { outcome } = handle.events.recv().await.unwrap().kind {
            assert!(
                matches!(outcome, Outcome::Failed { error } if error.code == FailureCode::Protocol)
            );
            break;
        }
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn retains_the_response_pump_error_diagnostic() {
    let (_root, service) = setup(Limits::default()).await;
    let mut handle = service
        .execute(ExecuteRequest {
            // A forged call is known to the host but has no SDK promise. The
            // response pump must report its diagnostic when the reply arrives.
            source: r#"Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify({type: 'call', id: 1, method: 'test', args: {}}) + '\n')); await new Promise(() => {});"#.into(),
            timeout_ms: 5000,
        })
        .unwrap();
    while !matches!(
        handle.events.recv().await.unwrap().kind,
        EventKind::HostCall { .. }
    ) {}
    handle
        .replies
        .send(HostReply {
            id: CallId(1),
            result: HostResult::Ok { value: Value::Null },
        })
        .await
        .unwrap();
    loop {
        if let EventKind::Finished { outcome } = handle.events.recv().await.unwrap().kind {
            assert!(matches!(outcome, Outcome::Failed { error }
                if error.message.contains("Unexpected host reply")));
            break;
        }
    }
    service.shutdown().await;
}
