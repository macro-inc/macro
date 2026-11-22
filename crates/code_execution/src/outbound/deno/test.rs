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
        ExecutionService::new(Arc::new(runner), Arc::new(Unchecked), limits).unwrap(),
    )
}

/// Passes every program, so these tests reach the process boundary with
/// code a type checker would refuse.
pub(super) struct Unchecked;

#[async_trait::async_trait]
impl ProgramChecker for Unchecked {
    fn sdk_fingerprint(&self) -> &str {
        "unchecked"
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
        max_result_bytes: 512,
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
                        .contains("x-macro-code-execution: 1\r\n"),
                    "{request}"
                );
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
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("cognition".into(), format!("http://{address}"))]),
            web_app_url: "https://app.example.test".into(),
        },
        unattended: None,
        egress: Egress::Direct,
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
async fn a_program_sends_four_searches_at_once_and_queues_the_rest() {
    const IN_FLIGHT: usize = 4;
    const SEARCHES: usize = 6;
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut held = Vec::new();
        for _ in 0..IN_FLIGHT {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            assert!(request.starts_with("POST /search?"), "{request}");
            held.push(stream);
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(500), listener.accept())
                .await
                .is_err(),
            "a fifth search started while four were unanswered"
        );
        for mut stream in held {
            respond(&mut stream, r#"{"results":[]}"#).await;
        }
        for _ in IN_FLIGHT..SEARCHES {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_request(&mut stream).await;
            respond(&mut stream, r#"{"results":[]}"#).await;
        }
    });
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("search".into(), format!("http://{address}"))]),
            web_app_url: "https://app.example.test".into(),
        },
        ..RunEnvironment::default()
    };
    let source = format!(
        r#"
export async function main({{macro}}) {{
  const pages = await Promise.all(Array.from({{length: {SEARCHES}}}, (_, i) => macro.search.page(`query ${{i}}`)));
  return {{ data: {{ pages: pages.length }}, reviews: [] }};
}}
"#
    );
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source,
                    timeout_ms: 8000,
                },
                environment,
            )
            .unwrap(),
    )
    .await;
    assert!(
        matches!(outcome, Outcome::Succeeded { ref value } if value["data"]["pages"] == SEARCHES),
        "{outcome:?}"
    );
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_presents_a_view_through_its_session() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        let response = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.unwrap();
        request
    });
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        trace_headers: BTreeMap::new(),
        session_id: Some(uuid::Uuid::from_u128(1)),
        execution_id: Some(uuid::Uuid::from_u128(2)),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("agent-harness".into(), format!("http://{address}"))]),
            web_app_url: "https://app.example.test".into(),
        },
        unattended: None,
        egress: Egress::Direct,
    };
    let source = r#"
export async function main({execution}) {
  await execution.views.present({ title: 'Launch notes', widgets: [{ type: 'md', markdown: 'Shipped.' }] });
  return { data: 'presented' };
}
"#;
    let (_, outcome) = collect(
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
        matches!(outcome, Outcome::Succeeded { ref value } if value["data"] == "presented"),
        "{outcome:?}"
    );
    let request = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert!(
        request.starts_with("POST /agent-sessions/00000000-0000-0000-0000-000000000001/views "),
        "{request}"
    );
    let body = request.split("\r\n\r\n").nth(1).unwrap();
    let body: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(body["view"]["title"], "Launch notes");
    assert_eq!(body["executionId"], "00000000-0000-0000-0000-000000000002");
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
async fn links_point_at_the_deployment_web_app() {
    let (_root, service) = setup(Limits::default()).await;
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::new(),
            web_app_url: "https://dev.macro.com".into(),
        },
        ..RunEnvironment::default()
    };
    let source = r#"
