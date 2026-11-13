//! The public event log over a Redis Stream.
//!
//! One stream, [`STREAM_KEY`], holds every public event and access
//! invalidation for [`RETENTION`], capped at about [`MAX_LEN`] entries. The
//! `public-event-log` consumer appends; every API process tails it from its
//! own start (`$`) and replays from it on resume. Entry ids are the cursors:
//! one total order, valid on every instance and across deploys.
//!
//! Each entry carries the W3C trace context of the append, so fan-out joins
//! the trace of the Kafka record the event came from.

#[cfg(test)]
mod test;

use crate::domain::models::{Cursor, LogEntry, LogRecord};
use crate::domain::ports::{EventLog, LogPage, LogTail, TailItem};
use redis::aio::MultiplexedConnection;
use redis::streams::{StreamId, StreamRangeReply, StreamReadOptions, StreamReadReply};
use redis::{AsyncCommands as _, AsyncConnectionConfig, RedisError};
use rootcause::Report;
use rootcause::prelude::ResultExt as _;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// The stream every public event is appended to.
pub const STREAM_KEY: &str = "events:v1";

/// How long an entry is kept: enough to cover reconnects, deploys and a
/// laptop waking up. Longer catch-up is what webhooks are for.
pub const RETENTION: Duration = Duration::from_secs(60 * 60);

/// Hard cap on entries, trimmed approximately. Sized above an hour of every
/// family at peak, so it bites only if volume outgrows retention; when it
/// does, the replay window shrinks and the floor key says by how much.
pub const MAX_LEN: usize = 1_500_000;

/// Wire format version, carried on every entry.
pub const WIRE_VERSION: u8 = 1;

/// How long one blocking tail read waits for new entries.
const READ_BLOCK: Duration = Duration::from_secs(5);

/// Entries one tail read returns at most.
const READ_COUNT: usize = 256;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);

mod field {
    pub const VERSION: &str = "v";
    pub const RECORD: &str = "record";
    pub const PUBLISHED_AT_MS: &str = "published_at_ms";
    /// Prefix of the trace context fields (`tc.traceparent`, ...).
    pub const TRACE_PREFIX: &str = "tc.";
}

/// Set the floor key to ARGV[1] unless it already holds a later entry id.
const RAISE_FLOOR_SCRIPT: &str = r"
local current = redis.call('GET', KEYS[1])
local function parse(id)
  local ms, seq = string.match(id, '^(%d+)-(%d+)$')
  return tonumber(ms), tonumber(seq)
end
if current then
  local cms, cseq = parse(current)
  local nms, nseq = parse(ARGV[1])
  if cms > nms or (cms == nms and cseq >= nseq) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1])
return 1
";

fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or_default()
}

fn retention_floor(now_ms: u64) -> Cursor {
    let retention_ms = u64::try_from(RETENTION.as_millis()).unwrap_or(u64::MAX);
    Cursor::floor_at(now_ms.saturating_sub(retention_ms))
}

/// The key holding the first entry the length cap has not trimmed.
fn floor_key(stream: &str) -> String {
    format!("{stream}:maxlen_floor")
}

/// [`EventLog`] over a Redis Stream. Clones share one command connection.
#[derive(Clone)]
pub struct RedisEventLog {
    client: redis::Client,
    stream: String,
    connection: Arc<tokio::sync::Mutex<Option<MultiplexedConnection>>>,
}

impl RedisEventLog {
    /// The log at [`STREAM_KEY`]. Connects lazily.
    pub fn new(client: redis::Client) -> Self {
        Self::at(client, STREAM_KEY.to_owned())
    }

