//! Collecting a finished turn's files from the provider that holds them.
//!
//! Cursor's walkthrough screenshots and screen recordings never reach the ACP
//! stream, so nothing writes them to the log as they happen. They are pulled
//! instead: when a turn ends, the provider is asked what it has, the answer is
//! diffed against the keys the log already carries, and the difference is
//! appended as one `artifacts` frame naming that turn.

use std::collections::BTreeSet;
use std::time::Duration;

use agent_fold::domain::model::TurnId;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use tracing::Instrument as _;

use super::*;

/// How long to wait before asking a second time when the first listing came
/// back empty.
///
/// Cursor uploads a run's files as the run finishes, so the listing can still
/// be empty at the moment the result event that ends the turn arrives. One
/// delayed retry turns that race into a short wait. Anything it still misses
/// is not lost: the next turn end diffs the keys afresh and collects it then.
const EMPTY_COLLECTION_RETRY: Duration = Duration::from_secs(5);

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
    Artifacts,
>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
        Artifacts,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
    Artifacts: ArtifactSource,
{
    /// Collect what the provider holds for `session` that the log does not,
    /// on a task of its own.
    ///
    /// Detached because the collection outlives the turn that starts it - it
    /// retries after a delay - and nothing about dispatching the next queued
    /// prompt should wait on a provider's network call. One collection per
    /// session at a time; a turn that ends while one is still running is
    /// skipped rather than queued, because the next end diffs keys afresh and
    /// so collects whatever this one missed.
    pub(super) fn collect_artifacts(
        self: &Arc<Self>,
        session_id: AgentSessionId,
        turn: TurnId,
        known_artifact_keys: BTreeSet<String>,
    ) {
        if self.collecting.insert(session_id, ()).is_some() {
            tracing::debug!(%session_id, "an artifact collection is already running");
            return;
        }
        let inner = Arc::clone(self);
        let span = tracing::info_span!(
            parent: tracing::Span::current(),
            "agent.artifacts.collect",
            agent.session.id = %session_id,
            agent.turn.id = turn.0,
            artifacts.known = known_artifact_keys.len(),
            artifacts.collected = tracing::field::Empty,
            artifacts.retried = tracing::field::Empty,
        );
        tokio::spawn(
            async move {
                inner
                    .run_collection(session_id, turn, known_artifact_keys)
                    .await;
                inner.collecting.remove(&session_id);
            }
            .instrument(span),
        );
    }

    async fn run_collection(
        &self,
        session_id: AgentSessionId,
        turn: TurnId,
        known_artifact_keys: BTreeSet<String>,
    ) {
        let session = match self.sessions.get_session(session_id).await {
            Ok(session) => session,
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    %session_id,
                    "could not read a session to collect its artifacts"
                );
                return;
            }
        };
        // A sandboxed session's files never leave its container, so there is
        // no provider holding anything to ask for.
        let Some(external) = session.external else {
            return;
        };
        // The owner's key is the only one that can read their agent: a
        // session runs on the Cursor account of whoever created it.
        let owner = session.owner_id;

        let span = tracing::Span::current();
        let mut collected = match self
            .artifacts
            .collect(&owner, &external, &known_artifact_keys)
            .await
        {
            Ok(collected) => collected,
            Err(error) => {
                tracing::warn!(error = ?error, %session_id, "could not collect session artifacts");
                return;
            }
        };
        if collected.is_empty() {
            span.record("artifacts.retried", true);
            tokio::time::sleep(EMPTY_COLLECTION_RETRY).await;
            collected = match self
                .artifacts
                .collect(&owner, &external, &known_artifact_keys)
                .await
            {
                Ok(collected) => collected,
                Err(error) => {
                    tracing::warn!(
                        error = ?error,
                        %session_id,
                        "could not collect session artifacts on the retry"
                    );
                    return;
                }
            };
        }
        span.record("artifacts.collected", collected.len());
        if collected.is_empty() {
            return;
        }
        if let Err(error) = self
            .sessions
            .record_frame(
                session_id,
                ToServerMessage::Artifacts {
                    turn: Some(turn.0),
                    artifacts: collected,
                },
            )
            .await
        {
            tracing::warn!(error = ?error, %session_id, "could not log collected session artifacts");
        }
    }
}
