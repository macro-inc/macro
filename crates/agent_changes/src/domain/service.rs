//! Capturing, storing, and serving a session's changes.
//!
//! One capture is one round trip through the extractor: read the patch, read
//! the facts out of it, store the patch, replace the summary, tell the
//! viewers. Captures run after every turn - the moment a session has
//! something new to show - and on demand from the pane. A session never has
//! two captures running at once: a request that lands mid-capture is folded
//! into a rerun, so the stored changeset always reflects a state at least as
//! new as the request that asked for it.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use agent_session::domain::model::AgentSession;
use agent_session::domain::ports::{AgentSessionRealtime, AgentSessionRepo, SessionTurnObserver};
use agent_session::domain::session::StopReason;
use chrono::Utc;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, RequiredPermission, ViewAccessLevel,
};
use macro_uuid::Uuid;
use tracing::Instrument as _;

use super::error::{ChangesError, ExtractError, Result};
use super::model::{
    AgentSessionId, AttemptOutcome, Changeset, ChangesetId, PullRequestDraft, SessionChanges,
};
use super::patch::{self, MAX_FILE_PATCH_BYTES, MAX_PATCH_BYTES};
use super::ports::{
    ChangesetBlobStore, ChangesetExtractor, ChangesetRepo, PatchBlobKey, PullRequestDraftGenerator,
};

#[cfg(test)]
mod test;

/// How one capture ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureOutcome {
    /// A changeset (possibly empty) was stored.
    Captured(Changeset),
    /// The session's harness has no extractor.
    Unsupported,
    /// The harness had nothing to compare yet; the reason was recorded.
    NotReady,
    /// The extractor or the storage failed; the reason was recorded.
    Failed,
    /// A capture was already running; it will run once more when it ends,
    /// so the caller's request is not lost.
    Queued,
}

