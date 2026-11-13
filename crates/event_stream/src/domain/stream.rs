//! Opening and running one live stream.
//!
//! A stream registers with the [`Registry`] first, then (with a cursor)
//! replays the log after the cursor, resolving each event's audience at
//! replay time, then delivers live events the fan-out hands it, skipping any
//! the replay already sent. It ends when the client leaves, when it falls
//! behind (`lagged`), when its credential stops validating or its bot is
//! deleted (`revoked`), when its cursor leaves the replay window (`reset`),
//! or at shutdown.
//!
//! Cursors, replay, wildcards and preview events need the
//! `public-event-stream` flag. Without it a stream behaves as before: live
//! only, SSE ids are broker event ids, wildcards are literal names.

#[cfg(test)]
mod test;

use crate::domain::access::{AudienceResolver, Candidate};
use crate::domain::filters::{
    self, FilterSubject, MAX_STREAM_FILTERS, MAX_WEBHOOK_FILTERS, WebhookFilters, validate_filters,
};
use crate::domain::models::{
    CloseReason, ControlEvent, Cursor, LogEntry, PrincipalKind, StreamItem, StreamPrincipal,
    WebhookScope,
};
use crate::domain::ports::{
    AccessDirectory, ContactDirectory, CredentialCheck, EventLog, GithubClaims, LimitKey,
    PreviewFlag, StreamLimiter, TeamDirectory,
};
use crate::domain::registry::{Delivery, Registration, Registry, StreamId, eligible};
use futures::stream::BoxStream;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use tokio_stream::wrappers::ReceiverStream;

/// How often an open stream re-validates its credential and renews its
/// concurrency lease.
pub const REVALIDATE_INTERVAL: Duration = Duration::from_secs(60);

/// Window in which high-frequency events are coalesced per entity.
pub const COALESCE_WINDOW: Duration = Duration::from_secs(1);

/// Events coalesced per entity per stream: the first in a window is sent at
/// once, the latest of the rest when the window ends.
pub const COALESCED_EVENTS: &[&str] = &["document.interaction", "document.content_changed"];

/// Longest a credential check or lease renewal may take.
const CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Entries read per replay page.
const REPLAY_PAGE: usize = 500;

/// Items buffered between a stream's task and its transport.
const TRANSPORT_BUFFER: usize = 16;

/// A request to open a stream.
pub struct OpenStream {
    /// Who is opening it.
    pub principal: StreamPrincipal,
    /// Personal or team workspace.
    pub scope: WebhookScope,
    /// What it delivers.
    pub filters: WebhookFilters,
    /// Where to resume.
    pub resume: Option<Resume>,
    /// Re-validates the credential while the stream is open.
    pub credential: Arc<dyn CredentialCheck>,
}

/// Where a client asks to resume.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resume {
    /// The `Last-Event-ID` header. A value that is not a cursor (a broker
    /// event id from before cursors, or from a stream without the flag) is
    /// ignored: the stream starts live.
    LastEventId(String),
    /// The `?cursor=` parameter: must be a cursor.
    Cursor(String),
}

/// How far ahead of this server's clock a cursor may be.
const CURSOR_CLOCK_SKEW_MS: u64 = 60_000;

/// Why a stream could not be opened.
#[derive(Debug, thiserror::Error)]
pub enum StreamError {
    /// The filters, cursor or scope are invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The credential may not open streams (harness, internal).
    #[error("this credential cannot open event streams")]
    Forbidden,
    /// The feature is not enabled for this user.
    #[error("not found")]
    NotEnabled,
    /// The credential already holds as many streams as it may.
    #[error("too many concurrent event streams for this credential")]
    TooManyStreams,
    /// The cursor is older than the replay window.
    #[error("cursor is older than the replay window; resync and reconnect without a cursor")]
    CursorExpired,
    /// Adapter failure.
    #[error("internal stream failure")]
    Internal(rootcause::Report),
}

