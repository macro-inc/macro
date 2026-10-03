//! Native harness setup subprocesses. OAuth credentials stay with the harness.

use std::io::Write as _;
use std::path::Path;
use std::process::Stdio;

use rootcause::prelude::ResultExt as _;
use tokio::io::{AsyncRead, AsyncReadExt as _};

use crate::setup::{SetupCommand, SetupRunner};

pub(crate) struct NativeSetup<'a> {
    pub cwd: &'a Path,
}

impl NativeSetup<'_> {
    fn command(&self, spec: &SetupCommand) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&spec.program);
        command
            .args(&spec.args)
            .envs(&spec.env)
            .current_dir(self.cwd)
            .kill_on_drop(true);
        command
    }
}

impl SetupRunner for NativeSetup<'_> {
    async fn run(&self, spec: &SetupCommand) -> rootcause::Result<()> {
        eprintln!(
            "\nConfiguring Macro MCP: {} {}",
            spec.program,
            spec.args.join(" ")
        );
        let mut child = self
            .command(spec)
            .stdin(Stdio::inherit())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("could not start harness setup; check that its CLI is installed")?;
        // Forward prompts as they arrive (including prompts without a newline).
        // Keep only enough bytes to recognize success, never a log of OAuth output.
        let (stdout_ok, stderr_ok) = tokio::try_join!(
            forward(child.stdout.take().unwrap(), spec.success_text, false),
            forward(child.stderr.take().unwrap(), spec.success_text, true),
        )?;
        let status = child
            .wait()
            .await
            .context("could not wait for harness setup")?;
        if !status.success() || !(stdout_ok || stderr_ok) {
            rootcause::bail!(
                "Macro MCP setup did not complete ({} {}). Check the CLI output and version, then retry.",
                spec.program,
                spec.args.first().map(String::as_str).unwrap_or_default()
            );
        }
        Ok(())
    }

    async fn configured_url(&self, spec: &SetupCommand) -> rootcause::Result<Option<String>> {
        let output = self
            .command(spec)
            .stdin(Stdio::null())
            .output()
            .await
            .context("could not inspect the existing Macro MCP configuration")?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            if stdout.contains("No MCP server found") || stderr.contains("No MCP server found") {
                return Ok(None);
            }
            rootcause::bail!(
                "Could not inspect Macro MCP configuration; check the Claude Code CLI version."
            );
        }
        let url = stdout
            .lines()
            .find_map(|line| line.trim().strip_prefix("URL: "))
            .map(str::to_owned);
        match url {
            Some(url) => Ok(Some(url)),
            None => rootcause::bail!(
                "An incompatible MCP server named macro already exists in Claude Code."
            ),
        }
    }
}

async fn forward(
    mut reader: impl AsyncRead + Unpin,
    success_text: Option<&str>,
    stderr: bool,
) -> std::io::Result<bool> {
    let mut buffer = [0; 4096];
    let mut tail = Vec::new();
    let mut matched = success_text.is_none();
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(matched);
        }
        let bytes = &buffer[..count];
        if stderr {
            let mut output = std::io::stderr().lock();
            output.write_all(bytes)?;
            output.flush()?;
        } else {
            let mut output = std::io::stdout().lock();
            output.write_all(bytes)?;
            output.flush()?;
        }
        if let Some(text) = success_text.filter(|_| !matched) {
            tail.extend_from_slice(bytes);
            matched = tail.windows(text.len()).any(|part| part == text.as_bytes());
            let keep_from = tail.len().saturating_sub(text.len());
            tail.drain(..keep_from);
        }
    }
}

#[cfg(test)]
mod test;
