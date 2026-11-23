//! A JS tools program's TypeScript module, in its own Deno process: no
//! network (`--deny-net`), no token, no SDK in its import map and no files
//! but its own. The program reads it with `get` and `call`; the bridge
//! relays each as a frame from the program's stdout to the module's stdin,
//! and its reply back on the program's stdin. Nothing else connects the two
//! processes, and the module dies with the run.

use super::{
    BOOTSTRAP_FLAGS, COMPUTE, DenoRunner, TIMERS, UNAVAILABLE, exit, import_map, internal, limit,
};
use crate::domain::*;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{
    io::AsyncWriteExt,
    process::{Child, ChildStderr, ChildStdin, ChildStdout},
};
use tokio_util::codec::{FramedRead, LinesCodec};
use tracing::Instrument as _;

/// Bytes of a frame kept for its envelope beside the value it carries: the
/// most a value may be is the frame limit less this.
const ENVELOPE_BYTES: usize = 1024;

/// The most a value crossing between program and module may be, as JSON.
pub(super) fn max_value_bytes(limits: &Limits) -> usize {
    limits.max_frame_bytes - ENVELOPE_BYTES
}

/// The module's process, which the runner reaps when the run ends.
pub(super) struct ModuleProcess {
    child: Child,
    /// Its scratch directory, dropped once it is reaped.
    _directory: tempfile::TempDir,
    pid: Option<u32>,
    spawned: tokio::time::Instant,
    usage: exit::ProcessUsage,
    /// `code_execution.module`: the process, and each relay under it.
    span: tracing::Span,
}

/// The module's pipes, which the bridge owns while the run lasts.
pub(super) struct ModulePipes {
    stdin: ChildStdin,
    stdout: FramedRead<ChildStdout, LinesCodec>,
    stderr: FramedRead<ChildStderr, LinesCodec>,
    /// Why the module can't answer any more, once it can't.
    stopped: Option<String>,
    span: tracing::Span,
}

/// The first line on the module's stdin.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleContext {
    max_value_bytes: usize,
}

/// What the program asks of its module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ModuleOp {
    /// Read an export.
    Get,
    /// Call an exported function with `args`.
    Call,
}

impl ModuleOp {
    fn as_str(self) -> &'static str {
        match self {
            Self::Get => "get",
            Self::Call => "call",
        }
    }
}

/// One request, as the program's bootstrap writes it and the module reads it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ModuleRequest {
    pub(super) id: u64,
    pub(super) op: ModuleOp,
    pub(super) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) args: Option<Vec<Value>>,
}

/// A line the module writes.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ModuleFrame {
    Log {
        level: LogLevel,
        message: String,
    },
    Reply {
        id: u64,
        #[serde(default)]
        value: Option<Value>,
        #[serde(default)]
        error: Option<String>,
    },
}

/// The reply the program reads on its stdin.
#[derive(Serialize)]
struct ModuleReply<'a> {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<&'a Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

/// One relay's result: the line for the program's stdin and what the module
/// logged meanwhile, which the run's output budget pays for.
pub(super) struct Relayed {
    pub(super) reply: String,
    pub(super) logs: Vec<(LogLevel, String)>,
}

