use super::*;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::{
    io::AsyncReadExt,
    net::{TcpListener, TcpStream},
};

// Real-runtime tests are opt-in; CI and local validation also run --ignored.
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
        ExecutionService::new(Arc::new(runner), limits).unwrap(),
    )
}

async fn collect(mut handle: ExecutionHandle) -> (Vec<ExecutionEvent>, Outcome) {
    let mut events = Vec::new();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(10), handle.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let EventKind::Finished { outcome } = event.kind {
            return (events, outcome);
        }
        events.push(event);
    }
}

async fn run(
    service: &ExecutionService,
    source: &str,
    timeout_ms: u64,
) -> (Vec<ExecutionEvent>, Outcome) {
    collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms,
                },
                RunEnvironment::default(),
            )
            .unwrap(),
    )
    .await
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    loop {
        let mut buffer = [0; 4096];
        let count = stream.read(&mut buffer).await.unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or_default();
            if bytes.len() >= end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8(bytes).unwrap()
}

async fn respond(stream: &mut TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await.unwrap();
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn real_sdk_nested_calls_are_authenticated_and_concurrent() {
    let (_root, service) = setup(Limits {
        max_output_bytes: 1024,
        max_frame_bytes: 1024,
        ..Limits::default()
    })
    .await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server =
        tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.unwrap();
            let first_request = read_request(&mut first).await;
            // Neither request can finish until both have arrived: proves actual HTTP concurrency.
            let (mut second, _) = listener.accept().await.unwrap();
            let second_request = read_request(&mut second).await;
            for request in [&first_request, &second_request] {
                assert!(request.contains(
                    "traceparent: 00-01234567890123456789012345678901-0123456789012345-01"
                ));
                assert!(request.starts_with("POST /decisions "), "{request}");
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains("authorization: bearer fixture-run-token\r\n")
                );
            }
            respond(&mut second, r#"{"probabilities":{"yes":0.2}}"#).await;
            respond(&mut first, r#"{"probabilities":{"yes":0.8}}"#).await;
        });
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        trace_headers: BTreeMap::from([(
            "traceparent".into(),
            "00-01234567890123456789012345678901-0123456789012345-01".into(),
        )]),
        session_id: Some(uuid::Uuid::from_u128(1)),
        execution_id: Some(uuid::Uuid::from_u128(2)),
        hosts: BTreeMap::from([("cognition".into(), format!("http://{address}"))]),
    };
    let source = r#"
