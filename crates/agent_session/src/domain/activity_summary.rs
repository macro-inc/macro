//! A running session's tool calls, summarized as one live status line
//! ("Searching your workspace…") by a cheap model.
//!
//! A turn can make thousands of calls, so the model is never asked once per
//! call. Each turn gets one task that waits for new calls, summarizes the
//! newest state, then rests: [`FAST_INTERVAL`] for the first
//! [`FAST_SUMMARIES`] summaries, [`SLOW_INTERVAL`] after, and none past
//! [`MAX_SUMMARIES_PER_TURN`]. Calls made while it rests coalesce into the
//! next summary. The line is ephemeral: it is published to live viewers and
//! never stored. The [`KILL_SWITCH_FLAG`] turns it off per owner.

use std::sync::Arc;
use std::time::Duration;

use agent_fold::domain::model::{ProjectedSegment, SegmentKind, TurnId, TurnSignal};
use ai_billing::{AiAdmissionService, AiFeature};
use ai_usage::UsageContext;
use dashmap::DashMap;
use feature_flags::FeatureFlags;
use serde::Serialize;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::model::{AgentSessionActivitySummarized, AgentSessionId};
use super::ports::{AgentSessionRealtime, AgentSessionRepo, SessionTurnObserver};
use super::session::StopReason;

#[cfg(test)]
mod test;

/// Rest after each of a turn's first [`FAST_SUMMARIES`] summaries.
pub const FAST_INTERVAL: Duration = Duration::from_secs(4);
/// Summaries a turn gets at [`FAST_INTERVAL`] before slowing down.
pub const FAST_SUMMARIES: u8 = 10;
/// Rest after every later summary.
pub const SLOW_INTERVAL: Duration = Duration::from_secs(15);
/// Model calls one turn may make; the line keeps its last summary after.
pub const MAX_SUMMARIES_PER_TURN: u8 = 120;
/// Newest steps the model is shown.
const MAX_DIGEST_STEPS: usize = 10;
/// The PostHog flag that turns summaries off. Unset, unreadable or without a
/// flag client, summaries stay on.
pub const KILL_SWITCH_FLAG: &str = "disable-agent-activity-summary";

/// What a turn's tool calls look like right now: the newest steps, worded as
/// the session's own activity rows already show them to every reader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActivityDigest {
    /// Steps the turn has taken so far.
    pub total_steps: usize,
    /// The newest steps, oldest first.
    pub steps: Vec<ActivityStep>,
}

/// One step of an [`ActivityDigest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActivityStep {
    /// The row's verb phrase: `Ran`, `Reading`, `Search documents`.
    pub label: String,
    /// What it acted on, already cut to the row's display length.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ActivityDigest {
    /// The digest of a reply's segments, or `None` before its first step.
    #[must_use]
    pub fn from_segments(segments: &[ProjectedSegment]) -> Option<Self> {
        let rows: Vec<_> = segments
            .iter()
            .filter(|projected| projected.segment.kind == SegmentKind::Activity)
            .flat_map(|projected| &projected.segment.rows)
            .collect();
        if rows.is_empty() {
            return None;
        }

        let newest = rows.len().saturating_sub(MAX_DIGEST_STEPS);
        let steps = rows
            .get(newest..)
            .unwrap_or_default()
            .iter()
            .map(|row| ActivityStep {
                label: row.label.clone(),
                detail: row.detail.clone(),
            })
            .collect();
        Some(Self {
            total_steps: rows.len(),
            steps,
        })
    }
}

/// Words a running turn's newest steps as one short status line.
pub trait ActivitySummarizer: Send + Sync + 'static {
    /// The status line, or `None` when the model had nothing usable.
    /// `previous` is the line viewers see now, so the next one reads on.
    fn summarize(
        &self,
        usage: UsageContext,
        previous: Option<&str>,
        digest: &ActivityDigest,
    ) -> impl Future<Output = Result<Option<String>, rootcause::Report>> + Send;
}

/// How long a turn's summary task rests after its `summaries`-th summary.
#[must_use]
pub fn rest_after(summaries: u8) -> Duration {
    if summaries < FAST_SUMMARIES {
        FAST_INTERVAL
    } else {
        SLOW_INTERVAL
    }
}

