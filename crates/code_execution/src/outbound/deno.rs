//! Fresh Deno processes with run-only credentials and allowlisted API egress.
//! JS tools programs run in the same bootstrap, in the interpreter
//! `code_mode_assets::JS_TOOLS` bundles.

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
const UNAVAILABLE: &str = include_str!("deno/unavailable.mjs");
/// Node built-ins a program may import: none opens a connection or a process,
/// or loads another built-in. `process` and `module` must stay out: their named
/// exports (`getBuiltinModule`, `createRequire`) load any built-in, past both
/// this map and the bootstrap's removals.
const NODE_ALLOWED: &[&str] = &[
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "console",
    "crypto",
    "events",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "punycode",
    "querystring",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "url",
    "util",
    "util/types",
    "zlib",
];
/// Every Node built-in the pinned Deno resolves: its `builtinModules` (see the
/// test), plus `_http_client` and `_http_incoming`, which it doesn't have but a
/// newer Deno resolves without listing.
const NODE_BUILTINS: &[&str] = &[
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_stream_duplex",
    "_stream_passthrough",
    "_stream_readable",
    "_stream_transform",
    "_stream_writable",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "sqlite",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "test",
    "test/reporters",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
];

/// Every program's requests go through the bootstrap's `fetch`, which marks
/// them as the program's (`x-macro-code-execution`) so an API can tell them
/// from the person's own. Any other Node built-in could open its own
/// connection with the run's token unmarked, so every built-in not in
/// [`NODE_ALLOWED`] resolves to unavailable.mjs, which throws. Timer modules,
/// and an attended program's worker modules, resolve to timers.mjs, which
/// refuses to sleep; see bootstrap.mjs. A bare allowed name (`crypto`) resolves
/// as its `node:` form.
fn import_map(unattended: bool) -> String {
    let mut imports = serde_json::Map::new();
    imports.insert("@macro-inc/sdk".into(), "./sdk.mjs".into());
    if !unattended {
        imports.insert("handlebars".into(), "./handlebars.mjs".into());
    }
    for &name in NODE_BUILTINS {
        let target = match name {
            _ if NODE_ALLOWED.contains(&name) => {
                imports.insert(name.into(), format!("node:{name}").into());
                continue;
            }
            "timers" | "timers/promises" => "./timers.mjs",
            "worker_threads" if !unattended => "./timers.mjs",
            _ => "./unavailable.mjs",
        };
        imports.insert(format!("node:{name}"), target.into());
        imports.insert(name.into(), target.into());
    }
    serde_json::json!({ "imports": imports }).to_string()
}
/// Runtime version pinned by the container and checked at startup.
pub const DENO_VERSION: &str = "2.9.6";
/// Where a JS tools program's source is written; its diagnostics name it.
const JS_TOOLS_PROGRAM: &str = "main.js";
/// The most tool calls one JS tools run makes.
const JS_TOOLS_MAX_TOOL_CALLS: u16 = 256;
/// What a JS tools run leaves of its deadline for the bootstrap to report how
/// it ended: the interpreter stops this much before the process is stopped.
const JS_TOOLS_REPORT_MARGIN: std::time::Duration = std::time::Duration::from_millis(500);

