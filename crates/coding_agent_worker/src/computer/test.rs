use serde_json::json;

use super::*;

fn session_new() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "session/new",
        "params": {
            "cwd": "/home/macro/work",
            "mcpServers": [
                { "type": "http", "name": "github", "url": "https://example.test/mcp", "headers": [] },
                {
                    "type": "http",
                    "name": "macro_internal",
                    "url": "https://dev-gateway.macro.com/agent-harness-egress/mcp/internal",
                    "headers": [{ "name": "Authorization", "value": "Bearer egress-token" }]
                }
            ],
            "_meta": { "claudeCode": { "options": { "env": { "KEEP": "me" } } } }
        }
    })
}

#[test]
fn credits_point_claude_code_at_the_gateway_of_the_sessions_internal_mcp() {
    let mut frame = session_new();
    prepare_session(
        &mut frame,
        None,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    assert_eq!(
        frame["params"]["_meta"]["claudeCode"]["options"]["env"],
        json!({
            "KEEP": "me",
            "ANTHROPIC_BASE_URL": "https://dev-gateway.macro.com/agent-harness-egress/anthropic",
            "ANTHROPIC_AUTH_TOKEN": "egress-token",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
        })
    );
}

#[test]
fn a_signed_in_account_replaces_the_gateway() {
    let mut frame = session_new();
    frame["method"] = json!("session/resume");
    frame["params"].as_object_mut().unwrap().remove("_meta");
    prepare_session(
        &mut frame,
        Some("sk-ant-oat01-own"),
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    assert_eq!(
        frame["params"]["_meta"],
        json!({ "claudeCode": { "options": { "env": {
            "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-own"
        } } } })
    );
}

#[test]
fn only_session_starts_are_touched() {
    let mut prompt = json!({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "session/prompt",
        "params": { "sessionId": "s", "prompt": [] }
    });
    let before = prompt.clone();
    prepare_session(
        &mut prompt,
        Some("sk-ant-oat01-own"),
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    assert_eq!(prompt, before);

    // Without the internal MCP server there is no gateway to point at.
    let mut bare = json!({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "session/load",
        "params": { "sessionId": "s", "cwd": "/", "mcpServers": [] }
    });
    let before = bare.clone();
    assert!(
        prepare_session(
            &mut bare,
            None,
            std::path::Path::new("/home/macro/work"),
            None
        )
        .is_err()
    );
    assert_eq!(bare, before);
}

#[test]
fn each_attach_refreshes_credentials_and_switches_modes_without_old_env() {
    let mut frame = session_new();
    prepare_session(
        &mut frame,
        None,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    prepare_session(
        &mut frame,
        Some("own-account-token"),
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    let env = &frame["params"]["_meta"]["claudeCode"]["options"]["env"];
    assert_eq!(env["CLAUDE_CODE_OAUTH_TOKEN"], "own-account-token");
    assert!(env.get("ANTHROPIC_AUTH_TOKEN").is_none());
    assert!(env.get("ANTHROPIC_BASE_URL").is_none());

    frame["method"] = json!("session/load");
    frame["params"]["mcpServers"][1]["headers"][0]["value"] = json!("Bearer fresh-token");
    prepare_session(
        &mut frame,
        None,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    let env = &frame["params"]["_meta"]["claudeCode"]["options"]["env"];
    assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "fresh-token");
    assert!(env.get("CLAUDE_CODE_OAUTH_TOKEN").is_none());
}

#[cfg(unix)]
mod sign_in {
    use std::os::unix::fs::PermissionsExt as _;

    use super::super::claude_sign_in::{
        CompleteError, Pasted, SignIn, oauth_token, sign_in_url, strip_terminal_codes,
    };

    const URL: &str = "https://claude.ai/oauth/authorize?code=true&client_id=9d1c&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&state=abc";

    #[test]
    fn the_sign_in_url_and_token_are_found_through_terminal_codes() {
        let output = format!(
            "\x1b[2J\x1b[1;1H\x1b[36mBrowser didn't open? Use the url below\x1b[39m\r\n\x1b]8;;{URL}\x07{URL}\x1b]8;;\x07\r\n\x1b[?25lPaste code here if prompted >"
        );
        assert_eq!(sign_in_url(&output).as_deref(), Some(URL));
        assert_eq!(sign_in_url("Opening browser…"), None);

        let done = "\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\n\x1b[1msk-ant-oat01-AbC_d-123456789012345678901234\x1b[22m\r\n";
        assert_eq!(
            oauth_token(done).as_deref(),
            Some("sk-ant-oat01-AbC_d-123456789012345678901234")
        );
        assert_eq!(oauth_token("sk-ant-oat01-short"), None);
        assert_eq!(
            oauth_token("sk-ant-oat01-AbC_d-123456789012345678901234"),
            None
        );
        assert_eq!(
            sign_in_url("https://claude.ai/oauth/authorize?code=true"),
            None
        );
        assert_eq!(strip_terminal_codes("\x1b[1mbold\x1b[22m"), "bold");
    }

    #[tokio::test]
    async fn rejected_codes_finish_before_the_token_timeout() {
        for transcript in [
            "\x1b[31mInvalid code. Please make sure the full code was copied\x1b[39m\r\n",
            "\x1b[31mOAuth error: access_denied\x1b[39m\r\n",
            "Authentication failed: Invalid authorization code\r\n",
            "OAuth state mismatch\r\n",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let claude = directory.path().join("claude");
            let script = format!(
                "#!/bin/sh\nprintf 'https://claude.ai/oauth/authorize?code=true\\n'\nIFS= read -r code\nprintf '%s' '{transcript}'\nIFS= read -r hold\n"
            );
            std::fs::write(&claude, script).unwrap();
            std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
            let mut sign_in = SignIn::spawn(&claude).unwrap();
            sign_in.url().await.unwrap();
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                sign_in.complete("bad-code"),
            )
            .await;
            assert!(result.is_ok(), "rejection waited for the token timeout");
            assert!(matches!(result.unwrap(), Err(CompleteError::InvalidCode)));
        }
    }

    #[tokio::test]
    async fn silent_setup_token_times_out_after_sixty_seconds() {
        let directory = tempfile::tempdir().unwrap();
        let claude = directory.path().join("claude");
        std::fs::write(&claude, "#!/bin/sh\nprintf 'https://claude.ai/oauth/authorize?code=true\\n'\nIFS= read -r code\nIFS= read -r hold\n").unwrap();
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut sign_in = SignIn::spawn(&claude).unwrap();
        sign_in.url().await.unwrap();
        tokio::time::pause();
        let before = tokio::time::Instant::now();
        let error = sign_in.complete("test-code").await.unwrap_err();
        assert!(matches!(error, CompleteError::Timeout));
        assert_eq!(before.elapsed().as_secs(), 60);
    }

    #[test]
    fn pasted_codes_and_localhost_callbacks_are_told_apart() {
        assert_eq!(
            Pasted::parse("  AbCdEf123#state-xyz \n").unwrap(),
            Pasted::Code("AbCdEf123#state-xyz".to_owned())
        );
        let callback = "http://localhost:54545/callback?code=AbC&state=xyz";
        assert_eq!(
            Pasted::parse(callback).unwrap(),
            Pasted::Callback(callback.parse().unwrap())
        );
        assert!(matches!(
            Pasted::parse("http://127.0.0.1:1/callback?code=x").unwrap(),
            Pasted::Callback(_)
        ));
        assert!(matches!(
            Pasted::parse("http://localhost:54545/oauth/complete?code=AbC").unwrap(),
            Pasted::Callback(_)
        ));
        for bad in [
            "",
            "two words",
            "https://localhost:54545/callback?code=AbC",
            "http://evil.example/callback?code=AbC",
            "http://localhost:54545/callback?code=",
            "http://localhost/callback?code=AbC",
            "http://user@localhost:54545/callback?code=AbC",
            "http://localhost:54545/callback?state=xyz",
        ] {
            assert!(Pasted::parse(bad).is_err(), "`{bad}` was accepted");
        }
    }

    #[test]
    fn token_storage_is_private_and_replaces_without_following_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let token = directory.path().join("claude-token");
        let unrelated = directory.path().join("unrelated");
        std::fs::write(&unrelated, "keep").unwrap();
        std::os::unix::fs::symlink(&unrelated, &token).unwrap();
        crate::enroll::write_private(&token, "private-token\n").unwrap();
        assert_eq!(std::fs::read_to_string(&unrelated).unwrap(), "keep");
        assert_eq!(std::fs::read_to_string(&token).unwrap(), "private-token\n");
        assert_eq!(
            std::fs::metadata(&token).unwrap().permissions().mode() & 0o777,
            0o600
        );
        crate::enroll::write_private(&token, "replacement\n").unwrap();
        assert_eq!(std::fs::read_to_string(&token).unwrap(), "replacement\n");
    }

    /// A stand-in for `claude setup-token`: needs a terminal, prints the URL,
    /// reads one line, and prints a token made from it.
    const FAKE_SETUP_TOKEN: &str = r#"#!/bin/sh
[ "$1" = "setup-token" ] || exit 2
[ -t 0 ] && [ -t 1 ] || { echo "not a terminal"; exit 3; }
printf '\033[36mVisit https://claude.ai/oauth/authorize?code=true&state=s1\033[39m\r\n'
printf 'Paste code here if prompted > '
IFS= read -r code
code=$(printf '%s' "$code" | tr -d '\r')
printf '\r\nYour OAuth token:\r\n\033[1msk-ant-oat01-%s-abcdefghijklmnopqrstuvwxyz\033[22m\r\n' "$code"
IFS= read -r hold
"#;

    #[tokio::test]
    async fn sign_in_drives_setup_token_on_a_hidden_terminal() {
        let directory = tempfile::tempdir().unwrap();
        let claude = directory.path().join("claude");
        std::fs::write(&claude, FAKE_SETUP_TOKEN).unwrap();
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();

        let mut sign_in = SignIn::spawn(&claude).unwrap();
        assert_eq!(
            sign_in.url().await.unwrap(),
            "https://claude.ai/oauth/authorize?code=true&state=s1"
        );
        assert_eq!(
            sign_in.complete("pasted42").await.unwrap(),
            "sk-ant-oat01-pasted42-abcdefghijklmnopqrstuvwxyz"
        );
    }
}

#[test]
fn computer_sessions_use_the_guest_workspace_and_egress_route() {
    for method in SESSION_METHODS {
        let mut frame = session_new();
        frame["method"] = json!(method);
        frame["params"]["cwd"] = json!("/workspace");
        frame["params"]["mcpServers"].as_array_mut().unwrap().push(json!({
            "type": "http", "name": "macro-preview", "url": "https://dev-gateway.macro.com/agent-harness-egress/mcp-preview", "headers": []
        }));
        prepare_session(
            &mut frame,
            None,
            std::path::Path::new("/home/macro/work"),
            Some("http://10.210.0.1:41027/"),
        )
        .unwrap();
        assert_eq!(frame["params"]["cwd"], "/home/macro/work");
        assert_eq!(
            frame["params"]["mcpServers"][0]["url"],
            "https://example.test/mcp"
        );
        assert_eq!(
            frame["params"]["mcpServers"][1]["url"],
            "http://10.210.0.1:41027/mcp/internal"
        );
        assert_eq!(
            frame["params"]["mcpServers"][2]["url"],
            "http://10.210.0.1:41027/mcp-preview"
        );
        assert_eq!(
            frame["params"]["_meta"]["claudeCode"]["options"]["env"]["ANTHROPIC_BASE_URL"],
            "http://10.210.0.1:41027/anthropic"
        );
        assert_eq!(
            frame["params"]["_meta"]["claudeCode"]["options"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            "egress-token"
        );
    }
    let mut explicit = session_new();
    prepare_session(
        &mut explicit,
        None,
        std::path::Path::new("/home/macro/other"),
        None,
    )
    .unwrap();
    assert_eq!(explicit["params"]["cwd"], "/home/macro/work");
}

#[cfg(unix)]
mod sign_in_lifecycle {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    fn computer(claude: PathBuf) -> Computer {
        Computer {
            workspace: PathBuf::from("/tmp"),
            egress_url: None,
            token_store: token_store::TokenStore::new(),
            oauth_token: RwLock::new(None),
            claude_program: claude,
            sign_in: tokio::sync::Mutex::new(None),
            sign_in_cancel: RwLock::new(CancellationToken::new()),
            cancel: CancellationToken::new(),
        }
    }

    #[tokio::test]
    async fn failed_sign_in_kills_setup_token_immediately() {
        let directory = tempfile::tempdir().unwrap();
        let claude = directory.path().join("claude");
        let pid_path = directory.path().join("pid");
        std::fs::write(&claude, format!("#!/bin/sh\necho $$ > '{}'\nprintf 'https://claude.ai/oauth/authorize?code=true\\n'\nIFS= read -r code\nprintf 'Invalid code. Please make sure the full code was copied\\n'\nIFS= read -r hold\n", pid_path.display())).unwrap();
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
        let computer = computer(claude);
        computer.start_sign_in().await.unwrap();
        let pid = rustix::process::Pid::from_raw(
            std::fs::read_to_string(pid_path)
                .unwrap()
                .trim()
                .parse()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            computer
                .run(ComputerCommand::ClaudeSignInComplete {
                    code: "bad-code".to_owned()
                })
                .await,
            ComputerControlResult::InvalidCode
        );
        assert!(computer.sign_in.lock().await.is_none());
        assert_eq!(
            rustix::process::test_kill_process(pid),
            Err(rustix::io::Errno::SRCH)
        );
    }

    #[tokio::test]
    async fn cancel_sign_in_kills_setup_token_even_during_submission() {
        let directory = tempfile::tempdir().unwrap();
        let claude = directory.path().join("claude");
        let pid_path = directory.path().join("pid");
        let submitted = directory.path().join("submitted");
        rustix::fs::mkfifoat(
            rustix::fs::CWD,
            &submitted,
            rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        )
        .unwrap();
        std::fs::write(&claude, format!("#!/bin/sh\necho $$ > '{}'\nprintf 'https://claude.ai/oauth/authorize?code=true\\n'\nIFS= read -r code\nprintf submitted > '{}'\nIFS= read -r hold\n", pid_path.display(), submitted.display())).unwrap();
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
        let computer = Arc::new(computer(claude));
        computer.start_sign_in().await.unwrap();
        let pid = rustix::process::Pid::from_raw(
            std::fs::read_to_string(pid_path)
                .unwrap()
                .trim()
                .parse()
                .unwrap(),
        )
        .unwrap();
        let input_seen = tokio::task::spawn_blocking(move || std::fs::read(submitted).unwrap());
        let pending = Arc::clone(&computer);
        let complete = tokio::spawn(async move {
            pending
                .run(ComputerCommand::ClaudeSignInComplete {
                    code: "test-code".to_owned(),
                })
                .await
        });
        assert_eq!(input_seen.await.unwrap(), b"submitted");
        let cancel =
            serde_json::from_value(serde_json::json!({"command": "claude_sign_in_cancel"}))
                .unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), computer.run(cancel))
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({"status": "sign_in_cancelled"})
        );
        assert_eq!(
            serde_json::to_value(complete.await.unwrap()).unwrap(),
            serde_json::json!({"status": "sign_in_cancelled"})
        );
        assert!(computer.sign_in.lock().await.is_none());
        assert_eq!(
            rustix::process::test_kill_process(pid),
            Err(rustix::io::Errno::SRCH)
        );
    }
}

#[cfg(unix)]
mod sign_in_persistence {
    use super::*;
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    };
    use tokio::sync::Notify;

    struct PausedTokenStore {
        persisted: Mutex<Option<String>>,
        started: Notify,
        resume: Notify,
        first_save: AtomicBool,
    }

    impl SignInTokenStore for PausedTokenStore {
        async fn store(&self, token: Option<&str>) -> rootcause::Result<()> {
            *self.persisted.lock().unwrap() = token.map(str::to_owned);
            if self.first_save.swap(false, Ordering::SeqCst) {
                self.started.notify_one();
                self.resume.notified().await;
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn cancellation_during_token_save_restores_the_previous_account() {
        for previous in [None, Some("previous-private-token")] {
            let store = PausedTokenStore {
                persisted: Mutex::new(previous.map(str::to_owned)),
                started: Notify::new(),
                resume: Notify::new(),
                first_save: AtomicBool::new(true),
            };
            let cancel = CancellationToken::new();
            let (result, ()) = tokio::join!(
                persist_sign_in(&store, &cancel, "new-private-token", previous),
                async {
                    store.started.notified().await;
                    cancel.cancel();
                    store.resume.notify_one();
                }
            );
            assert_eq!(result.unwrap(), ComputerControlResult::SignInCancelled);
            assert_eq!(
                *store.persisted.lock().unwrap(),
                previous.map(str::to_owned)
            );
        }
    }
}
