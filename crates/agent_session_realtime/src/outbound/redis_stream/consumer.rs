#[cfg(test)]
mod test;

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use redis::aio::MultiplexedConnection;
use redis::streams::{
    StreamId, StreamInfoConsumersReply, StreamInfoGroupsReply, StreamReadOptions, StreamReadReply,
};
use redis::{AsyncCommands as _, AsyncConnectionConfig, RedisError};
use rootcause::Report;
use rootcause::prelude::ResultExt as _;

use super::{GROUP_PREFIX, STREAM_KEY, WIRE_VERSION, decode, entry_id_ms, field, now_ms};
use crate::domain::ports::{AgentSessionLogConsumer, DeliveryId, ReceivedRun};

/// How long one `XREADGROUP` blocks waiting for new entries. Bounded so the
/// read loop comes back up regularly for housekeeping.
const READ_BLOCK: Duration = Duration::from_secs(5);

/// Entries one `XREADGROUP` returns at most.
const READ_COUNT: usize = 64;

/// How long connecting to Redis may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// How long a non-blocking command (`XACK`, `XINFO`, `XGROUP`) may take.
const COMMAND_RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);

/// How often the read loop logs the stream's and this group's state.
const STATS_INTERVAL: Duration = Duration::from_secs(60);

/// How often the read loop looks for groups their process abandoned.
const REAP_INTERVAL: Duration = Duration::from_secs(10 * 60);

/// A group whose every consumer has been idle this long belongs to a process
/// that is gone: a live one reads at least every [`READ_BLOCK`].
const ABANDONED_AFTER: Duration = Duration::from_secs(60 * 60);

/// Which entries the next read asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadMode {
    /// This consumer's own pending entries: delivered, never acknowledged.
    /// `XREADGROUP ... 0`.
    Pending,
    /// Entries never delivered to this group. `XREADGROUP ... >`.
    New,
}

impl ReadMode {
    fn id(self) -> &'static str {
        match self {
            Self::Pending => "0",
            Self::New => ">",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::New => "new",
        }
    }
}

/// An entry read but not yet handed out, with how it was read.
struct Buffered {
    entry: StreamId,
    mode: ReadMode,
}

/// Everything the read loop owns. Behind one lock: `recv` is called by one
/// fan-out loop at a time.
struct ReadState {
    /// Dedicated to `XREADGROUP`: a blocked read holds a multiplexed
    /// connection's pipeline, so nothing else shares it.
    connection: Option<MultiplexedConnection>,
    buffered: VecDeque<Buffered>,
    mode: ReadMode,
    last_stats: Instant,
    last_reap: Instant,
}

/// Reads [`STREAM_KEY`] through a consumer group of this process' own, at
/// least once.
///
/// The group starts at the stream's end, so the process receives runs
/// appended after it started. Every run it receives stays pending in the
/// group until [`AgentSessionLogConsumer::ack`]; after any failed read the
/// consumer reconnects and first rereads its own pending entries, so a run
/// in flight when the connection dropped is delivered again rather than
/// lost.
///
/// What it does not cover: entries trimmed before this process read them
/// (older than [`super::RETENTION`]), and a group lost with Redis itself.
/// Both are logged at error.
pub struct RedisLogStreamConsumer {
    client: redis::Client,
    stream: String,
    group: String,
    consumer: String,
    state: tokio::sync::Mutex<ReadState>,
    /// For `XACK`, `XINFO` and `XGROUP`, which must not queue behind a
    /// blocked read.
    commands: tokio::sync::Mutex<Option<MultiplexedConnection>>,
}

