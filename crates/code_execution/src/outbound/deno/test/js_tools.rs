//! JS tools programs through the real bootstrap and Deno: the JS tools
//! twins of the JavaScript tests beside this file, plus the analysis, the
//! gate's backstops and the analyzer process the permission gate runs.
//! JavaScript tests without a twin, because a JS tools program has no such
//! feature: module imports, files, the environment, sleeping and raw
//! network or redirects (the interpreter has no `require`, `import`,
//! `fetch`, `Deno`, timers or workers, which
//! `a_program_reaches_nothing_but_its_tools` checks instead), writing its own
//! frames beyond `js_tools_output_is_bounded_and_cannot_forge_frames` (its
//! only output is `console` and its return value, and its result takes the
//! JavaScript path's `resultFrame`), session views and `webUrl()` links (SDK
//! features, not operations), unattended runs, arguments and dry runs
//! (refused), and the credential in results (the program never holds it).

use super::*;

const TOKEN: &str = "fixture-run-token";

const TRACEPARENT: &str = "00-01234567890123456789012345678901-0123456789012345-01";

fn js_tools(source: &str, timeout_ms: u64) -> ExecuteRequest {
    ExecuteRequest {
        source: source.into(),
        timeout_ms,
        language: Language::JsTools,
        module: None,
    }
}

async fn run_js_tools(
    service: &ExecutionService,
    source: &str,
    timeout_ms: u64,
    environment: RunEnvironment,
) -> (Vec<ExecutionEvent>, Outcome) {
    collect(
        service
            .execute(js_tools(source, timeout_ms), environment)
            .unwrap(),
    )
    .await
}

/// A run checked to call `allowed`: every JS tools run is (the runner
/// refuses one that isn't).
fn environment(address: std::net::SocketAddr, allowed: Vec<SdkCall>) -> RunEnvironment {
    RunEnvironment {
        token: TOKEN.into(),
        trace_headers: BTreeMap::from([("traceparent".into(), TRACEPARENT.into())]),
        session_id: Some(uuid::Uuid::from_u128(1)),
        execution_id: Some(uuid::Uuid::from_u128(2)),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("storage".into(), format!("http://{address}/storage"))]),
            web_app_url: "https://app.example.test".into(),
        },
        unattended: None,
        egress: Egress::Direct,
        allowed_operations: Some(allowed),
    }
}

/// A run checked to call nothing, for programs that make no tool calls.
fn checked() -> RunEnvironment {
    RunEnvironment {
        allowed_operations: Some(vec![]),
        ..RunEnvironment::default()
    }
}

/// A stub API that answers `responses` in order, one connection each, and
/// returns the requests it got.
async fn stub(
    responses: Vec<&'static str>,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for body in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            requests.push(read_request(&mut stream).await);
            respond(&mut stream, body).await;
        }
        requests
    });
    (address, server)
}

fn call(operation_id: &str, method: &str, route: &str, rivals: Vec<SdkRoute>) -> SdkCall {
    SdkCall {
        operation: SdkOperation {
            service: "storage".into(),
            operation_id: operation_id.into(),
        },
        method: method.into(),
        route: route.into(),
        rivals,
    }
}

fn create_task() -> SdkCall {
    call(
        "create_task_handler",
        "POST",
        "/documents/create_task",
        vec![],
    )
}

/// What the analysis reports for `get_document_markdown` (the catalog's rivals).
fn read_markdown() -> SdkCall {
    call(
        "get_document_markdown",
        "GET",
        "/documents/{}/markdown",
        vec![
            SdkRoute {
                service: "storage".into(),
                route: "/documents/slug/{}".into(),
            },
            SdkRoute {
                service: "storage".into(),
                route: "/documents/{}/{}".into(),
            },
        ],
    )
}

const CREATE_AND_READ: &str = r#"
console.log("creating");
const task = await tools.storage.create_task_handler({
  body: { taskName: "Fix login redirect loop", markdown: "Signing in from a deep link returns to the login page." },
});
const doc = await tools.storage.get_document_markdown({ path: { document_id: task.documentId } });
return { taskId: task.documentId, markdown: doc.markdown, context };
"#;

