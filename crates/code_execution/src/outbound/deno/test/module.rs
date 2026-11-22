//! A JS tools program's module through the real bootstraps and Deno: its own
//! process with no network, SDK or token, read and called only through
//! copied `get` and `call` frames, and gone when the run ends.

use super::*;

const TOKEN: &str = "fixture-run-token";

fn with_module(source: &str, module: &str, timeout_ms: u64) -> ExecuteRequest {
    ExecuteRequest {
        source: source.into(),
        timeout_ms,
        language: Language::JsTools,
        module: Some(module.into()),
    }
}

/// A run checked to call nothing, holding a token and a reachable host, as
/// a real run does.
fn environment(address: std::net::SocketAddr) -> RunEnvironment {
    RunEnvironment {
        token: TOKEN.into(),
        execution_id: Some(uuid::Uuid::from_u128(2)),
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("storage".into(), format!("http://{address}/storage"))]),
            web_app_url: "https://app.example.test".into(),
        },
        allowed_operations: Some(vec![]),
        ..RunEnvironment::default()
    }
}

fn data(outcome: &Outcome) -> &serde_json::Value {
    match outcome {
        Outcome::Succeeded { value } => &value["data"],
        other => panic!("expected a result, got {other:?}"),
    }
}

fn logs(events: &[ExecutionEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Log { message, .. } => Some(message.clone()),
            _ => None,
        })
        .collect()
}

const PROBE: &str = r#"
export async function probe(host: string): Promise<Record<string, string>> {
  const tried: Record<string, string> = {};
  const attempt = async (name: string, act: () => Promise<unknown>) => {
    try {
      tried[name] = `reached: ${String(await act())}`;
    } catch (error) {
      tried[name] = String(error);
    }
  };
  await attempt("fetch", () => fetch(`${host}/documents`));
  await attempt("connect", () => Deno.connect({ hostname: "127.0.0.1", port: 9 }));
  await attempt("sdk", () => import("@macro-inc/sdk"));
  await attempt("env", async () => JSON.stringify(Deno.env.toObject()));
  await attempt("files", async () => [...Deno.readDirSync("..")].map((entry) => entry.name).join(","));
  await attempt("stdin", async () => {
    const reader = Deno.stdin.readable.getReader();
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  });
  return tried;
}
"#;

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_module_reaches_no_network_sdk_files_or_token() {
    let (_root, service) = setup(Limits::default()).await;
    // Something listens where the program's own process may connect; the
    // module may not.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let source = format!(r#"return await call("probe", "http://{address}/storage")"#);
    let (events, outcome) = collect(
        service
            .execute(with_module(&source, PROBE, 10_000), environment(address))
            .unwrap(),
    )
    .await;
    let tried = data(&outcome);
    for (name, refusal) in [
        ("fetch", "NotCapable"),
        ("connect", "NotCapable"),
        ("sdk", "@macro-inc/sdk"),
        ("env", "NotCapable"),
        ("files", "NotCapable"),
    ] {
        let answer = tried[name].as_str().unwrap();
        assert!(
            !answer.starts_with("reached") && answer.contains(refusal),
            "{name}: {answer}"
        );
    }
    // Its stdin carries only its own requests, never the run's context.
    assert!(!tried["stdin"].as_str().unwrap().contains(TOKEN), "{tried}");
    let everything = format!("{events:?} {outcome:?}");
    assert!(!everything.contains(TOKEN), "{everything}");
    assert!(
        tokio::time::timeout(Duration::from_millis(100), listener.accept())
            .await
            .is_err(),
        "the module connected"
    );
}

const MODULE: &str = r#"
import Handlebars from "handlebars";

console.log("module loaded");
export const total: number = 3;
export const pending = Promise.resolve({ ready: true });
export const when = new Date(Date.UTC(2026, 10, 22));
export function add(a: number, b: number): number {
  return a + b;
}
export async function render(data: { name: string }): Promise<string> {
  return Handlebars.compile("Hello {{name}}")(data);
}
export function fails(): never {
  throw new Error("module says no");
}
export function big(): string {
  return "x".repeat(300_000);
}
"#;

const READS: &str = r#"
const total = await get("total");
const pending = await get("pending");
const when = await get("when");
const sum = await call("add", 2, 5);
const greeting = await call("render", { name: "Ada" });
const errors = [];
for (const attempt of [
  () => call("fails"),
  () => get("missing"),
  () => get("add"),
  () => call("total"),
  () => call("big"),
  () => call("add", "y".repeat(300000), 1),
]) {
  try {
    await attempt();
    errors.push("no error");
  } catch (error) {
    errors.push(String(error));
  }
}
return { total, pending, when, sum, greeting, errors };
"#;

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn get_and_call_copy_values_and_reject_with_the_modules_errors() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (events, outcome) = collect(
        service
            .execute(
                with_module(READS, MODULE, 15_000),
                environment(listener.local_addr().unwrap()),
            )
            .unwrap(),
    )
    .await;
    let read = data(&outcome);
    assert_eq!(read["total"], 3, "{read}");
    assert_eq!(read["pending"], serde_json::json!({"ready": true}));
    assert_eq!(read["when"], "2026-11-22T00:00:00.000Z");
    assert_eq!(read["sum"], 7);
    assert_eq!(read["greeting"], "Hello Ada");
    let errors: Vec<&str> = read["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|error| error.as_str().unwrap())
        .collect();
    for (error, expected) in errors.iter().zip([
        "module says no",
        r#"the module exports no "missing""#,
        "add is a function",
        "total is not a function",
        "at most",
        "at most",
    ]) {
        assert!(error.contains(expected), "{error} lacks {expected}");
    }
    assert!(
        logs(&events)
            .iter()
            .any(|log| log == "module: module loaded"),
        "{:?}",
        logs(&events)
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_deadline_stops_the_module_and_nothing_of_it_outlives_the_run() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let module = r#"
export const pid: number = Deno.pid;
export function spin(): void {
  for (;;) {}
}
"#;
    let source = r#"console.log("pid", await get("pid")); await call("spin"); return 1"#;
    let started = tokio::time::Instant::now();
    let (events, outcome) = collect(
        service
            .execute(
                with_module(source, module, 2_000),
                environment(listener.local_addr().unwrap()),
            )
            .unwrap(),
    )
    .await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    let pid = logs(&events)
        .iter()
        .find_map(|log| log.strip_prefix("pid ").map(str::to_owned))
        .unwrap_or_else(|| panic!("{:?}", logs(&events)));
    assert!(
        !std::path::Path::new(&format!("/proc/{pid}")).exists(),
        "the module's process outlived its run"
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_module_that_does_not_load_rejects_every_read() {
    let (_root, service) = setup(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source = r#"try { await get("x") } catch (error) { return String(error) }"#;
    let (_, outcome) = collect(
        service
            .execute(
                with_module(source, "export const x = ;", 10_000),
                environment(listener.local_addr().unwrap()),
            )
            .unwrap(),
    )
    .await;
    let error = data(&outcome).as_str().unwrap();
    assert!(error.contains("the module failed to load"), "{error}");
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn without_a_module_get_and_call_reject() {
    let (_root, service) = setup(Limits::default()).await;
    let source = r#"try { await get("x") } catch (error) { return String(error) }"#;
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: source.into(),
                    timeout_ms: 10_000,
                    language: Language::JsTools,
                    module: None,
                },
                RunEnvironment {
                    allowed_operations: Some(vec![]),
                    ..RunEnvironment::default()
                },
            )
            .unwrap(),
    )
    .await;
    let error = data(&outcome).as_str().unwrap();
    assert!(error.contains("sent no module"), "{error}");
}