    /// The log at another key (tests).
    pub fn at(client: redis::Client, stream: String) -> Self {
        Self {
            client,
            stream,
            connection: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// A tail of this log from now.
    pub fn tail(&self) -> RedisLogTail {
        RedisLogTail {
            log: self.clone(),
            reader: None,
            last: None,
            buffered: VecDeque::new(),
        }
    }

    async fn connection(&self) -> Result<MultiplexedConnection, Report> {
        let mut held = self.connection.lock().await;
        if let Some(connection) = held.as_ref() {
            return Ok(connection.clone());
        }
        let config = AsyncConnectionConfig::new()
            .set_connection_timeout(Some(CONNECT_TIMEOUT))
            .set_response_timeout(Some(COMMAND_TIMEOUT));
        let connection = self
            .client
            .get_multiplexed_async_connection_with_config(&config)
            .await
            .context("failed to connect to Redis for the public event log")?;
        *held = Some(connection.clone());
        Ok(connection)
    }

    async fn reset_connection(&self) {
        self.connection.lock().await.take();
    }

    /// Turn a raw entry into a log entry, under a span parented on the
    /// append's trace. `None` for an entry this version cannot read.
    fn entry(&self, raw: &StreamId) -> Option<LogEntry> {
        let cursor: Cursor = raw.id.parse().ok()?;
        let mut carrier = HashMap::new();
        for (key, value) in &raw.map {
            if let Some(name) = key.strip_prefix(field::TRACE_PREFIX)
                && let Ok(value) = redis::from_redis_value::<String>(value.clone())
            {
                carrier.insert(name.to_owned(), value);
            }
        }
        let span = tracing::info_span!(
            "events.log.receive",
            otel.kind = "consumer",
            messaging.system = "redis",
            messaging.destination.name = %self.stream,
            messaging.message.id = %raw.id,
            delivery_lag_ms = tracing::field::Empty,
        );
        let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract(&carrier)
        });
        let _ = span.set_parent(parent);
        if let Some(published_at) = raw.get::<u64>(field::PUBLISHED_AT_MS) {
            span.record("delivery_lag_ms", now_ms().saturating_sub(published_at));
        }

        if raw.get::<u8>(field::VERSION) != Some(WIRE_VERSION) {
            span.in_scope(|| {
                tracing::warn!(entry = %raw.id, "skipping a public event log entry with an unsupported version");
            });
            return None;
        }
        let record = raw.get::<Vec<u8>>(field::RECORD)?;
        match serde_json::from_slice::<LogRecord>(&record) {
            Ok(record) => Some(LogEntry {
                cursor,
                record,
                span,
            }),
            Err(error) => {
                span.in_scope(|| {
                    tracing::error!(error = ?error, entry = %raw.id, "skipping an undecodable public event log entry");
                });
                None
            }
        }
    }

    async fn raise_length_floor(
        &self,
        connection: &mut MultiplexedConnection,
    ) -> Result<(), Report> {
        let first: StreamRangeReply = connection
            .xrange_count(&self.stream, "-", "+", 1)
            .await
            .context("failed to read the public event log's first entry")?;
        let Some(first) = first.ids.first() else {
            return Ok(());
        };
        let _: i64 = redis::Script::new(RAISE_FLOOR_SCRIPT)
            .key(floor_key(&self.stream))
            .arg(&first.id)
            .invoke_async(connection)
            .await
            .context("failed to record the public event log's length floor")?;
        Ok(())
    }
}

impl EventLog for RedisEventLog {
    #[tracing::instrument(
        name = "events.log.xadd",
        skip_all,
        err,
        fields(
            otel.kind = "producer",
            messaging.system = "redis",
            messaging.destination.name = %self.stream,
            messaging.message.id = tracing::field::Empty,
            trimmed_by_length = tracing::field::Empty,
        )
    )]
    async fn append(&self, record: &LogRecord) -> Result<Cursor, Report> {
        let payload =
            serde_json::to_string(record).context("failed to encode a public event log record")?;
        let mut carrier: HashMap<String, String> = HashMap::new();
        let context = tracing::Span::current().context();
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(&context, &mut carrier);
        });
        let published_at = now_ms();
        let mut fields = vec![
            (field::VERSION.to_owned(), WIRE_VERSION.to_string()),
            (field::PUBLISHED_AT_MS.to_owned(), published_at.to_string()),
            (field::RECORD.to_owned(), payload),
        ];
        fields.extend(
            carrier
                .into_iter()
                .map(|(key, value)| (format!("{}{key}", field::TRACE_PREFIX), value)),
        );

        let floor = retention_floor(published_at).to_string();
        let mut connection = self.connection().await?;
        let result: Result<(String, usize, usize), RedisError> = redis::pipe()
            .cmd("XADD")
            .arg(&self.stream)
            .arg("*")
            .arg(&fields)
            .cmd("XTRIM")
            .arg(&self.stream)
            .arg("MINID")
            .arg("~")
            .arg(&floor)
            .cmd("XTRIM")
            .arg(&self.stream)
            .arg("MAXLEN")
            .arg("~")
            .arg(MAX_LEN)
            .query_async(&mut connection)
            .await;
        let (entry_id, _, trimmed_by_length) = match result {
            Ok(reply) => reply,
            Err(error) => {
                self.reset_connection().await;
                return Err(Report::new(error)
                    .context("failed to XADD a public event log record")
                    .into_dynamic());
            }
        };
        let span = tracing::Span::current();
        span.record("messaging.message.id", entry_id.as_str());
        span.record("trimmed_by_length", trimmed_by_length);

        if trimmed_by_length > 0 {
            // The cap cut into the retention window: record the first entry
            // left, so resumes from before it are reset rather than silently
            // missing what was trimmed. Best effort (the append succeeded),
            // and the floor only moves forward even with several writers.
            if let Err(error) = self.raise_length_floor(&mut connection).await {
                tracing::error!(error = ?error, "failed to record the public event log's length floor");
            }
        }

        entry_id
            .parse()
            .map_err(|_| rootcause::report!("Redis returned an invalid entry id: {entry_id}"))
    }

    #[tracing::instrument(name = "events.log.read_after", skip(self), err)]
    async fn read_after(&self, after: Cursor, count: usize) -> Result<LogPage, Report> {
        let mut connection = self.connection().await?;
        let reply: Result<StreamRangeReply, RedisError> = connection
            .xrange_count(&self.stream, format!("({after}"), "+", count)
            .await;
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                self.reset_connection().await;
                return Err(Report::new(error)
                    .context("failed to XRANGE the public event log")
                    .into_dynamic());
            }
        };
        Ok(LogPage {
            entries: reply.ids.iter().filter_map(|raw| self.entry(raw)).collect(),
            last: reply.ids.last().and_then(|raw| raw.id.parse().ok()),
            full: reply.ids.len() == count,
        })
    }

    async fn retained_floor(&self) -> Result<Cursor, Report> {
        let by_time = retention_floor(now_ms());
        let mut connection = self.connection().await?;
        let by_length: Option<String> = connection
            .get(floor_key(&self.stream))
            .await
            .context("failed to read the public event log's length floor")?;
        let by_length = by_length.and_then(|id| id.parse::<Cursor>().ok());
        Ok(by_length.map_or(by_time, |by_length| by_length.max(by_time)))
    }
}