import { Macro } from '@macro-inc/sdk';
export async function main({token, hosts, webAppUrl, macro: supplied}) {
  const constructed = new Macro({token, hosts, webAppUrl});
  return {
    supplied: supplied.forms.byId('fixture-form').webUrl(),
    constructed: constructed.documents.byId('fixture-document').webUrl(),
  };
}
"#;
    let (_, outcome) = collect(
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
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "supplied": "https://dev.macro.com/app/form/fixture-form",
            "constructed": "https://dev.macro.com/app/md/fixture-document",
        })
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn requires_an_exported_main() {
    let (_root, service) = setup(Limits::default()).await;
    for source in ["return 42;", "export const main = 42;"] {
        let (_, outcome) = run(&service, source, 5000).await;
        assert!(matches!(outcome, Outcome::Failed { error } if error.code == FailureCode::Runtime));
    }
    // Programs are TypeScript; Deno strips the types.
    let (_, outcome) = run(
        &service,
        "export function main() { const n: number = 42; return n; }",
        5000,
    )
    .await;
    assert!(matches!(outcome, Outcome::Succeeded { value } if value == 42));
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

/// Every way a program could open its own connection to an API, each sending
/// the run's token. Only the final `fetch` may arrive, marked as the program's.
const RAW_REQUESTS: &str = r#"
const load = (specifier) => import(specifier);
export async function main() {
  const host = new URL("HOST");
  const port = Number(host.port);
  const request = `GET /raw HTTP/1.1\r\nHost: ${host.host}\r\nAuthorization: Bearer fixture-run-token\r\n\r\n`;
  const headers = {authorization: "Bearer fixture-run-token"};
  const send = (net) => net.connect(port, host.hostname).end(request);
  const attempts = {
    "Deno.connect": async () => {
      const connection = await Deno.connect({hostname: host.hostname, port});
      await connection.write(new TextEncoder().encode(request));
    },
    "Deno internals": () => Deno[Deno.internal].core,
    // A proxied client sends `http://host/...` to the allowed host and port,
    // which the URL's origin doesn't name.
    "Deno.createHttpClient": () => fetch(`${host.origin}/raw`, {headers, client: Deno.createHttpClient({proxy: {url: host.origin}})}),
    "WebSocket": () => new WebSocket(`ws://${host.host}/raw`),
    "Worker": () => new Worker("data:text/javascript,1", {type: "module"}),
    "node:net": async () => send(await load("node:net")),
    "net": async () => send(await load("net")),
    "node:http": async () => (await load("node:http")).get(`${host.origin}/raw`, {headers}),
    "node:_http_client": async () => new (await load("node:_http_client")).ClientRequest(`${host.origin}/raw`, {headers}).end(),
    "node:_tls_wrap": async () => (await load("node:_tls_wrap")).connect(port, host.hostname),
    "node:child_process": async () => (await load("node:child_process")).spawn("curl", [host.origin]),
    "node:module": async () => send((await load("node:module")).createRequire(import.meta.url)("node:net")),
    "node:process": async () => send((await load("node:process")).getBuiltinModule("node:net")),
    "process.getBuiltinModule": () => send(process.getBuiltinModule("node:net")),
    "process.binding": () => process.binding("tcp_wrap").TCP,
  };
  const results = {};
  for (const [name, attempt] of Object.entries(attempts)) {
    try {
      await attempt();
      results[name] = "sent";
    } catch (error) {
      const message = String(error?.message ?? error);
      results[name] = message.includes("Make requests with fetch") ? "unavailable"
        : message.includes("Promise.race deadline guards") ? "refused as a sleep"
        : error instanceof TypeError ? "removed" : message;
    }
  }
  const response = await fetch(`${host.origin}/marked`, {headers});
  return {results, status: response.status};
}
"#;

/// Accept the program's one request, which must be its marked fetch, and
/// nothing after it.
async fn expect_only_the_marked_fetch(listener: TcpListener) {
    let (mut stream, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let request = read_request(&mut stream).await;
    assert!(request.starts_with("GET /marked "), "{request}");
    assert!(
        request
            .to_ascii_lowercase()
            .contains("x-macro-code-execution: 1\r\n"),
        "{request}"
    );
    respond(&mut stream, "{}").await;
    assert!(
        tokio::time::timeout(Duration::from_millis(500), listener.accept())
            .await
            .is_err()
    );
}

/// What each attempt in [`RAW_REQUESTS`] meets; `worker` differs by mode.
fn every_raw_request_blocked(worker: &str) -> serde_json::Value {
    serde_json::json!({
        "results": {
            "Deno.connect": "removed",
            "Deno internals": "removed",
            "Deno.createHttpClient": "removed",
            "WebSocket": "removed",
            "Worker": worker,
            "node:net": "unavailable",
            "net": "unavailable",
            "node:http": "unavailable",
            "node:_http_client": "unavailable",
            "node:_tls_wrap": "unavailable",
            "node:child_process": "unavailable",
            "node:module": "unavailable",
            "node:process": "unavailable",
            "process.getBuiltinModule": "removed",
            "process.binding": "removed",
        },
        "status": 200,
    })
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_has_no_way_to_the_network_but_fetch() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(expect_only_the_marked_fetch(listener));
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("cognition".into(), host.clone())]),
            ..SdkEndpoints::default()
        },
        ..RunEnvironment::default()
    };
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: RAW_REQUESTS.replace("HOST", &host),
                    timeout_ms: 10_000,
                },
                environment,
            )
            .unwrap(),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value, every_raw_request_blocked("refused as a sleep"));
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn an_unattended_program_has_no_way_to_the_network_but_fetch() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(expect_only_the_marked_fetch(listener));
    let environment = unattended(
        "fixture-run-token",
        &[("cognition", host.clone())],
        serde_json::json!({}),
        false,
    );
    let (_, outcome) =
        run_unattended(&service, &RAW_REQUESTS.replace("HOST", &host), environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value, every_raw_request_blocked("removed"));
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn every_node_builtin_but_the_allowed_ones_is_unavailable() {
    let (_root, service) = setup(Limits::default()).await;
    // The pinned runtime lists no built-in the import map doesn't know.
    let deno = Command::new("deno")
        .args([
            "eval",
            r#"import { builtinModules } from "node:module"; console.log(JSON.stringify(builtinModules));"#,
        ])
        .output()
        .await
        .unwrap();
    assert!(deno.status.success());
    let listed: Vec<String> = serde_json::from_slice(&deno.stdout).unwrap();
    for name in &listed {
        let name = name.strip_prefix("node:").unwrap_or(name);
        assert!(
            NODE_BUILTINS.contains(&name),
            "{name} is missing from NODE_BUILTINS"
        );
    }
    let source = format!(
        r#"
export async function main() {{
  const results = {{}};
  for (const name of {names}) {{
    try {{
      await import("node:" + name);
      results[name] = "loaded";
    }} catch (error) {{
      results[name] = error.message.includes("Make requests with fetch") ? "unavailable"
        : error.message.includes("Promise.race deadline guards") ? "refused as a sleep" : error.message;
    }}
  }}
  return results;
}}
"#,
        names = serde_json::json!(NODE_BUILTINS)
    );
    let (_, outcome) = run(&service, &source, 10_000).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    let expected: serde_json::Map<String, serde_json::Value> = NODE_BUILTINS
        .iter()
        .map(|&name| {
            let result = match name {
                _ if NODE_ALLOWED.contains(&name) => "loaded",
                "timers" | "timers/promises" | "worker_threads" => "refused as a sleep",
                _ => "unavailable",
            };
            (name.to_owned(), result.into())
        })
        .collect();
    assert_eq!(value, serde_json::Value::Object(expected));
    // A static import fails to link before the module can throw; the error
    // still says why.
    let (_, outcome) = run(
        &service,
        r#"import { connect } from "node:net"; export async function main() { return connect; }"#,
        10_000,
    )
    .await;
    let Outcome::Failed { error } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        error.message,
        "Error: node:net is unavailable in ExecuteCode. Make requests with fetch or the macro SDK."
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn timer_deadline_guards_explain_supported_parallel_calls() {
    let (_root, service) = setup(Limits::default()).await;
    for source in [
        "export async function main() { return Promise.race([new Promise(() => {}), new Promise((_, reject) => setTimeout(() => reject(new Error('deadline')), 1000))]); }",
        "export function main() { setInterval(() => {}, 1000); }",
        "export async function main() { await import('node:timers/promises'); }",
    ] {
        let (_, outcome) = run(&service, source, 5000).await;
        let Outcome::Failed { error } = outcome else {
            panic!("{source}: {outcome:?}");
        };
        assert_eq!(error.code, FailureCode::Runtime);
        assert!(
            error
                .message
                .contains("including Promise.race deadline guards"),
            "{}",
            error.message
        );
        assert!(error.message.contains("30 s"), "{}", error.message);
        assert!(
            error.message.contains("Promise.allSettled"),
            "{}",
            error.message
        );
        assert!(
            error.message.contains("return successful results"),
            "{}",
            error.message
        );
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rejects_sleeping_and_points_at_routines() {
    let (_root, service) = setup(Limits::default()).await;
    let sources = [
        "export async function main() { await new Promise(resolve => setTimeout(resolve, 20000)); }",
        "export function main() { setInterval(() => {}, 1000); }",
        "export function main() { setImmediate(() => {}); }",
        "export async function main() { await new Promise(resolve => AbortSignal.timeout(1000).addEventListener('abort', resolve)); }",
        "export function main() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }",
        "export async function main() { await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000).value; }",
        "export function main() { new Worker('data:text/javascript,setTimeout(() => postMessage(1), 1000)', {type: 'module'}); }",
        "export async function main() { const { setTimeout } = await import('node:timers/promises'); await setTimeout(1000); }",
        "import { setTimeout } from 'node:timers'; export async function main() { await new Promise(resolve => setTimeout(resolve, 1000)); }",
        "import { Worker } from 'worker_threads'; export function main() { return Worker; }",
    ];
    for source in sources {
        let (_, outcome) = run(&service, source, 5000).await;
        assert!(
            matches!(&outcome, Outcome::Failed { error } if error.code == FailureCode::Runtime && error.message.contains("create a routine with macro.routines.create")),
            "{source}: {outcome:?}"
        );
    }
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
    let (_, outcome) = collect(service.execute(ExecuteRequest { source: format!("export async function main() {{ return await fetch('http://{allowed_address}'); }}"), timeout_ms: 5000 }, RunEnvironment { endpoints: SdkEndpoints { hosts: BTreeMap::from([("cognition".into(), format!("http://{allowed_address}"))]), ..SdkEndpoints::default() }, ..RunEnvironment::default() }).unwrap()).await;
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
        max_result_bytes: 8 * 1024,
        ..Limits::default()
    })
    .await;
    for body in [
        "console.log('x'.repeat(20000));",
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
async fn result_at_the_limit_fits_its_frame_unsummarized() {
    let (_root, service) = setup(Limits {
        max_frame_bytes: 1024,
        max_output_bytes: 4096,
        max_result_bytes: 1024 - RESULT_FRAME_OVERHEAD,
        ..Limits::default()
    })
    .await;
    // JSON quotes bring the string to exactly max_result_bytes.
    let (_, outcome) = run(
        &service,
        &format!(
            "export function main() {{ return 'x'.repeat({}); }}",
            1024 - RESULT_FRAME_OVERHEAD - 2
        ),
        5000,
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value.as_str().unwrap().len(),
        1024 - RESULT_FRAME_OVERHEAD - 2
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn oversized_result_data_is_summarized_and_reviews_kept() {
    let limits = Limits::default();
    let max_result_bytes = limits.max_result_bytes;
    let (_root, service) = setup(limits).await;
    let (_, outcome) = run(
        &service,
        "export function main(context) { return {data: {keys: Object.keys(context), items: Array.from({length: 2000}, (_, id) => ({id, name: 'x'.repeat(100)}))}, reviews: []}; }",
        5000,
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["reviews"], serde_json::json!([]));
    let data = &value["data"];
    assert_eq!(data["truncated"], true);
    assert_eq!(data["limitBytes"], max_result_bytes);
    assert!(data["bytes"].as_u64().unwrap() > max_result_bytes as u64);
    assert_eq!(
        data["outline"],
        "{keys: Array(9) of string, items: Array(2000) of {id: number, name: string}}"
    );
    assert!(data["preview"].as_str().unwrap().starts_with(
        r#"{"keys":["token","traceHeaders","sessionId","executionId","hosts","webAppUrl","macro","session","execution"],"items":[{"id":0,"#
    ));
    assert!(serde_json::to_vec(&value).unwrap().len() <= max_result_bytes);
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
        max_result_bytes: 512,
        ..Limits::default()
    })
    .await;
    let (_, outcome) = run(&service, "export async function main() { for(let i = 0; i < 20; i++) { console.log('x'.repeat(500)); } return null; }", 5000).await;
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

fn unattended(
    token: &str,
    hosts: &[(&str, String)],
    arguments: serde_json::Value,
    dry_run: bool,
) -> RunEnvironment {
    RunEnvironment {
        token: token.into(),
        endpoints: SdkEndpoints {
            hosts: hosts
                .iter()
                .map(|(name, url)| ((*name).to_owned(), url.clone()))
                .collect(),
            ..SdkEndpoints::default()
        },
        unattended: Some(Unattended {
            arguments: arguments.as_object().unwrap().clone(),
            dry_run,
        }),
        ..RunEnvironment::default()
    }
}

async fn run_unattended(
    service: &ExecutionService,
    source: &str,
    environment: RunEnvironment,
) -> (Vec<serde_json::Value>, Outcome) {
    let (events, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 10_000,
                },
                environment,
            )
            .unwrap(),
    )
    .await;
    let progress = events
        .into_iter()
        .filter_map(|event| match event.kind {
            EventKind::Progress { value } => Some(value),
            _ => None,
        })
        .collect();
    (progress, outcome)
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn an_unattended_result_is_kept_whole_or_fails_over_the_limit() {
    let (_root, service) = setup(Limits::default()).await;
    let fits = "export function main() { return { items: Array.from({ length: 400 }, (_, id) => ({ id, name: 'x'.repeat(100) })) }; }";
    let (_, outcome) = run_unattended(
        &service,
        fits,
        unattended("fixture-run-token", &[], serde_json::json!({}), true),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["items"].as_array().unwrap().len(), 400);

    let (_, outcome) = run_unattended(
        &service,
        "export function main() { return 'x'.repeat(70 * 1024); }",
        unattended("fixture-run-token", &[], serde_json::json!({}), true),
    )
    .await;
    let Outcome::Failed { error } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        error.message,
        "The step's output is 71 KB as JSON; a step's output can be at most 64 KB. Return only what later steps need."
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn unattended_typescript_gets_its_arguments_and_no_credential_or_raw_network() {
    let (_root, service) = setup(Limits::default()).await;
    let source = r#"
type Context = { macro: object; trigger: { subject: string } };
export async function main(context: Context): Promise<object> {
  let net = "loaded";
  try { await import("node:" + "net"); } catch { net = "unavailable"; }
  return {
    keys: Object.keys(context).sort(),
    subject: context.trigger.subject,
    connect: typeof Deno.connect,
    worker: typeof Worker,
    net,
  };
}
"#;
    let environment = unattended(
        "fixture-run-token",
        &[],
        serde_json::json!({"trigger": {"subject": "Invoice 7"}}),
        true,
    );
    let (_, outcome) = run_unattended(&service, source, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "keys": ["macro", "trigger"],
            "subject": "Invoice 7",
            "connect": "undefined",
            "worker": "undefined",
            "net": "unavailable",
        })
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_dry_run_reads_but_sends_no_writes() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        assert!(request.starts_with("POST /decisions "), "{request}");
        respond(&mut stream, r#"{"probabilities":{"yes":0.9}}"#).await;
        // Nothing else reaches the API: the write is skipped and the raw
        // request is stopped in the process.
        assert!(
            tokio::time::timeout(Duration::from_millis(500), listener.accept())
                .await
                .is_err()
        );
    });
    let source = r#"
export async function main({ macro, host }: { macro: any; host: string }) {
  const decision = await macro.ai.decide({ input: "x", questions: { yes: "Yes?" } });
  const archived = await macro._client.email.archiveThread({ path: { id: "thread-1" }, body: { archived: true } });
  const token = macro._client.email.client.getConfig().auth;
  let raw = "sent";
  try {
    await fetch(`${host}/email/labels`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    raw = String(error);
  }
  return { yes: decision.probabilities.yes, archived: archived.data, raw };
}
"#;
    let environment = unattended(
        "fixture-run-token",
        &[("cognition", host.clone()), ("email", host.clone())],
        serde_json::json!({ "host": host }),
        true,
    );
    let (progress, outcome) = run_unattended(&service, source, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["yes"], 0.9);
    assert_eq!(value["archived"], serde_json::json!({}));
    assert!(
        value["raw"]
            .as_str()
            .unwrap()
            .contains("A dry run doesn't send changes."),
        "{value}"
    );
    assert!(progress.iter().any(|event| event["service"] == "email"
        && event["operation"] == "archiveThread"
        && event["status"] == "skipped"));
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_real_run_sends_its_writes() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        assert!(request.starts_with("DELETE "), "{request}");
        respond(&mut stream, "{}").await;
    });
    let source = r#"
export async function main({ macro }: { macro: any }) {
  await macro._client.storage.deleteDocument({ path: { document_id: "document-1" } });
  return { deleted: true };
}
"#;
    let environment = unattended(
        "fixture-run-token",
        &[("storage", host.clone())],
        serde_json::json!({}),
        false,
    );
    let (progress, outcome) = run_unattended(&service, source, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["deleted"], true);
    assert!(
        progress
            .iter()
            .any(|event| event["operation"] == "deleteDocument" && event["status"] == "completed")
    );
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_cpu_limit_stops_a_busy_program() {
    let (_root, service) = setup(Limits {
        max_cpu: Some(Duration::from_secs(1)),
        background: true,
        ..Limits::default()
    })
    .await;
    let (_, outcome) = run(
        &service,
        "export async function main() { for (;;) {} }",
        10_000,
    )
    .await;
    assert!(
        matches!(&outcome, Outcome::Failed { error } if error.code == FailureCode::Limit && error.message.contains("CPU")),
        "{outcome:?}"
    );
    service.shutdown().await;
}

async fn checked_service() -> (tempfile::TempDir, ExecutionService) {
    let root = tempfile::tempdir().unwrap();
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let runner = DenoRunner::new(binary.clone(), root.path().join("runs"), 128)
        .await
        .unwrap();
    let checker = check::DenoChecker::new(binary, root.path().join("checks"), 1, 4, 64 * 1024)
        .await
        .unwrap();
    let service =
        ExecutionService::new(Arc::new(runner), Arc::new(checker), Limits::default()).unwrap();
    (root, service)
}

/// A server answering every request with `body`, counting them.
async fn counting_server(body: &'static str) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let served = Arc::clone(&count);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            read_request(&mut stream).await;
            served.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            respond(&mut stream, body).await;
        }
    });
    (host, count)
}

