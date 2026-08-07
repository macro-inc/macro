//! Utilities for connecting to ACP agents and proxies.
//!
//! This module provides [`AcpAgent`], a convenient wrapper around [`crate::schema::v1::McpServer`]
//! that can be parsed from either a command string or JSON configuration.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

use async_process::Child;
use std::pin::pin;

use crate::schema::v1::{EnvVariable, McpServer as SchemaMcpServer, McpServerStdio};
use crate::{Client, Conductor, Role};

/// Direction of a line being sent or received.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineDirection {
    /// Line being sent to the agent (stdin)
    Stdin,
    /// Line being received from the agent (stdout)
    Stdout,
    /// Line being received from the agent (stderr)
    Stderr,
}

/// A component representing an external ACP agent running in a separate process.
///
/// `AcpAgent` implements the [`ConnectTo`](`crate::ConnectTo`) trait for spawning and communicating with
/// external agents or proxies via stdio. It handles process spawning, stream setup, and
/// byte stream serialization automatically. This is the primary way to connect to agents
/// that run as separate executables.
///
/// This is a wrapper around [`crate::schema::v1::McpServer`] that provides convenient parsing
/// from command-line strings or JSON configurations.
///
/// # Use Cases
///
/// - **External agents**: Connect to agents written in any language (Python, Node.js, Rust, etc.)
/// - **Proxy chains**: Spawn intermediate proxies that transform or intercept messages
/// - **Conductor components**: Use with the conductor to build proxy chains
/// - **Subprocess isolation**: Run potentially untrusted code in a separate process
///
/// # Examples
///
/// Parse from a command string:
/// ```
/// # use agent_client_protocol::AcpAgent;
/// # use std::str::FromStr;
/// let agent = AcpAgent::from_str("python my_agent.py --verbose").unwrap();
/// ```
///
/// Parse from JSON:
/// ```
/// # use agent_client_protocol::AcpAgent;
/// # use std::str::FromStr;
/// let agent = AcpAgent::from_str(r#"{"type": "stdio", "name": "my-agent", "command": "python", "args": ["my_agent.py"], "env": []}"#).unwrap();
/// ```
pub struct AcpAgent {
    server: SchemaMcpServer,
    debug_callback: Option<Arc<dyn Fn(&str, LineDirection) + Send + Sync + 'static>>,
}

impl std::fmt::Debug for AcpAgent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcpAgent")
            .field("server", &self.server)
            .field(
                "debug_callback",
                &self.debug_callback.as_ref().map(|_| "..."),
            )
            .finish()
    }
}

impl AcpAgent {
    /// Create a new `AcpAgent` from an [`crate::schema::v1::McpServer`] configuration.
    #[must_use]
    pub fn new(server: SchemaMcpServer) -> Self {
        Self {
            server,
            debug_callback: None,
        }
    }

    /// Create an ACP agent for the Claude Agent adapter.
    /// Just runs `npx -y @agentclientprotocol/claude-agent-acp@latest`.
    #[must_use]
    pub fn claude_agent() -> Self {
        Self::from_str("npx -y @agentclientprotocol/claude-agent-acp@latest")
            .expect("valid bash command")
    }

    /// Create an ACP agent for the Codex adapter.
    /// Just runs `npx -y @agentclientprotocol/codex-acp@latest`.
    #[must_use]
    pub fn codex() -> Self {
        Self::from_str("npx -y @agentclientprotocol/codex-acp@latest").expect("valid bash command")
    }