/// What the inbound adapters ask of the service, so they can be generic over
/// one type rather than the service's six.
pub trait AgentChanges: Send + Sync + 'static {
    /// The latest changeset and attempt for the session the receipt names.
    fn changes(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<SessionChanges>> + Send;

    /// The stored patch for the session the receipt names.
    fn patch(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Start a capture without waiting for it; answer with the state as it
    /// stands.
    fn request_capture(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<SessionChanges>> + Send;

    /// Draft the pull request the current changeset would open.
    fn draft_pull_request(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<PullRequestDraft>> + Send;
}

struct Inner<Sessions, Extractor, Repo, Blobs, Realtime, Drafts> {
    sessions: Sessions,
    extractor: Extractor,
    repo: Repo,
    blobs: Blobs,
    realtime: Realtime,
    drafts: Drafts,
    /// Sessions with a capture running, and whether another was asked for
    /// while it ran.
    in_flight: Mutex<HashMap<AgentSessionId, bool>>,
}

/// The changes service: one per process, cloned wherever a capture can start.
pub struct AgentChangesService<Sessions, Extractor, Repo, Blobs, Realtime, Drafts> {
    inner: Arc<Inner<Sessions, Extractor, Repo, Blobs, Realtime, Drafts>>,
}

// Manual Clone so the port types need not be Clone; a clone is another
// handle on the same in-flight table, which is what makes "one capture per
// session" hold across every handle.
impl<Sessions, Extractor, Repo, Blobs, Realtime, Drafts> Clone
    for AgentChangesService<Sessions, Extractor, Repo, Blobs, Realtime, Drafts>
{
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<Sessions, Extractor, Repo, Blobs, Realtime, Drafts>
    AgentChangesService<Sessions, Extractor, Repo, Blobs, Realtime, Drafts>
where
    Sessions: AgentSessionRepo,
    Extractor: ChangesetExtractor,
    Repo: ChangesetRepo,
    Blobs: ChangesetBlobStore,
    Realtime: AgentSessionRealtime + Send + Sync + 'static,
    Drafts: PullRequestDraftGenerator,
{
    /// Build the service from its ports.
    pub fn new(
        sessions: Sessions,
        extractor: Extractor,
        repo: Repo,
        blobs: Blobs,
        realtime: Realtime,
        drafts: Drafts,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                sessions,
                extractor,
                repo,
                blobs,
                realtime,
                drafts,
                in_flight: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// The latest changeset and attempt for the session the receipt names.
    async fn read_changes(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SessionChanges> {
        let session = session_of(access)?;
        self.inner
            .repo
            .get(session)
            .await
            .map_err(ChangesError::Storage)
    }

    /// The stored patch for the session the receipt names.
    async fn read_patch(&self, access: &EntityAccessReceipt<ViewAccessLevel>) -> Result<String> {
        let session = session_of(access)?;
        let key = self
            .inner
            .repo
            .patch_key(session)
            .await
            .map_err(ChangesError::Storage)?
            .ok_or(ChangesError::NoChangeset)?;
        self.inner
            .blobs
            .get_patch(&key)
            .await
            .map_err(ChangesError::Storage)?
            .ok_or(ChangesError::PatchMissing)
    }

    /// Start a capture for the session the receipt names, without waiting
    /// for it, and answer with the state as it stands - which includes the
    /// attempt just started, once the repo has noted it.
    async fn start_capture(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<SessionChanges> {
        let session = session_of(access)?;
        self.capture_in_background(session);
        // Give the spawned capture a chance to mark its attempt so the
        // answer already says "running" - but never wait on the extractor.
        tokio::task::yield_now().await;
        self.inner
            .repo
            .get(session)
            .await
            .map_err(ChangesError::Storage)
    }

    /// Draft the pull request the session's current changeset would open.
    async fn draft(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<PullRequestDraft> {
        let session = session_of(access)?;
        let changes = self
            .inner
            .repo
            .get(session)
            .await
            .map_err(ChangesError::Storage)?;
        let changeset = changes.changeset.ok_or(ChangesError::NoChangeset)?;
        let patch = match self
            .inner
            .repo
            .patch_key(session)
            .await
            .map_err(ChangesError::Storage)?
        {
            Some(key) => self
                .inner
                .blobs
                .get_patch(&key)
                .await
                .map_err(ChangesError::Storage)?
                .unwrap_or_default(),
            None => String::new(),
        };
        let row = self.inner.sessions.get(session).await?;
        self.inner
            .drafts
            .draft(&row, &changeset, &patch)
            .await
            .map_err(ChangesError::Draft)
    }

    /// Run a capture on a task of its own. Safe to call from anywhere on a
    /// runtime - the session actor's task included - because it returns
    /// before any work happens.
    pub fn capture_in_background(&self, session: AgentSessionId) {
        let service = self.clone();
        let span = tracing::info_span!("agent.changes.capture", agent.session.id = %session);
        tokio::spawn(
            async move {
                if let Err(error) = service.capture(session).await {
                    tracing::warn!(error = ?error, %session, "capturing session changes failed");
                }
            }
            .instrument(span),
        );
    }

    /// Capture the session's changes now, rerunning once if another capture
    /// was requested while this one ran.
    pub async fn capture(&self, session: AgentSessionId) -> Result<CaptureOutcome> {
        if !self.claim(session) {
            return Ok(CaptureOutcome::Queued);
        }
        let mut outcome = self.capture_once(session).await;
        while self.release(session) {
            // Somebody asked again mid-capture; their request is the newer
            // state, so capture once more before letting go.
            if !self.claim(session) {
                break;
            }
            outcome = self.capture_once(session).await;
        }
        outcome
    }

    /// Take the session's capture slot, or note a rerun if it is taken.
    fn claim(&self, session: AgentSessionId) -> bool {
        let mut in_flight = self
            .inner
            .in_flight
            .lock()
            .expect("in-flight table poisoned");
        match in_flight.get_mut(&session) {
            Some(rerun) => {
                *rerun = true;
                false
            }
            None => {
                in_flight.insert(session, false);
                true
            }
        }
    }

    /// Give the slot back. Whether a rerun was asked for meanwhile.
    fn release(&self, session: AgentSessionId) -> bool {
        let mut in_flight = self
            .inner
            .in_flight
            .lock()
            .expect("in-flight table poisoned");
        in_flight.remove(&session).unwrap_or(false)
    }

    async fn capture_once(&self, session: AgentSessionId) -> Result<CaptureOutcome> {
        let started_at = Utc::now();
        let row = self.inner.sessions.get(session).await?;
        self.inner
            .repo
            .begin_attempt(session, started_at)
            .await
            .map_err(ChangesError::Storage)?;
        // Viewers learn a capture is running the same way they learn it
        // ended: by re-reading the summary.
        self.notify(session).await;

        let extracted = self.inner.extractor.extract(&row).await;
        let outcome = match extracted {
            Ok(extracted) => self.store(&row, extracted).await,
            Err(ExtractError::Unsupported { harness }) => {
                tracing::info!(%session, harness, "changes are not available for this harness");
                self.fail(
                    session,
                    AttemptOutcome::Unsupported,
                    format!("Changes are not available for the {harness} harness."),
                )
                .await
                .map(|()| CaptureOutcome::Unsupported)
            }
            Err(ExtractError::NotReady(reason)) => {
                tracing::info!(%session, reason, "changes are not ready to capture");
                self.fail(session, AttemptOutcome::NotReady, reason)
                    .await
                    .map(|()| CaptureOutcome::NotReady)
            }
            Err(ExtractError::Failed(report)) => {
                tracing::warn!(%session, error = ?report, "extracting session changes failed");
                self.fail(
                    session,
                    AttemptOutcome::Failed,
                    "Collecting the changes failed. Try again after the agent's next turn."
                        .to_owned(),
                )
                .await
                .map(|()| CaptureOutcome::Failed)
            }
        };
        self.notify(session).await;
        outcome
    }

    async fn store(
        &self,
        row: &AgentSession,
        extracted: super::model::ExtractedChangeset,
    ) -> Result<CaptureOutcome> {
        let session = row.id;
        let parsed = patch::parse_git_patch(&extracted.patch);
        let budgeted = patch::budget_patch(parsed, MAX_PATCH_BYTES, MAX_FILE_PATCH_BYTES);
        let (additions, deletions) = patch::totals(&budgeted.files);
        let id = ChangesetId::new();
        let key = (!budgeted.patch.is_empty()).then(|| PatchBlobKey::for_changeset(session, id));
        if let Some(key) = &key {
            if let Err(error) = self.inner.blobs.put_patch(key, &budgeted.patch).await {
                let _ = self
                    .fail(
                        session,
                        AttemptOutcome::Failed,
                        "Storing the changes failed.".to_owned(),
                    )
                    .await;
                return Err(ChangesError::Storage(error));
            }
        }
        let changeset = Changeset {
            id,
            session,
            source: extracted.source,
            range: extracted.range,
            patch_bytes: budgeted.patch.len() as u64,
            files: budgeted.files,
            additions,
            deletions,
            truncated: budgeted.truncated || extracted.truncated,
            captured_at: Utc::now(),
        };
        let superseded = match self
            .inner
            .repo
            .record_changeset(&changeset, key.as_ref(), Utc::now())
            .await
        {
            Ok(superseded) => superseded,
            Err(error) => {
                let _ = self
                    .fail(
                        session,
                        AttemptOutcome::Failed,
                        "Storing the changes failed.".to_owned(),
                    )
                    .await;
                return Err(ChangesError::Storage(error));
            }
        };
        // The old patch is unreachable now that the row points elsewhere;
        // deleting it is tidiness, not correctness, so a failure only logs.
        if let Some(old) = superseded
            && key.as_ref() != Some(&old)
            && let Err(error) = self.inner.blobs.delete_patch(&old).await
        {
            tracing::warn!(error = ?error, %session, key = %old, "could not delete a superseded patch");
        }
        tracing::info!(
            %session,
            files = changeset.files.len(),
            additions,
            deletions,
            truncated = changeset.truncated,
            source = %changeset.source,
            "captured session changes"
        );
        Ok(CaptureOutcome::Captured(changeset))
    }

    async fn fail(
        &self,
        session: AgentSessionId,
        outcome: AttemptOutcome,
        reason: String,
    ) -> Result<()> {
        self.inner
            .repo
            .record_failure(session, outcome, Some(&reason), Utc::now())
            .await
            .map_err(ChangesError::Storage)
    }

    async fn notify(&self, session: AgentSessionId) {
        if let Err(error) = self.inner.realtime.publish_changes_updated(session).await {
            tracing::warn!(error = ?error, %session, "could not publish a changes update");
        }
    }
}

impl<Sessions, Extractor, Repo, Blobs, Realtime, Drafts> AgentChanges
    for AgentChangesService<Sessions, Extractor, Repo, Blobs, Realtime, Drafts>
where
    Sessions: AgentSessionRepo,
    Extractor: ChangesetExtractor,
    Repo: ChangesetRepo,
    Blobs: ChangesetBlobStore,
    Realtime: AgentSessionRealtime + Send + Sync + 'static,
    Drafts: PullRequestDraftGenerator,
{
    async fn changes(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SessionChanges> {
        self.read_changes(access).await
    }

    async fn patch(&self, access: &EntityAccessReceipt<ViewAccessLevel>) -> Result<String> {
        self.read_patch(access).await
    }

    async fn request_capture(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<SessionChanges> {
        self.start_capture(access).await
    }

    async fn draft_pull_request(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<PullRequestDraft> {
        self.draft(access).await
    }
}

/// The session a receipt is for. Anything else is a wiring bug: every route
/// here resolves access against an agent session.
fn session_of<T: RequiredPermission>(access: &EntityAccessReceipt<T>) -> Result<AgentSessionId> {
    if access.entity().entity_type != EntityType::AgentSession {
        return Err(ChangesError::Forbidden);
    }
    let id = Uuid::parse_str(&access.entity().entity_id).map_err(|_| ChangesError::Forbidden)?;
    Ok(AgentSessionId::new_from_uuid(id))
}

/// Captures a session's changes each time one of its turns ends.
///
/// The observer runs on the session actor's task, so it only spawns; the
/// capture itself - a provider round trip and two writes - happens elsewhere.
pub struct CaptureOnTurnEnd<Service> {
    service: Service,
}

impl<Service> CaptureOnTurnEnd<Service> {
    /// Capture through `service` whenever a turn ends.
    pub fn new(service: Service) -> Self {
        Self { service }
    }
}

impl<Sessions, Extractor, Repo, Blobs, Realtime, Drafts> SessionTurnObserver
    for CaptureOnTurnEnd<AgentChangesService<Sessions, Extractor, Repo, Blobs, Realtime, Drafts>>
where
    Sessions: AgentSessionRepo,
    Extractor: ChangesetExtractor,
    Repo: ChangesetRepo,
    Blobs: ChangesetBlobStore,
    Realtime: AgentSessionRealtime + Send + Sync + 'static,
    Drafts: PullRequestDraftGenerator,
{
    fn signal(&self, id: AgentSessionId, signal: agent_fold::domain::model::TurnSignal) {
        if matches!(
            signal,
            agent_fold::domain::model::TurnSignal::TurnEnded { .. }
        ) {
            self.service.capture_in_background(id);
        }
    }

    fn session_stopped(&self, _id: AgentSessionId, _reason: StopReason) {}
}
