//! OCaml programs through the real compile step and Deno: the OCaml twins
//! of the JavaScript tests beside this file, plus compiling and the policy
//! check. They need the bundle this build names: build with
//! `CODE_MODE_OCAML_DIR=$(nix build --no-link --print-out-paths .#code-mode-ocaml)`.

use super::*;

const NO_BUNDLE: &str =
    "OCaml tests need a build with CODE_MODE_OCAML_DIR (nix build .#code-mode-ocaml)";

async fn runner(root: &Path) -> DenoRunner {
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    DenoRunner::new(binary, root.to_owned(), 128).await.unwrap()
}

async fn setup_ocaml(limits: Limits) -> (tempfile::TempDir, ExecutionService) {
    let root = tempfile::tempdir().unwrap();
    let runner = runner(root.path()).await;
    assert!(runner.ocaml_bundle().is_some(), "{NO_BUNDLE}");
    (
        root,
        ExecutionService::new(Arc::new(runner), limits).unwrap(),
    )
}

fn ocaml(source: &str, timeout_ms: u64) -> ExecuteRequest {
    ExecuteRequest {
        source: source.into(),
        timeout_ms,
        language: Language::Ocaml,
    }
}

async fn run_ocaml(
    service: &ExecutionService,
    source: &str,
    timeout_ms: u64,
    environment: RunEnvironment,
) -> (Vec<ExecutionEvent>, Outcome) {
    collect(
        service
            .execute(ocaml(source, timeout_ms), environment)
            .unwrap(),
    )
    .await
}

fn failure(outcome: &Outcome) -> &ExecutionFailure {
    match outcome {
        Outcome::Failed { error } => error,
        other => panic!("expected a failure, got {other:?}"),
    }
}

fn progress(events: &[ExecutionEvent]) -> Vec<&serde_json::Value> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Progress { value } => Some(value),
            _ => None,
        })
        .collect()
}

/// A program `ocamlc` takes far longer than any test's deadline to
/// compile: the exhaustiveness check of a 26-column diagonal match is
/// exponential (n=22 takes 3 s).
fn slow_to_compile() -> String {
    let rows: Vec<String> = (0..26)
        .map(|row| {
            let columns: Vec<&str> = (0..26)
                .map(|column| if row == column { "true" } else { "_" })
                .collect();
            format!("  | {} -> ()", columns.join(", "))
        })
        .collect();
    format!("let f = function\n{}\n", rows.join("\n"))
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_sdk_call_is_authenticated_marked_and_reported() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        respond(&mut stream, r#"{"contacts":["macro|a@example.com"]}"#).await;
        request
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
            hosts: BTreeMap::from([("contacts".into(), format!("http://{address}"))]),
            web_app_url: "https://app.example.test".into(),
        },
        unattended: None,
    };
    let source = r#"
open Macro_sdk

