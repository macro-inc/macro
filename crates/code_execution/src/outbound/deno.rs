//! Fresh JavaScript processes with run-only credentials and allowlisted API egress.

use crate::domain::*;
use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, Command},
    time::sleep_until,
};
use tokio_util::{
    codec::{FramedRead, LinesCodec},
    sync::CancellationToken,
};

const BOOTSTRAP: &str = include_str!("deno/bootstrap.mjs");
const TIMERS: &str = include_str!("deno/timers.mjs");
/// Node timer and worker modules resolve to timers.mjs, which refuses to
/// sleep; see bootstrap.mjs.
const IMPORTS: &str = r#"{"imports":{"@macro-inc/sdk":"./sdk.mjs","handlebars":"./handlebars.mjs","node:timers":"./timers.mjs","node:timers/promises":"./timers.mjs","node:worker_threads":"./timers.mjs","timers":"./timers.mjs","timers/promises":"./timers.mjs","worker_threads":"./timers.mjs"}}"#;
/// An unattended program's requests go through the bootstrap's `fetch`, where
/// a dry run holds back writes, so the Node modules that open their own
/// connections or threads resolve to a module that doesn't exist. Timers
/// refuse to sleep, as above.
const UNATTENDED_IMPORTS: &str = r#"{"imports":{"@macro-inc/sdk":"./sdk.mjs","node:timers":"./timers.mjs","node:timers/promises":"./timers.mjs","timers":"./timers.mjs","timers/promises":"./timers.mjs","node:net":"./unavailable.mjs","node:tls":"./unavailable.mjs","node:http":"./unavailable.mjs","node:https":"./unavailable.mjs","node:http2":"./unavailable.mjs","node:dgram":"./unavailable.mjs","node:worker_threads":"./unavailable.mjs","worker_threads":"./unavailable.mjs","node:child_process":"./unavailable.mjs","node:cluster":"./unavailable.mjs","node:inspector":"./unavailable.mjs"}}"#;
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
        let binary = pinned_deno(binary).await?;
        tokio::fs::create_dir_all(&scratch).await?;
        let scratch = tokio::fs::canonicalize(scratch).await?;
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
        // An unattended program is TypeScript; Deno strips its types on load.
        let program = if job.environment.unattended.is_some() {
            "main.ts"
        } else {
            "main.mjs"
        };
        tokio::fs::write(root.join(program), &job.request.source)
            .await
            .map_err(internal)?;
        let bootstrap = root.join("bootstrap.mjs");
        tokio::fs::write(&bootstrap, BOOTSTRAP)
            .await
            .map_err(internal)?;
        tokio::fs::write(root.join("sdk.mjs"), code_mode_assets::SDK)
            .await
            .map_err(internal)?;
        tokio::fs::write(root.join("handlebars.mjs"), code_mode_assets::HANDLEBARS)
            .await
            .map_err(internal)?;
        tokio::fs::write(root.join("timers.mjs"), TIMERS)
            .await
            .map_err(internal)?;
        tokio::fs::write(
            root.join("imports.json"),
            if job.environment.unattended.is_some() {
                UNATTENDED_IMPORTS
            } else {
                IMPORTS
            },
        )
        .await
        .map_err(internal)?;
        let mut destinations = std::collections::BTreeSet::new();
        for base in job.environment.endpoints.hosts.values() {
            let url = url::Url::parse(base).map_err(internal)?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(internal("invalid SDK destination"));
            }
            let host = url.host_str().ok_or_else(|| internal("missing SDK host"))?;
            destinations.insert(format!(
                "{host}:{}",
                url.port_or_known_default()
                    .ok_or_else(|| internal("missing SDK port"))?
            ));
        }
        let network = if destinations.is_empty() {
            "--deny-net".to_owned()
        } else {
            format!(
                "--allow-net={}",
                destinations.into_iter().collect::<Vec<_>>().join(",")
            )
        };
        let mut child = self
            .command(root)
            .args([
                "run",
                "--no-prompt",
                "--no-config",
                "--no-lock",
                "--no-remote",
                "--no-npm",
                "--deny-write",
                "--deny-env",
                "--deny-run",
                "--deny-ffi",
                "--deny-sys",
                "--deny-import",
            ])
            .arg(network)
            .arg(format!("--allow-read={}", root.display()))
            .arg(format!(
                "--import-map={}",
                root.join("imports.json").display()
            ))
            .arg(format!("--v8-flags=--max-old-space-size={}", self.heap_mb))
            .arg(&bootstrap)
            .spawn()
            .map_err(internal)?;
        if let Err(error) = limit(&child, &job.limits) {
            reap(&mut child).await;
            return Err(error);
        }
        let stdin = child.stdin.take().expect("piped child stdin");
        let stdout = child.stdout.take().expect("piped child stdout");
        let stderr = child.stderr.take().expect("piped child stderr");
        let execution = async {
            let candidate =
                bridge(&job.environment, stdin, stdout, stderr, events, &job.limits).await?;
            // Both streams have closed, so the process is exiting.
            let status = child.wait().await.map_err(internal)?;
            if std::os::unix::process::ExitStatusExt::signal(&status)
                == Some(rustix::process::Signal::XCPU.as_raw())
            {
                return Err(ExecutionFailure::new(
                    FailureCode::Limit,
                    "the program used up its CPU time",
                ));
            }
            let candidate = candidate.ok_or_else(|| {
                ExecutionFailure::new(FailureCode::Runtime, "Deno exited without a result")
            })?;
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
        // Drop the directory only after the process is reaped.
        drop(directory);
        outcome
    }
}