    /// Create an ACP agent for Zed Industries' Claude Code tool.
    /// Just runs `npx -y @zed-industries/claude-code-acp@latest`.
    #[deprecated(
        since = "1.2.0",
        note = "the package moved to @agentclientprotocol/claude-agent-acp; use `AcpAgent::claude_agent()` instead"
    )]
    #[must_use]
    pub fn zed_claude_code() -> Self {
        Self::from_str("npx -y @zed-industries/claude-code-acp@latest").expect("valid bash command")
    }

    /// Create an ACP agent for Zed Industries' Codex tool.
    /// Just runs `npx -y @zed-industries/codex-acp@latest`.
    #[deprecated(
        since = "1.2.0",
        note = "the package moved to @agentclientprotocol/codex-acp; use `AcpAgent::codex()` instead"
    )]
    #[must_use]
    pub fn zed_codex() -> Self {
        Self::from_str("npx -y @zed-industries/codex-acp@latest").expect("valid bash command")
    }

    /// Create an ACP agent for Google's Gemini CLI.
    /// Just runs `npx -y -- @google/gemini-cli@latest --experimental-acp`.
    #[must_use]
    pub fn google_gemini() -> Self {
        Self::from_str("npx -y -- @google/gemini-cli@latest --experimental-acp")
            .expect("valid bash command")
    }

    /// Get the underlying [`crate::schema::v1::McpServer`] configuration.
    #[must_use]
    pub fn server(&self) -> &SchemaMcpServer {
        &self.server
    }

    /// Convert into the underlying [`crate::schema::v1::McpServer`] configuration.
    #[must_use]
    pub fn into_server(self) -> SchemaMcpServer {
        self.server
    }

    /// Add a debug callback that will be invoked for each line sent/received.
    ///
    /// The callback receives the line content and the direction (stdin/stdout/stderr).
    /// This is useful for logging, debugging, or monitoring agent communication.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # use agent_client_protocol::{AcpAgent, LineDirection};
    /// # use std::str::FromStr;
    /// let agent = AcpAgent::from_str("python my_agent.py")
    ///     .unwrap()
    ///     .with_debug(|line, direction| {
    ///         eprintln!("{:?}: {}", direction, line);
    ///     });
    /// ```
    #[must_use]
    pub fn with_debug<F>(mut self, callback: F) -> Self
    where
        F: Fn(&str, LineDirection) + Send + Sync + 'static,
    {
        self.debug_callback = Some(Arc::new(callback));
        self
    }

    /// Spawn the process and get stdio streams.
    /// Used internally by the `ConnectTo` trait implementation.
    pub fn spawn_process(
        &self,
    ) -> Result<
        (
            async_process::ChildStdin,
            async_process::ChildStdout,
            async_process::ChildStderr,
            Child,
        ),
        crate::Error,
    > {
        match &self.server {
            SchemaMcpServer::Stdio(stdio) => {
                let mut cmd = async_process::Command::new(&stdio.command);
                cmd.args(&stdio.args);
                for env_var in &stdio.env {
                    cmd.env(&env_var.name, &env_var.value);
                }
                #[cfg(windows)]
                {
                    use async_process::windows::CommandExt as _;

                    cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
                }
                cmd.stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                let mut child = cmd.spawn().map_err(crate::Error::into_internal_error)?;

                let child_stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| crate::util::internal_error("Failed to open stdin"))?;
                let child_stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| crate::util::internal_error("Failed to open stdout"))?;
                let child_stderr = child
                    .stderr
                    .take()
                    .ok_or_else(|| crate::util::internal_error("Failed to open stderr"))?;

                Ok((child_stdin, child_stdout, child_stderr, child))
            }
            SchemaMcpServer::Http(_) => Err(crate::util::internal_error(
                "HTTP transport not yet supported by AcpAgent",
            )),
            SchemaMcpServer::Sse(_) => Err(crate::util::internal_error(
                "SSE transport not yet supported by AcpAgent",
            )),
            _ => Err(crate::util::internal_error(
                "Unknown MCP server transport type",
            )),
        }
    }
}

/// A wrapper around Child that kills the process when dropped.
struct ChildGuard(Child);

impl ChildGuard {
    async fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.0.status().await
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        drop(self.0.kill());
    }
}

/// Waits for a child process and returns an error if it exits with non-zero status.
///
/// The error message includes any stderr output collected concurrently.
/// When dropped, the child process is killed.
async fn monitor_child(
    child: Child,
    stderr_rx: futures::channel::oneshot::Receiver<String>,
) -> Result<(), crate::Error> {
    let mut guard = ChildGuard(child);

    let status = guard
        .wait()
        .await
        .map_err(|e| crate::util::internal_error(format!("Failed to wait for process: {e}")))?;

    if status.success() {
        Ok(())
    } else {
        let stderr = stderr_rx.await.unwrap_or_default();

        let message = if stderr.is_empty() {
            format!("Process exited with {status}")
        } else {
            format!("Process exited with {status}: {stderr}")
        };

        Err(crate::util::internal_error(message))
    }
}

/// Roles that an ACP agent executable can potentially serve.
pub trait AcpAgentCounterpartRole: Role {}

impl AcpAgentCounterpartRole for Client {}

impl AcpAgentCounterpartRole for Conductor {}

