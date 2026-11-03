//! Archives sessions whose pull requests merged, from the pull request topic.
//!
//! Every stored pull request change is published after it commits, so the status this reads is
//! at least as new as the event. Offsets are committed after each event; a lookup that keeps
//! failing is logged and skipped so one pull request never stalls its partition.

use std::time::Duration;

use agent_session::domain::auto_archive::AutoArchive;
use github_pull_requests::broker::{GithubPullRequestMacroEvent, GithubPullRequestTopicEvent};
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer, consumer_span, record_span_error};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::BorrowedMessage;
use tokio_retry::{Retry, strategy::ExponentialBackoff};
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

/// Consumer group owning the pull request offsets of session auto-archive.
struct PullRequestArchiveConsumerGroup;

impl GroupName for PullRequestArchiveConsumerGroup {
    const GROUP_NAME: &'static str = "agent-harness-pull-request-archive";
    // Merges from before this consumer existed predate every opt-in.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

macro_event_broker::declare_topics!(DeclaredMacroEvent: GithubPullRequestMacroEvent);

type ArchiveKafkaAdapter =
    KafkaConsumerAdapter<PullRequestArchiveConsumerGroup, DeclaredMacroEvent>;
type ArchiveConsumer = MacroEventConsumerService<DeclaredMacroEvent, ArchiveKafkaAdapter>;

const LOOKUP_ATTEMPTS: usize = 3;

/// Consume pull request changes until `shutdown`, archiving the sessions they finish.
pub async fn run(
    brokers: &str,
    auto_archive: &impl AutoArchive,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let consumer = KafkaEventConsumer::<PullRequestArchiveConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<PullRequestArchiveConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| {
            anyhow::anyhow!("failed to subscribe to pull request events: {error:?}")
        })?;
    let consumer = ArchiveConsumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = PullRequestArchiveConsumerGroup::GROUP_NAME,
        "pull request auto-archive consumer listening"
    );
    loop {
        tokio::select! {
            () = shutdown.cancelled() => return Ok(()),
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "failed to receive pull request event");
                        continue;
                    }
                };
                let kafka_message = message.inner();
                let span = consumer_span(kafka_message, PullRequestArchiveConsumerGroup::GROUP_NAME);
                async {
                    match message.decode_payload() {
                        Ok(DeclaredMacroEvent::GithubPullRequestMacroEvent(event)) => {
                            tracing::Span::current()
                                .record("macro.event.id", tracing::field::display(event.event().event_id));
                            let GithubPullRequestTopicEvent::Updated(update) = &event.event().event;
                            archive_finished_sessions(auto_archive, &update.github_key).await;
                        }
                        Err(error) => {
                            record_span_error(&tracing::Span::current(), &error);
                            tracing::error!(error = ?error, "dropping undecodable pull request event");
                        }
                    }
                    commit(&consumer, kafka_message);
                }
                .instrument(span)
                .await;
            }
        }
    }
}

async fn archive_finished_sessions(auto_archive: &impl AutoArchive, github_key: &str) {
    let retries = ExponentialBackoff::from_millis(2)
        .factor(100)
        .max_delay(Duration::from_secs(5))
        .take(LOOKUP_ATTEMPTS - 1);
    Retry::start(retries, || auto_archive.pull_request_changed(github_key))
        .await
        .inspect_err(|error| {
            tracing::error!(
                error = ?error,
                %github_key,
                attempts = LOOKUP_ATTEMPTS,
                "skipping session auto-archive for a pull request after lookup retries"
            );
        })
        .ok();
}

fn commit(consumer: &ArchiveConsumer, message: &BorrowedMessage<'_>) {
    consumer
        .inner()
        .commit_message(message, CommitMode::Async)
        .inspect_err(|error| {
            tracing::warn!(error = ?error, "failed to commit pull request auto-archive offset");
        })
        .ok();
}
