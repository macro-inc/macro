//! What macrod does on a Macro computer beyond relaying its agent: Claude
//! sign-in and the environment each Claude Code session starts with.
//!
//! A computer starts on Macro credits: every `session/new`, `session/load`
//! and `session/resume` gets Claude Code pointed at Macro's Anthropic gateway,
//! derived from the session's `macro_internal` MCP server. After a Claude
//! sign-in the stored OAuth token replaces that, for sessions opened from then
//! on; signing out deletes the token and returns to credits. The env reaches
//! Claude Code through the ACP adapter's `_meta.claudeCode.options.env`.

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use serde_json::{Map, Value};
use tokio_util::sync::CancellationToken;

use crate::config::{Harness, MacroApi};

#[cfg(unix)]
mod claude_sign_in;
#[cfg(unix)]
mod pty;
#[cfg(test)]
mod test;
#[cfg(unix)]
pub(crate) mod token_store;

/// `agent_harness::domain::model::INTERNAL_MCP_NAME`, which macrod cannot
/// depend on.
const INTERNAL_MCP_NAME: &str = "macro_internal";
/// The `macro_internal` MCP server's path, and the gateway's in its place.
const INTERNAL_MCP_PATH: &str = "/mcp/internal";
const ANTHROPIC_GATEWAY_PATH: &str = "/anthropic";
/// ACP methods that start a Claude Code query.
const SESSION_METHODS: &[&str] = &["session/new", "session/load", "session/resume"];

/// A Macro computer's runtime-side state, shared by every bridge.
pub struct Computer {
    workspace: PathBuf,
    egress_url: Option<String>,
    #[cfg(unix)]
    token_store: token_store::TokenStore,
    /// The signed-in Claude account's token, when there is one.
    oauth_token: RwLock<Option<String>>,
    claude_program: PathBuf,
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
        #[cfg(unix)]
        let token_store = token_store::TokenStore::new();
        #[cfg(unix)]
        let oauth_token = token_store.load().await?;
        #[cfg(not(unix))]
        let oauth_token = None;
        // The Claude Code preset names the installed CLI for its adapter.
        let claude_program = harness
            .env
            .get("CLAUDE_CODE_EXECUTABLE")
            .map_or_else(|| PathBuf::from("claude"), PathBuf::from);
        Ok(Arc::new(Self {
            workspace: workspace.to_owned(),
            egress_url: macro_api.egress_url.clone(),
            #[cfg(unix)]
            token_store,
            oauth_token: RwLock::new(oauth_token),
            claude_program,
            #[cfg(unix)]
            sign_in: tokio::sync::Mutex::new(None),
            #[cfg(unix)]
            sign_in_cancel: RwLock::new(CancellationToken::new()),
            cancel,
        }))
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
        let token = self
            .oauth_token
            .read()
            .map(|token| token.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone());
        prepare_session(
            frame,
            token.as_deref(),
            &self.workspace,
            self.egress_url.as_deref(),
        )
    }

    #[cfg(unix)]
    async fn start_sign_in(&self) -> rootcause::Result<ComputerControlResult> {
        let mut slot = self.sign_in.lock().await;
        // A new start abandons whatever sign-in was waiting.
        slot.take();
        let cancel = CancellationToken::new();
        *self
            .sign_in_cancel
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = cancel.clone();
        let mut sign_in = claude_sign_in::SignIn::spawn(&self.claude_program)?;
        let url = tokio::select! {
            biased;
            () = cancel.cancelled() => return Ok(ComputerControlResult::SignInCancelled),
            url = sign_in.url() => url?,
        };
        *slot = Some(sign_in);
        Ok(ComputerControlResult::SignInStarted { url })
    }

    #[cfg(unix)]
    async fn complete_sign_in(&self, code: &str) -> rootcause::Result<ComputerControlResult> {
        let mut slot = self.sign_in.lock().await;
        if slot.is_none()
            && self
                .oauth_token
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_some()
        {
            return Ok(ComputerControlResult::SignedIn);
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
            () = cancel.cancelled() => return Ok(ComputerControlResult::SignInCancelled),
            completed = sign_in.complete(code) => completed,
        };
        let token = match completed {
            Ok(token) => token,
            Err(claude_sign_in::CompleteError::InvalidCode) => {
                return Ok(ComputerControlResult::InvalidCode);
            }
            Err(error) => return Err(rootcause::report!("{error}")),
        };
        let previous = self
            .oauth_token
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let persisted =
            persist_sign_in(&self.token_store, &cancel, &token, previous.as_deref()).await?;
        if matches!(persisted, ComputerControlResult::SignInCancelled) {
            return Ok(persisted);
        }
        slot.take();
        *self
            .oauth_token
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(token);
        tracing::info!("Claude account signed in");
        Ok(ComputerControlResult::SignedIn)
    }

    #[cfg(unix)]
    async fn cancel_sign_in(&self) -> rootcause::Result<ComputerControlResult> {
        // Signal before locking: complete holds the slot while awaiting PTY output.
        self.sign_in_cancel
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .cancel();
        self.sign_in.lock().await.take();
        Ok(ComputerControlResult::SignInCancelled)
    }

    #[cfg(unix)]
    async fn sign_out(&self) -> rootcause::Result<ComputerControlResult> {
        self.cancel_sign_in().await?;
        self.token_store.delete().await?;
        *self
            .oauth_token
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        tracing::info!("Claude account signed out");
        Ok(ComputerControlResult::SignedOut)
    }
}

/// Persistence must finish or compensate before cancellation can be acknowledged.
#[cfg(unix)]
trait SignInTokenStore {
    fn store(&self, token: Option<&str>) -> impl Future<Output = rootcause::Result<()>> + Send;
}

#[cfg(unix)]
impl SignInTokenStore for token_store::TokenStore {
    async fn store(&self, token: Option<&str>) -> rootcause::Result<()> {
        match token {
            Some(token) => self.save(token.to_owned()).await,
            None => self.delete().await,
        }
    }
}

#[cfg(unix)]
async fn persist_sign_in(
    store: &impl SignInTokenStore,
    cancel: &CancellationToken,
    token: &str,
    previous: Option<&str>,
) -> rootcause::Result<ComputerControlResult> {
    store.store(Some(token)).await?;
    if cancel.is_cancelled() {
        store.store(previous).await?;
        return Ok(ComputerControlResult::SignInCancelled);
    }
    Ok(ComputerControlResult::SignedIn)
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
    oauth_token: Option<&str>,
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
    let env = match oauth_token {
        Some(token) => Map::from_iter([("CLAUDE_CODE_OAUTH_TOKEN".to_owned(), Value::from(token))]),
        None => gateway_env(params.get("mcpServers")).ok_or_else(|| {
            rootcause::report!("a computer session needs the macro_internal gateway credentials")
        })?,
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
