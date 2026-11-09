//! Claude Code's own sign-in state on a Macro computer, read and cleared
//! through `claude auth`.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use chrono::{DateTime, Utc};
use harnesses::domain::models::ClaudeAccount;
use rootcause::prelude::ResultExt as _;
use serde::Deserialize;

const AUTH_TIMEOUT: Duration = Duration::from_secs(20);

/// The computer's Claude sign-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeAuth(pub ClaudeAccount);

impl ClaudeAuth {
    pub fn is_signed_in(&self) -> bool {
        matches!(self.0, ClaudeAccount::SignedIn { .. })
    }

    pub fn account(&self) -> Option<String> {
        match &self.0 {
            ClaudeAccount::SignedIn { account, .. } => account.clone(),
            ClaudeAccount::SignedOut => None,
        }
    }
}

/// `claude auth status --json`, the fields macrod reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    logged_in: bool,
    #[serde(default)]
    auth_method: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    login_expires_at: Option<DateTime<Utc>>,
}

/// Parse `claude auth status --json`. Only a Claude account login counts:
/// an API key in the environment is not this computer's sign-in.
pub(super) fn parse_status(json: &str) -> rootcause::Result<ClaudeAuth> {
    let status: Status =
        serde_json::from_str(json).context("claude auth status answered unexpectedly")?;
    let claude_account = status.auth_method.as_deref() == Some("claude.ai");
    Ok(ClaudeAuth(if status.logged_in && claude_account {
        ClaudeAccount::SignedIn {
            account: status.email,
            expires_at: status.login_expires_at,
        }
    } else {
        ClaudeAccount::SignedOut
    }))
}

/// The current sign-in, as Claude Code itself sees it.
pub async fn status(claude: &Path) -> rootcause::Result<ClaudeAuth> {
    let output = run(claude, &["auth", "status", "--json"]).await?;
    parse_status(&output)
}

/// Sign Claude Code out on this computer.
pub async fn sign_out(claude: &Path) -> rootcause::Result<()> {
    run(claude, &["auth", "logout"]).await.map(drop)
}

async fn run(claude: &Path, args: &[&str]) -> rootcause::Result<String> {
    let output = tokio::time::timeout(
        AUTH_TIMEOUT,
        tokio::process::Command::new(claude)
            .args(args)
            .env_remove("ANTHROPIC_API_KEY")
            .env_remove("ANTHROPIC_AUTH_TOKEN")
            .env_remove("CLAUDE_CODE_OAUTH_TOKEN")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| rootcause::report!("claude {} timed out", args.join(" ")))?
    .context("could not run claude")?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    // `auth status` exits non-zero when signed out but still prints JSON.
    if !output.status.success() && stdout.trim().is_empty() {
        rootcause::bail!(
            "claude {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(stdout)
}
