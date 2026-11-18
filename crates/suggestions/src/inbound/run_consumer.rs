//! Moves background runs along from their sessions' lifecycle events
//! (`macro.agent_session_lifecycle`): a turn settling, a question asked, a
//! command refused, the runtime stopping, the session deleted.
//!
//! Records are handled one at a time and committed after. Applying an event
//! twice moves a run at most once (moves compare and set the state read), so a
//! redelivered record does nothing new. A record that can't be decoded, or
//! keeps failing, is logged and committed so it never stalls the partition:
//! the reconcile sweep reads every unsettled run's session anyway, and covers
//! what an event missed.

#[cfg(test)]
mod test;

use std::future::Future;
use std::time::Duration;

use agent_session::domain::events::{AgentSessionLifecycleEvent, AgentSessionLifecycleMacroEvent};
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    EventConsumer, KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _,
    MacroEventConsumerService, MessageWrapper,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message};
use rootcause::Report;
use tracing::Instrument as _;

use crate::domain::ports::{RunEventOutcome, SuggestionRuns};
use crate::domain::run::{SessionEvent, SessionNews};

macro_event_broker::declare_topics!(SessionLifecycle: AgentSessionLifecycleMacroEvent);

struct SuggestionRunsGroup;

impl GroupName for SuggestionRunsGroup {
    const GROUP_NAME: &'static str = "suggestions-runs";
    // Runs only need what their sessions do from now on; the sweep covers
    // anything before.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

type RunsKafkaAdapter = KafkaConsumerAdapter<SuggestionRunsGroup, SessionLifecycle>;

const MAX_ATTEMPTS: u8 = 4;
// Three delays (1+2+4 seconds) before the fourth and final attempt.
const RETRY_BASE_DELAY: Duration = Duration::from_secs(1);
/// The stop reason of a turn that ended as asked.
const END_TURN: &str = "end_turn";

// Transport-only seam, so tests run the receive/apply/commit loop without a
// broker.
trait CommittingConsumer: EventConsumer<SessionLifecycle> {
    fn commit(&self, message: &Self::MessageType<'_>) -> Result<(), Report>;
}

impl CommittingConsumer for RunsKafkaAdapter {
    fn commit(&self, message: &BorrowedMessage<'_>) -> Result<(), Report> {
        self.commit_message(message, CommitMode::Sync)
    }
}

/// What a lifecycle event says about its session's run, if it might be one.
fn session_event(event: &AgentSessionLifecycleEvent) -> Option<SessionEvent> {
    let news = match event {
        AgentSessionLifecycleEvent::Settled(settled) => match &settled.last_turn {
            Some(turn) => SessionNews::TurnEnded {
                action: turn.action_id.as_uuid(),
                finished: turn.stop_reason == END_TURN,
            },
            None => SessionNews::Changed,
        },
        AgentSessionLifecycleEvent::WaitingForInput(waiting) => SessionNews::WaitingForInput {
            action: waiting.action_id.as_uuid(),
        },
        // A refused command never runs: its turn is over, unfinished.
        AgentSessionLifecycleEvent::CommandRejected(rejected) => SessionNews::TurnEnded {
            action: rejected.action_id.as_uuid(),
            finished: false,
        },
        AgentSessionLifecycleEvent::Stopped(_) => SessionNews::Changed,
        AgentSessionLifecycleEvent::Deleted(_) => SessionNews::Deleted,
        // A turn ending with more queued, or settling, is followed by
        // `settled`; the rest say nothing about how a run goes.
        AgentSessionLifecycleEvent::Opened(_)
        | AgentSessionLifecycleEvent::TurnStarted(_)
        | AgentSessionLifecycleEvent::TurnEnded(_)
        | AgentSessionLifecycleEvent::InputReceived(_)
        | AgentSessionLifecycleEvent::Mentioned(_)
        | AgentSessionLifecycleEvent::Renamed(_) => return None,
    };
    Some(SessionEvent {
        session: event.session_id().as_uuid(),
        news,
    })
}

/// Apply `event`, trying again while it fails or someone else holds the run.
async fn apply_with_retry(runs: &impl SuggestionRuns, event: SessionEvent, base_delay: Duration) {
    for attempt in 1..=MAX_ATTEMPTS {
        if attempt > 1 {
            tokio::time::sleep(base_delay * (1 << (attempt - 2))).await;
        }
        match runs.on_session_event(event).await {
            // The holder may have read the session before this event.
            Ok(RunEventOutcome::Busy) => {
                tracing::debug!(attempt, "suggestion run held elsewhere");
            }
            Ok(RunEventOutcome::Ignored | RunEventOutcome::Applied(_)) => return,
            // The `suggestions.run.session_event` span records the error.
            Err(_) => tracing::warn!(attempt, "applying a session event to its run failed"),
        }
    }
    tracing::warn!(
        outcome = "dropped",
        "session event not applied; left to the reconcile sweep"
    );
}

async fn process_message<C: CommittingConsumer>(
    consumer: &C,
    runs: &impl SuggestionRuns,
    message: &MessageWrapper<C::MessageType<'_>, SessionLifecycle>,
    base_delay: Duration,
) -> Result<(), Report> {
    match message.decode_payload() {
        Ok(SessionLifecycle::AgentSessionLifecycleMacroEvent(event)) => {
            if let Some(event) = session_event(&event.event().event) {
                apply_with_retry(runs, event, base_delay).await;
            }
        }
        Err(_) => {
            // Serde errors can carry payload strings; log only the outcome.
            tracing::warn!(outcome = "undecodable", "broker record skipped");
        }
    }
    consumer
        .commit(message.inner())
        .map_err(|_| rootcause::report!("suggestion runs offset commit failed"))
}

async fn consume<C>(
    consumer: C,
    runs: impl SuggestionRuns,
    shutdown: impl Future<Output = ()> + Send,
    base_delay: Duration,
) -> Result<(), Report>
where
    C: CommittingConsumer,
    for<'a> C::MessageType<'a>: Message,
{
    let consumer = MacroEventConsumerService::new(consumer);
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let message = tokio::select! {
            biased;
            _ = &mut shutdown => return Ok(()),
            result = consumer.recv() => {
                result.map_err(|_| rootcause::report!("suggestion runs consumer receive failed"))?
            }
        };
        let span = kafka_util::consumer_span(message.inner(), SuggestionRunsGroup::GROUP_NAME);
        tokio::select! {
            biased;
            // Uncommitted: the record is redelivered, and applying it again
            // moves nothing twice.
            _ = &mut shutdown => return Ok(()),
            result = process_message(consumer.inner(), &runs, &message, base_delay)
                .instrument(span.clone()) => {
                result.inspect_err(|error| kafka_util::record_span_error(&span, error))?;
            }
        }
    }
}

/// Move background runs along from session lifecycle events under their own
/// consumer group, until `shutdown`. Receive and commit failures end it;
/// restart it with a fresh consumer.
pub async fn run_suggestion_runs_consumer(
    brokers: &str,
    runs: impl SuggestionRuns,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<SuggestionRunsGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<SuggestionRunsGroup, ()>::new(consumer)
        .subscribe::<SessionLifecycle>()?;
    tracing::info!(
        topics = ?SessionLifecycle::topics(),
        group = SuggestionRunsGroup::GROUP_NAME,
        "suggestion runs consumer listening"
    );
    consume(consumer, runs, shutdown, RETRY_BASE_DELAY).await
}