/// A cognition server that accepts requests and never answers them.
async fn hanging_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let mut open = Vec::new();
        while let Ok((stream, _)) = listener.accept().await {
            open.push(stream);
        }
    });
    host
}

fn session_run(host: &str, hanging: Option<&str>) -> RunEnvironment {
    let mut hosts = BTreeMap::from([("email".into(), host.to_owned())]);
    if let Some(hanging) = hanging {
        hosts.insert("cognition".into(), hanging.to_owned());
    }
    RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts,
            ..SdkEndpoints::default()
        },
        ..RunEnvironment::default()
    }
}

async fn run_in_session(
    service: &ExecutionService,
    source: &str,
    host: &str,
    hanging: Option<&str>,
    timeout_ms: u64,
) -> Outcome {
    collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms,
                },
                session_run(host, hanging),
            )
            .unwrap(),
    )
    .await
    .1
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn sdk_misuse_is_reported_by_line_and_never_runs() {
    let (_root, service) = checked_service().await;
    // Run, it would print; a rejected program has no log events.
    let source = "export async function main({ macro }: CodeContext) {\n  console.log('ran');\n  return await macro.tasks.findSimilarr({ title: 'x', body: 'y' });\n}\n";
    let (events, outcome) = run(&service, source, 20_000).await;
    let Outcome::Failed { error } = outcome else {
        panic!("expected a type error, got {outcome:?}");
    };
    assert_eq!(error.code, FailureCode::Compile);
    assert!(
        error
            .message
            .contains("Property 'findSimilarr' does not exist on type 'TaskNamespace'"),
        "{}",
        error.message
    );
    assert!(error.message.contains("at main.ts:3:"), "{}", error.message);
    assert!(
        events
            .iter()
            .all(|event| !matches!(event.kind, EventKind::Started | EventKind::Log { .. }))
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_catch_and_retry_loop_stops_at_its_budget_naming_the_operation() {
    let (_root, service) = setup(Limits {
        max_calls_per_operation: 3,
        ..Limits::default()
    })
    .await;
    let (host, served) = counting_server(r#"{"thread":{}}"#).await;
    // Retrying forever and swallowing every error must not run to the deadline.
    let source = r#"
export async function main({ macro }) {
  for (;;) {
    try {
      await macro._client.email.getThread({ path: { thread_id: "thread-1" } });
    } catch {}
  }
}
"#;
    let started = std::time::Instant::now();
    let outcome = run_in_session(&service, source, &host, None, 10_000).await;
    let Outcome::Failed { error } = outcome else {
        panic!("{outcome:?}");
    };
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "ran to the deadline"
    );
    assert!(
        error.message.starts_with(
            "Stopped: this program called email.getThread more than 3 times, so it is probably looping. Calls already started"
        ),
        "{}",
        error.message
    );
    assert_eq!(served.load(std::sync::atomic::Ordering::SeqCst), 3);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_call_budget_is_per_operation() {
    let (_root, service) = setup(Limits {
        max_calls_per_operation: 3,
        ..Limits::default()
    })
    .await;
    let (host, served) = counting_server(r#"{"thread":{}}"#).await;
    let source = r#"
export async function main({ macro }) {
  for (let i = 0; i < 3; i++) {
    await macro._client.email.getThread({ path: { thread_id: "thread-1" } });
    await macro._client.email.getThreadCalendarInvitations({ path: { thread_id: "thread-1" } });
  }
  return { data: "done" };
}
"#;
    let outcome = run_in_session(&service, source, &host, None, 10_000).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["data"], "done");
    assert_eq!(served.load(std::sync::atomic::Ordering::SeqCst), 6);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_loop_unfinished_at_the_deadline_is_named_before_it() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, _) = counting_server(r#"{"thread":{}}"#).await;
    // Under the budget, then stuck waiting: only the deadline would end it.
    let source = r#"
export async function main({ macro }) {
  for (let i = 0; i < 60; i++) {
    await macro._client.email.getThread({ path: { thread_id: "thread-1" } });
  }
  await macro.ai.decide({ input: "x", questions: { yes: "Yes?" } });
}
"#;
    let hanging = hanging_server().await;
    let outcome = run_in_session(&service, source, &host, Some(&hanging), 9_000).await;
    let Outcome::Failed { error } = outcome else {
        panic!("{outcome:?}");
    };
    assert!(
        error.message.starts_with(
            "Stopped near the deadline: this program called email.getThread 60 times and did not finish"
        ),
        "{}",
        error.message
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_typed_program_with_handlebars_checks_and_runs() {
    let (_root, service) = checked_service().await;
    let source = r#"import Handlebars from 'handlebars';
export async function main({ macro, webAppUrl }: CodeContext) {
  const render = Handlebars.compile('{{count}} items', { strict: true });
  return { data: { text: render({ count: 2 }), sdk: typeof macro.tasks.findSimilar, webAppUrl } };
}
"#;
    let (_, outcome) = run(&service, source, 20_000).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("expected success, got {outcome:?}");
    };
    assert_eq!(value["data"]["text"], "2 items");
    assert_eq!(value["data"]["sdk"], "function");
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_stuck_without_repeated_calls_still_times_out() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, _) = counting_server(r#"{"thread":{}}"#).await;
    let source = r#"
export async function main({ macro }) {
  await macro._client.email.getThread({ path: { thread_id: "thread-1" } });
  await macro.ai.decide({ input: "x", questions: { yes: "Yes?" } });
}
"#;
    let hanging = hanging_server().await;
    let outcome = run_in_session(&service, source, &host, Some(&hanging), 2_000).await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn skipped_dry_run_writes_count_toward_the_budget() {
    let (_root, service) = setup(Limits {
        max_calls_per_operation: 3,
        ..Limits::default()
    })
    .await;
    let source = r#"
export async function main({ macro }: { macro: any }) {
  for (let i = 0; i < 5; i++) {
    await macro._client.email.archiveThread({ path: { id: "thread-1" }, body: { archived: true } });
  }
  return { archived: true };
}
"#;
    let environment = unattended(
        "fixture-run-token",
        &[("email", "http://127.0.0.1:9".into())],
        serde_json::json!({}),
        true,
    );
    let (progress, outcome) = run_unattended(&service, source, environment).await;
    let Outcome::Failed { error } = outcome else {
        panic!("{outcome:?}");
    };
    assert!(
        error
            .message
            .starts_with("Stopped: this program called email.archiveThread more than 3 times"),
        "{}",
        error.message
    );
    assert_eq!(
        progress
            .iter()
            .filter(|event| event["status"] == "skipped")
            .count(),
        3
    );
    service.shutdown().await;
}

/// Every request to an SDK origin is marked, whatever credential it carries.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_credential_outside_the_authorization_header_is_still_marked() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for path in [
            "GET /query?macro-api-token=fixture-run-token ",
            "GET /cookie ",
        ] {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            assert!(request.starts_with(path), "{request}");
            let lowercase = request.to_ascii_lowercase();
            assert!(!lowercase.contains("authorization:"), "{request}");
            assert!(
                lowercase.contains("x-macro-code-execution: 1\r\n"),
                "{request}"
            );
            respond(&mut stream, "{}").await;
        }
    });
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("cognition".into(), format!("http://{address}"))]),
            web_app_url: "https://app.example.test".into(),
        },
        ..RunEnvironment::default()
    };
    let source = r#"