/// Summarize one turn until it ends: wait for a digest with steps the last
/// summary had not seen, summarize it, rest, repeat. `summarize` gets the
/// digest and the previous line and returns the line it published, if any.
///
/// Returns when `ended` is cancelled, when the digest sender is dropped, or
/// after [`MAX_SUMMARIES_PER_TURN`] calls; true when any line was published.
pub async fn summarize_turn<Summarize, Fut>(
    mut digests: watch::Receiver<Option<ActivityDigest>>,
    ended: CancellationToken,
    mut summarize: Summarize,
) -> bool
where
    Summarize: FnMut(ActivityDigest, Option<String>) -> Fut,
    Fut: Future<Output = Option<String>>,
{
    let mut summaries: u8 = 0;
    let mut summarized_steps = 0;
    let mut previous: Option<String> = None;
    loop {
        let digest = digests.borrow_and_update().clone();
        let fresh = digest.filter(|digest| digest.total_steps > summarized_steps);
        let Some(digest) = fresh else {
            tokio::select! {
                () = ended.cancelled() => break,
                changed = digests.changed() => {
                    if changed.is_err() {
                        break;
                    }
                }
            }
            continue;
        };

        summarized_steps = digest.total_steps;
        summaries = summaries.saturating_add(1);
        let line = tokio::select! {
            () = ended.cancelled() => break,
            line = summarize(digest, previous.clone()) => line,
        };
        if line.is_some() {
            previous = line;
        }
        if summaries >= MAX_SUMMARIES_PER_TURN {
            break;
        }

        tokio::select! {
            () = ended.cancelled() => break,
            () = tokio::time::sleep(rest_after(summaries)) => {}
        }
    }
    previous.is_some()
}

/// The live summary task of a session's running turn.
struct RunningTurn {
    turn: TurnId,
    digests: watch::Sender<Option<ActivityDigest>>,
    ended: CancellationToken,
}

/// A [`SessionTurnObserver`] that keeps one summary task per running turn
/// and publishes each line to the session's viewers.
pub struct ActivitySummaries<R, Rt, S, Flags> {
    repo: R,
    realtime: Rt,
    summarizer: Arc<S>,
    admission: Arc<dyn AiAdmissionService>,
    flags: Option<Arc<Flags>>,
    running: DashMap<AgentSessionId, RunningTurn>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

impl<R, Rt, S, Flags> ActivitySummaries<R, Rt, S, Flags> {
    /// Summarize with `summarizer`, admitted per turn against the session's
    /// owner by `admission` unless `flags` has the [`KILL_SWITCH_FLAG`] on
    /// for them. Tasks are tracked by `tasks` and stop on `shutdown`.
    pub fn new(
        repo: R,
        realtime: Rt,
        summarizer: S,
        admission: Arc<dyn AiAdmissionService>,
        flags: Option<Flags>,
        tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            repo,
            realtime,
            summarizer: Arc::new(summarizer),
            admission,
            flags: flags.map(Arc::new),
            running: DashMap::new(),
            tasks,
            shutdown,
        }
    }

    fn end(&self, id: AgentSessionId) {
        if let Some((_, turn)) = self.running.remove(&id) {
            turn.ended.cancel();
        }
    }
}

