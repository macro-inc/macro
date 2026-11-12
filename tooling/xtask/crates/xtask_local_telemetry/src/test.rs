use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use flate2::read::GzDecoder;
use serde_json::{Value, json};
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::config::Provision;
use super::{Event, Paths, Recorder, Switch, take_hint};

const TOKEN: &str = "test-token-0123456789abcdef0123456789";
const CHILD_DIR: &str = "LOCAL_TELEMETRY_TEST_CHILD_DIR";

struct Endpoint {
    runtime: tokio::runtime::Runtime,
    server: MockServer,
}

impl Endpoint {
    fn start(response: ResponseTemplate) -> Self {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let server = runtime.block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(response)
                .mount(&server)
                .await;
            server
        });
        Self { runtime, server }
    }

    fn requests(&self, route: &str) -> Vec<wiremock::Request> {
        self.runtime
            .block_on(self.server.received_requests())
            .unwrap_or_default()
            .into_iter()
            .filter(|request| request.url.path() == route)
            .collect()
    }

    /// The log records of every logs request, in order.
    fn log_records(&self) -> Vec<Value> {
        self.requests("/v1/logs")
            .iter()
            .flat_map(|request| {
                let body = gunzip(&request.body);
                body["resourceLogs"][0]["scopeLogs"][0]["logRecords"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            })
            .collect()
    }
}

fn gunzip(bytes: &[u8]) -> Value {
    let mut text = String::new();
    GzDecoder::new(bytes)
        .read_to_string(&mut text)
        .expect("a gzip body");
    serde_json::from_str(&text).expect("a JSON body")
}

fn opt_in(dir: &Path, endpoint: &str) -> Paths {
    let config = dir.join("local-telemetry.toml");
    std::fs::write(
        &config,
        format!("endpoint = \"{endpoint}\"\ntoken = \"{TOKEN}\"\n"),
    )
    .expect("write config");
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o600)).expect("chmod");
    Paths::at(config, dir.join("buffer"))
}

fn common() -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("kind".to_owned(), json!("up")),
        ("mode".to_owned(), json!("local")),
    ])
}

/// The attributes of an OTLP record as a plain map of their values.
fn fields(record: &Value) -> BTreeMap<String, Value> {
    record["attributes"]
        .as_array()
        .expect("attributes")
        .iter()
        .map(|attribute| {
            let value = attribute["value"]
                .as_object()
                .and_then(|value| value.values().next().cloned())
                .unwrap_or(Value::Null);
            (
                attribute["key"].as_str().unwrap_or_default().to_owned(),
                value,
            )
        })
        .collect()
}