export async function main({token, hosts}) {
  await fetch(`${hosts.cognition}/query?macro-api-token=${token}`);
  await fetch(`${hosts.cognition}/cookie`, {headers: {cookie: `macro-access-token=${token}`}});
  return {data: null, reviews: []};
}
"#;
    let (_, outcome) = collect(
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
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    server.await.unwrap();
}

/// A proxied run, with its one SDK host at `host`.
fn proxied(host: &str) -> RunEnvironment {
    RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("cognition".into(), host.to_owned())]),
            web_app_url: "https://app.example.test".into(),
        },
        egress: Egress::Proxied,
        ..RunEnvironment::default()
    }
}

/// A proxied run's requests are marked by the host's forwarder, whatever
/// the program does to the realm or its own headers, and reach the host's
/// path with their query.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_run_is_marked_outside_the_realm() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        respond(&mut stream, "{}").await;
        request
    });
    let source = r#"
export async function main({hosts}) {
  Headers.prototype.set = function () {};
  const response = await fetch(`${hosts.cognition}/marked?x=1`, {
    headers: {"x-macro-code-execution": "0", traceparent: "00-forged-forged-01", authorization: "Bearer fixture-run-token"},
  });
  return {status: response.status, cognition: hosts.cognition};
}
"#;
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 10_000,
                },
                proxied(&host),
            )
            .unwrap(),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["status"], 200);
    // The program keeps the real host, which its links need; its request
    // went to the forwarder.
    assert_eq!(value["cognition"], serde_json::json!(host));
    let request = server.await.unwrap().to_ascii_lowercase();
    assert!(request.starts_with("get /marked?x=1 "), "{request}");
    assert!(
        request.contains("x-macro-code-execution: 1\r\n"),
        "{request}"
    );
    assert!(!request.contains("x-macro-code-execution: 0"), "{request}");
    assert!(!request.contains("forged"), "{request}");
    assert!(
        request.contains("authorization: bearer fixture-run-token\r\n"),
        "{request}"
    );
    service.shutdown().await;
}

/// With the forwarder its only address, a proxied run can't reach an SDK
/// host directly.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_run_cannot_reach_the_hosts_directly() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    // The SDK host is named `localhost`, so the program's fetch doesn't send
    // `127.0.0.1` to the forwarder: it tries to connect itself.
    let host = format!("http://localhost:{port}");
    let direct = format!("http://127.0.0.1:{port}");
    let source = format!(
        r#"
export async function main() {{
  try {{
    await fetch("{direct}/direct");
    return "sent";
  }} catch (error) {{
    return String(error);
  }}
}}
"#
    );
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source,
                    timeout_ms: 10_000,
                },
                proxied(&host),
            )
            .unwrap(),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        "TypeError: Fetch a service by its own URL, not the run's forwarder."
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(500), listener.accept())
            .await
            .is_err()
    );
    service.shutdown().await;
}

/// A run's forwarder stops listening when the run ends, and when it is
/// cancelled.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_runs_forwarder_stops_with_the_run() {
    let (_root, service) = setup(Limits::default()).await;
    let host = "http://127.0.0.1:9";
    let finished = r#"export function main({forwarder}) { return forwarder.cognition; }"#;
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: finished.into(),
                    timeout_ms: 10_000,
                },
                proxied(host),
            )
            .unwrap(),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    let forwarder = value
        .as_str()
        .unwrap()
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap()
        .to_owned();
    assert!(TcpStream::connect(&forwarder).await.is_err(), "{forwarder}");

    let waiting = r#"export async function main({forwarder}) { console.log(forwarder.cognition); await new Promise(() => {}); }"#;
    let mut handle = service
        .execute(
            ExecuteRequest {
                source: waiting.into(),
                timeout_ms: 10_000,
            },
            proxied(host),
        )
        .unwrap();
    let forwarder = loop {
        if let EventKind::Log { message, .. } = handle.events.recv().await.unwrap().kind {
            break message
                .trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap()
                .to_owned();
        }
    };
    assert!(TcpStream::connect(&forwarder).await.is_ok(), "{forwarder}");
    handle.cancellation.cancel();
    let (_, outcome) = collect(handle).await;
    assert!(matches!(outcome, Outcome::Cancelled), "{outcome:?}");
    assert!(TcpStream::connect(&forwarder).await.is_err(), "{forwarder}");
    service.shutdown().await;
}

/// A request still in flight when a proxied run ends is dropped with it:
/// the host sees its connection close.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_runs_requests_end_with_the_run() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let (closed, was_closed) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        read_request(&mut stream).await;
        // Never answer; wait for the forwarder to hang up.
        let mut buffer = [0; 64];
        while stream.read(&mut buffer).await.is_ok_and(|count| count > 0) {}
        let _ = closed.send(());
    });
    let source =
        r#"export async function main({hosts}) { await fetch(`${hosts.cognition}/hangs`); }"#;
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 1000,
                },
                proxied(&host),
            )
            .unwrap(),
    )
    .await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    tokio::time::timeout(Duration::from_secs(2), was_closed)
        .await
        .expect("the forwarder kept the host's connection open after the run")
        .unwrap();
    service.shutdown().await;
}

