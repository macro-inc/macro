//! Type-check an OCaml program against the bundle's interfaces, and run the
//! policy check on it, without compiling it to WebAssembly or running it.

use super::{CompileError, OcamlBundle, PROGRAM};
use crate::domain::*;
use async_trait::async_trait;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

/// Longest a check may take, including waiting for a slot.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Checks with the bundle's `ocamlc -stop-after typing` and policy check.
pub struct OcamlChecker {
    bundle: Arc<OcamlBundle>,
    root: PathBuf,
    slots: Arc<Semaphore>,
    limits: Limits,
}

impl OcamlChecker {
    /// Check against `bundle` in directories under `scratch`, `concurrency`
    /// at once.
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
    ) -> Result<Vec<Diagnostic>, CheckError> {
        let directory = tempfile::Builder::new()
            .prefix("check-")
            .tempdir_in(&self.root)
            .map_err(|_| CheckError::Internal)?;
        let check = directory.path();
        for path in ["tmp", "home"] {
            tokio::fs::create_dir(check.join(path))
                .await
                .map_err(|_| CheckError::Internal)?;
        }
        tokio::fs::write(check.join(PROGRAM), source)
            .await
            .map_err(|_| CheckError::Internal)?;
        match self
            .bundle
            .compile(
                check,
                true,
                &self.limits,
                deadline,
                &CancellationToken::new(),
            )
            .await
        {
            Ok(()) => Ok(Vec::new()),
            Err(CompileError::Diagnostics(diagnostics)) => Ok(diagnostics),
            Err(CompileError::TimedOut | CompileError::Cancelled) => Err(CheckError::Busy),
            Err(CompileError::Internal) => Err(CheckError::Internal),
        }
    }
}

#[async_trait]
impl ProgramChecker for OcamlChecker {
    fn sdk_fingerprint(&self) -> &str {
        self.bundle.fingerprint()
    }

    async fn check(
        &self,
        source: &str,
        declarations: &str,
        imports: ProgramImports,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        self.check_files(
            &[SourceFile {
                name: PROGRAM.to_owned(),
                source: source.to_owned(),
            }],
            declarations,
            imports,
        )
        .await
    }

    /// An OCaml program is one file, `main.ml`. `declarations` are
    /// TypeScript and must be empty: an OCaml program's context types come
    /// from `Code_mode`, and it imports only the bundle's libraries, so
    /// `imports` (the TypeScript modules) doesn't apply.
    #[tracing::instrument(
        name = "code_execution.check",
        skip_all,
        fields(
            language = "ocaml",
            files = files.len(),
            source_bytes = files.iter().map(|file| file.source.len()).sum::<usize>(),
            diagnostics = tracing::field::Empty,
        ),
        err
    )]
    async fn check_files(
        &self,
        files: &[SourceFile],
        declarations: &str,
        _imports: ProgramImports,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        let [file] = files else {
            return Err(CheckError::InvalidSource);
        };
        if file.name != PROGRAM
            || !declarations.trim().is_empty()
            || file.source.trim().is_empty()
            || file.source.len() > self.limits.max_source_bytes
        {
            return Err(CheckError::InvalidSource);
        }
        // One deadline for waiting and checking. The compile step stops
        // (and reaps) its children at it; this future is never dropped
        // while one runs.
        let deadline = tokio::time::Instant::now() + CHECK_TIMEOUT;
        let _slot = tokio::time::timeout_at(deadline, self.slots.acquire())
            .await
            .map_err(|_| CheckError::Busy)?
            .map_err(|_| CheckError::Internal)?;
        let checked = self.run(&file.source, deadline).await?;
        tracing::Span::current().record("diagnostics", checked.len());
        Ok(checked)
    }
}