impl RedisLogStreamConsumer {
    /// Create this process' consumer group at the stream's end and reap any
    /// group a gone process left behind.
    #[tracing::instrument(
        name = "agent.session.log_stream.connect",
        skip_all,
        err,
        fields(
            messaging.system = "redis",
            messaging.destination.name = STREAM_KEY,
            messaging.consumer.group.name = tracing::field::Empty,
        )
    )]
    pub async fn connect(client: redis::Client) -> Result<Self, Report> {
        Self::connect_to(client, STREAM_KEY.to_owned()).await
    }

    /// [`Self::connect`] to a stream other than [`STREAM_KEY`].
    pub(crate) async fn connect_to(client: redis::Client, stream: String) -> Result<Self, Report> {
        let instance = macro_uuid::generate_uuid_v7();
        let group = format!("{GROUP_PREFIX}{instance}");
        tracing::Span::current().record("messaging.consumer.group.name", group.as_str());
        let now = Instant::now();
        let consumer = Self {
            client,
            stream,
            consumer: instance.to_string(),
            group,
            state: tokio::sync::Mutex::new(ReadState {
                connection: None,
                buffered: VecDeque::new(),
                mode: ReadMode::New,
                last_stats: now,
                last_reap: now,
            }),
            commands: tokio::sync::Mutex::new(None),
        };
        consumer.create_group().await?;
        let _ = consumer.reap_abandoned_groups().await.inspect_err(|error| {
            tracing::warn!(error = ?error, "failed to reap abandoned agent session log groups");
        });
        Ok(consumer)
    }

    /// This process' consumer group.
    #[must_use]
    pub fn group(&self) -> &str {
        &self.group
    }

    /// Destroy this process' consumer group: nothing reads it once the
    /// process stops. Call on shutdown; a group left behind is reaped by
    /// another process after [`ABANDONED_AFTER`].
    #[tracing::instrument(
        name = "agent.session.log_stream.close",
        skip_all,
        err,
        fields(
            messaging.system = "redis",
            messaging.destination.name = %self.stream,
            messaging.consumer.group.name = %self.group,
        )
    )]
    pub async fn close(&self) -> Result<(), Report> {
        let mut connection = self.commands().await?;
        let destroyed: usize = connection
            .xgroup_destroy(&self.stream, &self.group)
            .await
            .context("failed to destroy the agent session log consumer group")?;
        tracing::info!(
            messaging.consumer.group.name = %self.group,
            destroyed,
            "destroyed the agent session log consumer group"
        );
        Ok(())
    }

    async fn connect_with(
        &self,
        response_timeout: Option<Duration>,
    ) -> Result<MultiplexedConnection, Report> {
        let config = AsyncConnectionConfig::new()
            .set_connection_timeout(Some(CONNECT_TIMEOUT))
            .set_response_timeout(response_timeout);
        Ok(self
            .client
            .get_multiplexed_async_connection_with_config(&config)
            .await
            .context("failed to connect to Redis to read agent session log runs")?)
    }

    /// The command connection, opened if there is none.
    async fn commands(&self) -> Result<MultiplexedConnection, Report> {
        let mut held = self.commands.lock().await;
        if let Some(connection) = held.as_ref() {
            return Ok(connection.clone());
        }
        let connection = self.connect_with(Some(COMMAND_RESPONSE_TIMEOUT)).await?;
        *held = Some(connection.clone());
        Ok(connection)
    }

    async fn reset_commands(&self) {
        self.commands.lock().await.take();
    }

    /// `XGROUP CREATE ... $ MKSTREAM`, tolerating a group that exists.
    #[tracing::instrument(
        name = "agent.session.log_stream.create_group",
        skip_all,
        err,
        fields(messaging.consumer.group.name = %self.group, created = tracing::field::Empty)
    )]
    async fn create_group(&self) -> Result<(), Report> {
        let mut connection = self.commands().await?;
        let created: Result<(), RedisError> = connection
            .xgroup_create_mkstream(&self.stream, &self.group, "$")
            .await;
        match created {
            Ok(()) => {
                tracing::Span::current().record("created", true);
                tracing::info!(
                    messaging.consumer.group.name = %self.group,
                    "created the agent session log consumer group"
                );
                Ok(())
            }
            Err(error) if error.code() == Some("BUSYGROUP") => {
                tracing::Span::current().record("created", false);
                Ok(())
            }
            Err(error) => {
                self.reset_commands().await;
                Err(Report::new(error)
                    .context("failed to create the agent session log consumer group")
                    .into_dynamic())
            }
        }
    }

    /// One `XREADGROUP`, buffering what it returns.
    #[tracing::instrument(
        name = "agent.session.log_stream.read",
        skip_all,
        err,
        fields(
            otel.kind = "consumer",
            messaging.system = "redis",
            messaging.operation.name = "receive",
            messaging.operation.type = "receive",
            messaging.destination.name = %self.stream,
            messaging.consumer.group.name = %self.group,
            agent.log.read_mode = state.mode.as_str(),
            messaging.batch.message_count = tracing::field::Empty,
            agent.log.read_ms = tracing::field::Empty,
        )
    )]
    async fn read(&self, state: &mut ReadState) -> Result<(), Report> {
        let span = tracing::Span::current();
        let mut connection = match state.connection.as_ref() {
            Some(connection) => connection.clone(),
            None => {
                // A blocked read answers after up to READ_BLOCK; the response
                // timeout leaves room for that and a slow reply on top.
                let connection = self
                    .connect_with(Some(READ_BLOCK + COMMAND_RESPONSE_TIMEOUT))
                    .await?;
                tracing::info!(
                    messaging.consumer.group.name = %self.group,
                    "connected the agent session log stream reader"
                );
                state.connection = Some(connection.clone());
                connection
            }
        };

        let mode = state.mode;
        let mut options = StreamReadOptions::default()
            .group(&self.group, &self.consumer)
            .count(READ_COUNT);
        if mode == ReadMode::New {
            let block_ms = usize::try_from(READ_BLOCK.as_millis()).unwrap_or(usize::MAX);
            options = options.block(block_ms);
        }

        let started = Instant::now();
        let read: Result<Option<StreamReadReply>, RedisError> = connection
            .xread_options(&[self.stream.as_str()], &[mode.id()], &options)
            .await;
        span.record(
            "agent.log.read_ms",
            u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        );

        let reply = match read {
            Ok(reply) => reply,
            Err(error) if error.code() == Some("NOGROUP") => {
                // The group is gone: Redis restarted, or the stream key was
                // evicted or deleted. Whatever was appended meanwhile is lost
                // to this process; start over at the stream's end.
                tracing::error!(
                    error = ?error,
                    messaging.consumer.group.name = %self.group,
                    "the agent session log consumer group disappeared; recreating it at the stream's end, runs appended meanwhile are lost to this process"
                );
                state.mode = ReadMode::New;
                state.buffered.clear();
                return self.create_group().await;
            }
            Err(error) => {
                // Whatever this read might have delivered is pending in the
                // group; reread it once reconnected.
                state.connection = None;
                state.mode = ReadMode::Pending;
                return Err(Report::new(error)
                    .context(format!(
                        "failed to XREADGROUP {} agent session log runs",
                        mode.as_str()
                    ))
                    .into_dynamic());
            }
        };

        let entries: Vec<StreamId> = reply
            .map(|reply| reply.keys.into_iter().flat_map(|key| key.ids).collect())
            .unwrap_or_default();
        span.record("messaging.batch.message_count", entries.len());

        if mode == ReadMode::Pending {
            if entries.is_empty() {
                tracing::info!(
                    messaging.consumer.group.name = %self.group,
                    "replayed every pending agent session log run; reading new runs"
                );
                state.mode = ReadMode::New;
            } else {
                tracing::warn!(
                    messaging.consumer.group.name = %self.group,
                    messaging.batch.message_count = entries.len(),
                    "redelivering agent session log runs that were never acknowledged"
                );
            }
        }
        state
            .buffered
            .extend(entries.into_iter().map(|entry| Buffered { entry, mode }));
        Ok(())
    }

    /// Turn one read entry into a run, or acknowledge and skip it if it
    /// cannot become one.
    #[tracing::instrument(
        name = "agent.session.log_stream.receive",
        skip_all,
        fields(
            otel.kind = "consumer",
            messaging.system = "redis",
            messaging.operation.name = "process",
            messaging.operation.type = "process",
            messaging.destination.name = %self.stream,
            messaging.consumer.group.name = %self.group,
            messaging.message.id = %buffered.entry.id,
            messaging.message.body.size = tracing::field::Empty,
            agent.session.id = tracing::field::Empty,
            agent.log.frame_count = tracing::field::Empty,
            agent.log.redelivered = buffered.mode == ReadMode::Pending,
            agent.log.delivery_lag_ms = tracing::field::Empty,
            agent.log.decode_us = tracing::field::Empty,
            agent.log.skipped = tracing::field::Empty,
        )
    )]
    async fn receive(&self, buffered: Buffered) -> Option<ReceivedRun> {
        let span = tracing::Span::current();
        let Buffered { entry, mode } = buffered;
        let delivery = DeliveryId::new(entry.id.clone());

        if let Some(published_at) = entry
            .get::<u64>(field::PUBLISHED_AT_MS)
            .or_else(|| entry_id_ms(&entry.id))
        {
            span.record(
                "agent.log.delivery_lag_ms",
                now_ms().saturating_sub(published_at),
            );
        }
        if let Some(session) = entry.get::<String>(field::SESSION) {
            span.record("agent.session.id", session.as_str());
        }

        let Some(payload) = entry.get::<Vec<u8>>(field::PAYLOAD) else {
            // A pending entry the stream trimmed comes back with no fields.
            span.record("agent.log.skipped", "trimmed");
            tracing::error!(
                messaging.message.id = %entry.id,
                messaging.consumer.group.name = %self.group,
                read_mode = mode.as_str(),
                "an agent session log run was trimmed before it was acknowledged; it is lost to this process"
            );
            self.ack_skipped(&delivery).await;
            return None;
        };
        span.record("messaging.message.body.size", payload.len());

        let version = entry.get::<u8>(field::VERSION);
        if version != Some(WIRE_VERSION) {
            span.record("agent.log.skipped", "unsupported_version");
            tracing::warn!(
                messaging.message.id = %entry.id,
                expected = WIRE_VERSION,
                actual = ?version,
                "dropping agent session log run with an unsupported wire version"
            );
            self.ack_skipped(&delivery).await;
            return None;
        }

        let started = Instant::now();
        let decoded = decode(&payload);
        span.record(
            "agent.log.decode_us",
            u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX),
        );
        let run = match decoded {
            Ok(run) => run,
            Err(error) => {
                span.record("agent.log.skipped", "undecodable");
                tracing::error!(
                    error = ?error,
                    messaging.message.id = %entry.id,
                    "dropping undecodable agent session log run"
                );
                self.ack_skipped(&delivery).await;
                return None;
            }
        };
        span.record(
            "agent.session.id",
            tracing::field::display(run.agent_session_id),
        );
        span.record("agent.log.frame_count", run.entries.len());

        Some(ReceivedRun {
            run,
            delivery,
            redelivered: mode == ReadMode::Pending,
        })
    }

    /// Acknowledge an entry that will never become a run, so it is not
    /// redelivered forever. Best effort.
    async fn ack_skipped(&self, delivery: &DeliveryId) {
        let _ = self.ack(delivery).await.inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                messaging.message.id = %delivery,
                "failed to acknowledge a skipped agent session log entry"
            );
        });
    }

    /// Stats every [`STATS_INTERVAL`], reaping every [`REAP_INTERVAL`]. Both
    /// best effort: failures are logged and never stop reading.
    async fn housekeep(&self, state: &mut ReadState) {
        if state.last_stats.elapsed() >= STATS_INTERVAL {
            state.last_stats = Instant::now();
            let _ = self
                .log_stats(state.buffered.len())
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, "failed to read agent session log stream stats");
                });
        }
        if state.last_reap.elapsed() >= REAP_INTERVAL {
            state.last_reap = Instant::now();
            let _ = self.reap_abandoned_groups().await.inspect_err(|error| {
                tracing::warn!(error = ?error, "failed to reap abandoned agent session log groups");
            });
        }
    }

    /// Log the stream's length and this group's backlog, for dashboards and
    /// monitors.
    #[tracing::instrument(
        name = "agent.session.log_stream.stats",
        skip_all,
        err,
        fields(messaging.consumer.group.name = %self.group)
    )]
    async fn log_stats(&self, buffered: usize) -> Result<(), Report> {
        let mut connection = self.commands().await?;
        let length: usize = connection
            .xlen(&self.stream)
            .await
            .context("failed to XLEN the agent session log stream")?;
        let groups: StreamInfoGroupsReply = connection
            .xinfo_groups(&self.stream)
            .await
            .context("failed to XINFO GROUPS the agent session log stream")?;
        let ours = groups.groups.iter().find(|group| group.name == self.group);
        let reader_groups = groups
            .groups
            .iter()
            .filter(|group| group.name.starts_with(GROUP_PREFIX))
            .count();
        tracing::info!(
            messaging.destination.name = %self.stream,
            messaging.consumer.group.name = %self.group,
            agent.log_stream.length = length,
            agent.log_stream.groups = reader_groups,
            agent.log_stream.pending = ours.map(|group| group.pending),
            agent.log_stream.lag = ours.and_then(|group| group.lag),
            agent.log_stream.last_delivered_id = ours.map(|group| group.last_delivered_id.as_str()),
            agent.log_stream.buffered = buffered,
            agent.log_stream.group_present = ours.is_some(),
            "agent session log stream stats"
        );
        Ok(())
    }

    /// Destroy every reader group other than this one that is older than
    /// [`ABANDONED_AFTER`] and whose consumers have all been idle that long:
    /// their process is gone, and a group nobody reads only grows its pending
    /// list.
    #[tracing::instrument(
        name = "agent.session.log_stream.reap",
        skip_all,
        err,
        fields(
            messaging.consumer.group.name = %self.group,
            agent.log_stream.groups = tracing::field::Empty,
            agent.log_stream.reaped = tracing::field::Empty,
        )
    )]
    async fn reap_abandoned_groups(&self) -> Result<(), Report> {
        let span = tracing::Span::current();
        let mut connection = self.commands().await?;
        let groups: StreamInfoGroupsReply = connection
            .xinfo_groups(&self.stream)
            .await
            .context("failed to XINFO GROUPS the agent session log stream")?;
        span.record("agent.log_stream.groups", groups.groups.len());

        let abandoned_ms = usize::try_from(ABANDONED_AFTER.as_millis()).unwrap_or(usize::MAX);
        let mut reaped = 0_usize;
        for group in groups
            .groups
            .iter()
            .filter(|group| group.name.starts_with(GROUP_PREFIX) && group.name != self.group)
        {
            // A group younger than the threshold may just not have read yet:
            // its process started a moment ago, and a group has no
            // consumers until its first read.
            let age = group_age(&group.name);
            if age.is_some_and(|age| age < ABANDONED_AFTER) {
                continue;
            }
            let consumers: StreamInfoConsumersReply = connection
                .xinfo_consumers(&self.stream, &group.name)
                .await
                .context("failed to XINFO CONSUMERS an agent session log group")?;
            let least_idle_ms = consumers
                .consumers
                .iter()
                .map(|consumer| consumer.idle)
                .min();
            if least_idle_ms.is_some_and(|idle| idle < abandoned_ms) {
                continue;
            }
            let destroyed: usize = connection
                .xgroup_destroy(&self.stream, &group.name)
                .await
                .context("failed to destroy an abandoned agent session log group")?;
            reaped += destroyed;
            tracing::info!(
                messaging.consumer.group.name = %group.name,
                agent.log_stream.pending = group.pending,
                agent.log_stream.least_idle_ms = least_idle_ms,
                agent.log_stream.group_age_s = age.map(|age| age.as_secs()),
                agent.log_stream.consumers = consumers.consumers.len(),
                "reaped an abandoned agent session log consumer group"
            );
        }
        span.record("agent.log_stream.reaped", reaped);
        Ok(())
    }
}