/// `--allow-net` lets `host.` through as `host`, so a trailing dot must not
/// lose the mark either.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_trailing_dot_host_is_still_marked() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        assert!(request.starts_with("GET /dotted "), "{request}");
        assert!(
            request
                .to_ascii_lowercase()
                .contains("x-macro-code-execution: 1\r\n"),
            "{request}"
        );
        respond(&mut stream, "{}").await;
    });
    let environment = RunEnvironment {
        token: "fixture-run-token".into(),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("cognition".into(), format!("http://localhost:{port}"))]),
            web_app_url: "https://app.example.test".into(),
        },
        ..RunEnvironment::default()
    };
    let source = format!(
        r#"
export async function main() {{
  await fetch("http://localhost.:{port}/dotted");
  return {{data: null, reviews: []}};
}}
"#
    );
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source,
                    timeout_ms: 5000,
                },
                environment,
            )
            .unwrap(),
    )
    .await;
    // A fetch refused before connecting fails here rather than hanging below.
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    server.await.unwrap();
}

/// A proxied request's body reaches the host as the program sent it.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_requests_body_reaches_the_host() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        respond(&mut stream, "{}").await;
        request
    });
    let source = r#"
export async function main({hosts}) {
  const response = await fetch(`${hosts.cognition}/decisions`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({input: "x", questions: {yes: "Yes?"}}),
  });
  return response.status;
}
"#;
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 10_000,
                },
                proxied(&host),
            )
            .unwrap(),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value, 200);
    let request = server.await.unwrap();
    assert!(request.starts_with("POST /decisions "), "{request}");
    assert!(
        request.ends_with(r#"{"input":"x","questions":{"yes":"Yes?"}}"#),
        "{request}"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn an_unattended_entity_knob_arrives_as_the_sdk_handle_for_its_item() {
    let (_root, service) = setup(Limits::default()).await;
    // What `routine_program`'s entity knob sends: the item, marked.
    let knobs = serde_json::json!({
        "bugs": { "$entity": { "type": "channel", "id": "c1" } },
        "doc": { "$entity": { "type": "document", "id": "d1" } },
        "folder": { "$entity": { "type": "project", "id": "p1" } },
        "table": { "$entity": { "type": "database", "id": "db1" } },
        "person": { "$entity": { "type": "user", "id": "macro|dana@macro.com" } },
        "task": { "$entity": { "type": "task", "id": "t1" } },
        "thread": { "$entity": { "type": "email_thread", "id": "e1" } },
        "chat": { "$entity": { "type": "chat", "id": "a1" } },
        "company": { "$entity": { "type": "crm_company", "id": "co1" } },
        "contact": { "$entity": { "type": "crm_contact", "id": "ct1" } },
        "initiative": { "$entity": { "type": "initiative", "id": "i1" } },
        "days": 7,
    });
    let source = r#"
export async function main({ macro, knobs }: any) {
  return {
    channel: knobs.bugs.constructor === macro.channels.byId("x").constructor && knobs.bugs.id,
    document: knobs.doc.constructor === macro.documents.byId("x").constructor && knobs.doc.id,
    project: knobs.folder.constructor === macro.projects.byId("x").constructor && knobs.folder.id,
    database: knobs.table.constructor === macro.databases.byId("x").constructor && knobs.table.id,
    user: knobs.person.constructor === macro.users.byId("x").constructor && knobs.person.id,
    task: knobs.task.constructor === macro.tasks.byId("x").constructor && knobs.task.id,
    email_thread: knobs.thread.constructor === macro.email.byId("x").constructor && knobs.thread.id,
    chat: knobs.chat.constructor === macro.chats.byId("x").constructor && knobs.chat.id,
    crm_company: knobs.company.constructor === macro.crm.companyById("x").constructor && knobs.company.id,
    crm_contact: knobs.contact.constructor === macro.crm.contactById("x").constructor && knobs.contact.id,
    initiative: knobs.initiative.constructor === macro.initiatives.byId("x").constructor && knobs.initiative.id,
    days: knobs.days,
  };
}
"#;
    let (_, outcome) = run_unattended(
        &service,
        source,
        unattended(
            "fixture-run-token",
            &[],
            serde_json::json!({ "knobs": knobs }),
            true,
        ),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "channel": "c1", "document": "d1", "project": "p1", "database": "db1",
            "user": "macro|dana@macro.com", "task": "t1", "email_thread": "e1", "chat": "a1",
            "crm_company": "co1", "crm_contact": "ct1", "initiative": "i1", "days": 7,
        })
    );
    service.shutdown().await;
}

/// Each built-in the bootstrap's fetch wrapper reads or once read at call
/// time, rewritten one at a time around a fetch to HOST with METHOD. The
/// program returns what each fetch met. `Function.prototype.call` has its own
/// test: rewriting it stops Deno delivering the worker's answers.
const PATCHED_FETCHES: &str = r#"
const decoy = "http://decoy.invalid/";
const headersSymbol = Object.getOwnPropertySymbols(Request.prototype).find(symbol => symbol.description === "headers");
const realHeaders = Object.getOwnPropertyDescriptor(Request.prototype, "headers").get;
const realHas = Headers.prototype.has;
const realDelete = Headers.prototype.delete;
const patches = [
  ["Set.prototype.has", Set.prototype, "has", {value: () => false}],
  ["Headers.prototype.set", Headers.prototype, "set", {value: function () {}}],
  ["String.prototype.replace", String.prototype, "replace", {value: () => "decoy.invalid"}],
  ["String.prototype.endsWith", String.prototype, "endsWith", {value: () => true}],
  ["String.prototype.startsWith", String.prototype, "startsWith", {value: () => false}],
  ["String.prototype.slice", String.prototype, "slice", {value: () => "decoy.invalid"}],
  ["Request", globalThis, "Request", {value: class extends Request { get url() { return decoy; } }}],
  ["Request.prototype.url", Request.prototype, "url", {get: () => decoy}],
  ["Request.prototype.method", Request.prototype, "method", {get: () => "GET"}],
  ["Request.prototype.headers", Request.prototype, "headers", {get: () => new Headers()}],
  ["Request.prototype.headers, stripping the mark", Request.prototype, "headers", {get() {
    const headers = realHeaders.call(this);
    realDelete.call(headers, "x-macro-code-execution");
    return headers;
  }}],
  ["Request.prototype[Symbol(headers)]", Request.prototype, headersSymbol, {get: () => new Headers(), set() {}}],
  ["Headers.prototype.has", Headers.prototype, "has", {value(name) {
    realDelete.call(this, "x-macro-code-execution");
    return realHas.call(this, name);
  }}],
  ["Headers.prototype.forEach", Headers.prototype, "forEach", {value() {}}],
  ["URL", globalThis, "URL", {value: class { origin = "http://decoy.invalid"; hostname = "decoy.invalid"; pathname = "/"; }}],
  ["URL.prototype.origin", URL.prototype, "origin", {get: () => "http://decoy.invalid"}],
  ["URL.prototype.hostname", URL.prototype, "hostname", {get: () => "decoy.invalid", set() {}}],
  ["URL.prototype.port", URL.prototype, "port", {get: () => "1", set() {}}],
  ["URL.prototype.protocol", URL.prototype, "protocol", {get: () => "decoy:", set() {}}],
  ["URL.prototype.pathname", URL.prototype, "pathname", {get: () => "/decisions", set() {}}],
  ["RegExp.prototype.test", RegExp.prototype, "test", {value: () => true}],
  ["RegExp.prototype.exec", RegExp.prototype, "exec", {value: () => []}],
  ["Array.prototype.some", Array.prototype, "some", {value: () => true}],
  ["Array.prototype[Symbol.iterator]", Array.prototype, Symbol.iterator, {value: function* () {}}],
  ["Map.prototype.get", Map.prototype, "get", {value: () => undefined}],
  ["Map.prototype.set", Map.prototype, "set", {value() { return this; }}],
  ["Object.prototype.cacheMode", Object.prototype, "cacheMode", {get() {
    // Runs with Deno's inner request as `this`, which a direct fetch sends.
    if (Array.isArray(this.headerList)) {
      this.headerList = this.headerList.filter(([name]) => name.toLowerCase() !== "x-macro-code-execution");
    }
    return undefined;
  }, set(value) {
    Object.defineProperty(this, "cacheMode", {value, writable: true, configurable: true, enumerable: true});
  }}],
  ["MessagePort.prototype.postMessage", MessagePort.prototype, "postMessage", {value() {}}],
  ["EventTarget.prototype.addEventListener", EventTarget.prototype, "addEventListener", {value() {}}],
  ["AbortSignal.prototype.aborted", AbortSignal.prototype, "aborted", {get: () => true}],
  ["Object.entries", Object, "entries", {value: () => []}],
  ["Promise.reject", Promise, "reject", {value: () => Promise.resolve(new Response("{}"))}],
  ["Function.prototype.apply", Function.prototype, "apply", {value: () => true}],
  ["Function.prototype.bind", Function.prototype, "bind", {value: () => () => true}],
];
export async function main() {
  const results = {};
  for (const [name, target, key, patch] of patches) {
    const original = Object.getOwnPropertyDescriptor(target, key);
    const writable = "value" in patch ? {writable: true} : {};
    Object.defineProperty(target, key, {configurable: true, ...writable, ...patch});
    let result;
    try {
      const response = await fetch("HOST/patched", {method: "METHOD"});
      result = `sent ${response.status}`;
    } catch (error) {
      result = String(error);
    } finally {
      if (original) Object.defineProperty(target, key, original);
      else delete target[key];
    }
    results[name] = result;
  }
  return results;
}
"#;