fn buffered_files(paths: &Paths) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(&paths.buffer_dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn no_settings_and_no_provisioning_writes_and_sends_nothing() {
    let endpoint = Endpoint::start(ResponseTemplate::new(204));
    let dir = tempfile::tempdir().expect("tempdir");
    // A fully working settings file, just not at the path that is read.
    let opted_in = opt_in(dir.path(), &endpoint.server.uri());
    let paths = Paths::at(dir.path().join("absent.toml"), opted_in.buffer_dir.clone());

    let built_fields = std::cell::Cell::new(false);
    let recorder = Recorder::start(&paths, SystemTime::now(), || {
        built_fields.set(true);
        common()
    })
    .expect("start");

    assert!(recorder.is_none());
    // Building the fields runs git; an opted-out run must not pay for it.
    assert!(!built_fields.get());
    assert!(!paths.buffer_dir.exists());
    assert!(endpoint.requests("/v1/logs").is_empty());
    assert!(endpoint.requests("/v1/traces").is_empty());
}

#[test]
fn a_run_sends_its_steps_and_run_event_as_otlp() {
    let endpoint = Endpoint::start(ResponseTemplate::new(204));
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opt_in(dir.path(), &endpoint.server.uri());
    let started = SystemTime::now();

    let recorder = Recorder::start(&paths, started, common)
        .expect("start")
        .expect("on");
    let run_id = recorder.run_id().to_owned();
    recorder.step_started("Running migrations");
    recorder.record(
        Event::new("step")
            .with("step", "Running migrations")
            .with("seconds", 2.5)
            .with("outcome", "success")
            .lasting("Running migrations", Duration::from_millis(2500)),
    );
    recorder.finish(
        BTreeMap::from([
            ("outcome".to_owned(), json!("success")),
            ("ready_seconds".to_owned(), json!(3.25)),
        ]),
        SystemTime::now(),
        Duration::from_secs(20),
    );

    let logs = endpoint.requests("/v1/logs");
    assert_eq!(logs.len(), 1);
    let headers = &logs[0].headers;
    assert_eq!(
        headers.get("authorization").and_then(|v| v.to_str().ok()),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(
        headers
            .get("content-encoding")
            .and_then(|v| v.to_str().ok()),
        Some("gzip")
    );
    let body = gunzip(&logs[0].body);
    assert_eq!(
        body["resourceLogs"][0]["resource"]["attributes"],
        json!([
            { "key": "service.name", "value": { "stringValue": "local-telemetry" } },
            { "key": "deployment.environment", "value": { "stringValue": "local" } },
        ])
    );

    let records = endpoint.log_records();
    assert_eq!(records.len(), 2);
    assert_eq!(
        records[0]["body"]["stringValue"],
        json!(format!("step {run_id} 1"))
    );
    assert_eq!(
        fields(&records[0]),
        BTreeMap::from([
            ("event".to_owned(), json!("step")),
            ("kind".to_owned(), json!("up")),
            ("mode".to_owned(), json!("local")),
            ("outcome".to_owned(), json!("success")),
            ("run_id".to_owned(), json!(run_id)),
            ("seconds".to_owned(), json!(2.5)),
            ("step".to_owned(), json!("Running migrations")),
        ])
    );
    let run = fields(&records[1]);
    assert_eq!(run["event"], json!("run"));
    assert_eq!(run["outcome"], json!("success"));
    assert_eq!(run["ready_seconds"], json!(3.25));
    assert_eq!(records[0]["traceId"], records[1]["traceId"]);

    let traces = endpoint.requests("/v1/traces");
    assert_eq!(traces.len(), 1);
    let spans = gunzip(&traces[0].body)["resourceSpans"][0]["scopeSpans"][0]["spans"].clone();
    assert_eq!(spans[0]["name"], json!("Running migrations"));
    assert_eq!(spans[0]["parentSpanId"], spans[1]["spanId"]);
    assert_eq!(spans[1].get("parentSpanId"), None);
    // Delivered, so nothing is left to send again.
    assert!(buffered_files(&paths).is_empty());
}

/// Run by [`a_killed_run_is_sent_by_the_next_one`] in a child process, which it
/// then kills; skipped in a normal test run.
#[test]
#[ignore = "child process of a_killed_run_is_sent_by_the_next_one"]
fn killed_child() {
    let Some(dir) = std::env::var_os(CHILD_DIR) else {
        return;
    };
    let config = Path::new(&dir).join("local-telemetry.toml");
    let paths = Paths::at(config, Path::new(&dir).join("buffer"));
    let recorder = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on");
    recorder.step_started("Starting infra (docker compose up -d --wait)");
    recorder.record(
        Event::new("step")
            .with("step", "Starting infra (docker compose up -d --wait)")
            .with("seconds", 41.0)
            .with("outcome", "success"),
    );
    recorder.step_started("Building service binaries");
    println!("RECORDED");
    // Block until killed: the parent reads the line above, then SIGKILLs us.
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
    std::process::exit(0);
}

#[test]
fn a_killed_run_is_sent_by_the_next_one() {
    let endpoint = Endpoint::start(ResponseTemplate::new(204));
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opt_in(dir.path(), &endpoint.server.uri());

    let mut child = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--exact", "test::killed_child", "--ignored", "--nocapture"])
        .env(CHILD_DIR, dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn child");
    let stdout = child.stdout.take().expect("child stdout");
    let recorded = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        .any(|line| line.contains("RECORDED"));
    assert!(recorded, "the child never recorded its events");
    child.kill().expect("kill child");
    child.wait().expect("reap child");
    assert_eq!(buffered_files(&paths).len(), 1);
    assert!(endpoint.requests("/v1/logs").is_empty());

    let next = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on");
    next.finish(BTreeMap::new(), SystemTime::now(), Duration::from_secs(20));

    let records = endpoint.log_records();
    let killed: Vec<BTreeMap<String, Value>> = records
        .iter()
        .map(fields)
        .filter(|record| {
            record.get("event") == Some(&json!("step"))
                || record.get("outcome") == Some(&json!("interrupted"))
        })
        .collect();
    assert_eq!(killed.len(), 2);
    assert_eq!(
        killed[0]["step"],
        json!("Starting infra (docker compose up -d --wait)")
    );
    assert_eq!(killed[1]["event"], json!("run"));
    assert_eq!(killed[1]["outcome"], json!("interrupted"));
    assert_eq!(killed[1]["failed_step"], json!("Building service binaries"));
    assert!(
        killed[1]["seconds"]
            .as_f64()
            .is_some_and(|seconds| seconds >= 0.0)
    );
    assert_eq!(killed[0]["run_id"], killed[1]["run_id"]);
    assert!(buffered_files(&paths).is_empty());
}

#[test]
fn a_slow_endpoint_never_delays_the_run() {
    let endpoint = Endpoint::start(ResponseTemplate::new(204).set_delay(Duration::from_secs(60)));
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opt_in(dir.path(), &endpoint.server.uri());

    let began = Instant::now();
    let recorder = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on");
    for index in 0..50 {
        recorder.record(Event::new("step").with("step", format!("step {index}")));
    }
    recorder.finish(BTreeMap::new(), SystemTime::now(), Duration::ZERO);
    assert!(
        began.elapsed() < Duration::from_secs(1),
        "recording took {:?}",
        began.elapsed()
    );

    let bounded = Instant::now();
    let second = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on");
    second.finish(
        BTreeMap::new(),
        SystemTime::now(),
        Duration::from_millis(300),
    );
    assert!(
        bounded.elapsed() < Duration::from_secs(2),
        "a bounded finish took {:?}",
        bounded.elapsed()
    );
}

#[test]
fn an_unreachable_endpoint_keeps_the_events_for_later() {
    let dir = tempfile::tempdir().expect("tempdir");
    let closed = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = closed.local_addr().expect("addr").port();
    drop(closed);
    let paths = opt_in(dir.path(), &format!("http://127.0.0.1:{port}"));

    let recorder = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on");
    recorder.record(Event::new("step").with("step", "Running migrations"));
    recorder.finish(BTreeMap::new(), SystemTime::now(), Duration::from_secs(20));

    assert_eq!(buffered_files(&paths).len(), 1);
}

/// Settings in `dir` that don't exist yet, provisioned by `script`'s stdout.
fn unprovisioned(dir: &Path, endpoint: &str, script: &str) -> Paths {
    let mut paths = Paths::at(dir.join("local-telemetry.toml"), dir.join("buffer"));
    paths.provision = Some(Provision {
        command: vec!["sh".into(), "-c".into(), script.into()],
        endpoint: endpoint.to_owned(),
    });
    paths
}

#[test]
fn opting_out_wins_over_working_settings() {
    let endpoint = Endpoint::start(ResponseTemplate::new(204));
    let dir = tempfile::tempdir().expect("tempdir");
    let mut by_env = opt_in(dir.path(), &endpoint.server.uri());
    by_env.switch = Switch::Off;
    let recorder = Recorder::start(&by_env, SystemTime::now(), common).expect("start");
    assert!(recorder.is_none());

    let by_file = unprovisioned(dir.path(), &endpoint.server.uri(), &format!("echo {TOKEN}"));
    std::fs::write(&by_file.config, "enabled = false\n").expect("write");
    let recorder = Recorder::start(&by_file, SystemTime::now(), common).expect("start");
    assert!(recorder.is_none());
    assert!(!by_file.buffer_dir.exists());
    assert!(endpoint.requests("/v1/logs").is_empty());
}

#[test]
fn a_first_run_provisions_its_token_and_sends() {
    let endpoint = Endpoint::start(ResponseTemplate::new(204));
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = unprovisioned(dir.path(), &endpoint.server.uri(), &format!("echo {TOKEN}"));

    let recorder = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on by default");
    recorder.record(Event::new("step").with("step", "Running migrations"));
    recorder.finish(BTreeMap::new(), SystemTime::now(), Duration::from_secs(20));

    let requests = endpoint.requests("/v1/logs");
    assert!(!requests.is_empty());
    let authorization = requests[0]
        .headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    assert_eq!(authorization, Some(format!("Bearer {TOKEN}")));
    let mode = std::fs::metadata(&paths.config)
        .expect("settings written")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let written = std::fs::read_to_string(&paths.config).expect("read");
    assert!(written.contains("provisioned = true"));
    assert!(buffered_files(&paths).is_empty());
}

#[test]
fn without_a_token_runs_carry_on_and_back_off() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Doppler logged out, offline or without access: no token on stdout.
    let paths = unprovisioned(dir.path(), "https://otlp.example.com", "exit 1");

    let began = Instant::now();
    let recorder = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on by default");
    recorder.record(Event::new("step").with("step", "Running migrations"));
    recorder.finish(BTreeMap::new(), SystemTime::now(), Duration::from_secs(20));
    assert!(began.elapsed() < Duration::from_secs(5));
    assert!(!paths.config.exists());
    // Kept, in case a later run gets a token within the week.
    assert_eq!(buffered_files(&paths).len(), 1);

    let built_fields = std::cell::Cell::new(false);
    let next = Recorder::start(&paths, SystemTime::now(), || {
        built_fields.set(true);
        common()
    })
    .expect("start");
    assert!(next.is_none(), "a recent failure skips recording");
    assert!(!built_fields.get());

    assert!(take_hint(&paths).is_some());
    assert!(take_hint(&paths).is_none(), "the hint shows once");
}

#[test]
fn a_rejected_provisioned_token_is_fetched_again() {
    const FRESH: &str = "fresh-token-0123456789abcdef0123456789";
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let server = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(wiremock::matchers::header(
                "authorization",
                format!("Bearer {FRESH}").as_str(),
            ))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        server
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = unprovisioned(dir.path(), &server.uri(), &format!("echo {FRESH}"));
    std::fs::write(
        &paths.config,
        format!(
            "endpoint = \"{}\"\ntoken = \"{TOKEN}\"\nprovisioned = true\n",
            server.uri()
        ),
    )
    .expect("write");
    std::fs::set_permissions(&paths.config, std::fs::Permissions::from_mode(0o600)).expect("chmod");

    let recorder = Recorder::start(&paths, SystemTime::now(), common)
        .expect("start")
        .expect("on");
    recorder.finish(BTreeMap::new(), SystemTime::now(), Duration::from_secs(20));

    let written = std::fs::read_to_string(&paths.config).expect("read");
    assert!(written.contains(FRESH));
    assert!(
        buffered_files(&paths).is_empty(),
        "sent with the fresh token"
    );
}