impl DenoRunner {
    /// Start `source`'s process. It loads the module at once, beside the
    /// program's own start, and waits for requests.
    pub(super) async fn start_module(
        &self,
        source: &str,
        environment: &RunEnvironment,
        limits: &Limits,
    ) -> Result<(ModuleProcess, ModulePipes), ExecutionFailure> {
        let span = tracing::info_span!(
            "code_execution.module",
            execution_id = environment.execution_id.map(tracing::field::display),
            module_bytes = source.len(),
            requests = tracing::field::Empty,
            relayed_bytes = tracing::field::Empty,
            process.exit_code = tracing::field::Empty,
            process.signal = tracing::field::Empty,
            process.wall_ms = tracing::field::Empty,
            process.cpu_ms = tracing::field::Empty,
            process.peak_rss_kib = tracing::field::Empty,
            process.killed = tracing::field::Empty,
        );
        let directory = tempfile::Builder::new()
            .prefix("module-")
            .tempdir_in(&self.scratch)
            .map_err(internal)?;
        let root = directory.path();
        for path in ["tmp", "home", "cache"] {
            tokio::fs::create_dir(root.join(path))
                .await
                .map_err(internal)?;
        }
        let compute = root.join("compute.mjs");
        // No SDK bundle, no catalog and no interpreter: only what the
        // module may import.
        for (file, text) in [
            ("compute.mjs", COMPUTE),
            ("module.ts", source),
            ("handlebars.mjs", code_mode_assets::HANDLEBARS),
            ("timers.mjs", TIMERS),
            ("unavailable.mjs", UNAVAILABLE),
        ] {
            tokio::fs::write(root.join(file), text)
                .await
                .map_err(internal)?;
        }
        tokio::fs::write(root.join("imports.json"), import_map(false, false))
            .await
            .map_err(internal)?;
        let mut child = self
            .command(root)
            .args(BOOTSTRAP_FLAGS)
            .arg("--deny-net")
            .arg(format!("--allow-read={}", root.display()))
            .arg(format!(
                "--import-map={}",
                root.join("imports.json").display()
            ))
            .arg(format!("--v8-flags=--max-old-space-size={}", self.heap_mb))
            .arg(&compute)
            .spawn()
            .map_err(internal)?;
        let spawned = tokio::time::Instant::now();
        if let Err(error) = limit(&child, limits) {
            super::reap(&mut child).await;
            return Err(error);
        }
        let (Some(mut stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            super::reap(&mut child).await;
            return Err(internal("module child has no pipes"));
        };
        let mut context = serde_json::to_vec(&ModuleContext {
            max_value_bytes: max_value_bytes(limits),
        })
        .map_err(internal)?;
        context.push(b'\n');
        if let Err(error) = stdin.write_all(&context).await {
            super::reap(&mut child).await;
            return Err(internal(error));
        }
        let pid = child.id();
        Ok((
            ModuleProcess {
                child,
                _directory: directory,
                pid,
                spawned,
                usage: exit::ProcessUsage::default(),
                span: span.clone(),
            },
            ModulePipes {
                stdin,
                stdout: FramedRead::new(
                    stdout,
                    LinesCodec::new_with_max_length(limits.max_frame_bytes),
                ),
                stderr: FramedRead::new(
                    stderr,
                    LinesCodec::new_with_max_length(limits.max_frame_bytes),
                ),
                stopped: None,
                span,
            },
        ))
    }
}

impl ModuleProcess {
    /// Read its CPU time and memory while it runs.
    pub(super) fn sample(&mut self) {
        if let Some(pid) = self.pid {
            self.usage.sample(pid);
        }
    }

