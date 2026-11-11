//! Claude Code's own sign-in state on a Macro computer, read and cleared
//! through `claude auth`.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::ComputerControlResult;
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

    /// The sign-in result for the control plane, `None` when signed out.
    pub fn signed_in_result(&self) -> Option<ComputerControlResult> {
        match &self.0 {
            ClaudeAccount::SignedIn {
                account_id,
                account,
                organization,
                plan,
                ..
            } => Some(ComputerControlResult::SignedIn {
                account_id: account_id.clone(),
                account: account.clone(),
                organization: organization.clone(),
                plan: plan.clone(),
            }),
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
    #[serde(default)]
    org_name: Option<String>,
    #[serde(default)]
    subscription_type: Option<String>,
}

/// `~/.claude.json`, the field macrod reads: the account's id, which
/// `claude auth status` does not report.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeConfig {
    #[serde(default)]
    oauth_account: Option<OauthAccount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OauthAccount {
    account_uuid: String,
}

/// Parse `claude auth status --json` and `~/.claude.json` (`config`, absent
/// when the file is). Only a Claude account login counts: an API key in the
/// environment is not this computer's sign-in. A Claude login without an
/// account id is an error: the control plane keys accounts by it.
pub(super) fn parse_status(json: &str, config: Option<&str>) -> rootcause::Result<ClaudeAuth> {
    let status: Status =
        serde_json::from_str(json).context("claude auth status answered unexpectedly")?;
    let claude_account = status.auth_method.as_deref() == Some("claude.ai");
    if !(status.logged_in && claude_account) {
        return Ok(ClaudeAuth(ClaudeAccount::SignedOut));
    }
    let config: ClaudeConfig =
        serde_json::from_str(config.ok_or_else(|| {
            rootcause::report!("Claude is signed in but ~/.claude.json is missing")
        })?)
        .context("~/.claude.json is not valid JSON")?;
    let account_id = config
        .oauth_account
        .ok_or_else(|| {
            rootcause::report!("Claude is signed in but ~/.claude.json has no oauthAccount")
        })?
        .account_uuid;
    Ok(ClaudeAuth(ClaudeAccount::SignedIn {
        account_id,
        account: status.email,
        organization: status.org_name,
        plan: status.subscription_type,
        expires_at: status.login_expires_at,
    }))
}

/// The current sign-in, as Claude Code itself sees it.
pub async fn status(claude: &Path) -> rootcause::Result<ClaudeAuth> {
    let output = run(claude, &["auth", "status", "--json"]).await?;
    let config = match std::env::var_os("HOME") {
        Some(home) => {
            match tokio::fs::read_to_string(Path::new(&home).join(".claude.json")).await {
                Ok(config) => Some(config),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    return Err(rootcause::Report::new(error)
                        .context("could not read ~/.claude.json")
                        .into_dynamic());
                }
            }
        }
        None => None,
    };
    parse_status(&output, config.as_deref())
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
