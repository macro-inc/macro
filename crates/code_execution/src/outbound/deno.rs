//! Fresh Deno subprocesses with no ambient credentials or I/O permissions.

use crate::domain::*;
use async_trait::async_trait;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    sync::mpsc,
    time::sleep_until,
};
use tokio_util::{
    codec::{FramedRead, LinesCodec},
    sync::CancellationToken,
};

const BOOTSTRAP: &str = include_str!("deno/bootstrap.mjs");
/// Runtime version pinned by the container and checked at startup.
pub const DENO_VERSION: &str = "2.9.6";

/// The supervisor owns process lifecycle; Deno owns the permission boundary.
pub struct DenoRunner {
    binary: PathBuf,
    scratch: PathBuf,
    heap_mb: u32,
}

impl DenoRunner {
    /// Validate runtime availability and prepare a private scratch root.
    #[tracing::instrument(skip_all, err)]
    pub async fn new(
        binary: PathBuf,
        scratch: PathBuf,
        heap_mb: u32,
    ) -> Result<Self, rootcause::Report> {
        if !(32..=1024).contains(&heap_mb) {
            return Err(rootcause::report!(
                "Deno heap must be between 32 and 1024 MiB"
            ));
        }
        let binary = tokio::fs::canonicalize(binary).await?;
        tokio::fs::create_dir_all(&scratch).await?;
        let scratch = tokio::fs::canonicalize(scratch).await?;
        let mut command = Command::new(&binary);
        command.arg("--version").env_clear().kill_on_drop(true);
        let output =
            tokio::time::timeout(std::time::Duration::from_secs(5), command.output()).await??;
        if !output.status.success()
            || !String::from_utf8_lossy(&output.stdout)
                .starts_with(&format!("deno {DENO_VERSION} "))
        {
            return Err(rootcause::report!(
                "code execution requires Deno {DENO_VERSION}"
            ));
        }
        Ok(Self {
            binary,
            scratch,
            heap_mb,
        })
    }