/// Requests to an SDK origin stay marked, however the program rewrites the
/// built-ins.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rewritten_built_ins_do_not_unmark_requests() {
    for egress in [Egress::Direct, Egress::Proxied] {
        let (_root, service) = setup(Limits::default()).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let (stop, mut stopped) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            let mut unmarked = Vec::new();
            loop {
                let (mut stream, _) = tokio::select! {
                    accepted = listener.accept() => accepted.unwrap(),
                    _ = &mut stopped => break,
                };
                let request = read_request(&mut stream).await;
                if !request
                    .to_ascii_lowercase()
                    .contains("x-macro-code-execution: 1\r\n")
                {
                    unmarked.push(request);
                }
                respond(&mut stream, "{}").await;
            }
            unmarked
        });
        let environment = RunEnvironment {
            egress,
            token: "fixture-run-token".into(),
            endpoints: SdkEndpoints {
                hosts: BTreeMap::from([("cognition".into(), host.clone())]),
                ..SdkEndpoints::default()
            },
            ..RunEnvironment::default()
        };
        let (_, outcome) = collect(
            service
                .execute(
                    ExecuteRequest {
                        source: PATCHED_FETCHES
                            .replace("HOST", &host)
                            .replace("METHOD", "GET"),
                        timeout_ms: 10_000,
                    },
                    environment,
                )
                .unwrap(),
        )
        .await;
        stop.send(()).unwrap();
        let Outcome::Succeeded { value } = outcome else {
            panic!("{outcome:?}");
        };
        for (name, result) in value.as_object().unwrap() {
            assert_eq!(result, "sent 200", "{name}");
        }
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap(),
            Vec::<String>::new()
        );
        service.shutdown().await;
    }
}

/// A dry run sends no writes, however the program rewrites the built-ins.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rewritten_built_ins_do_not_let_a_dry_run_write() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let (stop, mut stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let mut sent = Vec::new();
        loop {
            let (mut stream, _) = tokio::select! {
                accepted = listener.accept() => accepted.unwrap(),
                _ = &mut stopped => break,
            };
            sent.push(read_request(&mut stream).await);
            respond(&mut stream, "{}").await;
        }
        sent
    });
    let environment = unattended(
        "fixture-run-token",
        &[("cognition", host.clone())],
        serde_json::json!({}),
        true,
    );
    let (_, outcome) = run_unattended(
        &service,
        &PATCHED_FETCHES
            .replace("HOST", &host)
            .replace("METHOD", "POST"),
        environment,
    )
    .await;
    stop.send(()).unwrap();
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    for (name, result) in value.as_object().unwrap() {
        assert!(
            result
                .as_str()
                .unwrap()
                .contains("A dry run doesn't send changes."),
            "{name}: {result}"
        );
    }
    assert_eq!(server.await.unwrap(), Vec::<String>::new());
    service.shutdown().await;
}

/// Serve every request with `answer` until stopped, and return each request
/// as it arrived.
async fn recording_server(
    answer: fn(&str) -> String,
) -> (
    String,
    tokio::sync::oneshot::Sender<()>,
    tokio::task::JoinHandle<Vec<String>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let (stop, mut stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let mut sent = Vec::new();
        loop {
            let (mut stream, _) = tokio::select! {
                accepted = listener.accept() => accepted.unwrap(),
                _ = &mut stopped => break,
            };
            let request = read_request(&mut stream).await;
            stream.write_all(answer(&request).as_bytes()).await.unwrap();
            sent.push(request);
        }
        sent
    });
    (host, stop, server)
}

fn ok_json(_request: &str) -> String {
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into()
}

/// The request line's method and whether the request carries the mark.
fn method_and_mark(request: &str) -> (&str, bool) {
    (
        request.split(' ').next().unwrap(),
        request
            .to_ascii_lowercase()
            .contains("x-macro-code-execution: 1\r\n"),
    )
}

/// A program rewrites what Deno's own fetch reads from the request it sends:
/// a field of its inner request that Deno sets or reads, through
/// `Object.prototype`. Here a GET becomes an unmarked DELETE.
const INNER_REQUEST_REWRITE: &str = r#"
export async function main() {
  let writes = 0;
  Object.defineProperty(Object.prototype, "cacheMode", {configurable: true, get() { return undefined; }, set(value) {
    Object.defineProperty(this, "cacheMode", {value, writable: true, configurable: true, enumerable: true});
    if (++writes === 2) {
      const list = this.headerList;
      for (let index = list.length - 1; index >= 0; index--) {
        if (list[index][0].toLowerCase() === "x-macro-code-execution") list.splice(index, 1);
      }
      this.method = "DELETE";
    }
  }});
  try {
    const response = await fetch("HOST/decisions", {cache: "default", headers: {authorization: "Bearer fixture-run-token"}});
    return `sent ${response.status}`;
  } catch (error) {
    return String(error);
  } finally {
    delete Object.prototype.cacheMode;
  }
}
"#;

/// Deno's fetch can't be made to send a request other than the one the
/// wrapper checked and marked, in a dry run or not.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rewriting_deno_s_inner_request_neither_unmarks_nor_writes() {
    for dry_run in [false, true] {
        let (_root, service) = setup(Limits::default()).await;
        let (host, stop, server) = recording_server(ok_json).await;
        let (_, outcome) = run_unattended(
            &service,
            &INNER_REQUEST_REWRITE.replace("HOST", &host),
            unattended(
                "fixture-run-token",
                &[("cognition", host.clone())],
                serde_json::json!({}),
                dry_run,
            ),
        )
        .await;
        stop.send(()).unwrap();
        assert!(
            matches!(&outcome, Outcome::Succeeded { value } if value == "sent 200"),
            "{outcome:?}"
        );
        let sent = server.await.unwrap();
        assert_eq!(
            sent.iter()
                .map(|request| method_and_mark(request))
                .collect::<Vec<_>>(),
            vec![("GET", true)],
            "dry run {dry_run}"
        );
        service.shutdown().await;
    }
}

/// Rewriting `Function.prototype.call` stops Deno delivering the worker's
/// answers to the program, so its fetches may never settle; what does go out
/// is still marked.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rewriting_call_never_unmarks_a_request() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, stop, server) = recording_server(ok_json).await;
    let source = r#"
export async function main() {
  await fetch("HOST/first");
  const call = Object.getOwnPropertyDescriptor(Function.prototype, "call");
  Object.defineProperty(Function.prototype, "call", {configurable: true, writable: true, value: () => true});
  try {
    return `sent ${(await fetch("HOST/second")).status}`;
  } catch (error) {
    return String(error);
  } finally {
    Object.defineProperty(Function.prototype, "call", call);
  }
}
"#
    .replace("HOST", &host);
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source,
                    timeout_ms: 3_000,
                },
                RunEnvironment {
                    token: "fixture-run-token".into(),
                    endpoints: SdkEndpoints {
                        hosts: BTreeMap::from([("cognition".into(), host.clone())]),
                        ..SdkEndpoints::default()
                    },
                    ..RunEnvironment::default()
                },
            )
            .unwrap(),
    )
    .await;
    stop.send(()).unwrap();
    assert!(
        matches!(&outcome, Outcome::TimedOut | Outcome::Succeeded { .. }),
        "{outcome:?}"
    );
    let sent = server.await.unwrap();
    assert!(!sent.is_empty());
    for request in &sent {
        assert!(method_and_mark(request).1, "{request}");
    }
    service.shutdown().await;
}