let () =
  Code_mode.run @@ fun { macro; session_id; execution_id; web_app_url } ->
  let string = function Some s -> `String s | None -> `Null in
  let reply = Macro_sdk_fetch.call_exn macro (Contacts.get_contacts ()) in
  print_endline "called";
  `Assoc
    [
      ("contacts", `List (List.map (fun c -> `String c) reply.contacts));
      ("session", string session_id);
      ("execution", string execution_id);
      ("webAppUrl", string web_app_url);
    ]
"#;
    let (events, outcome) = run_ocaml(&service, source, 10_000, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({
            "contacts": ["macro|a@example.com"],
            "session": "00000000-0000-0000-0000-000000000001",
            "execution": "00000000-0000-0000-0000-000000000002",
            "webAppUrl": "https://app.example.test",
        })
    );
    let request = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap()
        .to_ascii_lowercase();
    assert!(request.starts_with("get /contacts "), "{request}");
    assert!(request.contains("authorization: bearer fixture-run-token\r\n"));
    assert!(request.contains("x-macro-code-execution: 1\r\n"));
    assert!(
        request
            .contains("traceparent: 00-01234567890123456789012345678901-0123456789012345-01\r\n")
    );
    let progress = progress(&events);
    // Session activity reads numeric ids, as the TypeScript SDK sends.
    assert!(progress.iter().all(|event| event["id"] == 1));
    assert_eq!(
        progress
            .iter()
            .map(|event| (
                event["service"].as_str().unwrap(),
                event["operation"].as_str().unwrap(),
                event["status"].as_str().unwrap()
            ))
            .collect::<Vec<_>>(),
        [
            ("contacts", "getContacts", "started"),
            ("contacts", "getContacts", "completed")
        ]
    );
    assert!(events.iter().any(
        |event| matches!(&event.kind, EventKind::Log { level: LogLevel::Info, message } if message == "called")
    ));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_logs_result_and_cleanup() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    let source = r#"
let () =
  print_endline "working";
  prerr_endline "careful";
  Code_mode.run (fun _ -> `Int (6 * 7))
"#;
    let (events, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
    assert!(
        matches!(outcome, Outcome::Succeeded { ref value } if *value == 42),
        "{outcome:?}"
    );
    let logs: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Log { level, message } => Some((*level, message.as_str())),
            _ => None,
        })
        .collect();
    assert!(
        matches!(
            logs.as_slice(),
            [(LogLevel::Info, "working"), (LogLevel::Warn, "careful")]
        ),
        "{logs:?}"
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn requires_ocaml_code_mode_run() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    for (source, message) in [
        (
            "let x = 42",
            "The program ended without calling Code_mode.run.",
        ),
        (
            "let () = exit 3",
            "The program exited with status 3 before Code_mode.run finished.",
        ),
        (
            "let () = Code_mode.run (fun _ -> failwith \"boom\")",
            "boom",
        ),
    ] {
        let (_, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
        let error = failure(&outcome);
        assert_eq!(error.code, FailureCode::Runtime, "{source}: {error:?}");
        assert!(error.message.contains(message), "{source}: {error:?}");
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn a_compile_error_names_its_location() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    let (_, outcome) = run_ocaml(
        &service,
        "let () =\n  Code_mode.run (fun _ -> `Int missing)\n",
        10_000,
        RunEnvironment::default(),
    )
    .await;
    let error = failure(&outcome);
    assert_eq!(error.code, FailureCode::Compile);
    assert!(
        error.message.contains("Error: Unbound value missing"),
        "{error:?}"
    );
    assert!(error.message.ends_with("at main.ml:2:32"), "{error:?}");
    // Nothing from the host leaks into the message.
    assert!(!error.message.contains("/nix/store"), "{error:?}");
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn the_policy_check_refuses_escape_hatches() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    // The plan's must-reject programs, then one per rule.
    let cases = [
        (
            "external system : string -> int = \"caml_sys_system_command\"\nlet () = ignore (system \"true\"); ignore (Unix.getpid ())\nlet () = ignore (Obj.magic 0 : string)\n",
            "Unbound module Unix",
        ),
        (
            "external system : string -> int = \"caml_sys_system_command\"\nlet () = ignore (system \"echo plugin ran a shell command\")\n",
            "Error: An external declaration is not allowed in code-mode programs\n    at main.ml:1:1",
        ),
        (
            "let () = Code_mode.run (fun _ -> Obj.magic 0)",
            "Error: Obj is not allowed in code-mode programs\n    at main.ml:1:34",
        ),
        (
            "let () = Code_mode.run (fun _ -> `String (Marshal.to_string 1 []))",
            "Marshal is not allowed",
        ),
        (
            "let () = Code_mode.run (fun _ -> `Int (Sys.command \"true\"))",
            "Sys.command is not allowed",
        ),
        (
            "module S = Stdlib\nlet () = Code_mode.run (fun _ -> S.Obj.magic 0)",
            "Binding Stdlib to a module is not allowed",
        ),
        (
            "module O = Obj\nlet () = Code_mode.run (fun _ -> O.magic 0)",
            "Obj is not allowed",
        ),
        (
            "let () = Code_mode.run (fun _ -> Js_of_ocaml.Js.Unsafe.eval_string \"1\")",
            "Unbound module Js_of_ocaml",
        ),
        (
            "let () = Code_mode.run (fun _ -> Jsoo_runtime.Js.pure_js_expr \"1\")",
            "Unbound module Jsoo_runtime",
        ),
    ];
    for (source, message) in cases {
        let (_, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
        let error = failure(&outcome);
        assert_eq!(error.code, FailureCode::Compile, "{source}: {error:?}");
        assert!(error.message.contains(message), "{source}: {error:?}");
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_is_denied_ambient_io() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("outside.json");
    tokio::fs::write(&secret, r#"{"secret":"fixture-only"}"#)
        .await
        .unwrap();
    let bodies = [
        format!("`String (In_channel.with_open_bin {:?} In_channel.input_all)", secret.display().to_string()),
        "`String (In_channel.with_open_bin \"/etc/passwd\" In_channel.input_all)".to_owned(),
        "Out_channel.with_open_bin \"/tmp/macro-code-execution-forbidden\" (fun c -> output_string c \"bad\"); `Null".into(),
        "Out_channel.with_open_bin \"main.ml\" (fun c -> output_string c \"bad\"); `Null".into(),
        "`String (Sys.getenv \"PATH\")".into(),
        "`Bool (Sys.file_exists \"/etc/passwd\")".into(),
        "ignore (Sys.readdir \"/\"); `Null".into(),
        "Sys.remove \"main.js\"; `Null".into(),
    ];
    for body in bodies {
        let source = format!("let () = Code_mode.run (fun _ -> {body})");
        let (_, outcome) = run_ocaml(&service, &source, 10_000, RunEnvironment::default()).await;
        assert!(
            matches!(outcome, Outcome::Failed { ref error } if error.code == FailureCode::Runtime),
            "allowed forbidden source: {source}: {outcome:?}"
        );
    }
    // The environment is empty, not just unreadable.
    let (_, outcome) = run_ocaml(
        &service,
        "let () = Code_mode.run (fun _ -> `Bool (Sys.getenv_opt \"HOME\" = None && Sys.getenv_opt \"PATH\" = None))",
        10_000,
        RunEnvironment::default(),
    )
    .await;
    assert!(
        matches!(outcome, Outcome::Succeeded { ref value } if *value == true),
        "{outcome:?}"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_is_denied_unlisted_destinations_including_redirects() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let forbidden = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let forbidden_address = forbidden.local_addr().unwrap();
    // A client pointed anywhere but the run's hosts.
    let source = format!(
        r#"
let () =
  Code_mode.run @@ fun {{ macro; _ }} ->
  let config = Macro_sdk_fetch.config macro in
  let elsewhere =
    Macro_sdk_fetch.create
      ~config:{{ config with hosts = [ ("contacts", "http://{forbidden_address}") ] }}
      ()
  in
  match Macro_sdk_fetch.call elsewhere (Macro_sdk.Contacts.get_contacts ()) with
  | Ok _ -> `String "sent"
  | Error error -> `String (Macro_sdk_runtime.Error.to_string error)
"#
    );
    let (_, outcome) = run_ocaml(&service, &source, 10_000, RunEnvironment::default()).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert!(value.as_str().unwrap().contains("NotCapable"), "{value}");

    let allowed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let allowed_address = allowed.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = allowed.accept().await.unwrap();
        read_request(&mut stream).await;
        stream.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://{forbidden_address}/contacts\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    });
    let environment = RunEnvironment {
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([("contacts".into(), format!("http://{allowed_address}"))]),
            ..SdkEndpoints::default()
        },
        ..RunEnvironment::default()
    };
    let source = r#"
let () =
  Code_mode.run @@ fun { macro; _ } ->
  ignore (Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ()));
  `String "followed"
"#;
    let (_, outcome) = run_ocaml(&service, source, 10_000, environment).await;
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
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn times_out_and_cancels_while_compiling() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    let started = std::time::Instant::now();
    let (_, outcome) =
        run_ocaml(&service, &slow_to_compile(), 500, RunEnvironment::default()).await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);

    let mut handle = service
        .execute(ocaml(&slow_to_compile(), 20_000), RunEnvironment::default())
        .unwrap();
    while !matches!(handle.events.recv().await.unwrap().kind, EventKind::Started) {}
    handle.cancellation.cancel();
    let (_, outcome) = collect(handle).await;
    assert!(matches!(outcome, Outcome::Cancelled), "{outcome:?}");
    // The compiler was killed and reaped before its scratch was deleted.
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn times_out_cancels_and_reaps_busy_ocaml_programs() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    let busy = "let () = Code_mode.run (fun _ -> let rec loop n = loop (n + 1) in loop 0)";
    let (_, outcome) = run_ocaml(&service, busy, 1500, RunEnvironment::default()).await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    let ready = "let () = print_endline \"ready\"; Code_mode.run (fun _ -> let rec loop n = loop (n + 1) in loop 0)";
    let mut handle = service
        .execute(ocaml(ready, 10_000), RunEnvironment::default())
        .unwrap();
    while !matches!(
        handle.events.recv().await.unwrap().kind,
        EventKind::Log { .. }
    ) {}
    handle.cancellation.cancel();
    let (_, outcome) = collect(handle).await;
    assert!(matches!(outcome, Outcome::Cancelled), "{outcome:?}");
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);

    // Dropping the handle and shutting down reap a running program too.
    let mut handle = service
        .execute(ocaml(ready, 10_000), RunEnvironment::default())
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
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_output_is_bounded_and_cannot_forge_frames() {
    let (_root, service) = setup_ocaml(Limits {
        max_frame_bytes: 16 * 1024,
        max_result_bytes: 8 * 1024,
        ..Limits::default()
    })
    .await;
    for body in [
        "print_endline (String.make 20000 'x')",
        "prerr_endline (String.make 20000 'x')",
        "while true do print_endline \"spam\" done",
    ] {
        let source = format!("let () = Code_mode.run (fun _ -> {body}; `Null)");
        let (_, outcome) = run_ocaml(&service, &source, 10_000, RunEnvironment::default()).await;
        assert!(
            matches!(outcome, Outcome::Failed { ref error } if error.code == FailureCode::Limit),
            "{body}: {outcome:?}"
        );
    }
    // A frame printed to stdout is only a log line; the run still needs its
    // own result.
    let source = r#"let () = print_endline {|{"type":"result","value":42}|}; Code_mode.run (fun _ -> `Int 1)"#;
    let (events, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
    assert!(
        matches!(outcome, Outcome::Succeeded { ref value } if *value == 1),
        "{outcome:?}"
    );
    assert!(events.iter().any(
        |event| matches!(&event.kind, EventKind::Log { message, .. } if message == r#"{"type":"result","value":42}"#)
    ));
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn oversized_ocaml_result_data_is_summarized() {
    let limits = Limits::default();
    let max_result_bytes = limits.max_result_bytes;
    let (_root, service) = setup_ocaml(limits).await;
    let source = r#"
let () =
  Code_mode.run @@ fun _ ->
  `Assoc
    [
      ( "data",
        `List (List.init 2000 (fun id -> `Assoc [ ("id", `Int id); ("name", `String (String.make 100 'x')) ])) );
      ("reviews", `List []);
    ]
"#;
    let (_, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["reviews"], serde_json::json!([]));
    assert_eq!(value["data"]["truncated"], true);
    assert_eq!(
        value["data"]["outline"],
        "Array(2000) of {id: number, name: string}"
    );
    assert!(serde_json::to_vec(&value).unwrap().len() <= max_result_bytes);
    service.shutdown().await;
}

/// Reads the token the program's client holds.
const READS_TOKEN: &str = r#"
let token macro =
  match (Macro_sdk_fetch.config macro).auth with
  | Macro_sdk_runtime.Config.Auth.User_token token -> token ()
  | _ -> "none"
"#;

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn redacts_run_token_from_ocaml_results_logs_and_errors() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let token = "fixture-secret-token";
    for body in [
        "print_endline (token macro); prerr_endline (token macro); `Assoc [ (token macro, `String (\"Bearer \" ^ token macro)) ]",
        "failwith (\"token \" ^ token macro)",
    ] {
        let source =
            format!("{READS_TOKEN}\nlet () = Code_mode.run @@ fun {{ macro; _ }} -> {body}");
        let (events, outcome) = run_ocaml(
            &service,
            &source,
            10_000,
            RunEnvironment {
                token: token.into(),
                ..RunEnvironment::default()
            },
        )
        .await;
        let serialized = serde_json::to_string(&(events, &outcome)).unwrap();
        assert!(
            !serialized.contains(token),
            "run credential escaped redaction"
        );
        match outcome {
            Outcome::Succeeded { value } => assert_eq!(value["[REDACTED]"], "Bearer [REDACTED]"),
            Outcome::Failed { error } => {
                assert_eq!(error.message, "Error: Failure(\"token [REDACTED]\")")
            }
            unexpected => panic!("unexpected outcome: {unexpected:?}"),
        }
    }
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_unattended_ocaml_program_never_holds_the_credential() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        respond(&mut stream, r#"{"contacts":[]}"#).await;
        request
    });
    let source = format!(
        r#"{READS_TOKEN}
let () =
  Code_mode.run @@ fun {{ macro; session_id; _ }} ->
  ignore (Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ()));
  `Assoc [ ("token", `String (token macro)); ("session", `Bool (session_id = None)) ]
"#
    );
    let mut environment = unattended(
        "fixture-run-token",
        &[("contacts", host)],
        serde_json::json!({}),
        false,
    );
    environment.session_id = Some(uuid::Uuid::from_u128(1));
    let (_, outcome) = run_ocaml(&service, &source, 10_000, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(
        value,
        serde_json::json!({"token": "code-mode-unattended", "session": true})
    );
    // The bootstrap sent the real credential in its place.
    let request = server.await.unwrap().to_ascii_lowercase();
    assert!(
        request.contains("authorization: bearer fixture-run-token\r\n"),
        "{request}"
    );

    let (_, outcome) = run_ocaml(
        &service,
        "let () = Code_mode.run (fun _ -> `Null)",
        10_000,
        unattended(
            "fixture-run-token",
            &[],
            serde_json::json!({"trigger": 1}),
            false,
        ),
    )
    .await;
    assert_eq!(
        failure(&outcome).message,
        "OCaml programs take no arguments yet"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_ocaml_dry_run_reads_but_sends_no_writes() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        assert!(request.starts_with("GET /contacts "), "{request}");
        respond(&mut stream, r#"{"contacts":["macro|a@example.com"]}"#).await;
        // Nothing else reaches the API: the write is skipped in the process.
        assert!(
            tokio::time::timeout(Duration::from_millis(500), listener.accept())
                .await
                .is_err()
        );
    });
    let source = r#"
let () =
  Code_mode.run @@ fun { macro; _ } ->
  let contacts = Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ()) in
  let deleted =
    match Macro_sdk_fetch.call macro (Macro_sdk.Storage.delete_document ~document_id:"document-1" ()) with
    | Ok _ -> "skipped"
    | Error error -> Macro_sdk_runtime.Error.to_string error
  in
  `Assoc [ ("contacts", `Int (List.length contacts.contacts)); ("deleted", `String deleted) ]
"#;
    let environment = unattended(
        "fixture-run-token",
        &[("contacts", host.clone()), ("storage", host)],
        serde_json::json!({}),
        true,
    );
    let (events, outcome) = run_ocaml(&service, source, 10_000, environment).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["contacts"], 1, "{value}");
    assert!(
        progress(&events)
            .iter()
            .any(|event| event["service"] == "storage"
                && event["operation"] == "deleteDocument"
                && event["status"] == "skipped")
    );
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_ocaml_real_run_sends_its_writes() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        assert!(
            request.starts_with("DELETE /documents/document-1 "),
            "{request}"
        );
        respond(&mut stream, "{}").await;
    });
    let source = r#"
let () =
  Code_mode.run @@ fun { macro; _ } ->
  match Macro_sdk_fetch.call macro (Macro_sdk.Storage.delete_document ~document_id:"document-1" ()) with
  | Ok _ -> `Bool true
  | Error error -> `String (Macro_sdk_runtime.Error.to_string error)
"#;
    let environment = unattended(
        "fixture-run-token",
        &[("storage", host)],
        serde_json::json!({}),
        false,
    );
    let (events, outcome) = run_ocaml(&service, source, 10_000, environment).await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    assert!(
        progress(&events)
            .iter()
            .any(|event| event["operation"] == "deleteDocument" && event["status"] == "completed")
    );
    server.await.unwrap();
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn the_cpu_limit_stops_a_busy_ocaml_program() {
    let (_root, service) = setup_ocaml(Limits {
        max_cpu: Some(Duration::from_secs(1)),
        background: true,
        ..Limits::default()
    })
    .await;
    let (_, outcome) = run_ocaml(
        &service,
        "let () = Code_mode.run (fun _ -> let rec loop n = loop (n + 1) in loop 0)",
        10_000,
        RunEnvironment::default(),
    )
    .await;
    let error = failure(&outcome);
    assert!(
        error.code == FailureCode::Limit && error.message.contains("CPU"),
        "{error:?}"
    );
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn ocaml_without_a_bundle_fails_saying_so() {
    let root = tempfile::tempdir().unwrap();
    let mut runner = runner(root.path()).await;
    runner.ocaml = None;
    let service = ExecutionService::new(Arc::new(runner), Limits::default()).unwrap();
    let (_, outcome) = run_ocaml(
        &service,
        "let () = Code_mode.run (fun _ -> `Null)",
        10_000,
        RunEnvironment::default(),
    )
    .await;
    let error = failure(&outcome);
    assert_eq!(error.code, FailureCode::Internal);
    assert!(error.message.contains("CODE_MODE_OCAML_DIR"), "{error:?}");
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn the_ocaml_checker_type_checks_and_applies_the_policy() {
    let root = tempfile::tempdir().unwrap();
    let runner = runner(root.path()).await;
    let bundle = Arc::clone(runner.ocaml_bundle().expect(NO_BUNDLE));
    let checker = crate::outbound::ocaml::check::OcamlChecker::new(
        bundle,
        root.path().join("checks"),
        1,
        64 * 1024,
    )
    .await
    .unwrap();
    assert!(checker.sdk_fingerprint().starts_with("0.1.0+"));
    let ok = "let () = Code_mode.run @@ fun { macro; _ } -> ignore (Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ())); `Null";
    assert_eq!(checker.check(ok, "").await.unwrap(), []);

    let diagnostics = checker
        .check("let () = Code_mode.run (fun _ -> `Int \"x\")", "")
        .await
        .unwrap();
    assert!(
        matches!(diagnostics.as_slice(), [Diagnostic { file: Some(file), message }] if file == "main.ml" && message.contains("at main.ml:1:")),
        "{diagnostics:?}"
    );

    let diagnostics = checker
        .check("let () = Code_mode.run (fun _ -> Obj.magic 0)", "")
        .await
        .unwrap();
    assert_eq!(
        diagnostics,
        [Diagnostic {
            file: Some("main.ml".into()),
            message: "Error: Obj is not allowed in code-mode programs\n    at main.ml:1:34".into(),
        }]
    );
    assert!(matches!(
        checker.check(ok, "declare global {}").await,
        Err(CheckError::InvalidSource)
    ));
    assert_eq!(
        std::fs::read_dir(root.path().join("checks"))
            .unwrap()
            .count(),
        0
    );
}
