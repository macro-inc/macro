use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/claude/testdata");
const CAPTURED_URL: &str = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=zZqnXHwmWP2UOUEYKGrntM8pcw0_jmCn9Eg8xlA3iRQ&code_challenge_method=S256&state=Vgqcx2pGwkM1iRLxEkOLbdnGn4V2ILZyKhQUhu0rvQE";
const TEST_TOKEN: &str = "sk-ant-oat01-TESTTOKEN-abcdefghijklmnopqrstuvwxyz0123456789";

/// A `claude` that replays the real CLI's captured screens: the URL screen,
/// then the success screen for `good#state`, or the rejection otherwise.
/// It appends each code it reads to `codes.log` and, when `read.fifo`
/// exists, reports reading one through it.
fn stub_claude(directory: &Path) -> PathBuf {
    let script = format!(
        r#"#!/usr/bin/env bash
[ "$1" = setup-token ] || exit 2
env > "{directory}/environment"
cat "{FIXTURES}/setup-token-screen1.raw"
IFS= read -r code
printf '%s\n' "$code" >> "{directory}/codes.log"
[ -p "{directory}/read.fifo" ] && echo read > "{directory}/read.fifo"
case "$code" in
  *good#state*)
    printf '\r\n \xe2\x9c\x93 Long-lived authentication token created successfully!\r\n\r\n Your OAuth token (valid for 1 year):\r\n\r\n {TEST_TOKEN}\r\n\r\n Store this token securely. You won'"'"'t be able to see it again.\r\n\r\n Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\r\n'
    ;;
  *hang#state*)
    read -r never
    ;;
  *)
    cat "{FIXTURES}/setup-token-screen2.raw"
    read -r retry
    ;;
esac
"#,
        directory = directory.display(),
    );
    let path = directory.join("claude");
    std::fs::write(&path, script).expect("the stub");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("executable");
    path
}

fn config(directory: &Path, program: PathBuf) -> ClaudeConfig {
    ClaudeConfig {
        program,
        state_directory: directory.join("state"),
        environment: Vec::new(),
        url_timeout: Duration::from_secs(45),
        code_timeout: Duration::from_secs(60),
        pending_lifetime: Duration::from_secs(600),
        columns: 500,
        rows: 100,
    }
}

fn codes(directory: &Path) -> Vec<String> {
    std::fs::read_to_string(directory.join("codes.log"))
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn a_sign_in_gives_the_url_then_stores_the_token() {
    let directory = tempfile::tempdir().expect("a directory");
    let claude = ClaudeAuth::new(config(directory.path(), stub_claude(directory.path())));

    let url = claude.start().await;
    assert_eq!(url, Ok(CAPTURED_URL.to_owned()));
    assert_eq!(claude.status().await, Ok(AgentStatus::Pending));

    let signed_in = claude.complete("  good#state\n".to_owned()).await;
    let Ok(AgentStatus::SignedIn(Account::Claude(account))) = signed_in else {
        panic!("expected a sign-in, got {signed_in:?}");
    };
    // "sha256:" and 32 hex digits of SHA-256("harnessd claude credential v1\0" + token).
    assert_eq!(
        account.credential_id,
        "sha256:09e9d03dcf4ba47b6635ecbdbc071033"
    );

    let path = directory.path().join("state/claude/credential.json");
    let stored: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).expect("the credential")).expect("json");
    assert_eq!(stored["token"], TEST_TOKEN);
    let created_at = DateTime::parse_from_rfc3339(stored["created_at"].as_str().expect("created"))
        .expect("a time")
        .with_timezone(&Utc);
    let expires_at = DateTime::parse_from_rfc3339(stored["expires_at"].as_str().expect("expires"))
        .expect("a time")
        .with_timezone(&Utc);
    assert_eq!(expires_at, created_at + chrono::Months::new(12));
    assert_eq!(account.expires_at, Some(expires_at));
    assert_eq!(
        std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        std::fs::metadata(directory.path().join("state/claude"))
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    // The bracketed paste, trimmed.
    assert_eq!(
        codes(directory.path()),
        vec!["\u{1b}[200~good#state\u{1b}[201~".to_owned()]
    );
    let environment =
        std::fs::read_to_string(directory.path().join("environment")).expect("environment");
    assert!(
        environment
            .lines()
            .any(|line| line == "TERM=xterm-256color")
    );

    assert_eq!(
        claude.status().await,
        Ok(AgentStatus::SignedIn(Account::Claude(account.clone())))
    );
    // Retrying a complete that already succeeded answers the same.
    assert_eq!(
        claude.complete("good#state".to_owned()).await,
        Ok(AgentStatus::SignedIn(Account::Claude(account)))
    );
    assert_eq!(codes(directory.path()).len(), 1);
}