fn fidelity_answer(request: &str) -> String {
    let path = request.split(' ').nth(1).unwrap();
    match path {
        "/moved" => "HTTP/1.1 302 Found\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        "/empty" => "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".into(),
        _ => {
            let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
            let body = if body.is_empty() { "final" } else { body };
            format!(
                "HTTP/1.1 201 Created\r\nX-Answer: one\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
        }
    }
}

/// A response the worker fetched reads like Deno's own: status, headers,
/// body, the URL it ended at and whether it was redirected; a request keeps
/// its body and length, and an aborted fetch rejects with the signal's reason.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn fetch_through_the_worker_keeps_requests_and_responses_whole() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, stop, server) = recording_server(fidelity_answer).await;
    let source = r#"
export async function main() {
  const moved = await fetch("HOST/moved");
  const posted = await fetch("HOST/echo", {method: "POST", body: JSON.stringify({a: 1})});
  const empty = await fetch("HOST/empty");
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  const aborted = await fetch("HOST/never", {signal: controller.signal}).then(() => "sent", error => error.message);
  const copy = moved.clone();
  return {
    copy: {url: copy.url, redirected: copy.redirected, type: copy.type},
    moved: {status: moved.status, url: moved.url, redirected: moved.redirected, type: moved.type,
      answer: moved.headers.get("x-answer"), cookies: moved.headers.getSetCookie(), text: await moved.text()},
    posted: {status: posted.status, redirected: posted.redirected, body: await posted.json()},
    empty: {status: empty.status, body: empty.body},
    aborted,
  };
}
"#
    .replace("HOST", &host);
    let (_, outcome) = run_unattended(
        &service,
        &source,
        unattended(
            "fixture-run-token",
            &[("cognition", host.clone())],
            serde_json::json!({}),
            false,
        ),
    )
    .await;
    stop.send(()).unwrap();
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "copy": {"url": format!("{host}/final"), "redirected": true, "type": "basic"},
            "moved": {
                "status": 201, "url": format!("{host}/final"), "redirected": true, "type": "basic",
                "answer": "one", "cookies": ["a=1", "b=2"], "text": "final",
            },
            "posted": {"status": 201, "redirected": false, "body": {"a": 1}},
            "empty": {"status": 204, "body": null},
            "aborted": "stopped",
        })
    );
    let sent = server.await.unwrap();
    let posted = sent
        .iter()
        .find(|request| request.starts_with("POST /echo "))
        .unwrap()
        .to_ascii_lowercase();
    assert!(posted.contains("content-length: 7\r\n"), "{posted}");
    assert!(!sent.iter().any(|request| request.contains("/never")));
    service.shutdown().await;
}

/// Aborting after the answer stops the body with the signal's reason, as
/// Deno's own fetch does, instead of streaming it to the end.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn aborting_after_the_answer_stops_the_body() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        read_request(&mut stream).await;
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        // Chunks until the client goes away; a body that ran to its end
        // would take 50 of them.
        let mut written = 0;
        for _ in 0..50 {
            if stream.write_all(b"1\r\nx\r\n").await.is_err() {
                break;
            }
            written += 1;
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        written
    });
    let source = r#"
export async function main() {
  const controller = new AbortController();
  const response = await fetch("HOST/slow", {signal: controller.signal});
  const reader = response.body.getReader();
  await reader.read();
  controller.abort(new Error("stopped"));
  try {
    while (!(await reader.read()).done);
    return "read to the end";
  } catch (error) {
    return `rejected: ${error.message}`;
  }
}
"#
    .replace("HOST", &host);
    let (_, outcome) = run_unattended(
        &service,
        &source,
        unattended(
            "fixture-run-token",
            &[("cognition", host.clone())],
            serde_json::json!({}),
            false,
        ),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value, "rejected: stopped");
    let written = tokio::time::timeout(Duration::from_secs(10), server)
        .await
        .unwrap()
        .unwrap();
    assert!(written < 50, "{written}");
    service.shutdown().await;
}

/// A program can reach the channel to the sender through an
/// `EventTarget.prototype.dispatchEvent` hook. Malformed messages on it are
/// refused without stopping the sender, and what it sends stays marked.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn malformed_messages_to_the_sender_are_refused() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, stop, server) = recording_server(ok_json).await;
    let source = r#"
export async function main() {
  let port;
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (this instanceof MessagePort) port ??= this;
    return dispatch.call(this, event);
  };
  await fetch("HOST/first");
  EventTarget.prototype.dispatchEvent = dispatch;
  if (!port) return "no port";
  const answers = [];
  port.addEventListener("message", ({data}) => answers.push(data));
  const file = {id: 1002, request: {url: import.meta.url, method: "GET", headers: [], body: null, options: {}}};
  for (const message of [null, 7, {}, {id: "x"}, {id: 1000, request: null}, {abort: 1001}, file]) port.postMessage(message);
  const second = await fetch("HOST/second");
  return {second: second.status, answers: answers.filter(answer => answer.id >= 1000).sort((left, right) => left.id - right.id)};
}
"#
    .replace("HOST", &host);
    let (_, outcome) = run_unattended(
        &service,
        &source,
        unattended(
            "fixture-run-token",
            &[("cognition", host.clone())],
            serde_json::json!({}),
            false,
        ),
    )
    .await;
    stop.send(()).unwrap();
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "second": 200,
            "answers": [
                {"id": 1000, "error": {"name": "TypeError", "message": "A malformed request was refused."}},
                {"id": 1002, "error": {"name": "TypeError", "message": "Only http and https URLs can be fetched."}},
            ],
        })
    );
    let sent = server.await.unwrap();
    assert_eq!(
        sent.iter()
            .map(|request| method_and_mark(request))
            .collect::<Vec<_>>(),
        vec![("GET", true), ("GET", true)]
    );
    service.shutdown().await;
}

/// A program crashes the sender with an abort reason that can't be turned
/// into a string (before the answer, after it, and as a body's cancel),
/// takes the sender from its error event, and starts a worker of its own from
/// the sender's class to send an unmarked DELETE. The reason never reaches
/// the sender and the class is unreachable, so every request that arrives is
/// marked and none is a write.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_hostile_abort_reason_never_hands_the_program_a_worker() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let (stop, mut stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let mut sent = Vec::new();
        loop {
            let (mut stream, _) = tokio::select! {
                accepted = listener.accept() => accepted.unwrap(),
                _ = &mut stopped => break,
            };
            let request = read_request(&mut stream).await;
            sent.push(request.clone());
            // The first request hangs until the program has aborted it.
            tokio::spawn(async move {
                if request.starts_with("GET /hang ") {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                if request.starts_with("GET /drip ") {
                    // A body that is still arriving when the program aborts.
                    let _ = stream
                        .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\nx\r\n")
                        .await;
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    let _ = stream.write_all(b"0\r\n\r\n").await;
                    return;
                }
                let _ = stream.write_all(ok_json("").as_bytes()).await;
            });
        }
        sent
    });
    let source = r#"
// Run again as a worker of the program's own, this module sends a DELETE.
if (typeof WorkerGlobalScope !== "undefined") {
  postMessage((await fetch("HOST/decisions", {method: "DELETE"})).status);
}
export async function main() {
  let sender;
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (event?.type === "error" && !(this instanceof MessagePort) && this !== globalThis) sender ??= this;
    return dispatch.call(this, event);
  };
  const preventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () {
    if (this.target && this.target !== globalThis) sender ??= this.target;
    return preventDefault.call(this);
  };
  const controller = new AbortController();
  const hanging = fetch("HOST/hang", {signal: controller.signal}).catch(() => {});
  await fetch("HOST/first");
  controller.abort({message: {toString: 1}});
  await hanging;
  // The same reason after the answer, as an abort and as the body's cancel.
  for (const stop of ["abort", "cancel"]) {
    const late = new AbortController();
    const dripping = await fetch("HOST/drip", {signal: late.signal});
    const reader = dripping.body.getReader();
    await reader.read();
    if (stop === "abort") late.abort({message: {toString: 1}});
    else await reader.cancel({message: {toString: 1}}).catch(() => {});
    await reader.read().catch(() => {});
  }
  const after = (await fetch("HOST/after")).status;
  const portClass = Object.getPrototypeOf(new MessageChannel().port1).constructor;
  const NativeWorker = sender && Object.getPrototypeOf(sender).constructor;
  if (typeof NativeWorker !== "function") return {sender: Boolean(sender), worker: "no class", after, portClass: typeof portClass};
  const child = new NativeWorker(import.meta.url, {type: "module"});
  const status = await new Promise(resolve => {
    child.onmessage = ({data}) => resolve(data);
    child.onerror = (event) => { event.preventDefault(); resolve(String(event.message)); };
  });
  return {sender: true, worker: status, after};
}
"#
    .replace("HOST", &host);
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source,
                    timeout_ms: 10_000,
                },
                RunEnvironment {
                    token: "fixture-run-token".into(),
                    endpoints: SdkEndpoints {
                        hosts: BTreeMap::from([("cognition".into(), host.clone())]),
                        ..SdkEndpoints::default()
                    },
                    ..RunEnvironment::default()
                },
            )
            .unwrap(),
    )
    .await;
    stop.send(()).unwrap();
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({"sender": false, "worker": "no class", "after": 200, "portClass": "undefined"})
    );
    let sent = server.await.unwrap();
    for request in &sent {
        assert_eq!(method_and_mark(request), ("GET", true), "{request}");
    }
    service.shutdown().await;
}