/// What the stream service needs, shared by every stream.
pub struct StreamService<A, T, C, G, L, P, Lim> {
    registry: Arc<Registry>,
    resolver: Arc<AudienceResolver<A, T, C, G>>,
    log: Arc<L>,
    preview: Arc<P>,
    limiter: Arc<Lim>,
}

impl<A, T, C, G, L, P, Lim> Clone for StreamService<A, T, C, G, L, P, Lim> {
    fn clone(&self) -> Self {
        Self {
            registry: self.registry.clone(),
            resolver: self.resolver.clone(),
            log: self.log.clone(),
            preview: self.preview.clone(),
            limiter: self.limiter.clone(),
        }
    }
}

/// Inbound port for opening live event streams.
pub trait EventStreamService: Clone + Send + Sync + 'static {
    /// Open a stream.
    fn open_stream(
        &self,
        request: OpenStream,
    ) -> impl Future<Output = Result<BoxStream<'static, StreamItem>, StreamError>> + Send;

    /// Whether the user may read preview surfaces (catalog, preview events).
    fn preview_enabled(&self, principal: &StreamPrincipal) -> impl Future<Output = bool> + Send;
}

impl<A, T, C, G, L, P, Lim> StreamService<A, T, C, G, L, P, Lim> {
    /// Create the stream service.
    pub fn new(
        registry: Arc<Registry>,
        resolver: Arc<AudienceResolver<A, T, C, G>>,
        log: Arc<L>,
        preview: Arc<P>,
        limiter: Arc<Lim>,
    ) -> Self {
        Self {
            registry,
            resolver,
            log,
            preview,
            limiter,
        }
    }
}

/// The concurrency limits a principal's streams count against.
pub fn limit_keys(principal: &StreamPrincipal) -> Vec<LimitKey> {
    match &principal.kind {
        PrincipalKind::User { user, api_key } => {
            let mut keys = vec![LimitKey::User(user.as_ref().to_owned())];
            if *api_key {
                keys.push(LimitKey::ApiKey(principal.credential_id.clone()));
            }
            keys
        }
        PrincipalKind::AccountManager { user } => vec![
            LimitKey::User(user.as_ref().to_owned()),
            LimitKey::ApiKey(principal.credential_id.clone()),
        ],
        // A bot's or harness's streams count against that credential only,
        // never against the user it acts for.
        PrincipalKind::Bot { bot_id, .. } => vec![LimitKey::Bot(*bot_id)],
        PrincipalKind::Harness { harness_id, .. } => vec![LimitKey::Harness(*harness_id)],
    }
}

impl<A, T, C, G, L, P, Lim> StreamService<A, T, C, G, L, P, Lim>
where
    L: EventLog,
{
    /// A resume cursor inside the replay window and not ahead of the clock.
    async fn check_cursor(
        &self,
        cursor: Cursor,
        span: &tracing::Span,
    ) -> Result<Cursor, StreamError> {
        let now = now_ms();
        span.record("cursor_age_ms", now.saturating_sub(cursor.ms));
        if cursor.ms > now.saturating_add(CURSOR_CLOCK_SKEW_MS) {
            return Err(StreamError::BadRequest(
                "cursor is in the future".to_owned(),
            ));
        }
        let floor = self
            .log
            .retained_floor()
            .await
            .map_err(StreamError::Internal)?;
        if cursor < floor {
            return Err(StreamError::CursorExpired);
        }
        Ok(cursor)
    }
}