#[tokio::test]
async fn the_cli_runs_without_credentials_from_the_environment() {
    let directory = tempfile::tempdir().expect("a directory");
    let mut config = config(directory.path(), stub_claude(directory.path()));
    config.environment = vec![
        (
            "ANTHROPIC_BASE_URL".into(),
            "https://gateway.example".into(),
        ),
        ("HARNESSD_TEST_MARKER".into(), "kept".into()),
    ];
    let claude = ClaudeAuth::new(config);

    claude.start().await.expect("a url");

    let environment =
        std::fs::read_to_string(directory.path().join("environment")).expect("environment");
    assert!(
        environment
            .lines()
            .any(|line| line == "HARNESSD_TEST_MARKER=kept")
    );
    for removed in [
        "ANTHROPIC_BASE_URL=",
        "ANTHROPIC_AUTH_TOKEN=",
        "ANTHROPIC_API_KEY=",
        "CLAUDE_CODE_OAUTH_TOKEN=",
    ] {
        assert!(
            !environment.lines().any(|line| line.starts_with(removed)),
            "{removed} reached the CLI"
        );
    }
}

#[tokio::test]
async fn a_rejected_code_closes_the_sign_in() {
    let directory = tempfile::tempdir().expect("a directory");
    let claude = ClaudeAuth::new(config(directory.path(), stub_claude(directory.path())));
    claude.start().await.expect("a url");

    assert_eq!(
        claude.complete("wrong#state".to_owned()).await,
        Err(ErrorKind::InvalidCode)
    );
    assert_eq!(claude.status().await, Ok(AgentStatus::SignedOut));
    assert_eq!(
        claude.complete("good#state".to_owned()).await,
        Err(ErrorKind::NoPendingSignIn)
    );
}

#[tokio::test]
async fn malformed_codes_never_reach_the_cli() {
    let directory = tempfile::tempdir().expect("a directory");
    let claude = ClaudeAuth::new(config(directory.path(), stub_claude(directory.path())));
    claude.start().await.expect("a url");

    for code in [
        "no-separator",
        "two words#state",
        "tab\t#state",
        "escape\u{1b}#state",
        "",
        &format!("{}#state", "a".repeat(512)),
    ] {
        assert_eq!(
            claude.complete(code.to_owned()).await,
            Err(ErrorKind::MalformedCode),
            "{code:?}"
        );
    }
    assert_eq!(codes(directory.path()), Vec::<String>::new());
    assert_eq!(claude.status().await, Ok(AgentStatus::Pending));
}

#[tokio::test]
async fn completing_without_a_sign_in_is_refused() {
    let directory = tempfile::tempdir().expect("a directory");
    let claude = ClaudeAuth::new(config(directory.path(), stub_claude(directory.path())));

    assert_eq!(
        claude.complete("good#state".to_owned()).await,
        Err(ErrorKind::NoPendingSignIn)
    );
    assert_eq!(claude.status().await, Ok(AgentStatus::SignedOut));
}

#[tokio::test]
async fn a_fresh_sign_in_is_reused_and_a_stale_one_replaced() {
    let directory = tempfile::tempdir().expect("a directory");
    let program = directory.path().join("claude");
    std::fs::write(
        &program,
        format!(
            "#!/usr/bin/env bash\necho started >> \"{}/starts.log\"\nprintf 'https://claude.com/cai/oauth/authorize?state=%s\\r\\n\\r\\nPaste code here if prompted >' \"$$\"\nread -r code\n",
            directory.path().display()
        ),
    )
    .expect("the stub");
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).expect("executable");
    let starts = || {
        std::fs::read_to_string(directory.path().join("starts.log"))
            .unwrap_or_default()
            .lines()
            .count()
    };

    let fresh = ClaudeAuth::new(config(directory.path(), program.clone()));
    let first = fresh.start().await.expect("a url");
    assert_eq!(fresh.start().await, Ok(first.clone()));
    assert_eq!(starts(), 1);

    let mut stale_config = config(directory.path(), program);
    stale_config.pending_lifetime = Duration::ZERO;
    let stale = ClaudeAuth::new(stale_config);
    let second = stale.start().await.expect("a url");
    let third = stale.start().await.expect("a url");
    assert_ne!(second, third);
    assert_ne!(first, second);
    assert_eq!(starts(), 3);
}