/// A proxied dry run learns its forwarder's URL from a response and sends a
/// DELETE there, under every spelling of its loopback address: the sender
/// refuses any request that isn't under a service's own URL, and the
/// forwarder itself forwards no dry run's write.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_proxied_dry_run_cannot_write_through_the_forwarder_url() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, stop, server) = recording_server(ok_json).await;
    let source = r#"
export async function main() {
  const read = await fetch("HOST/decisions");
  const forwarder = read.url;
  const {port, pathname} = new URL(forwarder);
  const attempts = {};
  for (const [name, url] of [
    ["forwarder", forwarder],
    ["mapped", `http://[::ffff:127.0.0.1]:${port}${pathname}`],
    ["decimal", `http://2130706433:${port}${pathname}`],
    ["hex", `http://0x7f.0.0.1:${port}${pathname}`],
    ["short", `http://127.1:${port}${pathname}`],
    ["localhost", `http://localhost.:${port}${pathname}`],
    ["host", "HOST/decisions"],
  ]) {
    try {
      attempts[name] = `sent ${(await fetch(url, {method: "DELETE"})).status}`;
    } catch (error) {
      attempts[name] = String(error);
    }
  }
  return {viaForwarder: forwarder !== "HOST/decisions", attempts};
}
"#
    .replace("HOST", &host);
    let mut environment = unattended(
        "fixture-run-token",
        &[("cognition", host.clone())],
        serde_json::json!({}),
        true,
    );
    environment.egress = Egress::Proxied;
    let (_, outcome) = run_unattended(&service, &source, environment).await;
    stop.send(()).unwrap();
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "viaForwarder": true,
            "attempts": {
                "forwarder": "TypeError: Fetch a service by its own URL, not the run's forwarder.",
                "mapped": "TypeError: Fetch a service by its own URL, not the run's forwarder.",
                "decimal": "TypeError: Fetch a service by its own URL, not the run's forwarder.",
                "hex": "TypeError: Fetch a service by its own URL, not the run's forwarder.",
                "short": "TypeError: Fetch a service by its own URL, not the run's forwarder.",
                "localhost": "TypeError: Fetch a service by its own URL, not the run's forwarder.",
                "host": "Error: A dry run doesn't send changes.",
            },
        })
    );
    let sent = server.await.unwrap();
    assert_eq!(
        sent.iter()
            .map(|request| method_and_mark(request))
            .collect::<Vec<_>>(),
        vec![("GET", true)]
    );
    service.shutdown().await;
}

/// An abort while the request's body is read stops the request before it is
/// sent, as it would with Deno's own fetch.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn an_abort_while_the_body_is_read_sends_nothing() {
    let (_root, service) = setup(Limits::default()).await;
    let (host, stop, server) = recording_server(ok_json).await;
    let source = r#"
export async function main() {
  const controller = new AbortController();
  const body = new ReadableStream({
    pull(stream) {
      controller.abort(new Error("stopped while reading"));
      stream.enqueue(new TextEncoder().encode("{}"));
      stream.close();
    },
  });
  try {
    await fetch("HOST/during", {method: "POST", body, duplex: "half", signal: controller.signal});
    return "sent";
  } catch (error) {
    return error.message;
  }
}
"#
    .replace("HOST", &host);
    let (_, outcome) = run_unattended(
        &service,
        &source,
        unattended(
            "fixture-run-token",
            &[("cognition", host.clone())],
            serde_json::json!({}),
            false,
        ),
    )
    .await;
    stop.send(()).unwrap();
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value, "stopped while reading");
    assert_eq!(server.await.unwrap(), Vec::<String>::new());
    service.shutdown().await;
}

/// A dry run's write is refused whatever scheme names the allowed host and
/// port, before anything connects.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_dry_run_refuses_a_write_under_another_scheme() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let source = format!(
        r#"
export async function main() {{
  try {{
    await fetch("https://{address}/email/labels", {{method: "POST"}});
    return "sent";
  }} catch (error) {{
    return String(error);
  }}
}}
"#
    );
    let environment = unattended(
        "fixture-run-token",
        &[("email", format!("http://{address}"))],
        serde_json::json!({}),
        true,
    );
    let (_, outcome) = run_unattended(&service, &source, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert!(
        value
            .as_str()
            .unwrap()
            .contains("A dry run doesn't send changes."),
        "{value}"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(500), listener.accept())
            .await
            .is_err()
    );
    service.shutdown().await;
}

/// A read a dry run sends can't be redirected into a write.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_dry_run_read_is_not_redirected_into_a_write() {
    for egress in [Egress::Direct, Egress::Proxied] {
        let (_root, service) = setup(Limits::default()).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let location = format!("{host}/email/labels");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            assert!(request.starts_with("POST /decisions "), "{request}");
            let response = format!(
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            assert!(
                tokio::time::timeout(Duration::from_millis(500), listener.accept())
                    .await
                    .is_err()
            );
        });
        let source = r#"
export async function main({ host }: { host: string }) {
  try {
    const response = await fetch(`${host}/decisions`, { method: "POST", body: "{}" });
    return `sent ${response.status}`;
  } catch (error) {
    return String(error);
  }
}
"#;
        let mut environment = unattended(
            "fixture-run-token",
            &[("cognition", host.clone()), ("email", host.clone())],
            serde_json::json!({ "host": host }),
            true,
        );
        environment.egress = egress;
        let (_, outcome) = run_unattended(&service, source, environment).await;
        let Outcome::Succeeded { value } = outcome else {
            panic!("{outcome:?}");
        };
        assert!(value.as_str().unwrap().starts_with("TypeError"), "{value}");
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        service.shutdown().await;
    }
}

/// A write whose path ends like a read's (`/web/search` and `/search`) is
/// still a write to a dry run.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_dry_run_does_not_send_a_write_that_ends_like_a_read() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let source = r#"
export async function main({ host }: { host: string }) {
  const results: Record<string, string> = {};
  for (const path of ["/web/search", "/channel-sections/preview"]) {
    try {
      const response = await fetch(`${host}${path}`, { method: "POST", body: "{}" });
      results[path] = `sent ${response.status}`;
    } catch (error) {
      results[path] = String(error);
    }
  }
  return results;
}
"#;
    let environment = unattended(
        "fixture-run-token",
        &[
            ("cognition", host.clone()),
            ("search", host.clone()),
            ("storage", host.clone()),
        ],
        serde_json::json!({ "host": host }),
        true,
    );
    let (_, outcome) = run_unattended(&service, source, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    for (path, result) in value.as_object().unwrap() {
        assert!(
            result
                .as_str()
                .unwrap()
                .contains("A dry run doesn't send changes."),
            "{path}: {result}"
        );
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(500), listener.accept())
            .await
            .is_err()
    );
    service.shutdown().await;
}

/// A dry run's read is resent with options the program can't reach through
/// `Object.prototype`: it keeps its method and its mark.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_dry_run_read_keeps_its_method_and_mark_past_object_prototype() {
    for egress in [Egress::Direct, Egress::Proxied] {
        let (_root, service) = setup(Limits::default()).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            respond(&mut stream, "{}").await;
            request
        });
        let source = r#"
export async function main({ host }: { host: string }) {
  for (const [key, value] of [["method", "DELETE"], ["headers", { authorization: "Bearer x" }]]) {
    Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
  }
  try {
    const response = await fetch(`${host}/decisions`, { method: "POST", body: "{}" });
    return `sent ${response.status}`;
  } catch (error) {
    return String(error);
  } finally {
    delete (Object.prototype as Record<string, unknown>).method;
    delete (Object.prototype as Record<string, unknown>).headers;
  }
}
"#;
        let mut environment = unattended(
            "fixture-run-token",
            &[("cognition", host.clone())],
            serde_json::json!({ "host": host }),
            true,
        );
        environment.egress = egress;
        let (_, outcome) = run_unattended(&service, source, environment).await;
        let request = tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        assert!(request.starts_with("POST /decisions "), "{request}");
        assert!(
            request
                .to_ascii_lowercase()
                .contains("x-macro-code-execution: 1\r\n"),
            "{request}"
        );
        assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
        service.shutdown().await;
    }
}
