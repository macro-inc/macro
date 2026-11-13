//! Fan-out: every entry of the public event log, once, to this process'
//! matching streams.
//!
//! Per entry: evict what it invalidates, find the streams whose filters
//! accept it (one hash lookup when none do), resolve its audience once for
//! all of them, and hand it to each admitted stream's buffer.

#[cfg(test)]
mod bench;
#[cfg(test)]
mod test;

use crate::domain::access::{AudienceResolver, Candidate, audience_class};
use crate::domain::models::{CloseReason, Invalidation, LogEntry};
use crate::domain::ports::{
    AccessDirectory, ContactDirectory, GithubClaims, LogTail, TailItem, TeamDirectory,
};
use crate::domain::registry::{Delivery, Registry};
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

/// Delay before re-reading the log after a failed read.
const TAIL_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Fans log entries out to the registry's streams.
pub struct FanOut<A, T, C, G> {
    registry: Arc<Registry>,
    resolver: Arc<AudienceResolver<A, T, C, G>>,
}

impl<A, T, C, G> Clone for FanOut<A, T, C, G> {
    fn clone(&self) -> Self {
        Self {
            registry: self.registry.clone(),
            resolver: self.resolver.clone(),
        }
    }
}

impl<A, T, C, G> FanOut<A, T, C, G>
where
    A: AccessDirectory,
    T: TeamDirectory,
    C: ContactDirectory,
    G: GithubClaims,
{
    /// Fan out to `registry`, resolving audiences with `resolver`.
    pub fn new(registry: Arc<Registry>, resolver: Arc<AudienceResolver<A, T, C, G>>) -> Self {
        Self { registry, resolver }
    }

    /// Tail the log until `shutdown`, then close every stream.
    pub async fn run<L: LogTail>(&self, mut tail: L, shutdown: CancellationToken) {
        loop {
            let item = tokio::select! {
                biased;
                () = shutdown.cancelled() => break,
                item = tail.next() => item,
            };
            match item {
                Ok(TailItem::Entry(entry)) => self.deliver(*entry).await,
                Ok(TailItem::Gap) => {
                    crate::metrics::metrics().tail_gaps.add(1, &[]);
                    tracing::error!(
                        open_streams = self.registry.len(),
                        "public event log tail lost its place; resetting every stream"
                    );
                    self.registry.close_all(CloseReason::Reset);
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "failed to read the public event log; retrying");
                    tokio::select! {
                        biased;
                        () = shutdown.cancelled() => break,
                        () = tokio::time::sleep(TAIL_RETRY_DELAY) => {}
                    }
                }
            }
        }
        self.registry.close_all(CloseReason::Shutdown);
    }

    /// Fan one entry out.
    pub async fn deliver(&self, entry: LogEntry) {
        let LogEntry {
            cursor,
            record,
            span,
        } = entry;

        for invalidation in &record.invalidations {
            self.resolver.caches().invalidate(invalidation);
            if let Invalidation::BotDeleted { bot_id } = invalidation {
                self.registry.close_bot(*bot_id, CloseReason::BotDeleted);
            }
        }
        let Some(public) = record.event else {
            return;
        };
        let now_ms = u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or_default();
        crate::metrics::metrics()
            .fan_out_lag_ms
            .record(now_ms.saturating_sub(cursor.ms), &[]);

        let fan_out_span = tracing::info_span!(
            parent: &span,
            "events.stream.fan_out",
            event.id = %public.event.event_id,
            event.name = %public.event.event_name,
            entity.type = %public.event.entity_type,
            entity.id = %public.event.entity_id,
            event.cursor = %cursor,
            audience.class = audience_class(&public.audience),
            matched_streams = tracing::field::Empty,
            accessor_count = tracing::field::Empty,
            cache_hit = tracing::field::Empty,
            delivered = tracing::field::Empty,
        );
        async {
            let span = tracing::Span::current();
            let matches = self.registry.matching(&public.event, public.stage);
            span.record("matched_streams", matches.len());
            if matches.is_empty() {
                span.record("delivered", 0);
                return;
            }

            let candidates: Vec<Candidate<'_>> = matches
                .iter()
                .map(|matched| Candidate {
                    principal: &matched.principal,
                    scope: matched.scope,
                    preview: matched.preview,
                })
                .collect();
            let admitted = match self.resolver.resolve(&public.audience, &candidates).await {
                Ok(resolution) => {
                    if let Some(count) = resolution.accessor_count {
                        span.record("accessor_count", count);
                    }
                    if let Some(hit) = resolution.cache_hit {
                        span.record("cache_hit", hit);
                    }
                    resolution.admitted
                }
                Err(error) => {
                    // Nobody can be shown to be in the audience: drop the
                    // event for this resolution. The streams stay open.
                    tracing::error!(
                        error = ?error,
                        streams = matches.len(),
                        "failed to resolve an event's audience; dropping the event"
                    );
                    span.record("delivered", 0);
                    return;
                }
            };

            let event = Arc::new(public.event);
            let mut delivered = 0_usize;
            for (matched, admitted) in matches.iter().zip(admitted) {
                if !admitted {
                    continue;
                }
                let delivery = Delivery {
                    cursor,
                    event: event.clone(),
                };
                if self.registry.deliver(matched.id, delivery) {
                    delivered += 1;
                }
            }
            span.record("delivered", delivered);
        }
        .instrument(fan_out_span)
        .await;
    }
}