#[tokio::test]
async fn a_cancel_interrupts_a_waiting_complete() {
    let directory = tempfile::tempdir().expect("a directory");
    let fifo = directory.path().join("read.fifo");
    let made = std::process::Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .expect("mkfifo");
    assert!(made.success());
    let claude = Arc::new(ClaudeAuth::new(config(
        directory.path(),
        stub_claude(directory.path()),
    )));
    claude.start().await.expect("a url");

    let completing = tokio::spawn({
        let claude = Arc::clone(&claude);
        async move { claude.complete("hang#state".to_owned()).await }
    });
    // The stub has read the code, so the complete waits on its answer.
    let reported = tokio::task::spawn_blocking(move || std::fs::read_to_string(fifo))
        .await
        .expect("joined")
        .expect("read the fifo");
    assert_eq!(reported, "read\n");

    assert_eq!(claude.cancel().await, Ok(AgentStatus::SignedOut));
    assert_eq!(completing.await.expect("joined"), Err(ErrorKind::Cancelled));
    assert_eq!(claude.status().await, Ok(AgentStatus::SignedOut));
}

#[tokio::test]
async fn a_cli_that_never_answers_times_out() {
    let directory = tempfile::tempdir().expect("a directory");
    let mut config = config(directory.path(), stub_claude(directory.path()));
    config.code_timeout = Duration::from_millis(300);
    let claude = ClaudeAuth::new(config);
    claude.start().await.expect("a url");

    assert_eq!(
        claude.complete("hang#state".to_owned()).await,
        Err(ErrorKind::Timeout)
    );
    assert_eq!(claude.status().await, Ok(AgentStatus::SignedOut));
}

#[tokio::test]
async fn signing_out_forgets_the_token() {
    let directory = tempfile::tempdir().expect("a directory");
    let claude = ClaudeAuth::new(config(directory.path(), stub_claude(directory.path())));
    claude.start().await.expect("a url");
    claude
        .complete("good#state".to_owned())
        .await
        .expect("signed in");

    assert_eq!(claude.sign_out().await, Ok(()));
    assert_eq!(claude.status().await, Ok(AgentStatus::SignedOut));
    assert!(
        !directory
            .path()
            .join("state/claude/credential.json")
            .exists()
    );
    assert_eq!(claude.sign_out().await, Ok(()));
}

#[tokio::test]
async fn cancelling_while_signed_in_keeps_the_token() {
    let directory = tempfile::tempdir().expect("a directory");
    let claude = ClaudeAuth::new(config(directory.path(), stub_claude(directory.path())));
    claude.start().await.expect("a url");
    let Ok(signed_in) = claude.complete("good#state".to_owned()).await else {
        panic!("expected a sign-in");
    };
    claude.start().await.expect("a second url");

    assert_eq!(claude.status().await, Ok(signed_in.clone()));
    assert_eq!(claude.cancel().await, Ok(signed_in));
}

/// The real, pinned Claude Code's prompts: the URL, then a rejection for a
/// junk code.
#[tokio::test]
#[ignore = "needs network and the pinned Claude Code (HARNESSD_REAL_CLAUDE or /home/wolf/tmp/harnessd/claude-pinned/bin/claude)"]
async fn the_real_cli_gives_a_url_and_rejects_a_junk_code() {
    let program = std::env::var_os("HARNESSD_REAL_CLAUDE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home/wolf/tmp/harnessd/claude-pinned/bin/claude"));
    let directory = tempfile::tempdir().expect("a directory");
    let home = directory.path().join("home");
    std::fs::create_dir(&home).expect("a home");
    let mut config = config(directory.path(), program);
    config.environment = vec![("HOME".into(), home.into_os_string())];
    let claude = ClaudeAuth::new(config);

    let url = claude.start().await.expect("a url");
    println!("url: {url}");
    assert!(url.starts_with("https://claude.com/cai/oauth/authorize?"));

    assert_eq!(
        claude.complete("x#y".to_owned()).await,
        Err(ErrorKind::InvalidCode)
    );
}