impl<A, T, C, G, L, P, Lim> EventStreamService for StreamService<A, T, C, G, L, P, Lim>
where
    A: AccessDirectory,
    T: TeamDirectory,
    C: ContactDirectory,
    G: GithubClaims,
    L: EventLog,
    P: PreviewFlag,
    Lim: StreamLimiter,
{
    async fn preview_enabled(&self, principal: &StreamPrincipal) -> bool {
        self.preview.enabled_for(principal.kind.user()).await
    }

    #[tracing::instrument(
        name = "events.stream.open",
        skip_all,
        err(level = tracing::Level::INFO),
        fields(
            principal.kind = request.principal.kind.as_str(),
            credential.id = %request.principal.credential_id,
            scope = %request.scope,
            filter_count = request.filters.len(),
            preview = tracing::field::Empty,
            resumed = tracing::field::Empty,
            cursor_age_ms = tracing::field::Empty,
            stream.id = tracing::field::Empty,
        )
    )]
    async fn open_stream(
        &self,
        request: OpenStream,
    ) -> Result<BoxStream<'static, StreamItem>, StreamError> {
        let span = tracing::Span::current();
        let preview = self.preview_enabled(&request.principal).await;
        span.record("preview", preview);

        // Everything new is behind the flag. An unflagged stream keeps the
        // original contract: 50 filters, no concurrency limit, no credential
        // re-check, no coalescing, and a full buffer skips rather than closes.
        let max_filters = if preview {
            MAX_STREAM_FILTERS
        } else {
            MAX_WEBHOOK_FILTERS
        };
        validate_filters(&request.filters, max_filters)
            .map_err(|error| StreamError::BadRequest(error.0))?;

        // Without the flag a stream has no cursors: `Last-Event-ID` carries a
        // broker event id from an older client and is ignored, as before.
        let resume = match (preview, request.resume) {
            (true, Some(resume)) => {
                let parsed = match resume {
                    Resume::LastEventId(raw) => raw.parse::<Cursor>().ok(),
                    Resume::Cursor(raw) => Some(
                        raw.parse()
                            .map_err(|_| StreamError::BadRequest("invalid cursor".to_owned()))?,
                    ),
                };
                match parsed {
                    Some(cursor) => Some(self.check_cursor(cursor, &span).await?),
                    None => None,
                }
            }
            _ => None,
        };
        span.record("resumed", resume.is_some());

        let principal = Arc::new(request.principal);
        if request.scope == WebhookScope::Team {
            let candidate = Candidate {
                principal: &principal,
                scope: request.scope,
                preview,
            };
            let workspace = self
                .resolver
                .workspace(&candidate)
                .await
                .map_err(StreamError::Internal)?;
            if workspace.is_none() {
                return Err(StreamError::BadRequest(
                    "team scope requires the user to belong to a team".to_string(),
                ));
            }
        }

        let lease_holder = uuid::Uuid::now_v7().to_string();
        let limit_keys = if preview {
            limit_keys(&principal)
        } else {
            Vec::new()
        };
        if self
            .limiter
            .acquire(&limit_keys, &lease_holder)
            .await
            .map_err(StreamError::Internal)?
            .is_some()
        {
            return Err(StreamError::TooManyStreams);
        }

        let filters = Arc::new(request.filters);
        let subscription = self.registry.register(Registration {
            principal: principal.clone(),
            scope: request.scope,
            filters: filters.clone(),
            preview,
        });
        span.record("stream.id", subscription.id);
        crate::metrics::metrics().open_streams.add(1, &[]);

        let (transport, items) = mpsc::channel(TRANSPORT_BUFFER);
        let task = StreamTask {
            service: self.clone(),
            id: subscription.id,
            principal,
            scope: request.scope,
            filters,
            preview,
            credential: request.credential,
            lease_holder,
            limit_keys,
            transport,
            last_sent: None,
            coalescing: HashMap::new(),
            delivered: 0,
            opened: Instant::now(),
        };
        tokio::spawn(task.run(resume, subscription.deliveries, subscription.closed));

        Ok(Box::pin(ReceiverStream::new(items)))
    }
}

/// A coalesced event waiting for its window to end.
struct Coalescing {
    window_ends: tokio::time::Instant,
    pending: Option<Delivery>,
}

/// Why sending to the transport stopped.
enum Stop {
    Closed(CloseReason),
}