impl<Counterpart: AcpAgentCounterpartRole> crate::ConnectTo<Counterpart> for AcpAgent {
    async fn connect_to(
        self,
        client: impl crate::ConnectTo<Counterpart::Counterpart>,
    ) -> Result<(), crate::Error> {
        use futures::io::BufReader;
        use futures::{AsyncBufReadExt, AsyncWriteExt, StreamExt};

        let (child_stdin, child_stdout, child_stderr, child) = self.spawn_process()?;

        // Create a channel to collect stderr for error reporting
        let (stderr_tx, stderr_rx) = futures::channel::oneshot::channel::<String>();

        // Read stderr concurrently, optionally calling the debug callback.
        // We use futures::future::select below to race this against the protocol,
        // so this runs as part of the same task — no tokio::spawn needed.
        let debug_callback = self.debug_callback.clone();
        let stderr_future = async move {
            let stderr_reader = BufReader::new(child_stderr);
            let mut stderr_lines = stderr_reader.lines();
            let mut collected = String::new();
            while let Some(line_result) = stderr_lines.next().await {
                if let Ok(line) = line_result {
                    if let Some(ref callback) = debug_callback {
                        callback(&line, LineDirection::Stderr);
                    }
                    if !collected.is_empty() {
                        collected.push('\n');
                    }
                    collected.push_str(&line);
                }
            }
            drop(stderr_tx.send(collected));
        };

        // Create a future that monitors the child process for early exit
        let child_monitor = monitor_child(child, stderr_rx);

        // Convert stdio to line streams with optional debug inspection
        let incoming_lines: std::pin::Pin<
            Box<dyn futures::Stream<Item = std::io::Result<String>> + Send>,
        > = if let Some(callback) = self.debug_callback.clone() {
            Box::pin(BufReader::new(child_stdout).lines().inspect(move |result| {
                if let Ok(line) = result {
                    callback(line, LineDirection::Stdout);
                }
            }))
        } else {
            Box::pin(BufReader::new(child_stdout).lines())
        };

        // Create a sink that writes lines (with newlines) to stdin with optional debug logging
        let outgoing_sink: std::pin::Pin<
            Box<dyn futures::Sink<String, Error = std::io::Error> + Send>,
        > = if let Some(callback) = self.debug_callback.clone() {
            Box::pin(futures::sink::unfold(
                (child_stdin, callback),
                async move |(mut writer, callback), line: String| {
                    callback(&line, LineDirection::Stdin);
                    let mut bytes = line.into_bytes();
                    bytes.push(b'\n');
                    writer.write_all(&bytes).await?;
                    Ok::<_, std::io::Error>((writer, callback))
                },
            ))
        } else {
            Box::pin(futures::sink::unfold(
                child_stdin,
                async move |mut writer, line: String| {
                    let mut bytes = line.into_bytes();
                    bytes.push(b'\n');
                    writer.write_all(&bytes).await?;
                    Ok::<_, std::io::Error>(writer)
                },
            ))
        };

        // Race the protocol against child process exit.
        // Also run stderr collection concurrently.
        let protocol_future = crate::ConnectTo::<Counterpart>::connect_to(
            crate::Lines::new(outgoing_sink, incoming_lines),
            client,
        );

        let stderr_future = pin!(stderr_future);
        let protocol_future = pin!(protocol_future);
        let child_monitor = pin!(child_monitor);

        // Run stderr reader alongside the main race
        let main_race = async {
            match futures::future::select(protocol_future, child_monitor).await {
                futures::future::Either::Left((result, _))
                | futures::future::Either::Right((result, _)) => result,
            }
        };

        // Run stderr collection concurrently with the main logic.
        // When main_race completes, we don't need stderr anymore.
        let main_race = pin!(main_race);
        match futures::future::select(main_race, stderr_future).await {
            futures::future::Either::Left((result, _)) => result,
            futures::future::Either::Right(((), protocol)) => protocol.await,
        }
    }
}

impl AcpAgent {
    /// Create an `AcpAgent` from an iterator of command-line arguments.
    ///
    /// Leading arguments of the form `NAME=value` are parsed as environment variables.
    /// The first non-env argument is the command, and the rest are arguments.
    ///
    /// # Example
    ///
    /// ```
    /// # use agent_client_protocol::AcpAgent;
    /// let agent = AcpAgent::from_args([
    ///     "RUST_LOG=debug",
    ///     "cargo",
    ///     "run",
    ///     "-p",
    ///     "my-crate",
    /// ]).unwrap();
    /// ```
    pub fn from_args<I, T>(args: I) -> Result<Self, crate::Error>
    where
        I: IntoIterator<Item = T>,
        T: ToString,
    {
        let args: Vec<String> = args.into_iter().map(|s| s.to_string()).collect();

        if args.is_empty() {
            return Err(crate::util::internal_error("Arguments cannot be empty"));
        }

        let mut env = vec![];
        let mut command_idx = 0;

        for (i, arg) in args.iter().enumerate() {
            if let Some((name, value)) = parse_env_var(arg) {
                env.push(EnvVariable::new(name, value));
                command_idx = i + 1;
            } else {
                break;
            }
        }

        if command_idx >= args.len() {
            return Err(crate::util::internal_error(
                "No command found (only environment variables provided)",
            ));
        }

        let command = PathBuf::from(&args[command_idx]);
        let cmd_args = args[command_idx + 1..].to_vec();

        let name = command
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("agent")
            .to_string();

        Ok(AcpAgent {
            server: SchemaMcpServer::Stdio(
                McpServerStdio::new(name, command).args(cmd_args).env(env),
            ),
            debug_callback: None,
        })
    }
}

