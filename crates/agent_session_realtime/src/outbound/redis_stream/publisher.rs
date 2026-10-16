use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_session::domain::events::LogAppendedMetadata;
use agent_session::domain::model::{AgentSessionId, AgentSessionRenamed, LogAppended};
use agent_session::domain::ports::{AgentSessionQueueChanged, AgentSessionRealtime};
use redis::aio::MultiplexedConnection;
use redis::streams::{StreamAddOptions, StreamTrimStrategy, StreamTrimmingMode};
use redis::{AsyncCommands as _, AsyncConnectionConfig};
use rootcause::Report;
use rootcause::prelude::ResultExt as _;

use super::{STREAM_KEY, WIRE_VERSION, encode, field, now_ms, retention_floor};

/// How long one `XADD` may take. Generous: a run can carry megabytes of tool
/// output, which the client's 500 ms default does not leave room for.
const PUBLISH_RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

/// How long connecting to Redis may take before a publish gives up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// A run this large is logged with its largest frame, so whatever produces
/// oversized frames can be found from the logs.
const LARGE_RUN_BYTES: usize = 1024 * 1024;

/// [`AgentSessionRealtime`] that also appends each run of frames to the
/// agent session log stream, so a process serving viewers of its own - the
/// GraphQL subscription in document storage - hears the frames too.
///
/// `inner` keeps doing what it does, and its result is what `publish`
/// returns. The stream append is best effort, as the port allows: a failure
/// is logged at error, because a viewer reading through the stream misses the
/// run until it refetches.
///
/// Clones share one connection.
#[derive(Clone)]
pub struct RedisLogStreamRealtime<Inner> {
    inner: Inner,
    client: redis::Client,
    stream: String,
    connection: Arc<tokio::sync::Mutex<Option<MultiplexedConnection>>>,
}

impl<Inner> RedisLogStreamRealtime<Inner> {
    /// Publish through `inner`, and append each log run through `client` too.
    /// Connects lazily, on the first run.
    pub fn new(inner: Inner, client: redis::Client) -> Self {
        Self::to_stream(inner, client, STREAM_KEY.to_owned())
    }

    /// [`Self::new`], appending to a stream other than [`STREAM_KEY`].
    pub(crate) fn to_stream(inner: Inner, client: redis::Client, stream: String) -> Self {
        Self {
            inner,
            client,
            stream,
            connection: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// A connection, opened if there is none. Multiplexed and cheap to clone,
    /// so concurrent publishes share it.
    async fn connection(&self) -> Result<MultiplexedConnection, Report> {
        let mut held = self.connection.lock().await;
        if let Some(connection) = held.as_ref() {
            return Ok(connection.clone());
        }
        let config = AsyncConnectionConfig::new()
            .set_connection_timeout(Some(CONNECT_TIMEOUT))
            .set_response_timeout(Some(PUBLISH_RESPONSE_TIMEOUT));
        let connection = self
            .client
            .get_multiplexed_async_connection_with_config(&config)
            .await
            .context("failed to connect to Redis to publish agent session log runs")?;
        tracing::info!(
            messaging.destination.name = %self.stream,
            "connected the agent session log stream publisher"
        );
        *held = Some(connection.clone());
        Ok(connection)
    }

    /// Forget the connection after a failure, so the next publish reconnects
    /// rather than reusing a broken one.
    async fn reset_connection(&self) {
        self.connection.lock().await.take();
    }

    /// Append one run to the stream, trimming whatever is past retention.
    #[tracing::instrument(
        name = "agent.session.log_stream.publish",
        err,
        skip_all,
        fields(
            otel.kind = "producer",
            messaging.system = "redis",
            messaging.operation.name = "publish",
            messaging.operation.type = "send",
            messaging.destination.name = %self.stream,
            messaging.message.id = tracing::field::Empty,
            messaging.message.body.size = tracing::field::Empty,
            agent.session.id = %run.agent_session_id,
            agent.log.frame_count = run.entries.len(),
            agent.log.encode_us = tracing::field::Empty,
            agent.log.redis_ms = tracing::field::Empty,
            agent.log.large_run = tracing::field::Empty,
        )
    )]
    async fn append(&self, run: &LogAppendedMetadata) -> Result<String, Report> {
        let span = tracing::Span::current();

        let started = Instant::now();
        let payload = encode(run)?;
        span.record(
            "agent.log.encode_us",
            u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX),
        );
        span.record("messaging.message.body.size", payload.len());
        let large = payload.len() >= LARGE_RUN_BYTES;
        span.record("agent.log.large_run", large);
        if large {
            log_large_run(run, payload.len());
        }