impl<R, Rt, S, Flags> ActivitySummaries<R, Rt, S, Flags>
where
    R: AgentSessionRepo + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
    S: ActivitySummarizer,
    Flags: FeatureFlags + 'static,
{
    fn progressed(&self, id: AgentSessionId, turn: TurnId, digest: ActivityDigest) {
        if let Some(running) = self.running.get(&id)
            && running.turn == turn
        {
            running.digests.send_replace(Some(digest));
            return;
        }

        self.end(id);
        let (digests, receiver) = watch::channel(Some(digest));
        let ended = self.shutdown.child_token();
        let replaced = self.running.insert(
            id,
            RunningTurn {
                turn,
                digests,
                ended: ended.clone(),
            },
        );
        if let Some(replaced) = replaced {
            replaced.ended.cancel();
        }
        let span = tracing::info_span!(
            "agent.session.activity_turn",
            agent.session.id = %id,
            agent.turn.id = turn.0,
            agent.activity.admission = tracing::field::Empty,
        );
        self.tasks.spawn(
            run_turn(
                self.repo.clone(),
                self.realtime.clone(),
                Arc::clone(&self.summarizer),
                Arc::clone(&self.admission),
                self.flags.clone(),
                id,
                turn,
                receiver,
                ended,
            )
            .instrument(span),
        );
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "one detached task's inputs, passed once"
)]
async fn run_turn<R, Rt, S, Flags>(
    repo: R,
    realtime: Rt,
    summarizer: Arc<S>,
    admission: Arc<dyn AiAdmissionService>,
    flags: Option<Arc<Flags>>,
    id: AgentSessionId,
    turn: TurnId,
    digests: watch::Receiver<Option<ActivityDigest>>,
    ended: CancellationToken,
) where
    R: AgentSessionRepo,
    Rt: AgentSessionRealtime,
    S: ActivitySummarizer,
    Flags: FeatureFlags,
{
    let admitted = |outcome: &'static str| {
        tracing::Span::current().record("agent.activity.admission", outcome);
    };
    let usage = async {
        let session = repo
            .get(id)
            .await
            .map_err(|error| rootcause::report!(error))?;
        // A session owned by no person has nobody to bill, and is the kind
        // that runs unattended through thousands of calls: it gets no line.
        let Ok(owner) = session.owner_user() else {
            admitted("no_owner");
            return Ok::<_, rootcause::Report>(None);
        };
        if let Some(flags) = &flags {
            let killed = flags
                .load(owner)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, %id, "could not read the agent activity summary flag");
                })
                .is_ok_and(|snapshot| snapshot.is_enabled(KILL_SWITCH_FLAG));
            if killed {
                admitted("killed");
                return Ok(None);
            }
        }
        if let Err(error) = admission
            .admit(owner, AiFeature::AgentActivitySummary)
            .await
        {
            tracing::debug!(code = error.code(), %id, "skipping agent activity summaries");
            admitted("refused");
            return Ok(None);
        }
        admitted("admitted");
        Ok(Some(
            UsageContext::new(AiFeature::AgentActivitySummary, owner.clone())
                .with_entity(Some(id.as_uuid()))
                .with_agent_session(Some(id.as_uuid())),
        ))
    }
    .await;
    let usage = match usage {
        Ok(Some(usage)) => usage,
        Ok(None) => return,
        Err(error) => {
            admitted("failed");
            tracing::warn!(error = ?error, %id, "failed to admit agent activity summaries");
            return;
        }
    };

    let published = summarize_turn(digests, ended.clone(), |digest, previous| {
        let span = tracing::info_span!(
            "agent.session.activity_summary",
            agent.session.id = %id,
            agent.turn.id = turn.0,
            agent.activity.steps = digest.total_steps,
            agent.activity.outcome = tracing::field::Empty,
        );
        let summarizer = Arc::clone(&summarizer);
        let realtime = &realtime;
        let usage = usage.clone();
        async move {
            let span = tracing::Span::current();
            let line = async {
                let Some(text) = summarizer
                    .summarize(usage, previous.as_deref(), &digest)
                    .await?
                else {
                    return Ok::<_, rootcause::Report>(None);
                };
                realtime
                    .publish_activity_summarized(AgentSessionActivitySummarized {
                        agent_session_id: id,
                        text: Some(text.clone()),
                    })
                    .await?;
                Ok(Some(text))
            }
            .await;
            match line {
                Ok(Some(text)) => {
                    span.record("agent.activity.outcome", "published");
                    Some(text)
                }
                Ok(None) => {
                    span.record("agent.activity.outcome", "empty");
                    None
                }
                Err(error) => {
                    span.record("agent.activity.outcome", "failed");
                    tracing::warn!(error = ?error, %id, "failed to summarize agent activity");
                    None
                }
            }
        }
        .instrument(span)
    })
    .await;

    // A line past the turn cap stays up until the turn ends; then viewers
    // are told it is over, so none carries it into the next turn.
    ended.cancelled().await;
    if published {
        let _ = realtime
            .publish_activity_summarized(AgentSessionActivitySummarized {
                agent_session_id: id,
                text: None,
            })
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, %id, "failed to clear agent activity summary");
            });
    }
}

impl<R, Rt, S, Flags> SessionTurnObserver for ActivitySummaries<R, Rt, S, Flags>
where
    R: AgentSessionRepo + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
    S: ActivitySummarizer,
    Flags: FeatureFlags + 'static,
{
    fn signal(&self, id: AgentSessionId, signal: TurnSignal) {
        match signal {
            TurnSignal::Progressed {
                turn,
                phase: Some(_),
                segments,
                ..
            } => {
                if let Some(digest) = ActivityDigest::from_segments(&segments) {
                    self.progressed(id, turn, digest);
                }
            }
            TurnSignal::Progressed { phase: None, .. } | TurnSignal::TurnEnded { .. } => {
                self.end(id);
            }
            TurnSignal::ElicitationRaised { .. } | TurnSignal::ElicitationCleared { .. } => {}
        }
    }

    fn session_stopped(&self, id: AgentSessionId, _reason: StopReason) {
        self.end(id);
    }

    fn runtime_closed(&self, _id: AgentSessionId) {}
}
