//! List the Macro SDK operations a JavaScript tools program may call, without
//! running it: the bundle's own `analyze`, in a Deno process that can read
//! only the bundle and its catalog.

use crate::domain::*;
use async_trait::async_trait;
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Semaphore,
};

/// Longest an analysis may take, including waiting for a slot.
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(10);
/// Most of an answer read; a longer one is refused.
const MAX_ANSWER_BYTES: u64 = 256 * 1024;
/// Heap of one analysis process, in MiB: the same as a program's.
const HEAP_MB: u32 = 128;
/// The file locations in an answer are in, as the model wrote it.
pub(crate) const PROGRAM: &str = "main.js";
/// The analyzer's entry point: reads a program on stdin, prints the answer.
const ENTRY: &str = include_str!("js_tools_analyze.mjs");

/// Analyzes with the `js-tools.mjs` bundle the runs use, so a program is
/// read by the same analyzer and parser version that runs it.
pub struct JsToolsAnalyzer {
    binary: PathBuf,
    root: PathBuf,
    slots: Arc<Semaphore>,
    max_source_bytes: usize,
    timeout: Duration,
}

impl JsToolsAnalyzer {
    /// Validate the runtime and write the bundle, its catalog and the entry
    /// point under `scratch`, once. `concurrency` analyses run at once, each
    /// in its own process.
    #[tracing::instrument(skip_all, err)]
    pub async fn new(
        binary: PathBuf,
        scratch: PathBuf,
        concurrency: usize,
        max_source_bytes: usize,
    ) -> Result<Self, rootcause::Report> {
        let binary = super::pinned_deno(binary).await?;
        tokio::fs::create_dir_all(&scratch).await?;
        let root = tokio::fs::canonicalize(scratch).await?;
        tokio::fs::write(root.join("js-tools.mjs"), code_mode_assets::JS_TOOLS).await?;
        tokio::fs::write(
            root.join("js-tools.json"),
            code_mode_assets::JS_TOOLS_CATALOG,
        )
        .await?;
        tokio::fs::write(root.join("analyze.mjs"), ENTRY).await?;
        Ok(Self {
            binary,
            root,
            slots: Arc::new(Semaphore::new(concurrency.max(1))),
            max_source_bytes,
            timeout: ANALYZE_TIMEOUT,
        })
    }

    async fn run(&self, source: &str) -> Result<Analysis, CheckError> {
        let mut read = std::ffi::OsString::from("--allow-read=");
        read.push(&self.root);
        // The run's flags, minus the network and the import map: the
        // analysis reads its own directory and nothing else.
        let mut child = Command::new(&self.binary)
            .env_clear()
            .env("DENO_DIR", self.root.join("cache"))
            .env("HOME", &self.root)
            .env("TMPDIR", &self.root)
            .env("DENO_NO_UPDATE_CHECK", "1")
            .env("NO_COLOR", "1")
            .current_dir(&self.root)
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
                "--deny-net",
            ])
            .arg(read)
            .arg(format!("--v8-flags=--max-old-space-size={HEAP_MB}"))
            .arg("analyze.mjs")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(internal)?;
        let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            return Err(internal("analysis process has no pipes"));
        };
        // Write and read at once: a large program fills the pipe before the
        // analyzer has read it, and an answer can fill stdout. Closing stdin
        // ends the source.
        let write = async move {
            stdin.write_all(source.as_bytes()).await?;
            drop(stdin);
            Ok::<_, std::io::Error>(())
        };
        let mut answer = Vec::new();
        let mut stdout = stdout.take(MAX_ANSWER_BYTES + 1);
        let (written, read) = tokio::join!(write, stdout.read_to_end(&mut answer));
        written.map_err(internal)?;
        read.map_err(internal)?;
        // An answer past the limit is refused; closing the pipe ends a
        // process still writing one.
        drop(stdout);
        let status = child.wait().await.map_err(internal)?;
        if !status.success() || answer.len() as u64 > MAX_ANSWER_BYTES {
            return Err(internal("analysis process failed"));
        }
        super::super::analysis::analysis(&answer, PROGRAM)
            .ok_or_else(|| internal("unexpected analysis answer"))
    }
}

#[async_trait]
impl ProgramAnalyzer for JsToolsAnalyzer {
    fn sdk_fingerprint(&self) -> &str {
        code_mode_assets::JS_TOOLS_FINGERPRINT
    }

    // A program that doesn't parse or can't be analyzed is its author's
    // problem, recorded in `outcome`; only the service's failures are errors.
    #[tracing::instrument(
        name = "code_execution.analyze",
        skip_all,
        fields(
            language = "js_tools",
            sdk_fingerprint = code_mode_assets::JS_TOOLS_FINGERPRINT,
            source_bytes = source.len(),
            outcome = tracing::field::Empty,
            operations = tracing::field::Empty,
        ),
        err
    )]
    async fn may_call(&self, source: &str) -> Result<Analysis, CheckError> {
        if source.trim().is_empty() || source.len() > self.max_source_bytes {
            return Err(CheckError::InvalidSource);
        }
        let span = tracing::Span::current();
        // One deadline for waiting and analyzing; dropping the process at it
        // kills it. `outcome` tells a wait for a slot (`busy`) from an
        // analysis that ran out of time (`timed_out`).
        let deadline = tokio::time::Instant::now() + self.timeout;
        let Ok(slot) = tokio::time::timeout_at(deadline, self.slots.acquire()).await else {
            span.record("outcome", "busy");
            return Err(CheckError::Busy);
        };
        let _slot = slot.map_err(internal)?;
        let analyzed = tokio::time::timeout_at(deadline, self.run(source)).await;
        let outcome = match &analyzed {
            Ok(Ok(Analysis::Calls(calls))) => {
                span.record("operations", calls.len());
                "calls"
            }
            Ok(Ok(Analysis::CannotAnalyze(_))) => "cannot_analyze",
            Ok(Ok(Analysis::Diagnostics(_))) => "diagnostics",
            Ok(Err(_)) => "internal",
            Err(_) => "timed_out",
        };
        span.record("outcome", outcome);
        analyzed.map_err(|_| CheckError::Busy)?
    }
}

fn internal(error: impl std::fmt::Display) -> CheckError {
    // Host paths and source stay out of infrastructure diagnostics.
    tracing::error!(%error, "could not analyze a program");
    CheckError::Internal
}

#[cfg(test)]
mod test;
