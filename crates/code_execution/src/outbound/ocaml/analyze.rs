//! List the Macro SDK operations an OCaml program may call, without running
//! it: type-check it with the bundle's `ocamlc` and policy check, then read
//! its typed tree with the bundle's `macro_sdk_calls`.

use super::{CompileError, OcamlBundle, PROGRAM};
use crate::domain::*;
use async_trait::async_trait;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

/// Longest an analysis may take, including waiting for a slot.
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(10);

/// Analyzes with the bundle's `ocamlc -stop-after typing`, policy check and
/// `macro_sdk_calls`.
pub struct OcamlAnalyzer {
    bundle: Arc<OcamlBundle>,
    root: PathBuf,
    slots: Arc<Semaphore>,
    limits: Limits,
}

impl OcamlAnalyzer {
    /// Analyze against `bundle` in directories under `scratch`,
    /// `concurrency` at once.
    #[tracing::instrument(skip_all, err)]
    pub async fn new(
        bundle: Arc<OcamlBundle>,
        scratch: PathBuf,
        concurrency: usize,
        max_source_bytes: usize,
    ) -> Result<Self, rootcause::Report> {
        tokio::fs::create_dir_all(&scratch).await?;
        let root = tokio::fs::canonicalize(scratch).await?;
        Ok(Self {
            bundle,
            root,
            slots: Arc::new(Semaphore::new(concurrency.max(1))),
            limits: Limits {
                max_source_bytes,
                ..Limits::default()
            },
        })
    }

    async fn run(
        &self,
        source: &str,
        deadline: tokio::time::Instant,
    ) -> Result<Analysis, CompileError> {
        let directory = tempfile::Builder::new()
            .prefix("analyze-")
            .tempdir_in(&self.root)
            .map_err(|_| CompileError::Internal)?;
        let at = directory.path();
        for path in ["tmp", "home"] {
            tokio::fs::create_dir(at.join(path))
                .await
                .map_err(|_| CompileError::Internal)?;
        }
        tokio::fs::write(at.join(PROGRAM), source)
            .await
            .map_err(|_| CompileError::Internal)?;
        match self
            .bundle
            .compile(at, true, &self.limits, deadline, &CancellationToken::new())
            .await
        {
            Ok(()) => {}
            Err(CompileError::Diagnostics(diagnostics)) => {
                return Ok(Analysis::Diagnostics(diagnostics));
            }
            Err(error) => return Err(error),
        }
        self.bundle.analyze(at, &self.limits, deadline).await
    }
}

#[async_trait]
impl ProgramAnalyzer for OcamlAnalyzer {
    fn sdk_fingerprint(&self) -> &str {
        self.bundle.fingerprint()
    }

    // A program that doesn't compile or can't be analyzed is its author's
    // problem, recorded in `outcome`; only the service's failures are errors.
    #[tracing::instrument(
        name = "code_execution.analyze",
        skip_all,
        fields(
            language = "ocaml",
            sdk_fingerprint = %self.bundle.fingerprint(),
            source_bytes = source.len(),
            outcome = tracing::field::Empty,
            operations = tracing::field::Empty,
        ),
        err
    )]
    async fn may_call(&self, source: &str) -> Result<Analysis, CheckError> {
        if source.trim().is_empty() || source.len() > self.limits.max_source_bytes {
            return Err(CheckError::InvalidSource);
        }
        // One deadline for waiting and analyzing; the steps stop (and reap)
        // their children at it.
        let deadline = tokio::time::Instant::now() + ANALYZE_TIMEOUT;
        let span = tracing::Span::current();
        let Ok(slot) = tokio::time::timeout_at(deadline, self.slots.acquire()).await else {
            span.record("outcome", "timed_out");
            return Err(CheckError::Busy);
        };
        let _slot = slot.map_err(|_| CheckError::Internal)?;
        let analyzed = self.run(source, deadline).await;
        let outcome = match &analyzed {
            Ok(Analysis::Calls(calls)) => {
                span.record("operations", calls.len());
                "calls"
            }
            Ok(Analysis::CannotAnalyze(_)) => "cannot_analyze",
            Ok(Analysis::Diagnostics(_)) => "diagnostics",
            Err(CompileError::TimedOut | CompileError::Cancelled) => "timed_out",
            Err(_) => "internal",
        };
        span.record("outcome", outcome);
        analyzed.map_err(|error| match error {
            CompileError::TimedOut | CompileError::Cancelled => CheckError::Busy,
            CompileError::Diagnostics(_) | CompileError::Internal => CheckError::Internal,
        })
    }
}
