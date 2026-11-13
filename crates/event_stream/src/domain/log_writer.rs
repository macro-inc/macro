//! Writing the public event log: one decoded broker event in, at most one
//! log record out.

#[cfg(test)]
mod test;

use crate::domain::invalidations::log_record;
use crate::domain::models::Cursor;
use crate::domain::ports::EventLog;
use crate::topics::LogMacroEvent;
use macro_event_topics::{MacroEmailTopic, Topic as _};
use rootcause::Report;
use std::future::Future;
use std::sync::Arc;

/// Service switches for the writer, read from service feature flags.
pub trait WriterSwitches: Send + Sync + 'static {
    /// Whether the writer appends at all (the kill switch is off).
    fn writer_enabled(&self) -> impl Future<Output = bool> + Send;

    /// Whether events of the email family are appended: about 50 a second at
    /// the median, so they go on the log only once the family ships.
    fn email_enabled(&self) -> impl Future<Output = bool> + Send;
}

/// What happened to one event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// Appended at this cursor.
    Appended(Cursor),
    /// Not appended, for this reason (span value).
    Skipped(&'static str),
}

/// Appends public events and access invalidations to the log.
pub struct LogWriter<L, S> {
    log: Arc<L>,
    switches: S,
}

impl<L: EventLog, S: WriterSwitches> LogWriter<L, S> {
    /// Write to `log`, gated by `switches`.
    pub fn new(log: Arc<L>, switches: S) -> Self {
        Self { log, switches }
    }

    /// Write one decoded event from `topic`. `Err` is an append failure
    /// worth retrying; a malformed event is logged and skipped.
    #[tracing::instrument(
        name = "events.log.append",
        skip_all,
        err,
        fields(
            topic,
            event.id = tracing::field::Empty,
            event.name = tracing::field::Empty,
            entity.type = tracing::field::Empty,
            entity.id = tracing::field::Empty,
            exposure = tracing::field::Empty,
            invalidation_count = tracing::field::Empty,
            outcome = tracing::field::Empty,
        )
    )]
    pub async fn write(&self, topic: &str, event: &LogMacroEvent) -> Result<WriteOutcome, Report> {
        let span = tracing::Span::current();
        let outcome = self.write_inner(topic, event, &span).await?;
        span.record(
            "outcome",
            match outcome {
                WriteOutcome::Appended(_) => "appended",
                WriteOutcome::Skipped(reason) => reason,
            },
        );
        Ok(outcome)
    }

    async fn write_inner(
        &self,
        topic: &str,
        event: &LogMacroEvent,
        span: &tracing::Span,
    ) -> Result<WriteOutcome, Report> {
        if !self.switches.writer_enabled().await {
            return Ok(WriteOutcome::Skipped("killed"));
        }
        if topic == MacroEmailTopic::TOPIC_STR && !self.switches.email_enabled().await {
            return Ok(WriteOutcome::Skipped("email_disabled"));
        }

        let record = match log_record(event) {
            Ok(Some(record)) => record,
            Ok(None) => {
                span.record("exposure", "internal");
                return Ok(WriteOutcome::Skipped("internal"));
            }
            Err(error) => {
                tracing::error!(error = ?error, "skipping a broker event that violates its exposure contract");
                return Ok(WriteOutcome::Skipped("invalid"));
            }
        };
        span.record("invalidation_count", record.invalidations.len());
        match &record.event {
            Some(public) => {
                span.record("exposure", "public");
                span.record("event.id", public.event.event_id.as_str());
                span.record("event.name", public.event.event_name.as_str());
                span.record("entity.type", public.event.entity_type.as_str());
                span.record("entity.id", public.event.entity_id.as_str());
            }
            None => {
                span.record("exposure", "internal");
            }
        }

        Ok(WriteOutcome::Appended(self.log.append(&record).await?))
    }
}