    fn command(&self, root: &Path) -> Command {
        let mut command = Command::new(&self.binary);
        // No APP_SECRETS_JSON, AWS credentials, inspector flags, proxy settings,
        // startup hooks, PATH, or shared caches can reach generated code.
        command
            .env_clear()
            .env("DENO_DIR", root.join("cache"))
            .env("HOME", root.join("home"))
            .env("TMPDIR", root.join("tmp"))
            .env("DENO_NO_UPDATE_CHECK", "1")
            .env("NO_COLOR", "1")
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    async fn execute(
        &self,
        job: &ExecutionJob,
        events: &mut EventSink,
        replies: mpsc::Receiver<HostReply>,
        cancellation: &CancellationToken,
    ) -> Result<Outcome, ExecutionFailure> {
        let directory = tempfile::Builder::new()
            .prefix("run-")
            .tempdir_in(&self.scratch)
            .map_err(internal)?;
        let root = directory.path();
        for path in ["tmp", "home", "cache"] {
            tokio::fs::create_dir(root.join(path))
                .await
                .map_err(internal)?;
        }
        let source = root.join("snippet.ts");
        tokio::fs::write(
            &source,
            format!(
                "async function __code_mode() {{\n{}\n}}\n",
                job.request.source
            ),
        )
        .await
        .map_err(internal)?;
        let bootstrap = root.join("bootstrap.mjs");
        tokio::fs::write(&bootstrap, BOOTSTRAP)
            .await
            .map_err(internal)?;

        // Transpile only; never execute the generated file as an entrypoint.
        // Configuration, dependencies, declarations, and source maps are disabled.
        let mut compiler = self
            .command(root)
            .args([
                "transpile",
                "--no-config",
                "--no-lock",
                "--no-remote",
                "--no-npm",
                "--no-check",
                "--source-map=none",
            ])
            .arg(&source)
            .spawn()
            .map_err(internal)?;
        drop(compiler.stdin.take());
        let stdout = compiler.stdout.take().expect("piped compiler stdout");
        let stderr = compiler.stderr.take().expect("piped compiler stderr");
        let compilation = async {
            let (output, diagnostic, status) = tokio::try_join!(
                read_bounded(stdout, job.limits.max_source_bytes * 4),
                read_bounded(stderr, job.limits.max_frame_bytes),
                async { compiler.wait().await.map_err(internal) },
            )?;
            if !status.success() {
                return Err(ExecutionFailure::new(
                    FailureCode::Compile,
                    String::from_utf8_lossy(&diagnostic),
                ));
            }
            String::from_utf8(output).map_err(internal)
        };
        let compiled = tokio::select! {
            biased;
            _ = cancellation.cancelled() => None,
            _ = events.closed() => None,
            _ = sleep_until(job.deadline) => {
                reap(&mut compiler).await;
                return Ok(Outcome::TimedOut);
            }
            result = compilation => Some(result),
        };
        reap(&mut compiler).await;
        let Some(compiled) = compiled else {
            return Ok(Outcome::Cancelled);
        };
        let compiled = compiled?;

        let mut child = self
            .command(root)
            .args([
                "run",
                "--no-prompt",
                "--no-config",
                "--no-lock",
                "--no-remote",
                "--no-npm",
                "--deny-read",
                "--deny-write",
                "--deny-net",
                "--deny-env",
                "--deny-run",
                "--deny-ffi",
                "--deny-sys",
                "--deny-import",
            ])
            .arg(format!("--v8-flags=--max-old-space-size={}", self.heap_mb))
            .arg(&bootstrap)
            .spawn()
            .map_err(internal)?;
        let stdin = child.stdin.take().expect("piped child stdin");
        let stdout = child.stdout.take().expect("piped child stdout");
        let stderr = child.stderr.take().expect("piped child stderr");
        let execution = async {
            let candidate = bridge(
                compiled,
                stdin,
                stdout,
                stderr,
                replies,
                events,
                &job.limits,
            )
            .await?;
            let status = child.wait().await.map_err(internal)?;
            if !status.success() {
                return Err(ExecutionFailure::new(
                    FailureCode::Runtime,
                    "Deno exited unsuccessfully",
                ));
            }
            Ok(candidate)
        };
        let outcome = tokio::select! {
            biased;
            _ = cancellation.cancelled() => Ok(Outcome::Cancelled),
            _ = sleep_until(job.deadline) => Ok(Outcome::TimedOut),
            result = execution => result,
        };
        reap(&mut child).await;
        // Drop the directory only after both compiler and executor are reaped.
        drop(directory);
        outcome
    }
}

#[async_trait]
impl CodeRunner for DenoRunner {
    async fn run(
        &self,
        job: ExecutionJob,
        events: &mut EventSink,
        replies: mpsc::Receiver<HostReply>,
        cancellation: CancellationToken,
    ) -> Outcome {
        self.execute(&job, events, replies, &cancellation)
            .await
            .unwrap_or_else(Outcome::from)
    }
}

async fn reap(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

fn internal(_error: impl std::fmt::Display) -> ExecutionFailure {
    // Do not send host paths or log user source through infrastructure diagnostics.
    ExecutionFailure::new(FailureCode::Internal, "Deno runner infrastructure failed")
}

async fn read_bounded(
    reader: impl AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>, ExecutionFailure> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(internal)?;
    if bytes.len() > limit {
        return Err(ExecutionFailure::new(
            FailureCode::Limit,
            "compiler output exceeded limit",
        ));
    }
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ChildFrame {
    Log {
        level: LogLevel,
        message: String,
    },
    Progress {
        value: Value,
    },
    Call {
        id: CallId,
        method: String,
        args: Value,
    },
    Result {
        value: Value,
    },
    Error {
        message: String,
    },
}

async fn bridge(
    source: String,
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    mut replies: mpsc::Receiver<HostReply>,
    events: &mut EventSink,
    limits: &Limits,
) -> Result<Outcome, ExecutionFailure> {
    let mut initial =
        serde_json::to_vec(&serde_json::json!({ "source": source })).map_err(internal)?;
    initial.push(b'\n');
    stdin.write_all(&initial).await.map_err(internal)?;
    // Drain stdout while stdin is backpressured. Awaiting a reply write inside
    // the read loop can deadlock when the program is concurrently logging.
    let (write_queue, mut writes) = mpsc::channel::<Vec<u8>>(limits.max_pending_calls);
    let write_replies = async move {
        while let Some(frame) = writes.recv().await {
            stdin.write_all(&frame).await.map_err(internal)?;
        }
        Ok::<_, ExecutionFailure>(())
    };
    tokio::pin!(write_replies);
    let mut stdout = FramedRead::new(
        stdout,
        LinesCodec::new_with_max_length(limits.max_frame_bytes),
    );
    let mut stderr = FramedRead::new(
        stderr,
        LinesCodec::new_with_max_length(limits.max_frame_bytes),
    );
    let mut stdout_open = true;
    let mut stderr_open = true;
    let mut seen = HashSet::new();
    let mut pending = HashSet::new();
    let mut remaining = limits.max_output_bytes;
    let mut outcome = None;
    while stdout_open || stderr_open {
        tokio::select! {
            _ = events.closed() => return Ok(Outcome::Cancelled),
            result = &mut write_replies => {
                result?;
                return Err(internal("host reply writer closed"));
            }
            reply = replies.recv() => {
                let Some(reply) = reply else { return Ok(Outcome::Cancelled) };
                if !pending.remove(&reply.id) {
                    return Err(ExecutionFailure::new(FailureCode::Protocol, "unsolicited host reply"));
                }
                let mut frame = serde_json::to_vec(&reply).map_err(internal)?;
                if frame.len() > limits.max_frame_bytes {
                    return Err(ExecutionFailure::new(FailureCode::Limit, "host reply exceeded frame limit"));
                }
                frame.push(b'\n');
                write_queue.try_send(frame).map_err(|_| ExecutionFailure::new(FailureCode::Limit, "host reply buffer exceeded limit"))?;
            }
            line = stdout.next(), if stdout_open => {
                let Some(line) = line else { stdout_open = false; continue };
                let line = bounded_line(line, &mut remaining)?;
                if outcome.is_some() {
                    return Err(ExecutionFailure::new(FailureCode::Protocol, "output after terminal frame"));
                }
                let frame: ChildFrame = serde_json::from_str(&line).map_err(|_| ExecutionFailure::new(FailureCode::Protocol, "invalid child frame"))?;
                match frame {
                    ChildFrame::Log { level, message } => events.emit(EventKind::Log { level, message })?,
                    ChildFrame::Progress { value } => events.emit(EventKind::Progress { value })?,
                    ChildFrame::Call { id, method, args } => {
                        if method.is_empty() || method.len() > 128 || !method.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) || !seen.insert(id) {
                            return Err(ExecutionFailure::new(FailureCode::Protocol, "invalid or duplicate host call"));
                        }
                        if seen.len() > limits.max_calls || pending.len() >= limits.max_pending_calls {
                            return Err(ExecutionFailure::new(FailureCode::Limit, "host call limit exceeded"));
                        }
                        pending.insert(id);
                        events.emit(EventKind::HostCall { call: HostCall { id, method, args } })?;
                    }
                    ChildFrame::Result { value } => outcome = Some(Outcome::Succeeded { value }),
                    ChildFrame::Error { message } => outcome = Some(ExecutionFailure::new(FailureCode::Runtime, message).into()),
                }
            }
            line = stderr.next(), if stderr_open => {
                let Some(line) = line else { stderr_open = false; continue };
                let message = bounded_line(line, &mut remaining)?;
                events.emit(EventKind::Log { level: LogLevel::Warn, message })?;
            }
        }
    }
    if !pending.is_empty() && matches!(outcome, Some(Outcome::Succeeded { .. })) {
        return Err(ExecutionFailure::new(
            FailureCode::Protocol,
            "program returned with pending host calls",
        ));
    }
    outcome
        .ok_or_else(|| ExecutionFailure::new(FailureCode::Runtime, "Deno exited without a result"))
}

fn bounded_line(
    line: Result<String, tokio_util::codec::LinesCodecError>,
    remaining: &mut usize,
) -> Result<String, ExecutionFailure> {
    let line = line.map_err(|_| {
        ExecutionFailure::new(FailureCode::Limit, "invalid or oversized process output")
    })?;
    *remaining = remaining.checked_sub(line.len() + 1).ok_or_else(|| {
        ExecutionFailure::new(FailureCode::Limit, "process output limit exceeded")
    })?;
    Ok(line)
}

#[cfg(test)]
mod test;
