//! What macrod does on a Macro computer beyond relaying its agent: Claude
//! sign-in and the environment each Claude Code session starts with.
//!
//! A computer starts on Macro credits: every `session/new`, `session/load`
//! and `session/resume` gets Claude Code pointed at Macro's Anthropic gateway,
//! derived from the session's `macro_internal` MCP server. A Claude sign-in
//! (Claude Code's own `/login`, in a herdr pane) leaves its credential where
//! Claude Code keeps it, and sessions opened from then on use that account
//! instead; signing out returns to credits. The env reaches Claude Code
//! through the ACP adapter's `_meta.claudeCode.options.env`.

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use serde_json::{Map, Value};
use tokio_util::sync::CancellationToken;

use crate::config::{Harness, MacroApi};

pub(crate) mod claude_auth;
#[cfg(unix)]
mod claude_sign_in;
mod herdr_pane;
#[cfg(test)]
mod test;

pub(crate) use claude_auth::ClaudeAuth;

/// `agent_harness::domain::model::INTERNAL_MCP_NAME`, which macrod cannot
/// depend on.
const INTERNAL_MCP_NAME: &str = "macro_internal";
/// The `macro_internal` MCP server's path, and the gateway's in its place.
const INTERNAL_MCP_PATH: &str = "/mcp/internal";
const ANTHROPIC_GATEWAY_PATH: &str = "/anthropic";
/// ACP methods that start a Claude Code query.
const SESSION_METHODS: &[&str] = &["session/new", "session/load", "session/resume"];
/// The home directory the sign-in pane opens in.
const SIGN_IN_DIRECTORY: &str = "/home/macro";

/// A Macro computer's runtime-side state, shared by every bridge.
pub struct Computer {
    workspace: PathBuf,
    egress_url: Option<String>,
    /// Claude Code's sign-in, as last read or changed.
    auth: RwLock<ClaudeAuth>,
    /// Woken whenever `auth` changes, so the capability report follows.
    auth_changed: tokio::sync::Notify,
    claude_program: PathBuf,
    herdr: herdr_pane::Herdr,
    #[cfg(unix)]
    sign_in: tokio::sync::Mutex<Option<claude_sign_in::SignIn>>,
    #[cfg(unix)]
    sign_in_cancel: RwLock<CancellationToken>,
    cancel: CancellationToken,
}

impl Computer {
    /// Load the enrolled computer's private state.
    pub async fn load(
        macro_api: &MacroApi,
        harness: &Harness,
        workspace: &std::path::Path,
        cancel: CancellationToken,
    ) -> rootcause::Result<Arc<Self>> {
        // The Claude Code preset names the installed CLI for its adapter.
        let claude_program = harness
            .env
            .get("CLAUDE_CODE_EXECUTABLE")
            .map_or_else(|| PathBuf::from("claude"), PathBuf::from);
        let auth = claude_auth::status(&claude_program)
            .await
            .inspect_err(
                |error| tracing::warn!(error = ?error, "could not read the Claude sign-in"),
            )
            .unwrap_or(ClaudeAuth(
                harnesses::domain::models::ClaudeAccount::SignedOut,
            ));
        Ok(Arc::new(Self {
            workspace: workspace.to_owned(),
            egress_url: macro_api.egress_url.clone(),
            auth: RwLock::new(auth),
            auth_changed: tokio::sync::Notify::new(),
            claude_program,
            herdr: herdr_pane::Herdr::new("herdr"),
            #[cfg(unix)]
            sign_in: tokio::sync::Mutex::new(None),
            #[cfg(unix)]
            sign_in_cancel: RwLock::new(CancellationToken::new()),
            cancel,
        }))
    }

    /// Claude Code's sign-in, as last read or changed.
    pub fn claude_auth(&self) -> ClaudeAuth {
        self.auth
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Read Claude Code's sign-in again, catching expiry or a sign-out made
    /// in a terminal on the computer.
    pub async fn refresh_claude_auth(&self) -> ClaudeAuth {
        match claude_auth::status(&self.claude_program).await {
            Ok(auth) => {
                self.set_auth(auth.clone());
                auth
            }
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the Claude sign-in");
                self.claude_auth()
            }
        }
    }

    /// Wait until the sign-in changes.
    pub async fn claude_auth_changed(&self) {
        self.auth_changed.notified().await;
    }

    fn set_auth(&self, auth: ClaudeAuth) {
        let changed = {
            let mut current = self
                .auth
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let changed = *current != auth;
            *current = auth;
            changed
        };
        if changed {
            self.auth_changed.notify_waiters();
        }
    }