/// Parse a string as an environment variable assignment (NAME=value).
fn parse_env_var(s: &str) -> Option<(String, String)> {
    let eq_pos = s.find('=')?;
    if eq_pos == 0 {
        return None;
    }

    let name = &s[..eq_pos];
    let value = &s[eq_pos + 1..];

    let mut chars = name.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() && first != '_' {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }

    Some((name.to_string(), value.to_string()))
}

impl FromStr for AcpAgent {
    type Err = crate::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let trimmed = s.trim();

        if trimmed.starts_with('{') {
            let server: SchemaMcpServer = serde_json::from_str(trimmed)
                .map_err(|e| crate::util::internal_error(format!("Failed to parse JSON: {e}")))?;
            return Ok(Self {
                server,
                debug_callback: None,
            });
        }

        let parts = shell_words::split(trimmed)
            .map_err(|e| crate::util::internal_error(format!("Failed to parse command: {e}")))?;

        Self::from_args(parts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_command() {
        let agent = AcpAgent::from_str("python agent.py").unwrap();
        match agent.server {
            SchemaMcpServer::Stdio(stdio) => {
                assert_eq!(stdio.name, "python");
                assert_eq!(stdio.command, PathBuf::from("python"));
                assert_eq!(stdio.args, vec!["agent.py"]);
                assert!(stdio.env.is_empty());
            }
            _ => panic!("Expected Stdio variant"),
        }
    }

    #[test]
    fn test_parse_command_with_args() {
        let agent = AcpAgent::from_str("node server.js --port 8080 --verbose").unwrap();
        match agent.server {
            SchemaMcpServer::Stdio(stdio) => {
                assert_eq!(stdio.name, "node");
                assert_eq!(stdio.command, PathBuf::from("node"));
                assert_eq!(stdio.args, vec!["server.js", "--port", "8080", "--verbose"]);
                assert!(stdio.env.is_empty());
            }
            _ => panic!("Expected Stdio variant"),
        }
    }

    #[test]
    fn test_parse_command_with_quotes() {
        let agent = AcpAgent::from_str(r#"python "my agent.py" --name "Test Agent""#).unwrap();
        match agent.server {
            SchemaMcpServer::Stdio(stdio) => {
                assert_eq!(stdio.name, "python");
                assert_eq!(stdio.command, PathBuf::from("python"));
                assert_eq!(stdio.args, vec!["my agent.py", "--name", "Test Agent"]);
                assert!(stdio.env.is_empty());
            }
            _ => panic!("Expected Stdio variant"),
        }
    }

    #[test]
    fn test_parse_json_stdio() {
        let json = r#"{
            "type": "stdio",
            "name": "my-agent",
            "command": "/usr/bin/python",
            "args": ["agent.py", "--verbose"],
            "env": []
        }"#;
        let agent = AcpAgent::from_str(json).unwrap();
        match agent.server {
            SchemaMcpServer::Stdio(stdio) => {
                assert_eq!(stdio.name, "my-agent");
                assert_eq!(stdio.command, PathBuf::from("/usr/bin/python"));
                assert_eq!(stdio.args, vec!["agent.py", "--verbose"]);
                assert!(stdio.env.is_empty());
            }
            _ => panic!("Expected Stdio variant"),
        }
    }

    #[test]
    fn test_parse_json_http() {
        let json = r#"{
            "type": "http",
            "name": "remote-agent",
            "url": "https://example.com/agent",
            "headers": []
        }"#;
        let agent = AcpAgent::from_str(json).unwrap();
        match agent.server {
            SchemaMcpServer::Http(http) => {
                assert_eq!(http.name, "remote-agent");
                assert_eq!(http.url, "https://example.com/agent");
                assert!(http.headers.is_empty());
            }
            _ => panic!("Expected Http variant"),
        }
    }
}