/// The supervisor owns process lifecycle; Deno owns the permission boundary.
pub struct DenoRunner {
    binary: PathBuf,
    scratch: PathBuf,
    heap_mb: u32,
    /// Forwards proxied runs' requests, its connections kept warm across
    /// runs. It follows no redirects: a redirect is the host's answer to
    /// the program.
    egress: reqwest::Client,
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
        // No overall timeout: a response may stream for as long as the run
        // lasts, and the run's end stops its forwarder.
        let egress = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|error| rootcause::report!("could not build the egress client: {error}"))?;
        Ok(Self {
            binary,
            scratch,
            heap_mb,
            egress,
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
        let language = job.request.language;
        let program = match language {
            // Only JS tools requests name their operation, so only those runs
            // can be held to a set of them.
            Language::Javascript if job.environment.allowed_operations.is_some() => {
                return Err(ExecutionFailure::new(
                    FailureCode::Internal,
                    "only JS tools programs can be limited to operations",
                ));
            }
            Language::JsTools if job.environment.unattended.is_some() => {
                return Err(ExecutionFailure::new(
                    FailureCode::Runtime,
                    "JS tools programs can't run unattended",
                ));
            }
            // A JS tools run is always held to the operations its check
            // allowed, so a caller that skipped the check fails closed here.
            Language::JsTools if job.environment.allowed_operations.is_none() => {
                return Err(ExecutionFailure::new(
                    FailureCode::Internal,
                    "JS tools programs run only with the operations they were checked to call",
                ));
            }
            Language::JsTools => JS_TOOLS_PROGRAM,
            // Programs are TypeScript; Deno strips their types on load.
            Language::Javascript => "main.ts",
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
        tokio::fs::write(root.join("unavailable.mjs"), UNAVAILABLE)
            .await
            .map_err(internal)?;
        // The interpreter and catalog sit in scratch like the SDK, so a JS
        // tools run has exactly a JavaScript run's read permission.
        if language == Language::JsTools {
            tokio::fs::write(root.join("js-tools.mjs"), code_mode_assets::JS_TOOLS)
                .await
                .map_err(internal)?;
            tokio::fs::write(
                root.join("js-tools.json"),
                code_mode_assets::JS_TOOLS_CATALOG,
            )
            .await
            .map_err(internal)?;
        }
        tokio::fs::write(
            root.join("imports.json"),
            import_map(job.environment.unattended.is_some()),
        )
        .await
        .map_err(internal)?;
        // A proxied run reaches only its forwarder, which reaches the hosts.
        let egress = match job.environment.egress {
            Egress::Direct => None,
            Egress::Proxied => Some(
                egress::RunEgress::start(
                    self.egress.clone(),
                    &job.environment.endpoints.hosts,
                    &job.environment.trace_headers,
                    egress::code_execution_marker(language),
                )
                .await
                .map_err(internal)?,
            ),
        };
        // The program keeps the real hosts, which its links need; its fetch
        // sends their requests to the forwarder, the only address it reaches.
        let forwarder = egress.as_ref().map(|egress| &egress.hosts);
        let mut destinations = std::collections::BTreeSet::new();
        for base in forwarder
            .unwrap_or(&job.environment.endpoints.hosts)
            .values()
        {
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
        let spawned = tokio::time::Instant::now();
        if let Err(error) = limit(&child, &job.limits) {
            reap(&mut child).await;
            return Err(error);
        }
        let pid = child.id();
        let stdin = child.stdin.take().expect("piped child stdin");
        let stdout = child.stdout.take().expect("piped child stdout");
        let stderr = child.stderr.take().expect("piped child stderr");
        // Kept outside the run so a run the deadline, a cancellation or a
        // protocol error cuts short still records how its child ended.
        let mut usage = exit::ProcessUsage::default();
        let mut answered = false;
        let mut exited_by_itself = false;
        let execution = async {
            let bridged = bridge(
                &job.environment,
                language,
                forwarder,
                ChildPipes {
                    stdin,
                    stdout,
                    stderr,
                },
                events,
                &job.limits,
                job.deadline,
            );
            tokio::pin!(bridged);
            let mut samples = tokio::time::interval(exit::SAMPLE_INTERVAL);
            let candidate = loop {
                tokio::select! {
                    candidate = &mut bridged => break candidate?,
                    _ = samples.tick() => if let Some(pid) = pid {
                        usage.sample(pid);
                    },
                }
            };
            answered = candidate.is_some();
            // Both streams have closed, so the process is exiting; its CPU
            // time stays readable until it is reaped.
            if let Some(pid) = pid {
                usage.sample(pid);
            }
            let status = child.wait().await.map_err(internal)?;
            exited_by_itself = true;
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
        if !exited_by_itself && let Some(pid) = pid {
            usage.sample(pid);
        }
        // A run that failed before waiting (an output budget overrun, say)
        // may still have a child that already exited on its own.
        let killed = !exited_by_itself && !matches!(child.try_wait(), Ok(Some(_)));
        if let Some(status) = reap(&mut child).await {
            exit::ProcessExit {
                status,
                wall: spawned.elapsed(),
                usage,
                answered,
                killed,
            }
            .record(&tracing::Span::current());
        }
        if let Some(egress) = egress {
            egress.stop().await;
        }
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

/// Kill `child` if it still runs and wait for it; its exit status, once known.
async fn reap(child: &mut Child) -> Option<std::process::ExitStatus> {
    let _ = child.start_kill();
    child.wait().await.ok()
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
    /// A proxied run's forwarder, each service's base under it.
    #[serde(skip_serializing_if = "Option::is_none")]
    forwarder: Option<&'a std::collections::BTreeMap<String, String>>,
    max_result_bytes: usize,
    max_calls_per_operation: u32,
    /// Time left before the host stops the run, so the program can report a
    /// loop before then.
    remaining_ms: u128,
    /// For an unattended program, the catalog a dry run tells reads from
    /// writes with, both for SDK operations and the requests they send.
    #[serde(skip_serializing_if = "Option::is_none")]
    operations: Option<&'static [CatalogEntry]>,
    /// `js_tools` for a JS tools program (main.js); absent for JavaScript.
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<&'static str>,
    /// For a JS tools program, the interpreter's limits.
    #[serde(skip_serializing_if = "Option::is_none")]
    js_tools: Option<JsToolsLimits>,
}

/// What `@opencode/codemode` enforces on a JS tools run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsToolsLimits {
    /// The run's remaining deadline, less the margin to report how it ended.
    timeout_ms: u32,
    max_tool_calls: u16,
    /// Bytes of result and logs the interpreter keeps: the frame limit.
    max_output_bytes: usize,
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
        /// Set when the program was refused before it ran.
        #[serde(default)]
        failure: Option<FrameFailure>,
    },
}

/// Why an error frame's program failed, when it's not a runtime error.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum FrameFailure {
    /// A JS tools program that doesn't parse or can't be analyzed.
    Compile,
    /// A JS tools program its interpreter stopped at the deadline.
    TimedOut,
}

/// The child's standard streams, which the bridge owns for the run.
struct ChildPipes {
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
}

async fn bridge(
    environment: &RunEnvironment,
    language: Language,
    forwarder: Option<&std::collections::BTreeMap<String, String>>,
    pipes: ChildPipes,
    events: &mut EventSink,
    limits: &Limits,
    deadline: tokio::time::Instant,
) -> Result<Option<Outcome>, ExecutionFailure> {
    let ChildPipes {
        mut stdin,
        stdout,
        stderr,
    } = pipes;
    // Only the JS tools path sends a failure kind; any other program could
    // write its own error frame.
    let js_tools = language == Language::JsTools;
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    let mut initial = serde_json::to_vec(&ChildContext {
        environment,
        forwarder,
        max_result_bytes: limits.max_result_bytes,
        max_calls_per_operation: limits.max_calls_per_operation,
        remaining_ms: remaining.as_millis(),
        operations: environment.unattended.as_ref().map(|_| CATALOG.as_slice()),
        language: js_tools.then(|| language.as_str()),
        js_tools: js_tools.then(|| JsToolsLimits {
            // Milliseconds as a u32 stay a safe JavaScript integer.
            timeout_ms: u32::try_from(remaining.saturating_sub(JS_TOOLS_REPORT_MARGIN).as_millis())
                .unwrap_or(u32::MAX)
                .max(1),
            max_tool_calls: JS_TOOLS_MAX_TOOL_CALLS,
            max_output_bytes: limits.max_frame_bytes,
        }),
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
                    ChildFrame::Error { message, failure } => {
                        outcome = Some(match failure.filter(|_| js_tools) {
                            Some(FrameFailure::Compile) => ExecutionFailure::new(FailureCode::Compile, message).into(),
                            Some(FrameFailure::TimedOut) => Outcome::TimedOut,
                            None => ExecutionFailure::new(FailureCode::Runtime, message).into(),
                        });
                    }
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

pub mod analyze;
pub mod check;
mod egress;
mod exit;

#[cfg(test)]
mod test;