    /// Run one command from the service.
    #[tracing::instrument(name = "macrod.computer.control", skip_all, fields(command = command_name(&command)))]
    pub async fn run(&self, command: ComputerCommand) -> ComputerControlResult {
        let result = match command {
            #[cfg(unix)]
            ComputerCommand::ClaudeSignInStart => self.start_sign_in().await,
            #[cfg(unix)]
            ComputerCommand::ClaudeSignInComplete { code } => self.complete_sign_in(&code).await,
            #[cfg(unix)]
            ComputerCommand::ClaudeSignInCancel => self.cancel_sign_in().await,
            #[cfg(unix)]
            ComputerCommand::ClaudeSignOut => self.sign_out().await,
            #[cfg(not(unix))]
            _ => Err(rootcause::report!("Claude sign-in needs a Unix computer")),
        };
        result.unwrap_or_else(|error| {
            tracing::warn!(error = ?error, "computer command failed");
            ComputerControlResult::Failed {
                message: root_message(&error),
            }
        })
    }

    /// Point a Claude Code session at the signed-in account or the gateway.
    /// Leaves anything but a session-starting request alone.
    pub fn prepare_session(&self, frame: &mut Value) -> rootcause::Result<()> {
        prepare_session(
            frame,
            self.claude_auth().is_signed_in(),
            &self.workspace,
            self.egress_url.as_deref(),
        )
    }

    #[cfg(unix)]
    #[tracing::instrument(name = "macrod.claude.sign_in.start", skip_all, err)]
    async fn start_sign_in(&self) -> rootcause::Result<ComputerControlResult> {
        let mut slot = self.sign_in.lock().await;
        // A new start abandons whatever sign-in was waiting.
        if let Some(previous) = slot.take() {
            previous.close().await;
        }
        let cancel = CancellationToken::new();
        *self
            .sign_in_cancel
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = cancel.clone();
        let mut sign_in = claude_sign_in::SignIn::spawn(
            &self.herdr,
            &self.claude_program,
            std::path::Path::new(SIGN_IN_DIRECTORY),
        )
        .await?;
        let url = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                sign_in.close().await;
                return Ok(ComputerControlResult::SignInCancelled);
            }
            url = sign_in.url() => url?,
        };
        *slot = Some(sign_in);
        Ok(ComputerControlResult::SignInStarted { url })
    }

    #[cfg(unix)]
    #[tracing::instrument(name = "macrod.claude.sign_in.complete", skip_all, err)]
    async fn complete_sign_in(&self, code: &str) -> rootcause::Result<ComputerControlResult> {
        let mut slot = self.sign_in.lock().await;
        if slot.is_none() && self.claude_auth().is_signed_in() {
            return Ok(ComputerControlResult::SignedIn {
                account: self.claude_auth().account(),
            });
        }
        let mut sign_in = slot
            .take()
            .ok_or_else(|| rootcause::report!("no Claude sign-in is waiting; start one first"))?;
        let cancel = self
            .sign_in_cancel
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let completed = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                sign_in.close().await;
                return Ok(ComputerControlResult::SignInCancelled);
            }
            completed = sign_in.complete(code) => completed,
        };
        sign_in.close().await;
        let auth = match completed {
            Ok(auth) => auth,
            Err(claude_sign_in::CompleteError::InvalidCode) => {
                return Ok(ComputerControlResult::InvalidCode);
            }
            Err(error) => return Err(rootcause::report!("{error}")),
        };
        let account = auth.account();
        self.set_auth(auth);
        tracing::info!("Claude account signed in");
        Ok(ComputerControlResult::SignedIn { account })
    }

    #[cfg(unix)]
    async fn cancel_sign_in(&self) -> rootcause::Result<ComputerControlResult> {
        // Signal before locking: complete holds the slot while it waits on Claude.
        self.sign_in_cancel
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .cancel();
        if let Some(sign_in) = self.sign_in.lock().await.take() {
            sign_in.close().await;
        }
        Ok(ComputerControlResult::SignInCancelled)
    }

    #[cfg(unix)]
    #[tracing::instrument(name = "macrod.claude.sign_out", skip_all, err)]
    async fn sign_out(&self) -> rootcause::Result<ComputerControlResult> {
        self.cancel_sign_in().await?;
        claude_auth::sign_out(&self.claude_program).await?;
        self.set_auth(ClaudeAuth(
            harnesses::domain::models::ClaudeAccount::SignedOut,
        ));
        tracing::info!("Claude account signed out");
        Ok(ComputerControlResult::SignedOut)
    }
}