/// The canonical path of `binary`, once it has proved to be the pinned Deno.
async fn pinned_deno(binary: PathBuf) -> Result<PathBuf, rootcause::Report> {
    let binary = tokio::fs::canonicalize(binary).await?;
    let mut command = Command::new(&binary);
    command.arg("--version").env_clear().kill_on_drop(true);
    let output =
        tokio::time::timeout(std::time::Duration::from_secs(5), command.output()).await??;
    if !output.status.success()
        || !String::from_utf8_lossy(&output.stdout).starts_with(&format!("deno {DENO_VERSION} "))
    {
        return Err(rootcause::report!(
            "code execution requires Deno {DENO_VERSION}"
        ));
    }
    Ok(binary)
}

#[async_trait]
impl CodeRunner for DenoRunner {
    async fn run(
        &self,
        job: ExecutionJob,
        events: &mut EventSink,
        cancellation: CancellationToken,
    ) -> Outcome {
        self.execute(&job, events, &cancellation)
            .await
            .unwrap_or_else(Outcome::from)
    }
}

/// Apply the per-process limits to a child that has just started.
fn limit(child: &Child, limits: &Limits) -> Result<(), ExecutionFailure> {
    let pid = child
        .id()
        .and_then(|id| i32::try_from(id).ok())
        .and_then(rustix::process::Pid::from_raw)
        .ok_or_else(|| internal("child has no pid"))?;
    if let Some(cpu) = limits.max_cpu {
        // The soft limit sends SIGXCPU, which stops Deno; the hard limit a
        // second later is the kernel's SIGKILL backstop.
        let seconds = cpu.as_secs();
        rustix::process::prlimit(
            Some(pid),
            rustix::process::Resource::Cpu,
            rustix::process::Rlimit {
                current: Some(seconds),
                maximum: Some(seconds + 1),
            },
        )
        .map_err(internal)?;
    }
    if limits.background {
        rustix::process::setpriority_process(Some(pid), BACKGROUND_NICENESS).map_err(internal)?;
    }
    Ok(())
}

/// Niceness of background programs: below the host, above idle work.
const BACKGROUND_NICENESS: i32 = 10;

async fn reap(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

fn internal(_error: impl std::fmt::Display) -> ExecutionFailure {
    // Do not send host paths or log user source through infrastructure diagnostics.
    ExecutionFailure::new(FailureCode::Internal, "Deno runner infrastructure failed")
}

/// The first stdin line: run credentials plus bootstrap-only settings.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChildContext<'a> {
    #[serde(flatten)]
    environment: &'a RunEnvironment,
    max_result_bytes: usize,
    max_calls_per_operation: u32,
    /// For an unattended program, the catalog a dry run tells reads from
    /// writes with, both for SDK operations and the requests they send.
    #[serde(skip_serializing_if = "Option::is_none")]
    operations: Option<&'static [CatalogEntry]>,
}

#[derive(Serialize)]
struct CatalogEntry {
    key: &'static str,
    method: &'static str,
    path: &'static str,
    write: bool,
}

static CATALOG: std::sync::LazyLock<Vec<CatalogEntry>> = std::sync::LazyLock::new(|| {
    operations()
        .iter()
        .map(|(key, operation)| CatalogEntry {
            key,
            method: &operation.method,
            path: &operation.path,
            write: operation.write,
        })
        .collect()
});

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
    Result {
        value: Value,
        /// Set when the bootstrap summarized an oversized result of this size.
        #[serde(default)]
        summarized_from_bytes: Option<usize>,
    },
    Error {
        message: String,
    },
}