        let published_at = now_ms();
        let options = StreamAddOptions::default().trim(StreamTrimStrategy::minid(
            StreamTrimmingMode::Approx,
            retention_floor(published_at),
        ));
        let fields = [
            (field::VERSION, WIRE_VERSION.to_string()),
            (field::SESSION, run.agent_session_id.to_string()),
            (field::FRAMES, run.entries.len().to_string()),
            (field::PUBLISHED_AT_MS, published_at.to_string()),
            (field::PAYLOAD, payload),
        ];

        let mut connection = self.connection().await?;
        let started = Instant::now();
        let added: Result<Option<String>, _> = connection
            .xadd_options(&self.stream, "*", &fields, &options)
            .await;
        span.record(
            "agent.log.redis_ms",
            u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        );
        let entry_id = match added {
            Ok(Some(entry_id)) => entry_id,
            Ok(None) => {
                return Err(rootcause::report!(
                    "Redis accepted the XADD but returned no entry id"
                ));
            }
            Err(error) => {
                self.reset_connection().await;
                return Err(Report::new(error)
                    .context("failed to XADD an agent session log run")
                    .into_dynamic());
            }
        };
        span.record("messaging.message.id", entry_id.as_str());
        Ok(entry_id)
    }
}

/// Log a run that crossed [`LARGE_RUN_BYTES`] with the size and id of its
/// largest frame. Sizes only: frames are session content, never logged.
fn log_large_run(run: &LogAppendedMetadata, body_size: usize) {
    let largest = run
        .entries
        .iter()
        .map(|entry| {
            let size = serde_json::to_vec(&entry.content)
                .map(|bytes| bytes.len())
                .unwrap_or_default();
            (entry.id, size)
        })
        .max_by_key(|(_, size)| *size);
    let (largest_frame_id, largest_frame_bytes) = largest.unwrap_or_default();
    tracing::warn!(
        agent.session.id = %run.agent_session_id,
        messaging.message.body.size = body_size,
        agent.log.frame_count = run.entries.len(),
        agent.log.largest_frame_id = %largest_frame_id,
        agent.log.largest_frame_bytes = largest_frame_bytes,
        "publishing a large agent session log run"
    );
}

impl<Inner> AgentSessionRealtime for RedisLogStreamRealtime<Inner>
where
    Inner: AgentSessionRealtime + Sync,
{
    async fn publish(&self, event: LogAppended) -> Result<(), Report> {
        let run = LogAppendedMetadata::from(&event);
        let inner = self.inner.publish(event).await;
        let _ = self.append(&run).await.inspect_err(|error| {
            tracing::error!(
                error = ?error,
                agent.session.id = %run.agent_session_id,
                agent.log.frame_count = run.entries.len(),
                "failed to append agent session log frames to the stream"
            );
        });
        inner
    }

    fn publish_updated(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        self.inner.publish_updated(session)
    }

    fn publish_renamed(
        &self,
        event: AgentSessionRenamed,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        self.inner.publish_renamed(event)
    }

    fn publish_queue_changed(
        &self,
        event: AgentSessionQueueChanged,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        self.inner.publish_queue_changed(event)
    }

    fn publish_changes_updated(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        self.inner.publish_changes_updated(session)
    }
}
