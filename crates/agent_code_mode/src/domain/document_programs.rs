//! Programs in a stored HTML document, built on the server and run for the
//! person viewing it.
//!
//! The document's source is built once per content hash ([`page_build`]): the
//! preview renders the built page, and a run names a program of that build
//! by id. The server never runs source the page sends, and the credential
//! never reaches the page.
use super::{CodeModeError, UserCodeMode, UserExecutionReceipt};
use ai_toolset::ToolCaller;
use async_trait::async_trait;
use code_execution::domain::{
    CheckError, ExecuteRequest, ProgramBundler, ProgramChecker, Unattended, UnattendedOutput,
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub mod page_build;
mod viewer_runs;

pub use page_build::{BuildOutcome, ProgramId, SourceHash};
pub use viewer_runs::RUNS_PER_VIEWER;

/// The per-user rollout flag, shared with the web app's `defineFlag` key.
pub const DOCUMENT_PROGRAMS_FLAG: &str = "enable-html-code-mode";

/// Largest value, as JSON, a page's program may return. The executor that
/// runs document programs is given it; a larger value fails the run with a
/// message naming it.
pub const DOCUMENT_RESULT_BYTES: usize = 1000 * 1024;

/// Builds kept, by source hash. A miss rebuilds, so this only bounds memory.
const CACHED_BUILDS: NonZeroUsize = NonZeroUsize::MIN.saturating_add(31);

/// Whether a user may run a document's embedded programs: a rollout gate,
/// never an authorization. The run still acts under the user's own credential.
#[async_trait]
pub trait DocumentProgramGate: Send + Sync + 'static {
    /// `false` when the rollout excludes the user or cannot be read.
    async fn allows(&self, user: &MacroUserIdStr<'static>) -> bool;
}

/// Reads the stored HTML of a document the caller may view.
/// `#[async_trait]` keeps it object-safe for `Arc<dyn …>`.
#[async_trait]
pub trait DocumentSources: Send + Sync + 'static {
    /// The document's current source.
    async fn html(
        &self,
        document: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentSourceError>;
}

/// Why a document's source couldn't be read.
#[derive(Debug, thiserror::Error)]
pub enum DocumentSourceError {
    /// The document is gone or has no stored file.
    #[error("document not found")]
    NotFound,
    /// The stored file isn't an HTML file.
    #[error("document is not an HTML file")]
    NotHtml,
    /// The stored file is larger than a build takes.
    #[error("document is too large to build")]
    TooLarge,
    /// Storage failed.
    #[error("document storage failed: {0}")]
    Internal(rootcause::Report),
}

/// A document's build, as of the source the server just read.
#[derive(Debug, Clone)]
pub struct DocumentBuild {
    /// The hash of the source it was built from.
    pub source_hash: SourceHash,
    /// The page and program bundles, or the author's problems.
    pub outcome: Arc<BuildOutcome>,
}

/// Run one program of the build a page was rendered from.
pub struct RunProgram {
    /// The source hash of the build the page shows.
    pub source_hash: SourceHash,
    /// The program to run.
    pub program: ProgramId,
    /// Its arguments.
    pub arguments: serde_json::Map<String, serde_json::Value>,
    /// Total deadline in milliseconds, including any wait for a run slot.
    pub timeout_ms: u64,
}

/// Why a build or run could not happen.
#[derive(Debug, thiserror::Error)]
pub enum DocumentProgramError {
    /// The document's source couldn't be read.
    #[error(transparent)]
    Source(#[from] DocumentSourceError),
    /// The document changed since the page was built; reload it.
    #[error("the document changed since this page was built; reload it")]
    Changed,
    /// The build has no program with that id.
    #[error("this document has no program with that id")]
    UnknownProgram,
    /// The document doesn't build, so none of its programs run.
    #[error("this document doesn't build")]
    BuildFailed,
    /// Every build slot is busy, or the viewer's other runs held their run
    /// slots past this run's deadline.
    #[error("the document's programs are busy; try again later")]
    Busy,
    /// The toolchain failed.
    #[error("building failed to run")]
    Toolchain,
    /// The run itself failed to start or finish.
    #[error(transparent)]
    Execution(#[from] CodeModeError),
}

/// Builds documents and runs their programs as the viewer.
pub struct DocumentPrograms {
    sources: Arc<dyn DocumentSources>,
    checker: Arc<dyn ProgramChecker>,
    bundler: Arc<dyn ProgramBundler>,
    runner: Arc<dyn UserCodeMode>,
    builds: Mutex<lru::LruCache<SourceHash, Arc<BuildOutcome>>>,
    viewers: viewer_runs::ViewerRuns,
}

impl DocumentPrograms {
    /// Bind the storage reader, the Deno toolchain and the user-scoped runner.
    /// The runner should have a pool of its own, so documents can't take the
    /// slots of other user-scoped runs.
    pub fn new(
        sources: Arc<dyn DocumentSources>,
        checker: Arc<dyn ProgramChecker>,
        bundler: Arc<dyn ProgramBundler>,
        runner: Arc<dyn UserCodeMode>,
    ) -> Self {
        Self {
            sources,
            checker,
            bundler,
            runner,
            builds: Mutex::new(lru::LruCache::new(CACHED_BUILDS)),
            viewers: viewer_runs::ViewerRuns::default(),
        }
    }

    /// The build of the document's current source, from the cache or new.
    #[tracing::instrument(
        name = "document_programs.build",
        skip_all,
        fields(
            document_id = %document.entity().entity_id,
            source_bytes = tracing::field::Empty,
            cached = tracing::field::Empty,
            built = tracing::field::Empty,
        ),
        err
    )]
    pub async fn build(
        &self,
        document: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DocumentBuild, DocumentProgramError> {
        let html = self.sources.html(document).await?;
        let source_hash = SourceHash::of(&html);
        let span = tracing::Span::current();
        span.record("source_bytes", html.len());

        let cached = self
            .builds
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&source_hash)
            .cloned();
        span.record("cached", cached.is_some());
        let outcome = match cached {
            Some(outcome) => outcome,
            None => {
                let outcome =
                    page_build::build(&html, self.checker.as_ref(), self.bundler.as_ref())
                        .await
                        .map_err(|error| match error {
                            CheckError::Busy => DocumentProgramError::Busy,
                            CheckError::InvalidSource | CheckError::Internal => {
                                DocumentProgramError::Toolchain
                            }
                        })?;
                let outcome = Arc::new(outcome);
                self.builds
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .put(source_hash.clone(), Arc::clone(&outcome));
                outcome
            }
        };
        span.record("built", matches!(*outcome, BuildOutcome::Built { .. }));
        Ok(DocumentBuild {
            source_hash,
            outcome,
        })
    }

    /// Run a program of the build the page shows, as `user`. Refuses when the
    /// document has changed since, so a page never runs code it doesn't show.
    /// A viewer runs [`RUNS_PER_VIEWER`] programs at once; another waits for
    /// one of them to finish, within its own deadline, and is `Busy` past it.
    #[tracing::instrument(
        name = "document_programs.run",
        skip_all,
        fields(
            document_id = %document.entity().entity_id,
            program = %request.program,
            queued_ms = tracing::field::Empty,
        ),
        err
    )]
    pub async fn run(
        &self,
        user: &MacroUserIdStr<'static>,
        document: &EntityAccessReceipt<ViewAccessLevel>,
        request: RunProgram,
        cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, DocumentProgramError> {
        let current = self.build(document).await?;
        if current.source_hash != request.source_hash {
            return Err(DocumentProgramError::Changed);
        }
        let BuildOutcome::Built { programs, .. } = current.outcome.as_ref() else {
            return Err(DocumentProgramError::BuildFailed);
        };
        let bundle = programs
            .get(&request.program)
            .ok_or(DocumentProgramError::UnknownProgram)?;
        let mut execution = ExecuteRequest {
            source: bundle.clone(),
            timeout_ms: request.timeout_ms,
        };
        // A run that could never start doesn't take a place in the queue.
        super::service::validate_request(&execution)?;

        let deadline = Duration::from_millis(request.timeout_ms);
        let queued = tokio::time::Instant::now();
        let turn = self.viewers.admit(user, deadline).await;
        let waited = queued.elapsed();
        tracing::Span::current().record(
            "queued_ms",
            u64::try_from(waited.as_millis()).unwrap_or(u64::MAX),
        );
        let remaining_ms =
            u64::try_from(deadline.saturating_sub(waited).as_millis()).unwrap_or(u64::MAX);
        let Some(_turn) = turn else {
            return Err(DocumentProgramError::Busy);
        };
        if remaining_ms == 0 {
            return Err(DocumentProgramError::Busy);
        }
        execution.timeout_ms = remaining_ms;

        let receipt = self
            .runner
            .execute(
                user,
                &ToolCaller::Document,
                None,
                execution,
                Some(Unattended {
                    arguments: request.arguments,
                    dry_run: false,
                    output: UnattendedOutput::Page,
                }),
                cancel,
            )
            .await?;
        Ok(receipt)
    }
}

#[cfg(test)]
mod test;