    /// Kill it if it still runs, wait for it and record how it ended. The
    /// run is over: nothing of the module outlives it.
    pub(super) async fn stop(mut self, requests: u64, relayed_bytes: usize) {
        self.sample();
        let killed = !matches!(self.child.try_wait(), Ok(Some(_)));
        self.span.record("requests", requests);
        self.span.record("relayed_bytes", relayed_bytes);
        if let Some(status) = super::reap(&mut self.child).await {
            exit::ProcessExit {
                status,
                wall: self.spawned.elapsed(),
                usage: self.usage,
                // It answers per request and never writes a terminal frame.
                answered: true,
                killed,
            }
            .record(&self.span);
        }
    }
}

/// Relay `request` to the module and wait for its reply. Takes the pipes
/// and hands them back, so the bridge keeps reading the program meanwhile.
/// A module that stopped, broke the protocol or wrote more than `log_budget`
/// bytes of logs answers this and every later request with an error, which
/// the program sees as a rejected promise.
pub(super) async fn relay(
    mut pipes: ModulePipes,
    request: ModuleRequest,
    log_budget: usize,
) -> (ModulePipes, Relayed) {
    let span = tracing::info_span!(
        parent: &pipes.span,
        "code_execution.module.relay",
        op = request.op.as_str(),
        request_bytes = tracing::field::Empty,
        reply_bytes = tracing::field::Empty,
        outcome = tracing::field::Empty,
    );
    let mut logs = Vec::new();
    let mut log_bytes = 0;
    let answer = match &pipes.stopped {
        Some(why) => Err(why.clone()),
        None => {
            exchange(
                &mut pipes,
                &request,
                log_budget,
                &mut logs,
                &mut log_bytes,
                &span,
            )
            .instrument(span.clone())
            .await
        }
    };
    let reply = match &answer {
        Ok(Ok(value)) => ModuleReply {
            id: request.id,
            value: Some(value),
            error: None,
        },
        Ok(Err(error)) | Err(error) => ModuleReply {
            id: request.id,
            value: None,
            error: Some(error),
        },
    };
    // Plain JSON throughout, so it always serializes.
    let reply = serde_json::to_string(&reply).unwrap_or_default();
    span.record("reply_bytes", reply.len());
    span.record(
        "outcome",
        match &answer {
            Ok(Ok(_)) => "value",
            Ok(Err(_)) => "error",
            Err(_) => "stopped",
        },
    );
    if let Err(why) = answer {
        pipes.stopped = Some(why);
    }
    (pipes, Relayed { reply, logs })
}

/// Write one request and read until its reply: `Ok` with the module's answer
/// (a value, or the error it threw), `Err` when the module can't answer.
async fn exchange(
    pipes: &mut ModulePipes,
    request: &ModuleRequest,
    log_budget: usize,
    logs: &mut Vec<(LogLevel, String)>,
    log_bytes: &mut usize,
    span: &tracing::Span,
) -> Result<Result<Value, String>, String> {
    let stopped = |why: &str| format!("The module stopped: {why}.");
    let mut line =
        serde_json::to_vec(request).map_err(|_| stopped("its request did not encode"))?;
    span.record("request_bytes", line.len());
    line.push(b'\n');
    let ModulePipes {
        stdin,
        stdout,
        stderr,
        ..
    } = pipes;
    // The request is written while the module's output is read: a module
    // writing more than its pipe holds (logs at load, say) reads nothing
    // until it is read.
    let write = stdin.write_all(&line);
    tokio::pin!(write);
    let mut written = false;
    let mut stderr_open = true;
    loop {
        tokio::select! {
            sent = &mut write, if !written => {
                sent.map_err(|_| stopped("its process ended"))?;
                written = true;
            }
            frame = stdout.next() => {
                let frame = match frame {
                    None | Some(Err(tokio_util::codec::LinesCodecError::Io(_))) => {
                        return Err(stopped("its process ended"));
                    }
                    Some(Err(tokio_util::codec::LinesCodecError::MaxLineLengthExceeded)) => {
                        return Err(stopped("it wrote a line over the frame limit"));
                    }
                    Some(Ok(frame)) => frame,
                };
                match serde_json::from_str(&frame) {
                    Ok(ModuleFrame::Log { level, message }) => {
                        *log_bytes += frame.len() + 1;
                        if *log_bytes > log_budget {
                            return Err(stopped("it wrote more output than a run may"));
                        }
                        logs.push((level, message));
                    }
                    Ok(ModuleFrame::Reply { id, value, error }) if written && id == request.id => {
                        return Ok(match error {
                            Some(error) => Err(error),
                            None => Ok(value.unwrap_or(Value::Null)),
                        });
                    }
                    Ok(ModuleFrame::Reply { .. }) | Err(_) => {
                        return Err(stopped("it wrote an invalid frame"));
                    }
                }
            }
            line = stderr.next(), if stderr_open => match line {
                Some(Ok(line)) => {
                    *log_bytes += line.len() + 1;
                    if *log_bytes > log_budget {
                        return Err(stopped("it wrote more output than a run may"));
                    }
                    logs.push((LogLevel::Warn, format!("module: {line}")));
                }
                Some(Err(_)) | None => stderr_open = false,
            },
        }
    }
}