impl Drop for Computer {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

fn command_name(command: &ComputerCommand) -> &'static str {
    match command {
        ComputerCommand::ClaudeSignInStart => "claude_sign_in_start",
        ComputerCommand::ClaudeSignInComplete { .. } => "claude_sign_in_complete",
        ComputerCommand::ClaudeSignInCancel => "claude_sign_in_cancel",
        ComputerCommand::ClaudeSignOut => "claude_sign_out",
    }
}

/// Reports render as decorated trees; the service shows one sentence.
fn root_message(error: &rootcause::Report) -> String {
    format!("{error}")
        .lines()
        .map(|line| line.trim().trim_start_matches('●').trim())
        .find(|line| !line.is_empty() && !line.starts_with('╰'))
        .unwrap_or("the computer command failed")
        .to_owned()
}

/// Merge the session env into a session-starting request's
/// `params._meta.claudeCode.options.env`.
fn prepare_session(
    frame: &mut Value,
    signed_in: bool,
    workspace: &std::path::Path,
    egress_url: Option<&str>,
) -> rootcause::Result<()> {
    let is_session_start = frame
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| SESSION_METHODS.contains(&method));
    if !is_session_start {
        return Ok(());
    }
    let params = frame
        .get_mut("params")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| rootcause::report!("a session start needs params"))?;
    if params.get("cwd").and_then(Value::as_str) == Some("/workspace") {
        params.insert(
            "cwd".to_owned(),
            Value::from(workspace.to_string_lossy().as_ref()),
        );
    }
    if let Some(egress_url) = egress_url {
        route_egress(params, egress_url);
    }
    // Signed in, Claude Code uses its own stored credential: no env at all.
    let env = if signed_in {
        Map::new()
    } else {
        gateway_env(params.get("mcpServers")).ok_or_else(|| {
            rootcause::report!("a computer session needs the macro_internal gateway credentials")
        })?
    };
    let mut target = params;
    for key in ["_meta", "claudeCode", "options", "env"] {
        let next = object_at(target, key).ok_or_else(|| {
            rootcause::report!("could not prepare the Claude session environment")
        })?;
        target = next;
    }
    for key in [
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    ] {
        target.remove(key);
    }
    target.extend(env);
    Ok(())
}

/// The object under `key`, replacing anything that is not one.
fn object_at<'object>(
    object: &'object mut Map<String, Value>,
    key: &str,
) -> Option<&'object mut Map<String, Value>> {
    let entry = object
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    entry.as_object_mut()
}

/// The gateway variables, from the session's `macro_internal` MCP server:
/// its URL with `/mcp/internal` replaced by `/anthropic`, and its bearer.
fn gateway_env(mcp_servers: Option<&Value>) -> Option<Map<String, Value>> {
    let server = mcp_servers?
        .as_array()?
        .iter()
        .find(|server| server.get("name").and_then(Value::as_str) == Some(INTERNAL_MCP_NAME))?;
    let url = server.get("url")?.as_str()?;
    let base = url.strip_suffix(INTERNAL_MCP_PATH)?;
    let bearer = server
        .get("headers")?
        .as_array()?
        .iter()
        .find(|header| {
            header
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case("authorization"))
        })?
        .get("value")?
        .as_str()?
        .strip_prefix("Bearer ")?;
    Some(Map::from_iter([
        (
            "ANTHROPIC_BASE_URL".to_owned(),
            Value::from(format!("{base}{ANTHROPIC_GATEWAY_PATH}")),
        ),
        ("ANTHROPIC_AUTH_TOKEN".to_owned(), Value::from(bearer)),
        (
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_owned(),
            Value::from("1"),
        ),
    ]))
}

/// Keep first-party MCP and inference requests on the enrolled computer route.
fn route_egress(params: &mut Map<String, Value>, egress_url: &str) {
    let Some(servers) = params.get_mut("mcpServers").and_then(Value::as_array_mut) else {
        return;
    };
    let base = servers
        .iter()
        .find(|server| server.get("name").and_then(Value::as_str) == Some(INTERNAL_MCP_NAME))
        .and_then(|server| server.get("url"))
        .and_then(Value::as_str)
        .and_then(|url| url.strip_suffix(INTERNAL_MCP_PATH))
        .map(str::to_owned);
    let Some(base) = base else {
        return;
    };
    for server in servers {
        let Some(url) = server.get("url").and_then(Value::as_str) else {
            continue;
        };
        if let Some(path) = url.strip_prefix(&base).filter(|path| path.starts_with('/')) {
            let routed = format!("{}{path}", egress_url.trim_end_matches('/'));
            server["url"] = Value::from(routed);
        }
    }
}