/// How long ago a reader group was created, from the UUIDv7 its name ends
/// in. `None` for a name this crate did not mint.
fn group_age(group: &str) -> Option<Duration> {
    let instance = group.strip_prefix(GROUP_PREFIX)?;
    let (seconds, nanos) = macro_uuid::Uuid::parse_str(instance)
        .ok()?
        .get_timestamp()?
        .to_unix();
    let created = Duration::new(seconds, nanos);
    let now = Duration::from_millis(now_ms());
    Some(now.saturating_sub(created))
}

impl AgentSessionLogConsumer for RedisLogStreamConsumer {
    async fn recv(&self) -> Result<ReceivedRun, Report> {
        let mut state = self.state.lock().await;
        loop {
            if let Some(buffered) = state.buffered.pop_front() {
                if let Some(received) = self.receive(buffered).await {
                    return Ok(received);
                }
                continue;
            }
            self.housekeep(&mut state).await;
            self.read(&mut state).await?;
        }
    }

    #[tracing::instrument(
        name = "agent.session.log_stream.ack",
        skip_all,
        err,
        fields(
            messaging.system = "redis",
            messaging.operation.name = "ack",
            messaging.operation.type = "settle",
            messaging.destination.name = %self.stream,
            messaging.consumer.group.name = %self.group,
            messaging.message.id = %delivery,
            agent.log.acked = tracing::field::Empty,
        )
    )]
    async fn ack(&self, delivery: &DeliveryId) -> Result<(), Report> {
        let mut connection = self.commands().await?;
        let acked: Result<usize, RedisError> = connection
            .xack(&self.stream, &self.group, &[delivery.as_str()])
            .await;
        let acked = match acked {
            Ok(acked) => acked,
            Err(error) => {
                self.reset_commands().await;
                return Err(Report::new(error)
                    .context("failed to XACK an agent session log run")
                    .into_dynamic());
            }
        };
        tracing::Span::current().record("agent.log.acked", acked);
        if acked == 0 {
            // Already acknowledged, or its group was recreated since.
            tracing::debug!(
                messaging.message.id = %delivery,
                "XACK acknowledged nothing for an agent session log run"
            );
        }
        Ok(())
    }
}