import { Macro } from '@macro-inc/sdk';
import Handlebars from 'handlebars';
export async function main({token, hosts, macro: supplied, session, execution}) {
  if (!(supplied instanceof Macro) || session.id !== "00000000-0000-0000-0000-000000000001" || execution.id !== "00000000-0000-0000-0000-000000000002") throw new Error("Missing SDK handles");
  const macro = new Macro({token, hosts});
  console.log('x'.repeat(650));
  const values = await Promise.all(['one', 'two'].map(input => macro.ai.decide({input, questions: {yes: 'Is this relevant?'}})));
  const document = macro.documents.byId('fixture-document');
  return { data: { text: Handlebars.compile('{{name}}: {{count}}')({name: document.id, count: values.length}), sum: values.reduce((sum, result) => sum + result.probabilities.yes, 0) }, reviews: [] };
}
"#;
    let (events, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 5000,
                },
                environment,
            )
            .unwrap(),
    )
    .await;
    assert!(
        matches!(outcome, Outcome::Succeeded { ref value } if value["data"]["text"] == "fixture-document: 2" && value["data"]["sum"] == 1.0),
        "{outcome:?}"
    );
    let progress: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Progress { value } => Some(value),
            _ => None,
        })
        .collect();
    assert_eq!(progress.len(), 4);
    assert_eq!(
        progress
            .iter()
            .filter(|event| event["status"] == "started")
            .count(),
        2
    );
    assert_eq!(
        progress
            .iter()
            .filter(|event| event["status"] == "completed")
            .count(),
        2
    );
    assert!(
        progress
            .iter()
            .all(|event| event["service"] == "cognition" && event["operation"] == "decisions")
    );
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn javascript_logs_result_and_cleanup() {
    let (root, service) = setup(Limits::default()).await;
    let (events, outcome) = run(&service, "export async function main() { console.log('working'); await Promise.resolve(); return 6 * 7; }", 5000).await;
    assert!(matches!(outcome, Outcome::Succeeded { value } if value == 42));
    assert!(events.iter().any(
        |event| matches!(&event.kind, EventKind::Log { message, .. } if message == "working")
    ));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn requires_javascript_exported_main() {
    let (_root, service) = setup(Limits::default()).await;
    for source in [
        "return 42;",
        "export const main = 42;",
        "export function main() { const n: number = 42; return n; }",
    ] {
        let (_, outcome) = run(&service, source, 5000).await;
        assert!(matches!(outcome, Outcome::Failed { error } if error.code == FailureCode::Runtime));
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn denies_ambient_io_and_external_module_imports() {
    let (_root, service) = setup(Limits::default()).await;
    let outside = tempfile::tempdir().unwrap();
    let module = outside.path().join("outside.mjs");
    let json = outside.path().join("outside.json");
    tokio::fs::write(&json, r#"{"secret":"fixture-only"}"#)
        .await
        .unwrap();
    tokio::fs::write(&module, "export default 42;")
        .await
        .unwrap();
    let bodies = [
        "return Deno.env.get('PATH');".to_owned(),
        "return Deno.readTextFile('/etc/passwd');".into(),
        "await Deno.writeTextFile('/tmp/macro-code-execution-forbidden', 'bad');".into(),
        "return new Deno.Command('/bin/true').output();".into(),
        format!("return await import('{}');", module.display()),
        format!(
            "return await import('{}', {{with: {{type: 'json'}}}});",
            json.display()
        ),
        format!(
            "const path = '{}'; return await import(path);",
            module.display()
        ),
        format!(
            "const worker = new Worker('file://{}', {{type: 'module'}}); await new Promise((resolve, reject) => {{ worker.onmessage = resolve; worker.onerror = reject; }});",
            module.display()
        ),
        "const fs = await import('node:fs'); return fs.readFileSync('/etc/passwd', 'utf8');".into(),
        "return await import('https://example.com/module.js');".into(),
        "return await import('npm:lodash');".into(),
    ];
    for body in bodies {
        let source = format!("export async function main() {{ {body} }}");
        let (_, outcome) = run(&service, &source, 5000).await;
        assert!(
            matches!(outcome, Outcome::Failed { .. }),
            "allowed forbidden source: {source}"
        );
    }
    let source = format!(
        "import value from '{}'; export function main() {{ return value; }}",
        module.display()
    );
    let (_, outcome) = run(&service, &source, 5000).await;
    assert!(
        matches!(outcome, Outcome::Failed { .. }),
        "static import escaped scratch: {outcome:?}"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn denies_unlisted_destinations_including_redirects() {
    let (_root, service) = setup(Limits::default()).await;
    let forbidden = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let forbidden_address = forbidden.local_addr().unwrap();
    let (_, outcome) = run(
        &service,
        &format!(
            "export async function main() {{ return await fetch('http://{forbidden_address}'); }}"
        ),
        5000,
    )
    .await;
    assert!(matches!(outcome, Outcome::Failed { .. }));
    let allowed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let allowed_address = allowed.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = allowed.accept().await.unwrap();
        read_request(&mut stream).await;
        stream.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://{forbidden_address}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    });
    let (_, outcome) = collect(service.execute(ExecuteRequest { source: format!("export async function main() {{ return await fetch('http://{allowed_address}'); }}"), timeout_ms: 5000 }, RunEnvironment { hosts: BTreeMap::from([("cognition".into(), format!("http://{allowed_address}"))]), ..RunEnvironment::default() }).unwrap()).await;
    assert!(
        matches!(outcome, Outcome::Failed { .. }),
        "redirect escaped allowlist: {outcome:?}"
    );
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(50), forbidden.accept())
            .await
            .is_err()
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn times_out_cancels_and_reaps_busy_processes() {
    let (root, service) = setup(Limits::default()).await;
    let (_, outcome) = run(&service, "export function main() { while (true) {} }", 300).await;
    assert!(matches!(outcome, Outcome::TimedOut));
    let mut handle = service
        .execute(
            ExecuteRequest {
                source: "export function main() { console.log('ready'); while(true) {} }".into(),
                timeout_ms: 5000,
            },
            RunEnvironment::default(),
        )
        .unwrap();
    while !matches!(
        handle.events.recv().await.unwrap().kind,
        EventKind::Log { .. }
    ) {}
    handle.cancellation.cancel();
    let (_, outcome) = collect(handle).await;
    assert!(matches!(outcome, Outcome::Cancelled));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn bounds_output_and_rejects_invalid_or_duplicate_frames() {
    let (_root, service) = setup(Limits {
        max_frame_bytes: 16 * 1024,
        ..Limits::default()
    })
    .await;
    for body in [
        "console.log('x'.repeat(20000));",
        "return 'x'.repeat(20000);",
        "Deno.stderr.writeSync(new TextEncoder().encode('x'.repeat(20000)));",
        "while (true) console.log('spam');",
        "Deno.stdout.writeSync(new TextEncoder().encode('not json\\n'));",
        "Deno.stdout.writeSync(new TextEncoder().encode('{\"type\":\"started\"}\\n'));",
        "Deno.stdout.writeSync(new TextEncoder().encode('{\"type\":\"result\",\"value\":1}\\n')); return 2;",
    ] {
        let (_, outcome) = run(
            &service,
            &format!("export function main() {{ {body} }}"),
            5000,
        )
        .await;
        assert!(
            matches!(outcome, Outcome::Failed { ref error } if matches!(error.code, FailureCode::Limit | FailureCode::Protocol)),
            "{body}: {outcome:?}"
        );
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn printed_result_cannot_complete_before_process_exit() {
    let (root, service) = setup(Limits::default()).await;
    let (_, outcome) = run(&service, "export function main() { Deno.stdout.writeSync(new TextEncoder().encode('{\"type\":\"result\",\"value\":42}\\n')); while(true) {} }", 300).await;
    assert!(matches!(outcome, Outcome::TimedOut));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn dropping_receiver_and_shutdown_reap_processes() {
    let (root, service) = setup(Limits::default()).await;
    let mut handle = service
        .execute(
            ExecuteRequest {
                source: "export function main() { console.log('ready'); while(true) {} }".into(),
                timeout_ms: 5000,
            },
            RunEnvironment::default(),
        )
        .unwrap();
    while !matches!(
        handle.events.recv().await.unwrap().kind,
        EventKind::Log { .. }
    ) {}
    drop(handle);
    service.shutdown().await;
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn total_output_budget_applies_across_small_frames() {
    let (_root, service) = setup(Limits {
        max_frame_bytes: 1024,
        max_output_bytes: 4096,
        ..Limits::default()
    })
    .await;
    let (_, outcome) = run(&service, "export async function main() { for(let i = 0; i < 20; i++) { console.log('x'.repeat(500)); await new Promise(resolve => setTimeout(resolve, 1)); } return null; }", 5000).await;
    assert!(
        matches!(outcome, Outcome::Failed { error } if error.code == FailureCode::Limit && error.message == "process output limit exceeded")
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn redacts_run_token_from_results_keys_console_stderr_and_errors() {
    let (_root, service) = setup(Limits::default()).await;
    let token = "fixture-secret-token";
    for source in [
        "export function main({token}) { console.log(token); Deno.stderr.writeSync(new TextEncoder().encode(token + '\\n')); return {[token]: token, embedded: 'Bearer ' + token}; }",
        "export function main({token}) { throw new Error('token ' + token); }",
    ] {
        let (events, outcome) = collect(
            service
                .execute(
                    ExecuteRequest {
                        source: source.into(),
                        timeout_ms: 5000,
                    },
                    RunEnvironment {
                        token: token.into(),
                        ..RunEnvironment::default()
                    },
                )
                .unwrap(),
        )
        .await;
        let serialized = serde_json::to_string(&(events, &outcome)).unwrap();
        assert!(
            !serialized.contains(token),
            "run credential escaped redaction"
        );
        assert!(serialized.contains("[REDACTED]"));
        match outcome {
            Outcome::Succeeded { value } => {
                assert_eq!(value["[REDACTED]"], "[REDACTED]");
                assert_eq!(value["embedded"], "Bearer [REDACTED]");
            }
            Outcome::Failed { error } => assert_eq!(error.message, "Error: token [REDACTED]"),
            unexpected => panic!("unexpected outcome: {unexpected:?}"),
        }
    }
    service.shutdown().await;
}