struct StreamTask<A, T, C, G, L, P, Lim> {
    service: StreamService<A, T, C, G, L, P, Lim>,
    id: StreamId,
    principal: Arc<StreamPrincipal>,
    scope: WebhookScope,
    filters: Arc<WebhookFilters>,
    preview: bool,
    credential: Arc<dyn CredentialCheck>,
    lease_holder: String,
    limit_keys: Vec<LimitKey>,
    transport: mpsc::Sender<StreamItem>,
    /// The highest cursor sent: the SSE id of the last event, and where a
    /// lagged client resumes.
    last_sent: Option<Cursor>,
    coalescing: HashMap<(String, String), Coalescing>,
    delivered: u64,
    opened: Instant,
}

impl<A, T, C, G, L, P, Lim> StreamTask<A, T, C, G, L, P, Lim>
where
    A: AccessDirectory,
    T: TeamDirectory,
    C: ContactDirectory,
    G: GithubClaims,
    L: EventLog,
    P: PreviewFlag,
    Lim: StreamLimiter,
{
    async fn run(
        mut self,
        resume: Option<Cursor>,
        mut deliveries: mpsc::Receiver<Delivery>,
        mut closed: oneshot::Receiver<CloseReason>,
    ) {
        let Stop::Closed(reason) = self.stream(resume, &mut deliveries, &mut closed).await;
        self.finish(reason).await;
    }

    async fn stream(
        &mut self,
        resume: Option<Cursor>,
        deliveries: &mut mpsc::Receiver<Delivery>,
        closed: &mut oneshot::Receiver<CloseReason>,
    ) -> Stop {
        if let Some(cursor) = resume
            && let Err(stop) = self.replay(cursor, closed).await
        {
            return stop;
        }
        // Live events at or before what the client already has (its cursor,
        // or what the replay sent) are skipped: the tail can still be handing
        // out entries older than the replay's last read.
        let replayed_through = self.last_sent.max(resume);

        let mut revalidate = tokio::time::interval_at(
            tokio::time::Instant::now() + REVALIDATE_INTERVAL,
            REVALIDATE_INTERVAL,
        );
        loop {
            let next_window = self
                .coalescing
                .values()
                .map(|coalescing| coalescing.window_ends)
                .min();
            tokio::select! {
                biased;
                () = self.transport.closed() => return Stop::Closed(CloseReason::Client),
                reason = &mut *closed => {
                    return Stop::Closed(reason.unwrap_or(CloseReason::Shutdown));
                }
                delivery = deliveries.recv() => {
                    let Some(delivery) = delivery else {
                        return Stop::Closed(CloseReason::Shutdown);
                    };
                    if replayed_through.is_some_and(|through| delivery.cursor <= through) {
                        continue;
                    }
                    if let Err(stop) = self.offer(delivery, closed).await {
                        return stop;
                    }
                }
                _ = revalidate.tick(), if self.preview => {
                    if let Err(stop) = self.revalidate().await {
                        return stop;
                    }
                }
                () = sleep_until(next_window) => {
                    if let Err(stop) = self.flush_windows(closed).await {
                        return stop;
                    }
                }
            }
        }
    }

    /// Replay the log after `cursor`, resolving access at replay time.
    async fn replay(
        &mut self,
        mut after: Cursor,
        closed: &mut oneshot::Receiver<CloseReason>,
    ) -> Result<(), Stop> {
        loop {
            match self.service.log.retained_floor().await {
                Ok(floor) if after < floor => return Err(Stop::Closed(CloseReason::Reset)),
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, stream.id = self.id, "failed to read the replay window");
                    return Err(Stop::Closed(CloseReason::Lagged));
                }
            }
            let page = match self.service.log.read_after(after, REPLAY_PAGE).await {
                Ok(page) => page,
                Err(error) => {
                    tracing::warn!(error = ?error, stream.id = self.id, "failed to replay the public event log");
                    return Err(Stop::Closed(CloseReason::Lagged));
                }
            };
            for entry in page.entries {
                if let Some(delivery) = self.replayable(entry).await? {
                    self.offer(delivery, closed).await?;
                }
            }
            match page.last {
                Some(last) if page.full => after = last,
                _ => return Ok(()),
            }
        }
    }

    /// A replayed entry, if this stream may receive it now.
    async fn replayable(&self, entry: LogEntry) -> Result<Option<Delivery>, Stop> {
        let Some(public) = entry.record.event else {
            return Ok(None);
        };
        let subject = FilterSubject {
            event_name: &public.event.event_name,
            entity_type: &public.event.entity_type,
            entity_id: &public.event.entity_id,
        };
        if !filters::any_accepts(&self.filters, subject, self.preview) {
            return Ok(None);
        }
        if !eligible(&self.principal, self.preview, &public.event, public.stage) {
            return Ok(None);
        }
        let candidate = Candidate {
            principal: &self.principal,
            scope: self.scope,
            preview: self.preview,
        };
        let admitted = match self
            .service
            .resolver
            .resolve(&public.audience, &[candidate])
            .await
        {
            Ok(resolution) => resolution.admitted.first().copied().unwrap_or(false),
            Err(error) => {
                // As at fan-out: the event is dropped, the stream continues.
                tracing::error!(error = ?error, stream.id = self.id, "failed to resolve access during replay; dropping the event");
                false
            }
        };
        Ok(admitted.then(|| Delivery {
            cursor: entry.cursor,
            event: Arc::new(public.event),
        }))
    }

    /// Send an event, or hold it for its coalescing window.
    async fn offer(
        &mut self,
        delivery: Delivery,
        closed: &mut oneshot::Receiver<CloseReason>,
    ) -> Result<(), Stop> {
        if self.preview && COALESCED_EVENTS.contains(&delivery.event.event_name.as_str()) {
            let key = (
                delivery.event.event_name.clone(),
                delivery.event.entity_id.clone(),
            );
            let now = tokio::time::Instant::now();
            if let Some(coalescing) = self.coalescing.get_mut(&key)
                && coalescing.window_ends > now
            {
                coalescing.pending = Some(delivery);
                return Ok(());
            }
            self.coalescing.insert(
                key,
                Coalescing {
                    window_ends: now + COALESCE_WINDOW,
                    pending: None,
                },
            );
        }
        self.send(delivery, closed).await
    }

    /// Send the latest event of every window that ended.
    async fn flush_windows(
        &mut self,
        closed: &mut oneshot::Receiver<CloseReason>,
    ) -> Result<(), Stop> {
        let now = tokio::time::Instant::now();
        let mut due = Vec::new();
        self.coalescing.retain(|_, coalescing| {
            if coalescing.window_ends > now {
                return true;
            }
            if let Some(pending) = coalescing.pending.take() {
                due.push(pending);
            }
            false
        });
        due.sort_by_key(|delivery| delivery.cursor);
        for delivery in due {
            self.send(delivery, closed).await?;
        }
        Ok(())
    }

    async fn send(
        &mut self,
        delivery: Delivery,
        closed: &mut oneshot::Receiver<CloseReason>,
    ) -> Result<(), Stop> {
        // A coalesced event can trail newer ones, so the highest cursor sent
        // is not always a safe place to resume: the SSE id is the resume
        // point (see `resume_point`), and resuming from it never skips an
        // event still held for its window.
        let cursor = self
            .last_sent
            .map_or(delivery.cursor, |last| last.max(delivery.cursor));
        let id = if self.preview {
            self.resume_point(cursor).to_string()
        } else {
            delivery.event.event_id.clone()
        };
        let item = StreamItem::Event {
            id,
            event: delivery.event,
        };
        tokio::select! {
            biased;
            reason = &mut *closed => Err(Stop::Closed(reason.unwrap_or(CloseReason::Shutdown))),
            sent = self.transport.send(item) => match sent {
                Ok(()) => {
                    self.last_sent = Some(cursor);
                    self.delivered += 1;
                    Ok(())
                }
                Err(_) => Err(Stop::Closed(CloseReason::Client)),
            },
        }
    }

    /// Where a client that has seen everything through `sent` resumes: just
    /// before the oldest event still held in a coalescing window, if any.
    fn resume_point(&self, sent: Cursor) -> Cursor {
        self.coalescing
            .values()
            .filter_map(|coalescing| coalescing.pending.as_ref())
            .map(|pending| before(pending.cursor))
            .fold(sent, Cursor::min)
    }

    async fn revalidate(&mut self) -> Result<(), Stop> {
        // Bounded, so a hung check never stops the stream draining its
        // buffer; a timeout is treated like a failed check.
        match tokio::time::timeout(CHECK_TIMEOUT, self.credential.still_valid()).await {
            Ok(Ok(true)) => {}
            Ok(Ok(false)) => return Err(Stop::Closed(CloseReason::Revoked)),
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, stream.id = self.id, "failed to re-validate a stream's credential; keeping it open");
            }
            Err(_) => {
                tracing::warn!(
                    stream.id = self.id,
                    "re-validating a stream's credential timed out; keeping it open"
                );
            }
        }
        let renewal = tokio::time::timeout(
            CHECK_TIMEOUT,
            self.service
                .limiter
                .renew(&self.limit_keys, &self.lease_holder),
        )
        .await;
        match renewal {
            Ok(Ok(refused)) => {
                for key in refused {
                    tracing::warn!(
                        limit = key.kind(),
                        stream.id = self.id,
                        "a stream lost its concurrency lease; keeping it open"
                    );
                }
            }
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, stream.id = self.id, "failed to renew a stream's concurrency lease");
            }
            Err(_) => {
                tracing::warn!(
                    stream.id = self.id,
                    "renewing a stream's concurrency lease timed out"
                );
            }
        }
        Ok(())
    }

    async fn finish(self, reason: CloseReason) {
        self.service.registry.deregister(self.id);
        crate::metrics::record_close(reason.as_str());
        self.service
            .limiter
            .release(&self.limit_keys, &self.lease_holder)
            .await;

        let control = match reason {
            CloseReason::Client | CloseReason::Shutdown => None,
            CloseReason::Lagged => Some(ControlEvent::Lagged {
                cursor: self
                    .preview
                    .then_some(self.last_sent)
                    .flatten()
                    .map(|cursor| self.resume_point(cursor).to_string()),
            }),
            CloseReason::Revoked => Some(ControlEvent::Revoked {
                reason: "credential",
            }),
            CloseReason::BotDeleted => Some(ControlEvent::Revoked {
                reason: "bot_deleted",
            }),
            CloseReason::Reset => Some(ControlEvent::Reset),
        };
        if let Some(control) = control {
            // Best effort: a client too slow to drain its buffer may not get
            // it, and reconnects on the closed connection either way.
            let _ = self.transport.try_send(StreamItem::Control(control));
        }

        let span = tracing::info_span!(
            "events.stream.close",
            stream.id = self.id,
            principal.kind = self.principal.kind.as_str(),
            credential.id = %self.principal.credential_id,
            close.reason = reason.as_str(),
            delivered = self.delivered,
            duration_ms = u64::try_from(self.opened.elapsed().as_millis()).unwrap_or(u64::MAX),
        );
        span.in_scope(|| tracing::info!("event stream closed"));
    }
}

async fn sleep_until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

/// The cursor just before `cursor`.
fn before(cursor: Cursor) -> Cursor {
    match cursor.seq {
        0 => Cursor {
            ms: cursor.ms.saturating_sub(1),
            seq: u64::MAX,
        },
        seq => Cursor {
            ms: cursor.ms,
            seq: seq - 1,
        },
    }
}

fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or_default()
}