async fn bridge(
    environment: &RunEnvironment,
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    events: &mut EventSink,
    limits: &Limits,
) -> Result<Option<Outcome>, ExecutionFailure> {
    let mut initial = serde_json::to_vec(&ChildContext {
        environment,
        max_result_bytes: limits.max_result_bytes,
        max_calls_per_operation: limits.max_calls_per_operation,
        operations: environment.unattended.as_ref().map(|_| CATALOG.as_slice()),
    })
    .map_err(internal)?;
    initial.push(b'\n');
    stdin.write_all(&initial).await.map_err(internal)?;
    // Credentials travel once through the private pipe, never argv or a file.
    drop(stdin);
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
    let mut remaining = limits.max_output_bytes;
    // Reserve bounded observer overhead so SDK diagnostics do not consume the
    // program's existing stdout/stderr allowance.
    let mut remaining_progress = 64 * 1024;
    let mut remaining_total = remaining + remaining_progress;
    let mut outcome = None;
    while stdout_open || stderr_open {
        tokio::select! {
            _ = events.closed() => return Ok(Some(Outcome::Cancelled)),
            line = stdout.next(), if stdout_open => {
                let Some(line) = line else { stdout_open = false; continue };
                let raw = bounded_line(frame_line(line, limits.max_frame_bytes)?, &mut remaining_total)?;
                let line = redact_token(raw.clone(), &environment.token);
                if outcome.is_some() {
                    return Err(ExecutionFailure::new(FailureCode::Protocol, "output after terminal frame"));
                }
                let frame: ChildFrame = serde_json::from_str(&line).map_err(|_| ExecutionFailure::new(FailureCode::Protocol, "invalid child frame"))?;
                let budget = if matches!(&frame, ChildFrame::Progress { .. }) {
                    &mut remaining_progress
                } else {
                    &mut remaining
                };
                bounded_line(raw, budget)?;
                match frame {
                    ChildFrame::Log { level, message } => events.emit(EventKind::Log { level, message })?,
                    ChildFrame::Progress { value } => events.progress(value),
                    ChildFrame::Result { value, summarized_from_bytes } => {
                        if let Some(bytes) = summarized_from_bytes {
                            tracing::Span::current().record("result_summarized_from_bytes", bytes);
                        }
                        outcome = Some(Outcome::Succeeded { value });
                    }
                    ChildFrame::Error { message } => outcome = Some(ExecutionFailure::new(FailureCode::Runtime, message).into()),
                }
            }
            line = stderr.next(), if stderr_open => {
                let Some(line) = line else { stderr_open = false; continue };
                let raw = bounded_line(frame_line(line, limits.max_frame_bytes)?, &mut remaining_total)?;
                let message = redact_token(bounded_line(raw, &mut remaining)?, &environment.token);
                events.emit(EventKind::Log { level: LogLevel::Warn, message })?;
            }
        }
    }
    Ok(outcome)
}

// Prevent accidental exposure of the credential supplied to this run. The token
// is an ASCII bearer JWT, so replacing it before JSON decoding covers values and
// object keys without changing frame structure. Encoded deliberate disclosure
// is outside this safeguard; the program already holds the user credential.
fn redact_token(line: String, token: &str) -> String {
    if token.is_empty() {
        line
    } else {
        line.replace(token, "[REDACTED]")
    }
}

fn frame_line(
    line: Result<String, tokio_util::codec::LinesCodecError>,
    max_frame_bytes: usize,
) -> Result<String, ExecutionFailure> {
    line.map_err(|error| match error {
        tokio_util::codec::LinesCodecError::MaxLineLengthExceeded => ExecutionFailure::new(
            FailureCode::Limit,
            format!("a single output line exceeded the {max_frame_bytes}-byte frame limit"),
        ),
        tokio_util::codec::LinesCodecError::Io(_) => {
            ExecutionFailure::new(FailureCode::Protocol, "invalid process output")
        }
    })
}

fn bounded_line(line: String, remaining: &mut usize) -> Result<String, ExecutionFailure> {
    *remaining = remaining.checked_sub(line.len() + 1).ok_or_else(|| {
        ExecutionFailure::new(FailureCode::Limit, "process output limit exceeded")
    })?;
    Ok(line)
}

pub mod check;

#[cfg(test)]
mod test;
