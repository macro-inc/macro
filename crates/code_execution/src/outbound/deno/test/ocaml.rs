//! OCaml programs through the real compile step and Deno: the OCaml twins
//! of the JavaScript tests beside this file, plus compiling and the policy
//! check. JavaScript tests without a twin, because OCaml has no such
//! feature: module imports (a program is one `main.ml` against the
//! bundle), sleeping (no timer API without Unix), invalid or duplicate
//! result frames (an OCaml program writes no frames; `Code_mode.run`
//! finishes once), arguments to unattended programs (refused), and the
//! SDK features `execution.views` and `webUrl()` links. They need the bundle this build names: build with
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

/// A service whose OCaml compile skips the policy step (tests only), to
/// reach what Deno does with a program the policy would refuse.
async fn setup_ocaml_without_policy() -> (tempfile::TempDir, ExecutionService) {
    let root = tempfile::tempdir().unwrap();
    let runner = runner(root.path()).await.without_ocaml_policy();
    assert!(runner.ocaml_bundle().is_some(), "{NO_BUNDLE}");
    (
        root,
        ExecutionService::new(Arc::new(runner), Limits::default()).unwrap(),
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
        allowed_operations: None,
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
async fn a_character_split_across_writes_is_logged_whole() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let source = "let () =\n  print_string \"caf\\xc3\"; flush stdout; print_string \"\\xa9\\n\"; flush stdout;\n  Code_mode.run (fun _ -> `Null)";
    let (events, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    assert!(
        events.iter().any(
            |event| matches!(&event.kind, EventKind::Log { message, .. } if message == "café")
        ),
        "{events:?}"
    );
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
        // Sys seen through a signature the program writes (the review's
        // bypasses and variants), and marshalling by other names.
        (
            "module M : sig val command : string -> int end = Sys\nlet () = Code_mode.run (fun _ -> `Int (M.command \"id\"))",
            "Error: Using Sys as a module (other than Sys.name or open Sys) is not allowed in code-mode programs\n    at main.ml:1:50",
        ),
        (
            "module F (S : sig val command : string -> int end) = struct let r = S.command \"id\" end\nmodule R = F (Sys)\nlet () = Code_mode.run (fun _ -> `Int R.r)",
            "Sys.command behind a signature is not allowed",
        ),
        (
            "module type C = sig val command : string -> int end\nmodule P = (val (module Sys : C))\nlet () = Code_mode.run (fun _ -> `Int (P.command \"id\"))",
            "Sys.command behind a signature is not allowed",
        ),
        (
            "module S = Sys\nmodule I : sig val command : string -> int end = struct include S end\nlet () = Code_mode.run (fun _ -> `Int (I.command \"id\"))",
            "Using Sys as a module",
        ),
        (
            "module N = struct module X = Sys end\nmodule G (A : sig module X : sig val command : string -> int end end) = struct let r = A.X.command \"id\" end\nmodule U = G (N)\nlet () = Code_mode.run (fun _ -> `Int U.r)",
            "Sys as a submodule behind a signature is not allowed",
        ),
        // A path to a local alias of Sys stays an unexpanded alias in the
        // typed tree; the check expands it in the program's environment.
        (
            "module type Command = sig val command : string -> int end\nmodule Nested = struct module X = Sys end\nmodule M : Command = Nested.X\nlet () = Code_mode.run (fun _ -> `Int (M.command \"id\"))",
            "Error: Sys as a submodule behind a signature is not allowed in code-mode programs\n    at main.ml:3:22",
        ),
        (
            "module type Command = sig val command : string -> int end\nmodule Nested = struct module X = Sys end\nlet () = Code_mode.run (fun _ -> let module L : Command = Nested.X in `Int (L.command \"id\"))",
            "Sys as a submodule behind a signature is not allowed",
        ),
        (
            "module type Command = sig val command : string -> int end\nmodule Y = struct module S = Sys end\nmodule M : sig module S : Command end = Y\nlet () = Code_mode.run (fun _ -> `Int (M.S.command \"id\"))",
            "Sys as a submodule behind a signature is not allowed",
        ),
        (
            "let () = Code_mode.run (fun _ -> ignore (input_value (open_in_bin \"main.ml\")); `Null)",
            "input_value (unmarshalling) is not allowed",
        ),
        (
            "let () = Code_mode.run (fun _ -> Stdlib.output_value stdout 1; `Null)",
            "output_value (marshalling) is not allowed",
        ),
        (
            "let () = Code_mode.run (fun _ -> ignore CamlinternalOO.new_method; `Null)",
            "Camlinternal* (the compiler's internals) is not allowed",
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
    // Sys by name, opened or renamed still compiles and runs.
    let (_, outcome) = run_ocaml(
        &service,
        "module S = Sys\nlet () = Code_mode.run (fun _ -> `Bool (S.time () >= 0. && Sys.(time ()) >= 0.))",
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

/// The policy refuses Sys.command, so only a compile without it reaches the
/// runtime's process path: the run, not the policy, must stop it there. The
/// runtime asks the loader's `require` for `node:child_process`, which it
/// doesn't have; Deno's `--deny-run` is behind that.
#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_cannot_run_a_process() {
    let (root, service) = setup_ocaml_without_policy().await;
    let outside = tempfile::tempdir().unwrap();
    let marker = outside.path().join("spawned");
    let command = format!("touch {}", marker.display());
    for source in [
        format!("let () = Code_mode.run (fun _ -> `Int (Sys.command {command:?}))"),
        format!(
            "external system : string -> int = \"caml_sys_system_command\"\nlet () = Code_mode.run (fun _ -> `Int (system {command:?}))"
        ),
    ] {
        let (_, outcome) = run_ocaml(&service, &source, 10_000, RunEnvironment::default()).await;
        assert!(
            matches!(outcome, Outcome::Failed { ref error } if error.code == FailureCode::Runtime),
            "ran a process: {source}: {outcome:?}"
        );
        assert!(
            failure(&outcome)
                .message
                .contains("node:child_process is unavailable in ExecuteCode"),
            "{outcome:?}"
        );
        assert!(!marker.exists(), "a process ran: {source}");
    }
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn a_program_that_explodes_the_compiler_is_stopped() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    // Each function doubles its type: f23's type is far beyond any memory.
    let mut source = String::from("let f0 x = (x, x)\n");
    for n in 1..24 {
        source.push_str(&format!("let f{n} x = f{} (f{} x)\n", n - 1, n - 1));
    }
    source.push_str("let () = Code_mode.run (fun _ -> `Null)\n");
    let started = std::time::Instant::now();
    let (_, outcome) = run_ocaml(&service, &source, 20_000, RunEnvironment::default()).await;
    let error = failure(&outcome);
    assert_eq!(error.code, FailureCode::Compile, "{error:?}");
    assert!(
        error
            .message
            .contains("needs more memory than code mode allows"),
        "{error:?}"
    );
    // Stopped by its memory cap, not by the deadline.
    assert!(started.elapsed() < Duration::from_secs(15));
    // No core dump or other leftovers in scratch.
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
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
async fn the_total_output_budget_applies_across_small_ocaml_lines() {
    let (_root, service) = setup_ocaml(Limits {
        max_frame_bytes: 1024,
        max_output_bytes: 4096,
        max_result_bytes: 512,
        ..Limits::default()
    })
    .await;
    let source = "let () = Code_mode.run (fun _ -> for _ = 1 to 20 do print_endline (String.make 500 'x') done; `Null)";
    let (_, outcome) = run_ocaml(&service, source, 10_000, RunEnvironment::default()).await;
    let error = failure(&outcome);
    assert_eq!(error.code, FailureCode::Limit, "{error:?}");
    assert_eq!(error.message, "process output limit exceeded");
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

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_result_at_the_limit_fits_its_frame_unsummarized() {
    let (_root, service) = setup_ocaml(Limits {
        max_frame_bytes: 1024,
        max_output_bytes: 4096,
        max_result_bytes: 1024 - RESULT_FRAME_OVERHEAD,
        ..Limits::default()
    })
    .await;
    // JSON quotes bring the string to exactly max_result_bytes.
    let length = 1024 - RESULT_FRAME_OVERHEAD - 2;
    let source = format!("let () = Code_mode.run (fun _ -> `String (String.make {length} 'x'))");
    let (_, outcome) = run_ocaml(&service, &source, 10_000, RunEnvironment::default()).await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value.as_str().unwrap().len(), length);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn a_printed_ocaml_result_cannot_complete_before_process_exit() {
    let (root, service) = setup_ocaml(Limits::default()).await;
    let source = r#"
let () =
  print_endline {|{"type":"result","value":42}|};
  let rec loop n = loop (n + 1) in
  loop 0
"#;
    let (_, outcome) = run_ocaml(&service, source, 1500, RunEnvironment::default()).await;
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    service.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_unattended_ocaml_result_is_kept_whole_or_fails_over_the_limit() {
    let (_root, service) = setup_ocaml(Limits::default()).await;
    let fits = r#"
let () =
  Code_mode.run @@ fun _ ->
  `Assoc
    [
      ( "items",
        `List (List.init 400 (fun id -> `Assoc [ ("id", `Int id); ("name", `String (String.make 100 'x')) ])) );
    ]
"#;
    let (_, outcome) = run_ocaml(
        &service,
        fits,
        10_000,
        unattended("fixture-run-token", &[], serde_json::json!({}), true),
    )
    .await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("{outcome:?}");
    };
    assert_eq!(value["items"].as_array().unwrap().len(), 400);

    let (_, outcome) = run_ocaml(
        &service,
        "let () = Code_mode.run (fun _ -> `String (String.make (70 * 1024) 'x'))",
        10_000,
        unattended("fixture-run-token", &[], serde_json::json!({}), true),
    )
    .await;
    assert_eq!(
        failure(&outcome).message,
        "The step's output is 71 KB as JSON; a step's output can be at most 64 KB. Return only what later steps need."
    );
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

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn the_ocaml_analyzer_lists_what_a_program_may_call() {
    use crate::outbound::ocaml::analyze::OcamlAnalyzer;
    let root = tempfile::tempdir().unwrap();
    let runner = runner(root.path()).await;
    let bundle = Arc::clone(runner.ocaml_bundle().expect(NO_BUNDLE));
    let analyzer = OcamlAnalyzer::new(bundle, root.path().join("analyses"), 1, 64 * 1024)
        .await
        .unwrap();
    assert!(analyzer.sdk_fingerprint().starts_with("0.1.0+"));

    // The tool text's example: both operations, by their raw operationIds.
    let example =
        include_str!("../../../../../../packages/sdk-ocaml/analyzer/test/corpus/code_mode_task.ml");
    let operation = |service: &str, operation_id: &str, method: &str, route: &str| SdkCall {
        operation: SdkOperation {
            service: service.into(),
            operation_id: operation_id.into(),
        },
        method: method.into(),
        route: route.into(),
        rivals: Vec::new(),
    };
    // Rivals are checked below; here, the operations.
    let without_rivals = |analysis: Analysis| match analysis {
        Analysis::Calls(calls) => Analysis::Calls(
            calls
                .into_iter()
                .map(|call| SdkCall {
                    rivals: Vec::new(),
                    ..call
                })
                .collect(),
        ),
        other => other,
    };
    assert_eq!(
        without_rivals(analyzer.may_call(example).await.unwrap()),
        Analysis::Calls(
            [
                operation(
                    "storage",
                    "create_task_handler",
                    "POST",
                    "/documents/create_task"
                ),
                operation(
                    "storage",
                    "get_document_markdown",
                    "GET",
                    "/documents/{}/markdown"
                ),
            ]
            .into()
        )
    );
    // Branches count: an operation in a branch that never runs is listed.
    let branch = "let () = Code_mode.run @@ fun { macro; _ } -> if false then ignore (Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ())); `Null";
    assert_eq!(
        without_rivals(analyzer.may_call(branch).await.unwrap()),
        Analysis::Calls([operation("contacts", "get_contacts", "GET", "/contacts")].into())
    );
    // A parameter route lists the literal routes it could reach.
    let Analysis::Calls(calls) = analyzer.may_call(GET_SYSTEM_SKILLS).await.unwrap() else {
        panic!("get_document was not analyzed");
    };
    let get_document = calls.iter().next().unwrap();
    assert_eq!(get_document.route, "/documents/{}");
    assert!(get_document.rivals.contains(&system_skills()));
    assert_eq!(
        analyzer
            .may_call("let () = Code_mode.run (fun _ -> `Null)")
            .await
            .unwrap(),
        Analysis::Calls(Default::default())
    );

    // A program that reaches past the SDK's values passes the policy but
    // cannot be analyzed; the reason carries its location.
    let forged =
        include_str!("../../../../../../packages/sdk-ocaml/analyzer/test/corpus/forged_request.ml");
    assert_eq!(
        analyzer.may_call(forged).await.unwrap(),
        Analysis::CannotAnalyze(vec![AnalysisReason {
            message:
                "builds a Macro_sdk_runtime.Request.t by hand, so its operation cannot be known"
                    .into(),
            line: 3,
            column: 3,
        }])
    );
    let unsafe_get = "let x = Array.unsafe_get [| 1 |] 5\nlet () = Code_mode.run (fun _ -> `Int x)";
    assert!(
        matches!(
            analyzer.may_call(unsafe_get).await.unwrap(),
            Analysis::CannotAnalyze(reasons) if reasons.len() == 1 && reasons[0].line == 1
        ),
        "unsafe_get"
    );

    // Type errors and policy refusals are the compile step's diagnostics.
    assert!(matches!(
        analyzer.may_call("let () = Code_mode.run (fun _ -> `Int \"x\")").await.unwrap(),
        Analysis::Diagnostics(found) if found.len() == 1
    ));
    assert!(matches!(
        analyzer.may_call("let () = Code_mode.run (fun _ -> Obj.magic 0)").await.unwrap(),
        Analysis::Diagnostics(found) if found[0].message.contains("Obj is not allowed")
    ));
    assert!(matches!(
        analyzer.may_call(" ").await,
        Err(CheckError::InvalidSource)
    ));
    assert_eq!(
        std::fs::read_dir(root.path().join("analyses"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn the_ocaml_analyzer_gives_up_at_its_deadline() {
    use crate::outbound::ocaml::analyze::OcamlAnalyzer;
    let root = tempfile::tempdir().unwrap();
    let runner = runner(root.path()).await;
    let bundle = Arc::clone(runner.ocaml_bundle().expect(NO_BUNDLE));
    let analyzer = OcamlAnalyzer::new(bundle, root.path().join("analyses"), 1, 64 * 1024)
        .await
        .unwrap();
    let started = std::time::Instant::now();
    assert!(matches!(
        analyzer.may_call(&slow_to_compile()).await,
        Err(CheckError::Busy)
    ));
    assert!(started.elapsed() < std::time::Duration::from_secs(15));
}

/// The `get_contacts` program the backstop tests run, and what it may send.
const GET_CONTACTS: &str = "let () = Code_mode.run @@ fun { macro; _ } -> let reply = Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ()) in `Int (List.length reply.contacts)";

/// Reads the document `system_skills`: `/documents/{}` with a parameter equal
/// to the literal segment of another operation's route.
const GET_SYSTEM_SKILLS: &str = "let () = Code_mode.run @@ fun { macro; _ } -> ignore (Macro_sdk_fetch.call_exn macro (Macro_sdk.Storage.get_document ~document_id:\"system_skills\" ())); `Null";

fn system_skills() -> SdkRoute {
    SdkRoute {
        service: "storage".into(),
        route: "/documents/system_skills".into(),
    }
}

fn call(service: &str, operation_id: &str, method: &str, route: &str) -> SdkCall {
    SdkCall {
        operation: SdkOperation {
            service: service.into(),
            operation_id: operation_id.into(),
        },
        method: method.into(),
        route: route.into(),
        rivals: Vec::new(),
    }
}

/// Run `GET_CONTACTS` limited to `allowed`, against a stub that answers
/// once; returns the events, the outcome and the request the stub got.
async fn run_gated(
    allowed: Option<Vec<SdkCall>>,
) -> (Vec<ExecutionEvent>, Outcome, Option<String>) {
    run_gated_program(GET_CONTACTS, allowed).await
}

/// Run `program` limited to `allowed`, as [`run_gated`].
async fn run_gated_program(
    program: &str,
    allowed: Option<Vec<SdkCall>>,
) -> (Vec<ExecutionEvent>, Outcome, Option<String>) {
    let (_root, service) = setup_ocaml(Limits::default()).await;
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
        endpoints: SdkEndpoints {
            hosts: BTreeMap::from([
                ("contacts".into(), format!("http://{address}")),
                ("storage".into(), format!("http://{address}/storage")),
            ]),
            web_app_url: "https://app.example.test".into(),
        },
        allowed_operations: allowed,
        ..RunEnvironment::default()
    };
    let (events, outcome) = run_ocaml(&service, program, 10_000, environment).await;
    service.shutdown().await;
    let request = if server.is_finished() {
        Some(server.await.unwrap())
    } else {
        server.abort();
        None
    };
    (events, outcome, request)
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_ocaml_call_the_gate_admitted_is_sent() {
    let (events, outcome, request) = run_gated(Some(vec![call(
        "contacts",
        "get_contacts",
        "GET",
        "/contacts",
    )]))
    .await;
    assert!(
        matches!(&outcome, Outcome::Succeeded { value } if value == &serde_json::json!(1)),
        "{outcome:?}"
    );
    assert!(request.unwrap().starts_with("GET /contacts "));
    assert_eq!(
        progress(&events)
            .iter()
            .map(|event| event["status"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["started", "completed"]
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_ocaml_call_outside_what_the_gate_admitted_is_never_sent() {
    // Left out, on another route, another method, or under another
    // service's host: refused before it is sent.
    for allowed in [
        vec![],
        vec![call(
            "storage",
            "create_task_handler",
            "POST",
            "/documents/create_task",
        )],
        vec![call("contacts", "get_contacts", "GET", "/contacts/{}")],
        vec![call("contacts", "get_contacts", "POST", "/contacts")],
        vec![call("contacts", "get_contact", "GET", "/contacts")],
    ] {
        let (events, outcome, request) = run_gated(Some(allowed.clone())).await;
        assert_eq!(request, None, "{allowed:?}");
        let error = failure(&outcome);
        assert!(
            error.message.contains(
                "contacts.get_contacts is outside what this program was checked to call; it was not sent."
            ),
            "{allowed:?}: {error:?}"
        );
        assert_eq!(
            progress(&events)
                .iter()
                .map(|event| (
                    event["operation"].as_str().unwrap(),
                    event["status"].as_str().unwrap()
                ))
                .collect::<Vec<_>>(),
            [("getContacts", "refused")],
            "{allowed:?}"
        );
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn a_parameter_that_reaches_a_more_specific_route_is_never_sent() {
    let get_document = SdkCall {
        rivals: vec![system_skills()],
        ..call("storage", "get_document", "GET", "/documents/{}")
    };
    let (events, outcome, request) =
        run_gated_program(GET_SYSTEM_SKILLS, Some(vec![get_document.clone()])).await;
    assert_eq!(request, None);
    assert!(
        failure(&outcome).message.contains(
            "storage.get_document is outside what this program was checked to call; it was not sent."
        ),
        "{outcome:?}"
    );
    assert_eq!(
        progress(&events)
            .iter()
            .map(|event| event["status"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["refused"]
    );

    // Any other document id goes to get_document's own route.
    let (_, _, request) = run_gated_program(
        &GET_SYSTEM_SKILLS.replace("system_skills", "doc-1"),
        Some(vec![get_document]),
    )
    .await;
    assert!(
        request
            .as_deref()
            .is_some_and(|request| request.starts_with("GET /storage/documents/doc-1 ")),
        "{request:?}"
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn an_ocaml_run_without_a_gate_sends_as_before() {
    let (_, outcome, request) = run_gated(None).await;
    assert!(matches!(outcome, Outcome::Succeeded { .. }), "{outcome:?}");
    assert!(request.is_some());
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_javascript_run_cannot_be_limited_to_operations() {
    let (_root, service) = setup(Limits::default()).await;
    let (_, outcome) = collect(
        service
            .execute(
                ExecuteRequest {
                    source: "export async function main() { return 1; }".into(),
                    timeout_ms: 10_000,
                    language: Language::Javascript,
                },
                RunEnvironment {
                    allowed_operations: Some(vec![]),
                    ..RunEnvironment::default()
                },
            )
            .unwrap(),
    )
    .await;
    assert_eq!(failure(&outcome).code, FailureCode::Internal);
    service.shutdown().await;
}