/// One process' tail of the log: from the moment it first reads, then
/// strictly after the last entry it returned, across reconnects.
pub struct RedisLogTail {
    log: RedisEventLog,
    /// Dedicated to blocking reads, which hold a connection's pipeline.
    reader: Option<MultiplexedConnection>,
    last: Option<Cursor>,
    buffered: VecDeque<StreamId>,
}

impl RedisLogTail {
    async fn read(&mut self) -> Result<Option<TailItem>, Report> {
        let mut connection = match self.reader.as_ref() {
            Some(connection) => connection.clone(),
            None => {
                let config = AsyncConnectionConfig::new()
                    .set_connection_timeout(Some(CONNECT_TIMEOUT))
                    .set_response_timeout(Some(READ_BLOCK + COMMAND_TIMEOUT));
                let connection = self
                    .log
                    .client
                    .get_multiplexed_async_connection_with_config(&config)
                    .await
                    .context("failed to connect to Redis to tail the public event log")?;
                // Reconnected after missing entries the log has since dropped:
                // the streams cannot be caught up.
                if let Some(last) = self.last
                    && last < self.log.retained_floor().await?
                {
                    self.reader = Some(connection);
                    self.last = None;
                    return Ok(Some(TailItem::Gap));
                }
                self.reader = Some(connection.clone());
                connection
            }
        };

        // Start from a concrete id, never `$`: a blocking read that times out
        // and is reissued with `$` would skip whatever was appended between
        // the two reads.
        let from = match self.last {
            Some(last) => last,
            None => {
                let newest: StreamRangeReply = connection
                    .xrevrange_count(&self.log.stream, "+", "-", 1)
                    .await
                    .context("failed to read the public event log's newest entry")?;
                let start = newest
                    .ids
                    .first()
                    .and_then(|raw| raw.id.parse().ok())
                    .unwrap_or_default();
                self.last = Some(start);
                start
            }
        }
        .to_string();
        let block_ms = usize::try_from(READ_BLOCK.as_millis()).unwrap_or(usize::MAX);
        let options = StreamReadOptions::default()
            .block(block_ms)
            .count(READ_COUNT);
        let reply: Result<Option<StreamReadReply>, RedisError> = connection
            .xread_options(&[self.log.stream.as_str()], &[from.as_str()], &options)
            .await;
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                self.reader = None;
                return Err(Report::new(error)
                    .context("failed to XREAD the public event log")
                    .into_dynamic());
            }
        };
        self.buffered.extend(
            reply
                .into_iter()
                .flat_map(|reply| reply.keys)
                .flat_map(|key| key.ids),
        );
        Ok(None)
    }
}

impl LogTail for RedisLogTail {
    async fn next(&mut self) -> Result<TailItem, Report> {
        loop {
            if let Some(raw) = self.buffered.pop_front() {
                if let Ok(cursor) = raw.id.parse::<Cursor>() {
                    self.last = Some(cursor);
                }
                if let Some(entry) = self.log.entry(&raw) {
                    return Ok(TailItem::Entry(entry));
                }
                continue;
            }
            if let Some(item) = self.read().await? {
                return Ok(item);
            }
        }
    }
}