fn statuses(events: &[ExecutionEvent]) -> Vec<(String, String)> {
    progress(events)
        .iter()
        .map(|event| {
            (
                event["operation"].as_str().unwrap().to_owned(),
                event["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_js_tools_program_creates_and_reads_a_task() {
    // Gated to exactly what it calls.
    {
        let allowed = vec![create_task(), read_markdown()];
        let (root, service) = setup(Limits::default()).await;
        let (address, server) = stub(vec![
            r#"{"documentId":"task-1","documentMetadata":{},"token":"t","initialSnapshot":""}"#,
            r##"{"markdown":"# Fix login redirect loop","revision":3}"##,
        ])
        .await;
        let (events, outcome) = run_js_tools(
            &service,
            CREATE_AND_READ,
            10_000,
            environment(address, allowed.clone()),
        )
        .await;
        let Outcome::Succeeded { value } = outcome else {
            panic!("{allowed:?}: {outcome:?}");
        };
        assert_eq!(
            value,
            serde_json::json!({"data": {
                "taskId": "task-1",
                "markdown": "# Fix login redirect loop",
                "context": {
                    "sessionId": "00000000-0000-0000-0000-000000000001",
                    "executionId": "00000000-0000-0000-0000-000000000002",
                    "webAppUrl": "https://app.example.test",
                },
            }}),
        );
        let requests = tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        let [create, read] = requests.as_slice() else {
            panic!("{requests:?}");
        };
        assert!(
            create.starts_with("POST /storage/documents/create_task "),
            "{create}"
        );
        assert!(create.ends_with(r#"{"taskName":"Fix login redirect loop","markdown":"Signing in from a deep link returns to the login page."}"#), "{create}");
        assert!(
            read.starts_with("GET /storage/documents/task-1/markdown "),
            "{read}"
        );
        for (request, verb) in [(create, "created"), (read, "read")] {
            let request = request.to_ascii_lowercase();
            assert!(
                request.contains(&format!("authorization: bearer {TOKEN}\r\n")),
                "{request}"
            );
            assert!(
                request.contains("x-macro-code-execution: js_tools\r\n"),
                "{request}"
            );
            assert!(
                request.contains(&format!("x-macro-sdk-verb: {verb}\r\n")),
                "{request}"
            );
            assert!(
                request.contains(&format!("traceparent: {TRACEPARENT}\r\n")),
                "{request}"
            );
        }
        assert_eq!(
            statuses(&events),
            [
                ("createTaskHandler".into(), "started".into()),
                ("createTaskHandler".into(), "completed".into()),
                ("getDocumentMarkdown".into(), "started".into()),
                ("getDocumentMarkdown".into(), "completed".into()),
            ]
        );
        // Session activity reads numeric ids, as the TypeScript SDK sends.
        assert!(progress(&events).iter().all(|event| event["id"].is_u64()));
        assert!(events.iter().any(
            |event| matches!(&event.kind, EventKind::Log { level: LogLevel::Info, message } if message == "creating")
        ));
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        service.shutdown().await;
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn js_tools_calls_run_concurrently() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        // Neither request can finish until both have arrived.
        let (mut first, _) = listener.accept().await.unwrap();
        read_request(&mut first).await;
        let (mut second, _) = listener.accept().await.unwrap();
        read_request(&mut second).await;
        respond(&mut second, r#"{"markdown":"two"}"#).await;
        respond(&mut first, r#"{"markdown":"one"}"#).await;
    });
    let (_, outcome) = run_js_tools(
        &service,
        r#"const docs = await Promise.all(["a", "b"].map((id) => tools.storage.get_document_markdown({ path: { document_id: id } }))); return docs.map((doc) => doc.markdown).sort()"#,
        10_000,
        environment(address, vec![read_markdown()]),
    )
    .await;
    assert!(
        matches!(&outcome, Outcome::Succeeded { value } if *value == serde_json::json!({"data": ["one", "two"]})),
        "{outcome:?}"
    );
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_cpu_limit_stops_a_busy_js_tools_program() {
    let (_root, service) = setup(Limits {
        max_cpu: Some(Duration::from_secs(1)),
        ..Limits::default()
    })
    .await;
    let (_, outcome) = run_js_tools(&service, "while (true) {}", 10_000, checked()).await;
    assert!(
        matches!(&outcome, Outcome::Failed { error } if error.code == FailureCode::Limit && error.message.contains("CPU")),
        "{outcome:?}"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_that_may_call_more_than_the_gate_admitted_never_starts() {
    let (_root, service) = setup(Limits::default()).await;
    let (address, server) = stub(vec!["{}"]).await;
    let (events, outcome) = run_js_tools(
        &service,
        CREATE_AND_READ,
        10_000,
        environment(address, vec![create_task()]),
    )
    .await;
    let error = failure(&outcome);
    assert_eq!(error.code, FailureCode::Compile);
    assert_eq!(
        error.message,
        "main.js: the program calls tools.storage.get_document_markdown, which it wasn't checked to call; it changed after it was checked."
    );
    assert!(progress(&events).is_empty());
    assert!(!server.is_finished());
    server.abort();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_parameter_that_reaches_another_route_is_never_sent() {
    // `slug` sends the request to `/documents/slug/{}`, a more specific
    // route: refused at fetch.
    let (_root, service) = setup(Limits::default()).await;
    let (address, server) = stub(vec!["{}"]).await;
    let (events, outcome) = run_js_tools(
        &service,
        r#"return await tools.storage.get_document_markdown({ path: { document_id: "slug" } })"#,
        10_000,
        environment(address, vec![read_markdown()]),
    )
    .await;
    let error = failure(&outcome);
    assert_eq!(error.code, FailureCode::Runtime);
    assert!(
        error.message.contains(
            "storage.get_document_markdown is outside what this program was checked to call; it was not sent."
        ),
        "{error:?}"
    );
    assert_eq!(
        statuses(&events),
        [("getDocumentMarkdown".into(), "refused".into())]
    );

    // `..` (URL resolution drops the segment) and an object (whose keys the
    // client writes into the path unencoded) never reach fetch, gate or not.
    for document_id in [r#"".." "#, r#"{ "../../storage/documents/x?": 1 }"#] {
        let (events, outcome) = run_js_tools(
            &service,
            &format!("return await tools.storage.get_document_markdown({{ path: {{ document_id: {document_id} }} }})"),
            10_000,
            environment(address, vec![read_markdown()]),
        )
        .await;
        assert!(
            failure(&outcome).message.contains(
                "path.document_id must be a string, number or boolean naming one path segment."
            ),
            "{document_id}: {outcome:?}"
        );
        assert!(progress(&events).is_empty());
    }
    assert!(!server.is_finished());
    server.abort();
    service.shutdown().await;

    // Any other document id goes to the operation's own route.
    let (_root, service) = setup(Limits::default()).await;
    let (address, server) = stub(vec![r#"{"markdown":""}"#]).await;
    let (_, outcome) = run_js_tools(
        &service,
        r#"return await tools.storage.get_document_markdown({ path: { document_id: "doc-1" } })"#,
        10_000,
        environment(address, vec![read_markdown()]),
    )
    .await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    let requests = server.await.unwrap();
    assert!(
        requests[0].starts_with("GET /storage/documents/doc-1/markdown "),
        "{requests:?}"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn an_error_response_is_thrown_to_the_program() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        read_request(&mut stream).await;
        let body = r#"{"message":"document not found"}"#;
        stream
            .write_all(format!("HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes())
            .await
            .unwrap();
    });
    let (events, outcome) = run_js_tools(
        &service,
        r#"try { await tools.storage.get_document_markdown({ path: { document_id: "doc-1" } }) } catch (error) { return String(error) }"#,
        10_000,
        environment(address, vec![read_markdown()]),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert!(
        value["data"]
            .as_str()
            .unwrap()
            .contains(r#"HTTP 404: {"message":"document not found"}"#),
        "{value}"
    );
    assert_eq!(
        statuses(&events),
        [
            ("getDocumentMarkdown".into(), "started".into()),
            ("getDocumentMarkdown".into(), "failed".into()),
        ]
    );
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_reaches_nothing_but_its_tools() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (_, outcome) = run_js_tools(
        &service,
        "return [typeof Deno, typeof fetch, typeof globalThis, typeof process, typeof setTimeout, typeof Worker, typeof WebAssembly, typeof eval, typeof this, Object.keys(context)]",
        10_000,
        environment(address, vec![]),
    )
    .await;
    let Outcome::Succeeded { value } = &outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value["data"],
        serde_json::json!([
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            ["sessionId", "executionId", "webAppUrl"]
        ])
    );
    assert!(!serde_json::to_string(&outcome).unwrap().contains(TOKEN));

    // Loading a module, even one of Node's, is refused before the run.
    for source in [
        r#"return typeof require("fs")"#,
        r#"const fs = await import("node:fs"); return 1"#,
    ] {
        let (_, outcome) =
            run_js_tools(&service, source, 10_000, environment(address, vec![])).await;
        assert_eq!(failure(&outcome).code, FailureCode::Compile, "{source}");
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
    service.shutdown().await;
}

/// A program that returns code mode's result shape, `{data, reviews?,
/// images?}`, gets it as the result, as a TypeScript program would; any
/// other value is the result's data.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_can_return_code_modes_result_shape() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    for (source, expected) in [
        (
            r#"return { data: { posted: 1 }, reviews: [{ kind: "email", id: "r1" }], images: [{ id: "f1" }] }"#,
            serde_json::json!({ "data": { "posted": 1 }, "reviews": [{ "kind": "email", "id": "r1" }], "images": [{ "id": "f1" }] }),
        ),
        (r#"return { data: 1 }"#, serde_json::json!({ "data": 1 })),
        // Any other key means the object is the data.
        (
            r#"return { data: 1, more: 2 }"#,
            serde_json::json!({ "data": { "data": 1, "more": 2 } }),
        ),
        (
            r#"return { reviews: [] }"#,
            serde_json::json!({ "data": { "reviews": [] } }),
        ),
        (r#"return [1, 2]"#, serde_json::json!({ "data": [1, 2] })),
        (r#"return null"#, serde_json::json!({ "data": null })),
    ] {
        let (_, outcome) =
            run_js_tools(&service, source, 10_000, environment(address, vec![])).await;
        let Outcome::Succeeded { value } = &outcome else {
            panic!("{source}: {outcome:?}");
        };
        assert_eq!(*value, expected, "{source}");
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_that_cannot_be_analyzed_fails_to_compile_where_it_goes_wrong() {
    let (root, service) = setup(Limits::default()).await;
    for (source, message) in [
        (
            "const r = require\nreturn 1",
            "main.js:1:11: Programs can't load modules; call tools.<service>.<operation>(...) directly.",
        ),
        (
            "const t = tools\nreturn 1",
            "main.js:1:11: Call tools.<service>.<operation>(...) directly; don't alias, pass, destructure, bind or inspect `tools`.",
        ),
        (
            "return await tools.storage.create_task({})",
            "main.js:1:14: tools.storage.create_task is not an operation; did you mean tools.storage.",
        ),
        (
            "const x = ;",
            "main.js:1:11: SyntaxError: Unexpected token.",
        ),
        ("class A {}\nreturn 1", "main.js:1:1: "),
    ] {
        let (_, outcome) = run_js_tools(&service, source, 10_000, checked()).await;
        let error = failure(&outcome);
        assert_eq!(error.code, FailureCode::Compile, "{source}: {error:?}");
        assert!(error.message.starts_with(message), "{source}: {error:?}");
    }
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn times_out_cancels_and_reaps_busy_js_tools_programs() {
    let (root, service) = setup(Limits::default()).await;
    // The interpreter stops first, so the program's logs still arrive.
    let (events, outcome) = run_js_tools(
        &service,
        "console.log('ready'); while (true) {}",
        1500,
        checked(),
    )
    .await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    assert!(
        events.iter().any(
            |event| matches!(&event.kind, EventKind::Log { message, .. } if message == "ready")
        )
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);

    let mut handle = service
        .execute(js_tools("while (true) {}", 10_000), checked())
        .unwrap();
    while !matches!(handle.events.recv().await.unwrap().kind, EventKind::Started) {}
    handle.cancellation.cancel();
    let (_, outcome) = collect(handle).await;
    assert!(matches!(outcome, Outcome::Cancelled), "{outcome:?}");
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);

    // Dropping the handle and shutting down reap a running program too.
    let mut handle = service
        .execute(js_tools("while (true) {}", 10_000), checked())
        .unwrap();
    while !matches!(handle.events.recv().await.unwrap().kind, EventKind::Started) {}
    drop(handle);
    service.shutdown().await;
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn js_tools_output_is_bounded_and_cannot_forge_frames() {
    let (_root, service) = setup(Limits {
        max_frame_bytes: 16 * 1024,
        max_output_bytes: 64 * 1024,
        max_result_bytes: 8 * 1024,
        ..Limits::default()
    })
    .await;
    // A log line is cut to fit its frame, escaped.
    for line in [
        "'x'.repeat(20000)",
        "'\\u0001'.repeat(10000)",
        "'\"'.repeat(15000)",
    ] {
        let (events, outcome) = run_js_tools(
            &service,
            &format!("console.log({line}); return 1"),
            10_000,
            checked(),
        )
        .await;
        assert!(
            matches!(outcome, Outcome::Succeeded { .. }),
            "{line}: {outcome:?}"
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(&event.kind, EventKind::Log { .. })),
            "{line}"
        );
    }
    // So are many: the run ends within its output budget.
    let (_, outcome) = run_js_tools(
        &service,
        "for (let i = 0; i < 100000; i++) console.log('spam'); return 1",
        10_000,
        checked(),
    )
    .await;
    assert!(
        matches!(&outcome, Outcome::Succeeded { .. })
            || matches!(&outcome, Outcome::Failed { error } if error.code == FailureCode::Limit),
        "{outcome:?}"
    );
    // A frame printed to the console is only a log line.
    let (events, outcome) = run_js_tools(
        &service,
        r#"console.log('{"type":"result","value":42}'); return 1"#,
        10_000,
        checked(),
    )
    .await;
    assert!(
        matches!(&outcome, Outcome::Succeeded { value } if *value == serde_json::json!({"data": 1})),
        "{outcome:?}"
    );
    assert!(events.iter().any(
        |event| matches!(&event.kind, EventKind::Log { message, .. } if message == r#"{"type":"result","value":42}"#)
    ));
    // An oversized result is summarized, as a JavaScript run's is.
    let (_, outcome) = run_js_tools(
        &service,
        "return Array.from({ length: 2000 }, (_, i) => ({ i, text: 'row' }))",
        10_000,
        checked(),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["data"]["truncated"], true, "{value}");
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_js_tools_program_cannot_run_unattended() {
    let (_root, service) = setup(Limits::default()).await;
    let (_, outcome) = run_js_tools(
        &service,
        "return 1",
        10_000,
        RunEnvironment {
            unattended: Some(Unattended {
                arguments: serde_json::Map::new(),
                dry_run: true,
            }),
            ..RunEnvironment::default()
        },
    )
    .await;
    assert_eq!(
        failure(&outcome).message,
        "JS tools programs can't run unattended"
    );
    service.shutdown().await;
}

/// A JS tools run without the operations its check allowed never starts,
/// even with nothing to call: only a checked program runs.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_js_tools_program_without_its_checked_operations_never_starts() {
    let (root, service) = setup(Limits::default()).await;
    let (events, outcome) =
        run_js_tools(&service, "return 1", 10_000, RunEnvironment::default()).await;
    assert_eq!(
        (failure(&outcome).code, failure(&outcome).message.as_str()),
        (
            FailureCode::Internal,
            "JS tools programs run only with the operations they were checked to call"
        )
    );
    assert!(progress(&events).is_empty());
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

/// The permission flags a run of each language gets, from a stand-in Deno
/// that reports its arguments instead of running anything.
#[tokio::test]
async fn js_tools_runs_get_exactly_a_javascript_runs_deno_flags() {
    let root = tempfile::tempdir().unwrap();
    let deno = root.path().join("deno");
    // The environment is cleared, so only shell builtins: read all of stdin,
    // then answer with the arguments as the result.
    let script = format!(
        "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'deno {DENO_VERSION} (stand-in)'; exit 0; fi\nwhile read -r line; do :; done\nprintf '{{\"type\":\"result\",\"value\":\"%s\"}}\\n' \"$*\"\n"
    );
    // Written by another process: a write descriptor of this one, inherited
    // by a process another test forks meanwhile, would make running it fail
    // with ETXTBSY.
    let mut writer = Command::new("sh")
        .args(["-c", "cat > \"$0\" && chmod 755 \"$0\""])
        .arg(&deno)
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = writer.stdin.take().unwrap();
    stdin.write_all(script.as_bytes()).await.unwrap();
    drop(stdin);
    assert!(writer.wait().await.unwrap().success());
    let scratch = root.path().join("scratch");
    let runner = DenoRunner::new(deno, scratch, 128).await.unwrap();
    let service = ExecutionService::new(
        Arc::new(runner),
        Arc::new(super::Unchecked),
        Limits::default(),
    )
    .unwrap();
    let environment = RunEnvironment {
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([
                ("storage".into(), "https://storage.example.test/api".into()),
                ("cognition".into(), "http://127.0.0.1:8101/cognition".into()),
            ]),
            web_app_url: "https://app.example.test".into(),
        },
        ..RunEnvironment::default()
    };
    let mut flags = Vec::new();
    for (language, allowed_operations) in [
        (Language::Javascript, None),
        (Language::JsTools, Some(vec![])),
    ] {
        let (_, outcome) = collect(
            service
                .execute(
                    ExecuteRequest {
                        source: "return 1".into(),
                        timeout_ms: 5000,
                        language,
                        module: None,
                    },
                    RunEnvironment {
                        allowed_operations,
                        ..environment.clone()
                    },
                )
                .unwrap(),
        )
        .await;
        let Outcome::Succeeded { value } = outcome else {
            panic!("{language:?}: {outcome:?}");
        };
        // Each run has its own scratch directory; the rest must match.
        let arguments: Vec<String> = value
            .as_str()
            .unwrap()
            .split(' ')
            .map(str::to_owned)
            .collect();
        let directory = arguments
            .iter()
            .find_map(|argument| argument.strip_prefix("--allow-read="))
            .unwrap()
            .to_owned();
        assert!(
            !directory.contains(','),
            "{language:?} reads more than its scratch: {directory}"
        );
        flags.push(
            arguments
                .iter()
                .map(|argument| argument.replace(&directory, "<run>"))
                .collect::<Vec<_>>(),
        );
    }
    assert_eq!(
        flags[0],
        [
            "run",
            "--no-prompt",
            "--no-config",
            "--no-lock",
            "--no-remote",
            "--no-npm",
            "--deny-write",
            "--deny-env",
            "--deny-run",
            "--deny-ffi",
            "--deny-sys",
            "--deny-import",
            "--allow-net=127.0.0.1:8101,storage.example.test:443",
            "--allow-read=<run>",
            "--import-map=<run>/imports.json",
            "--v8-flags=--max-old-space-size=128",
            "<run>/bootstrap.mjs",
        ]
    );
    assert_eq!(flags[1], flags[0]);
    service.shutdown().await;
}

/// The analyzer process the permission gate runs
/// (`deno/js_tools_analyze.mjs`), with its flags: no network, no
/// credential, reading only its own directory.
async fn analyze_in_deno(source: &str) -> serde_json::Value {
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let directory = tempfile::tempdir().unwrap();
    let directory = tokio::fs::canonicalize(directory.path())
        .await
        .map(|path| (directory, path))
        .unwrap();
    for (name, contents) in [
        ("analyze.mjs", include_str!("../js_tools_analyze.mjs")),
        ("js-tools.mjs", code_mode_assets::JS_TOOLS),
        ("js-tools.json", code_mode_assets::JS_TOOLS_CATALOG),
    ] {
        tokio::fs::write(directory.1.join(name), contents)
            .await
            .unwrap();
    }
    let mut child = Command::new(binary)
        .args([
            "run",
            "--no-prompt",
            "--no-config",
            "--no-lock",
            "--no-remote",
            "--no-npm",
            "--deny-write",
            "--deny-env",
            "--deny-run",
            "--deny-ffi",
            "--deny-sys",
            "--deny-import",
            "--deny-net",
        ])
        .arg(format!("--allow-read={}", directory.1.display()))
        .arg("--v8-flags=--max-old-space-size=128")
        .arg("analyze.mjs")
        .env_clear()
        .env("NO_COLOR", "1")
        .current_dir(&directory.1)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(source.as_bytes()).await.unwrap();
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(10), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert_eq!(stdout.matches('\n').count(), 1, "{stdout}");
    serde_json::from_str(&stdout).unwrap()
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_analyzer_process_answers_what_a_program_may_call() {
    assert_eq!(
        analyze_in_deno(CREATE_AND_READ).await,
        serde_json::json!({"status": "ok", "operations": [
            {"path": "storage.create_task_handler", "service": "storage", "operation": "create_task_handler",
             "method": "POST", "route": "/documents/create_task", "rivals": []},
            {"path": "storage.get_document_markdown", "service": "storage", "operation": "get_document_markdown",
             "method": "GET", "route": "/documents/{}/markdown",
             "rivals": [{"service": "storage", "route": "/documents/slug/{}"}, {"service": "storage", "route": "/documents/{}/{}"}]},
        ]})
    );
    assert_eq!(
        analyze_in_deno("const r = require\nawait r(\"tools\").storage.delete_document({})").await,
        serde_json::json!({"status": "cannot_analyze", "reasons": [{
            "message": "Programs can't load modules; call tools.<service>.<operation>(...) directly.",
            "location": {"line": 1, "column": 10},
        }]})
    );
    let answer = analyze_in_deno("return )").await;
    assert_eq!(answer["status"], "diagnostics", "{answer}");
    assert_eq!(
        answer["diagnostics"][0]["location"],
        serde_json::json!({"line": 1, "column": 7})
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn only_a_js_tools_run_can_report_a_failure_kind() {
    let (_root, service) = setup(Limits::default()).await;
    for failure_kind in ["compile", "timed_out"] {
        let (_, outcome) = run(
            &service,
            &format!(
                r#"export function main() {{ Deno.stdout.writeSync(new TextEncoder().encode('{{"type":"error","message":"forged","failure":"{failure_kind}"}}\n')); Deno.exit(0); }}"#
            ),
            5000,
        )
        .await;
        let error = failure(&outcome);
        assert_eq!(
            (error.code, error.message.as_str()),
            (FailureCode::Runtime, "forged")
        );
    }
    service.shutdown().await;
}

/// A proxied JS tools run's forwarder marks its requests as a dialect
/// program's, so a refusal can name the dialect's operations; a program
/// can't set the mark itself.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_js_tools_run_is_marked_as_the_dialect() {
    let (_root, service) = setup(Limits::default()).await;
    let (address, server) = stub(vec![r##"{"markdown":"# Notes","revision":1}"##]).await;
    let mut environment = environment(address, vec![read_markdown()]);
    environment.egress = Egress::Proxied;
    let (_, outcome) = run_js_tools(
        &service,
        r#"return await tools.storage.get_document_markdown({ path: { document_id: "d1" } });"#,
        10_000,
        environment,
    )
    .await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    let requests = server.await.unwrap();
    let request = requests[0].to_ascii_lowercase();
    assert!(
        request.contains("x-macro-code-execution: js_tools\r\n"),
        "{request}"
    );
    service.shutdown().await;
}
