use std::os::unix::fs::PermissionsExt as _;

use super::super::test::test_adapter;
use super::*;

const CODEX_RUN: &str = "  Would you like to run the following command?\n\n  $ cargo test -p macrod\n\n› 1. Yes, proceed (y)\n  2. No, and tell Codex what to do differently (esc)\n";
const CODEX_RUN_REMEMBERABLE: &str = "  Would you like to run the following command?\n\n  $ cargo test -p macrod\n\n› 1. Yes, proceed (y)\n  2. Yes, and don't ask again for commands that start with `cargo test` (p)\n  3. No, and tell Codex what to do differently (esc)\n";

/// A herdr whose agent is blocked on the dialog in `screen`, logging keys.
fn fake_herdr(root: &Path) -> (HerdrCli, PathBuf, PathBuf) {
    let screen = root.join("screen");
    let keys = root.join("keys");
    let script = root.join("herdr");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\ncase \"$2\" in\n  get) printf '%s\\n' '{{\"result\":{{\"agent\":{{\"agent_status\":\"blocked\",\"state_change_seq\":1}}}}}}';;\n  read) cat {screen};;\n  send-keys) printf '%s\\n' \"$4\" >> {keys};;\n  *) exit 2;;\nesac\n",
            screen = shell_words::quote(&screen.to_string_lossy()),
            keys = shell_words::quote(&keys.to_string_lossy()),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(&keys, "").unwrap();
    (HerdrCli::new(script, None), screen, keys)
}

fn codex_adapter(
    root: &Path,
) -> (
    Arc<Adapter>,
    mpsc::UnboundedReceiver<Value>,
    PathBuf,
    PathBuf,
) {
    let (herdr, screen, keys) = fake_herdr(root);
    let (mut adapter, output) = test_adapter(root);
    let adapter_mut = Arc::get_mut(&mut adapter).unwrap();
    adapter_mut.herdr = Some(herdr);
    adapter_mut.options.kind = TuiAgent::Codex;
    (adapter, output, screen, keys)
}

fn session(root: &Path) -> Session {
    Session {
        id: "s1".to_owned(),
        cwd: root.to_owned(),
        mcp_servers: Vec::new(),
        model: Mutex::new(DEFAULT_MODEL.to_owned()),
        effort: Mutex::new(None),
        native_id: Mutex::new(None),
        prompt_pending: AtomicBool::new(false),
        live: tokio::sync::Mutex::new(None),
        cancel: Mutex::new(None),
        always_allowed: Mutex::new(std::collections::HashSet::new()),
    }
}

/// Answer the next permission request with `option`, returning the request.
async fn answer_next(
    adapter: &Adapter,
    output: &mut mpsc::UnboundedReceiver<Value>,
    option: &str,
) -> Value {
    let request = output.recv().await.unwrap();
    adapter.answered(
        &request["id"],
        json!({"jsonrpc": "2.0", "id": request["id"], "result": {"outcome": {"outcome": "selected", "optionId": option}}}),
    );
    request
}

#[tokio::test]
async fn always_allowing_a_command_without_a_native_answer_approves_it_for_the_rest_of_the_session()
{
    let root = tempfile::tempdir().unwrap();
    let (adapter, mut output, screen, keys) = codex_adapter(root.path());
    let session = session(root.path());
    let blocked = AtomicU64::new(1);
    std::fs::write(&screen, CODEX_RUN).unwrap();

    let ((), request) = tokio::join!(
        adapter.answer_permission(&session, "macro-s1", None, 1, &blocked),
        answer_next(&adapter, &mut output, "always"),
    );
    assert_eq!(request["method"], "session/request_permission");
    assert_eq!(
        request["params"]["options"],
        json!([
            {"optionId": "allow", "name": "Allow once", "kind": "allow_once"},
            {"optionId": "always", "name": "Always allow `cargo test -p macrod` in this session", "kind": "allow_always"},
            {"optionId": "reject", "name": "Reject", "kind": "reject_once"},
        ])
    );
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), "y\n");

    // The same command again is approved without asking Macro.
    adapter
        .answer_permission(&session, "macro-s1", None, 1, &blocked)
        .await;
    assert!(output.try_recv().is_err());
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), "y\ny\n");

    // A different command still asks.
    std::fs::write(
        &screen,
        CODEX_RUN.replace("cargo test -p macrod", "rm -rf target"),
    )
    .unwrap();
    let ((), request) = tokio::join!(
        adapter.answer_permission(&session, "macro-s1", None, 1, &blocked),
        answer_next(&adapter, &mut output, "reject"),
    );
    assert_eq!(
        request["params"]["options"][1]["name"],
        "Always allow `rm -rf target` in this session"
    );
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), "y\ny\nesc\n");
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn always_allow_presses_the_dialogs_own_dont_ask_again_answer() {
    let root = tempfile::tempdir().unwrap();
    let (adapter, mut output, screen, keys) = codex_adapter(root.path());
    let session = session(root.path());
    let blocked = AtomicU64::new(1);
    std::fs::write(&screen, CODEX_RUN_REMEMBERABLE).unwrap();

    let ((), request) = tokio::join!(
        adapter.answer_permission(&session, "macro-s1", None, 1, &blocked),
        answer_next(&adapter, &mut output, "always"),
    );
    assert_eq!(
        request["params"]["options"][1],
        json!({"optionId": "always", "name": "Yes, and don't ask again for commands that start with `cargo test`", "kind": "allow_always"})
    );
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), "p\n");
    // The native agent remembers it; Macro keeps no standing approval.
    assert!(lock(&session.always_allowed).is_empty());
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn a_dialog_answered_in_the_window_meanwhile_records_no_standing_approval() {
    let root = tempfile::tempdir().unwrap();
    let (adapter, mut output, screen, keys) = codex_adapter(root.path());
    let session = session(root.path());
    let blocked = AtomicU64::new(1);
    std::fs::write(&screen, CODEX_RUN).unwrap();

    let ((), _) = tokio::join!(
        adapter.answer_permission(&session, "macro-s1", None, 1, &blocked),
        async {
            let request = output.recv().await.unwrap();
            std::fs::write(&screen, "a different dialog").unwrap();
            adapter.answered(
                &request["id"],
                json!({"result": {"outcome": {"outcome": "selected", "optionId": "always"}}}),
            );
        },
    );
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), "");
    assert!(lock(&session.always_allowed).is_empty());
    adapter.shutdown.cancel();
}

#[test]
fn claude_code_dialogs_remember_by_the_tool_its_transcript_names() {
    let bash = OpenTool {
        id: "toolu_1".to_owned(),
        title: "ls -la".to_owned(),
        name: Some("Bash".to_owned()),
    };
    let screen = " Bash command\n   ls -la\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No, and tell Claude what to do differently (esc)\n";
    assert_eq!(
        Always::for_dialog(TuiAgent::Claude, Some(&bash), screen),
        Some(Always::Standing {
            tool: "Bash".to_owned(),
            name: "Always allow Bash in this session".to_owned(),
        })
    );
    assert_eq!(Always::for_dialog(TuiAgent::Claude, None, screen), None);
}
