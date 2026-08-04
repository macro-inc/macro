//! Google Calendar API adapter.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, NaiveDate, Utc};
use reqwest::{Client, RequestBuilder, StatusCode};
use rootcause::Report;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::{
    models::{
        AttendeeResponseStatus, CalendarAttendee, CalendarEvent, CalendarEventOverride,
        CalendarEventSource, CalendarEventUpsert, CalendarOccurrence, EventStart, EventStatus,
        EventTime, EventTransparency, EventVisibility, GoogleEventSource, GoogleEventSyncBatch,
        GoogleSyncPlan, GoogleWatchChannel, GoogleWatchConfig, OccurrenceRange, ProviderCalendar,
    },
    ports::{
        GoogleCalendarProvider, GoogleEventSyncContext, GoogleProviderError,
        GoogleProviderErrorKind,
    },
};

const GOOGLE_CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3";

/// Consulted before every Google Calendar HTTP request so deployments can
/// enforce the per-user API quota. Denials surface as transient provider
/// errors, which the backfill lifecycle retries.
pub trait GoogleRequestGate: Send + Sync + 'static {
    /// Admit one provider request on behalf of the connected inbox.
    fn acquire(
        &self,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<(), GoogleProviderError>> + Send;
}

/// Gate that admits every request, for tests and unmetered environments.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnmeteredGate;

impl GoogleRequestGate for UnmeteredGate {
    async fn acquire(&self, _email_link_id: Uuid) -> Result<(), GoogleProviderError> {
        Ok(())
    }
}

/// Google Calendar REST client.
#[derive(Clone)]
pub struct GoogleCalendarClient<G = UnmeteredGate> {
    client: Client,
    gate: G,
}

impl GoogleCalendarClient<UnmeteredGate> {
    /// Construct an unmetered client using the application's HTTP client.
    pub fn new(client: Client) -> Self {
        Self {
            client,
            gate: UnmeteredGate,
        }
    }
}

impl<G: GoogleRequestGate> GoogleCalendarClient<G> {
    /// Construct a client whose requests must pass the supplied quota gate.
    pub fn with_gate(client: Client, gate: G) -> Self {
        Self { client, gate }
    }

    async fn calendars(
        &self,
        access_token: &str,
        email_link_id: Uuid,
    ) -> Result<Vec<GoogleCalendar>, GoogleProviderError> {
        let mut page_token: Option<String> = None;
        let mut result = Vec::new();
        loop {
            self.gate.acquire(email_link_id).await?;
            let mut request = self
                .client
                .get(format!("{GOOGLE_CALENDAR_API}/users/me/calendarList"))
                .bearer_auth(access_token)
                .query(&[("maxResults", "250"), ("minAccessRole", "reader")]);
            if let Some(token) = &page_token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: GoogleCalendarListResponse = send_google(request).await?;
            result.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        Ok(result)
    }

    async fn events(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        range: &OccurrenceRange,
        single_events: bool,
    ) -> Result<Vec<GoogleEvent>, GoogleProviderError> {
        let calendar = urlencoding::encode(provider_calendar_id);
        let mut page_token: Option<String> = None;
        let mut result = Vec::new();
        loop {
            self.gate.acquire(email_link_id).await?;
            let mut request = self
                .client
                .get(format!("{GOOGLE_CALENDAR_API}/calendars/{calendar}/events"))
                .bearer_auth(access_token)
                .query(&[
                    ("maxResults", "2500".to_string()),
                    ("singleEvents", single_events.to_string()),
                    ("showDeleted", "false".to_string()),
                    ("timeMin", range.starts_at.to_rfc3339()),
                    ("timeMax", range.ends_at.to_rfc3339()),
                    ("timeZone", "UTC".to_string()),
                ]);
            if single_events {
                request = request.query(&[("orderBy", "startTime")]);
            }
            if let Some(token) = &page_token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: GoogleEventListResponse = send_google(request).await?;
            result.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        Ok(result)
    }

    async fn event_changes(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        sync_token: Option<&str>,
        window: &OccurrenceRange,
    ) -> Result<(Vec<GoogleEvent>, String), GoogleProviderError> {
        let calendar = urlencoding::encode(provider_calendar_id);
        let mut page_token: Option<String> = None;
        let mut result = Vec::new();
        loop {
            self.gate.acquire(email_link_id).await?;
            let mut request = self
                .client
                .get(format!("{GOOGLE_CALENDAR_API}/calendars/{calendar}/events"))
                .bearer_auth(access_token)
                .query(&[
                    ("maxResults", "2500"),
                    ("singleEvents", "false"),
                    ("showDeleted", "true"),
                ]);
            if let Some(token) = sync_token {
                // Google forbids combining a sync token with time bounds; the
                // token already encodes the ones it was minted with.
                request = request.query(&[("syncToken", token)]);
            } else {
                // The token-earning enumeration otherwise walks the entire
                // calendar history just to reach the final page. Bound the
                // past only: a timeMax would be encoded into the token and
                // silently hide events created beyond it once the maintained
                // window extends.
                request = request.query(&[("timeMin", window.starts_at.to_rfc3339())]);
            }
            if let Some(token) = &page_token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: GoogleEventListResponse = send_google(request).await?;
            result.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                return page
                    .next_sync_token
                    .map(|next_sync_token| (result, next_sync_token))
                    .ok_or_else(|| {
                        GoogleProviderError::new(
                            GoogleProviderErrorKind::Transient,
                            "Google Calendar change feed ended without a sync token",
                        )
                    });
            }
        }
    }

    async fn event(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        provider_event_id: &str,
    ) -> Result<Option<GoogleEvent>, GoogleProviderError> {
        let calendar = urlencoding::encode(provider_calendar_id);
        let event = urlencoding::encode(provider_event_id);
        self.gate.acquire(email_link_id).await?;
        let response = self
            .client
            .get(format!(
                "{GOOGLE_CALENDAR_API}/calendars/{calendar}/events/{event}"
            ))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(provider_transport_error)?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND || status == StatusCode::GONE {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.map_err(provider_transport_error)?;
            return Err(provider_response_error(status, &body));
        }
        response
            .json()
            .await
            .map(Some)
            .map_err(provider_transport_error)
    }

    async fn events_by_ical_uid(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        ical_uid: &str,
    ) -> Result<Vec<GoogleEvent>, GoogleProviderError> {
        let calendar = urlencoding::encode(provider_calendar_id);
        let mut page_token: Option<String> = None;
        let mut result = Vec::new();
        loop {
            self.gate.acquire(email_link_id).await?;
            let mut request = self
                .client
                .get(format!("{GOOGLE_CALENDAR_API}/calendars/{calendar}/events"))
                .bearer_auth(access_token)
                .query(&[
                    ("maxResults", "2500"),
                    ("singleEvents", "false"),
                    ("showDeleted", "false"),
                    ("iCalUID", ical_uid),
                ]);
            if let Some(token) = &page_token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: GoogleEventListResponse = send_google(request).await?;
            result.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        Ok(result)
    }

    async fn instances(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        provider_event_id: &str,
        range: &OccurrenceRange,
    ) -> Result<Vec<GoogleEvent>, GoogleProviderError> {
        let calendar = urlencoding::encode(provider_calendar_id);
        let event = urlencoding::encode(provider_event_id);
        let mut page_token: Option<String> = None;
        let mut result = Vec::new();
        loop {
            self.gate.acquire(email_link_id).await?;
            let mut request = self
                .client
                .get(format!(
                    "{GOOGLE_CALENDAR_API}/calendars/{calendar}/events/{event}/instances"
                ))
                .bearer_auth(access_token)
                .query(&[
                    ("maxResults", "2500".to_string()),
                    ("showDeleted", "false".to_string()),
                    ("timeMin", range.starts_at.to_rfc3339()),
                    ("timeMax", range.ends_at.to_rfc3339()),
                    ("timeZone", "UTC".to_string()),
                ]);
            if let Some(token) = &page_token {
                request = request.query(&[("pageToken", token)]);
            }
            let page: GoogleEventListResponse = send_google(request).await?;
            result.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        Ok(result)
    }
}

async fn send_google<T: DeserializeOwned>(
    request: RequestBuilder,
) -> Result<T, GoogleProviderError> {
    let response = request.send().await.map_err(provider_transport_error)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.map_err(provider_transport_error)?;
        return Err(provider_response_error(status, &body));
    }
    response.json().await.map_err(provider_transport_error)
}

fn provider_transport_error(error: reqwest::Error) -> GoogleProviderError {
    GoogleProviderError::new(GoogleProviderErrorKind::Transient, format!("{error:?}"))
}

fn provider_response_error(status: StatusCode, body: &str) -> GoogleProviderError {
    let payload = serde_json::from_str::<GoogleErrorResponse>(body).ok();
    let reasons: Vec<_> = payload
        .as_ref()
        .map(|payload| {
            payload
                .error
                .errors
                .iter()
                .map(|error| error.reason.as_str())
                .collect()
        })
        .unwrap_or_default();
    let kind = if status == StatusCode::GONE || reasons.contains(&"fullSyncRequired") {
        GoogleProviderErrorKind::SyncTokenExpired
    } else if reasons.contains(&"insufficientPermissions") {
        GoogleProviderErrorKind::ReauthRequired
    } else if status == StatusCode::UNAUTHORIZED
        || status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
        || reasons.contains(&"authError")
        || reasons.contains(&"backendError")
        || reasons.contains(&"dailyLimitExceeded")
        || reasons.contains(&"quotaExceeded")
        || reasons.contains(&"rateLimitExceeded")
        || reasons.contains(&"userRateLimitExceeded")
    {
        GoogleProviderErrorKind::Transient
    } else {
        GoogleProviderErrorKind::Permanent
    };
    let message = payload
        .map(|payload| payload.error.message)
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| format!("Google Calendar returned HTTP {status}"));
    GoogleProviderError::new(kind, message)
}

impl<G: GoogleRequestGate> GoogleCalendarProvider for GoogleCalendarClient<G> {
    #[tracing::instrument(skip(self, access_token), err)]
    async fn list_calendars(
        &self,
        access_token: &str,
        email_link_id: Uuid,
    ) -> Result<Vec<ProviderCalendar>, GoogleProviderError> {
        Ok(self
            .calendars(access_token, email_link_id)
            .await?
            .into_iter()
            .map(|calendar| ProviderCalendar {
                provider_calendar_id: calendar.id,
                name: calendar.summary,
                description: calendar.description,
                time_zone: calendar.time_zone,
                color: calendar.background_color,
                access_role: calendar.access_role,
                is_primary: calendar.primary,
                is_selected: calendar.selected,
            })
            .collect())
    }

    #[tracing::instrument(
        skip(self, access_token, context),
        fields(provider_calendar_id = %context.provider_calendar_id),
        err
    )]
    async fn sync_events(
        &self,
        access_token: &str,
        context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        let (changes, next_sync_token, token_was_reset) = match self
            .event_changes(
                access_token,
                context.email_link_id,
                &context.provider_calendar_id,
                context.sync_token.as_deref(),
                &context.range,
            )
            .await
        {
            Ok((changes, next_sync_token)) => (changes, next_sync_token, false),
            Err(error) if error.kind() == GoogleProviderErrorKind::SyncTokenExpired => {
                let (changes, next_sync_token) = self
                    .event_changes(
                        access_token,
                        context.email_link_id,
                        &context.provider_calendar_id,
                        None,
                        &context.range,
                    )
                    .await?;
                (changes, next_sync_token, true)
            }
            Err(error) => return Err(error),
        };
        let rebuild_snapshot =
            needs_full_rebuild(&context.plan, context.sync_token.is_some(), token_was_reset);
        if rebuild_snapshot {
            tracing::info!(
                plan = ?context.plan,
                had_sync_token = context.sync_token.is_some(),
                token_was_reset,
                feed_changes = changes.len(),
                "rebuilding full Google Calendar snapshot"
            );
            let canonical_events = self
                .events(
                    access_token,
                    context.email_link_id,
                    &context.provider_calendar_id,
                    &context.range,
                    false,
                )
                .await?;
            let instances = self
                .events(
                    access_token,
                    context.email_link_id,
                    &context.provider_calendar_id,
                    &context.range,
                    true,
                )
                .await?;

            let mapped = map_snapshot(&context, canonical_events, instances);

            return Ok(GoogleEventSyncBatch {
                upserts: mapped.upserts,
                observed_provider_event_ids: Some(mapped.observed_provider_event_ids),
                next_sync_token,
                materialized_range: Some(context.range.clone()),
                cancelled_provider_event_ids: Vec::new(),
            });
        }

        let mut applied = self
            .apply_change_feed(access_token, &context, changes)
            .await?;
        let materialized_range =
            if let GoogleSyncPlan::ExtendTail { from, from_date } = context.plan {
                self.extend_tail(access_token, &context, from, from_date, &mut applied)
                    .await?;
                Some(context.range.clone())
            } else {
                None
            };

        Ok(GoogleEventSyncBatch {
            upserts: applied.upserts,
            observed_provider_event_ids: None,
            next_sync_token,
            materialized_range,
            cancelled_provider_event_ids: applied.cancelled.into_iter().collect(),
        })
    }

    #[tracing::instrument(skip(self, access_token, config), err)]
    async fn watch_calendar(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        channel_id: Uuid,
        config: &GoogleWatchConfig,
    ) -> Result<GoogleWatchChannel, GoogleProviderError> {
        let calendar = urlencoding::encode(provider_calendar_id);
        self.gate.acquire(email_link_id).await?;
        let response: GoogleChannelResponse = send_google(
            self.client
                .post(format!(
                    "{GOOGLE_CALENDAR_API}/calendars/{calendar}/events/watch"
                ))
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "id": channel_id.to_string(),
                    "type": "web_hook",
                    "address": config.address,
                    "token": config.token,
                })),
        )
        .await?;
        let expiration_millis: i64 = response.expiration.parse().map_err(|_| {
            GoogleProviderError::new(
                GoogleProviderErrorKind::Transient,
                "Google Calendar watch returned an unparseable expiration",
            )
        })?;
        let expires_at = DateTime::from_timestamp_millis(expiration_millis).ok_or_else(|| {
            GoogleProviderError::new(
                GoogleProviderErrorKind::Transient,
                "Google Calendar watch returned an out-of-range expiration",
            )
        })?;
        Ok(GoogleWatchChannel {
            channel_id,
            resource_id: response.resource_id,
            expires_at,
        })
    }
}

/// Feed application state shared by incremental polls and tail extension.
#[derive(Default)]
struct AppliedChangeFeed {
    upserts: Vec<CalendarEventUpsert>,
    cancelled: BTreeSet<String>,
    refreshed_series: BTreeSet<String>,
    upserted_singles: BTreeSet<String>,
}

enum SeriesOutcome {
    Refreshed(Box<CalendarEventUpsert>),
    Gone,
    Malformed,
}

impl<G: GoogleRequestGate> GoogleCalendarClient<G> {
    async fn apply_change_feed(
        &self,
        access_token: &str,
        context: &GoogleEventSyncContext,
        changes: Vec<GoogleEvent>,
    ) -> Result<AppliedChangeFeed, GoogleProviderError> {
        let classified = classify_changes(changes);
        let mut applied = AppliedChangeFeed {
            cancelled: classified.tombstoned_provider_event_ids,
            ..AppliedChangeFeed::default()
        };

        for single in classified.single_upserts {
            let provider_event_id = single.id.clone();
            match map_upsert(context, single.clone(), Vec::new(), vec![single]) {
                Ok(upsert) => {
                    applied.upserts.push(upsert);
                    applied.upserted_singles.insert(provider_event_id);
                }
                Err(error) => {
                    tracing::warn!(
                        error=?error,
                        provider_calendar_id=%context.provider_calendar_id,
                        provider_event_id,
                        "skipping malformed changed Google Calendar event"
                    );
                }
            }
        }

        // One bounded refresh per changed series keeps Google authoritative
        // for recurrence expansion without re-sweeping the whole window.
        for (master_id, feed_master) in classified.refresh_masters {
            match self
                .refresh_series(access_token, context, &master_id, feed_master)
                .await?
            {
                SeriesOutcome::Refreshed(upsert) => {
                    applied.upserts.push(*upsert);
                    applied.refreshed_series.insert(master_id);
                }
                SeriesOutcome::Gone => {
                    applied.cancelled.insert(master_id);
                }
                SeriesOutcome::Malformed => {
                    applied.refreshed_series.insert(master_id);
                }
            }
        }

        Ok(applied)
    }

    async fn refresh_series(
        &self,
        access_token: &str,
        context: &GoogleEventSyncContext,
        master_id: &str,
        feed_master: Option<GoogleEvent>,
    ) -> Result<SeriesOutcome, GoogleProviderError> {
        let master = match feed_master {
            Some(master) => Some(master),
            None => {
                self.event(
                    access_token,
                    context.email_link_id,
                    &context.provider_calendar_id,
                    master_id,
                )
                .await?
            }
        };
        let Some(master) = master else {
            return Ok(SeriesOutcome::Gone);
        };
        if master.status.as_deref() == Some("cancelled") {
            return Ok(SeriesOutcome::Gone);
        }
        let exceptions = if master.ical_uid.is_empty() {
            Vec::new()
        } else {
            self.events_by_ical_uid(
                access_token,
                context.email_link_id,
                &context.provider_calendar_id,
                &master.ical_uid,
            )
            .await?
            .into_iter()
            .filter(|event| event.recurring_event_id.is_some())
            .collect()
        };
        let instances = self
            .instances(
                access_token,
                context.email_link_id,
                &context.provider_calendar_id,
                &master.id,
                &context.range,
            )
            .await?;
        let provider_event_id = master.id.clone();
        match map_upsert(context, master, exceptions, instances) {
            Ok(upsert) => Ok(SeriesOutcome::Refreshed(Box::new(upsert))),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%context.provider_calendar_id,
                    provider_event_id,
                    "skipping malformed changed Google Calendar series"
                );
                Ok(SeriesOutcome::Malformed)
            }
        }
    }

    /// Materialize only the window the stored coverage does not reach yet:
    /// one bounded expanded sweep of the tail, then a full-window refresh of
    /// each series that surfaced there and was not already refreshed.
    async fn extend_tail(
        &self,
        access_token: &str,
        context: &GoogleEventSyncContext,
        from: DateTime<Utc>,
        from_date: NaiveDate,
        applied: &mut AppliedChangeFeed,
    ) -> Result<(), GoogleProviderError> {
        let tail = OccurrenceRange {
            starts_at: from,
            ends_at: context.range.ends_at,
            start_date: from_date,
            end_date: context.range.end_date,
        };
        if tail.starts_at >= tail.ends_at {
            return Ok(());
        }
        let tail_events = self
            .events(
                access_token,
                context.email_link_id,
                &context.provider_calendar_id,
                &tail,
                true,
            )
            .await?;
        let (tail_series, tail_singles) = plan_tail_refreshes(tail_events, applied);

        for single in tail_singles {
            let provider_event_id = single.id.clone();
            match map_upsert(context, single.clone(), Vec::new(), vec![single]) {
                Ok(upsert) => {
                    applied.upserts.push(upsert);
                    applied.upserted_singles.insert(provider_event_id);
                }
                Err(error) => {
                    tracing::warn!(
                        error=?error,
                        provider_calendar_id=%context.provider_calendar_id,
                        provider_event_id,
                        "skipping malformed Google Calendar event in the coverage tail"
                    );
                }
            }
        }

        for master_id in tail_series {
            match self
                .refresh_series(access_token, context, &master_id, None)
                .await?
            {
                SeriesOutcome::Refreshed(upsert) => {
                    applied.upserts.push(*upsert);
                    applied.refreshed_series.insert(master_id);
                }
                SeriesOutcome::Gone => {
                    applied.cancelled.insert(master_id);
                }
                SeriesOutcome::Malformed => {
                    applied.refreshed_series.insert(master_id);
                }
            }
        }

        Ok(())
    }
}

/// Whether this run must rebuild the complete bounded snapshot instead of
/// applying the change feed. ExtendTail deliberately stays out of this set:
/// it applies the feed and then materializes only the uncovered tail.
fn needs_full_rebuild(plan: &GoogleSyncPlan, has_sync_token: bool, token_was_reset: bool) -> bool {
    matches!(plan, GoogleSyncPlan::FullSnapshot) || !has_sync_token || token_was_reset
}

/// Split a tail sweep into series needing a refresh and standalone events to
/// upsert, skipping anything the change feed already handled this run.
fn plan_tail_refreshes(
    tail_events: Vec<GoogleEvent>,
    applied: &AppliedChangeFeed,
) -> (BTreeSet<String>, Vec<GoogleEvent>) {
    let mut series = BTreeSet::new();
    let mut singles = Vec::new();
    let mut seen_singles = BTreeSet::new();
    for event in tail_events {
        if let Some(master_id) = &event.recurring_event_id {
            if !applied.refreshed_series.contains(master_id)
                && !applied.cancelled.contains(master_id)
            {
                series.insert(master_id.clone());
            }
        } else if !applied.upserted_singles.contains(&event.id)
            && !applied.cancelled.contains(&event.id)
            && seen_singles.insert(event.id.clone())
        {
            singles.push(event);
        }
    }
    (series, singles)
}

#[derive(Default)]
struct ClassifiedChanges {
    /// Events the feed reported deleted; a master id also retires its
    /// expanded instances during the fenced per-calendar commit.
    tombstoned_provider_event_ids: BTreeSet<String>,
    /// Recurring series needing a bounded refresh, keyed by master id and
    /// carrying the master when the feed already delivered it.
    refresh_masters: BTreeMap<String, Option<GoogleEvent>>,
    /// Changed standalone events whose feed payload is the whole update.
    single_upserts: Vec<GoogleEvent>,
}

fn classify_changes(changes: Vec<GoogleEvent>) -> ClassifiedChanges {
    let mut classified = ClassifiedChanges::default();
    for change in changes {
        let is_cancelled = change.status.as_deref() == Some("cancelled");
        match (&change.recurring_event_id, is_cancelled) {
            (Some(master_id), _) => {
                // Created, modified, or cancelled exceptions all resolve by
                // refreshing their series from the provider.
                classified
                    .refresh_masters
                    .entry(master_id.clone())
                    .or_insert(None);
            }
            (None, true) => {
                classified.tombstoned_provider_event_ids.insert(change.id);
            }
            (None, false) if !change.recurrence.is_empty() => {
                classified
                    .refresh_masters
                    .insert(change.id.clone(), Some(change));
            }
            (None, false) => classified.single_upserts.push(change),
        }
    }
    classified
}

struct MappedGoogleSnapshot {
    upserts: Vec<CalendarEventUpsert>,
    observed_provider_event_ids: Vec<String>,
}

fn map_snapshot(
    context: &GoogleEventSyncContext,
    canonical_events: Vec<GoogleEvent>,
    instances: Vec<GoogleEvent>,
) -> MappedGoogleSnapshot {
    let mut occurrences: BTreeMap<String, Vec<GoogleEvent>> = BTreeMap::new();
    for instance in instances {
        occurrences
            .entry(instance.ical_uid.clone())
            .or_default()
            .push(instance);
    }

    let mut exceptions: BTreeMap<String, Vec<GoogleEvent>> = BTreeMap::new();
    let mut masters = BTreeMap::new();
    for event in canonical_events {
        if event.recurring_event_id.is_some() {
            exceptions
                .entry(event.ical_uid.clone())
                .or_default()
                .push(event);
        } else {
            masters.insert(event.ical_uid.clone(), event);
        }
    }

    // Google can omit a master outside the requested window while still
    // returning one expanded instance. Preserve identity by using that
    // instance as a read-only canonical fallback.
    for (uid, uid_instances) in &occurrences {
        if !masters.contains_key(uid)
            && let Some(instance) = uid_instances.first()
        {
            masters.insert(uid.clone(), instance.clone());
        }
    }

    let observed_provider_event_ids = masters
        .values()
        .map(|master| master.id.clone())
        .collect::<Vec<_>>();
    let upserts = masters
        .into_iter()
        .filter_map(|(uid, master)| {
            let provider_event_id = master.id.clone();
            map_upsert(
                context,
                master,
                exceptions.remove(&uid).unwrap_or_default(),
                occurrences.remove(&uid).unwrap_or_default(),
            )
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%context.provider_calendar_id,
                    provider_event_id,
                    "skipping malformed Google Calendar master"
                );
            })
            .ok()
        })
        .collect();
    MappedGoogleSnapshot {
        upserts,
        observed_provider_event_ids,
    }
}

fn map_upsert(
    context: &GoogleEventSyncContext,
    master: GoogleEvent,
    exceptions: Vec<GoogleEvent>,
    instances: Vec<GoogleEvent>,
) -> Result<CalendarEventUpsert, Report> {
    let event_id = Uuid::now_v7();
    let time = google_time(&master)?;
    let created_at = parse_datetime(master.created.as_deref()).unwrap_or_else(Utc::now);
    let updated_at = parse_datetime(master.updated.as_deref()).unwrap_or(created_at);
    let source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: context.email_link_id,
        account_id: context.account_id,
        calendar_id: context.calendar_id,
        provider_event_id: master.id.clone(),
        provider_recurring_event_id: master.recurring_event_id.clone(),
        provider_etag: master.etag.clone(),
        raw_payload: serde_json::to_value(&master).map_err(report)?,
    });
    let event = CalendarEvent {
        id: event_id,
        owner_id: context.owner_id.clone(),
        ical_uid: master.ical_uid.clone(),
        title: master.summary.clone().unwrap_or_default(),
        description: master.description.clone(),
        location: master.location.clone(),
        status: google_status(master.status.as_deref()),
        visibility: google_visibility(master.visibility.as_deref()),
        transparency: google_transparency(master.transparency.as_deref()),
        time,
        recurrence_lines: master.recurrence.clone(),
        organizer_email: master
            .organizer
            .as_ref()
            .and_then(|value| value.email.clone()),
        organizer_name: master
            .organizer
            .as_ref()
            .and_then(|value| value.display_name.clone()),
        conference_url: master
            .hangout_link
            .clone()
            .or_else(|| conference_url(master.conference_data.as_ref())),
        sequence: master.sequence.unwrap_or_default(),
        is_read_only: context.is_read_only,
        attendees: master
            .attendees
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter_map(map_attendee)
            .collect(),
        created_at,
        updated_at,
    };

    let overrides = exceptions
        .into_iter()
        .filter_map(|exception| {
            // Cancelled exceptions arrive without times; the occurrence
            // replace already removes them, so there is no override to keep.
            if exception.status.as_deref() == Some("cancelled") {
                return None;
            }
            let provider_event_id = exception.id.clone();
            (|| -> Result<CalendarEventOverride, Report> {
                let original = exception
                    .original_start_time
                    .as_ref()
                    .and_then(google_start)
                    .ok_or_else(|| {
                        rootcause::report!(
                            "Google recurring exception {} has an invalid original start",
                            exception.id
                        )
                    })?;
                let time = google_time(&exception)?;
                Ok(CalendarEventOverride {
                    recurrence_id: original.occurrence_key(),
                    original_time: original,
                    time,
                    title: exception.summary,
                    description: exception.description,
                    location: exception.location,
                    status: Some(google_status(exception.status.as_deref())),
                })
            })()
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%context.provider_calendar_id,
                    provider_event_id,
                    "skipping malformed Google Calendar recurrence exception"
                );
            })
            .ok()
        })
        .collect();

    let occurrences = instances
        .into_iter()
        .filter_map(|instance| {
            let provider_event_id = instance.id.clone();
            (|| -> Result<Option<CalendarOccurrence>, Report> {
                let time = google_time(&instance)?;
                let original_start = instance
                    .original_start_time
                    .as_ref()
                    .map(|value| {
                        google_start(value).ok_or_else(|| {
                            rootcause::report!(
                                "Google recurring instance {} has an invalid original start",
                                instance.id
                            )
                        })
                    })
                    .transpose()?;
                Ok(time.overlaps(&context.range).then(|| CalendarOccurrence {
                    event_id,
                    occurrence_key: original_start
                        .as_ref()
                        .map(|start| start.occurrence_key())
                        .unwrap_or_else(|| time.occurrence_key()),
                    recurrence_id: original_start.map(|start| start.occurrence_key()),
                    time,
                    is_cancelled: instance.status.as_deref() == Some("cancelled"),
                }))
            })()
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%context.provider_calendar_id,
                    provider_event_id,
                    "skipping malformed Google Calendar recurrence instance"
                );
            })
            .ok()
            .flatten()
        })
        .collect();

    Ok(CalendarEventUpsert {
        event,
        source,
        overrides,
        occurrences,
    })
}

fn google_time(event: &GoogleEvent) -> Result<EventTime, Report> {
    let start = event
        .start
        .as_ref()
        .ok_or_else(|| rootcause::report!("Google event {} has no start", event.id))?;
    let end = event
        .end
        .as_ref()
        .ok_or_else(|| rootcause::report!("Google event {} has no end", event.id))?;
    match (
        start.date_time.as_deref(),
        end.date_time.as_deref(),
        start.date.as_deref(),
        end.date.as_deref(),
    ) {
        (Some(start_value), Some(end_value), _, _) => {
            let starts_at = DateTime::parse_from_rfc3339(start_value)
                .map_err(report)?
                .with_timezone(&Utc);
            let ends_at = DateTime::parse_from_rfc3339(end_value)
                .map_err(report)?
                .with_timezone(&Utc);
            Ok(EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: start.time_zone.clone(),
            })
        }
        (_, _, Some(start_value), Some(end_value)) => Ok(EventTime::AllDay {
            start_date: NaiveDate::parse_from_str(start_value, "%Y-%m-%d").map_err(report)?,
            end_date: NaiveDate::parse_from_str(end_value, "%Y-%m-%d").map_err(report)?,
        }),
        _ => Err(rootcause::report!(
            "Google event {} has mixed or missing time fields",
            event.id
        )),
    }
}

fn google_start(value: &GoogleEventDateTime) -> Option<EventStart> {
    if let Some(date_time) = &value.date_time {
        DateTime::parse_from_rfc3339(date_time)
            .ok()
            .map(|value| EventStart::Timed(value.with_timezone(&Utc)))
    } else {
        value.date.as_deref().and_then(|date| {
            NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .ok()
                .map(EventStart::AllDay)
        })
    }
}

fn map_attendee(value: GoogleAttendee) -> Option<CalendarAttendee> {
    let email = value.email?.to_ascii_lowercase();
    Some(CalendarAttendee {
        email,
        display_name: value.display_name,
        response_status: match value.response_status.as_deref() {
            Some("accepted") => AttendeeResponseStatus::Accepted,
            Some("declined") => AttendeeResponseStatus::Declined,
            Some("tentative") => AttendeeResponseStatus::Tentative,
            _ => AttendeeResponseStatus::NeedsAction,
        },
        is_organizer: value.organizer,
        is_optional: value.optional,
        is_self: value.is_self,
        comment: value.comment,
    })
}

fn conference_url(data: Option<&GoogleConferenceData>) -> Option<String> {
    data.and_then(|data| {
        data.entry_points
            .iter()
            .find(|entry| entry.entry_point_type.as_deref() == Some("video"))
            .and_then(|entry| entry.uri.clone())
    })
}

fn google_status(value: Option<&str>) -> EventStatus {
    match value {
        Some("tentative") => EventStatus::Tentative,
        Some("cancelled") => EventStatus::Cancelled,
        _ => EventStatus::Confirmed,
    }
}

fn google_visibility(value: Option<&str>) -> EventVisibility {
    match value {
        Some("public") => EventVisibility::Public,
        Some("private") => EventVisibility::Private,
        Some("confidential") => EventVisibility::Confidential,
        _ => EventVisibility::Default,
    }
}

fn google_transparency(value: Option<&str>) -> EventTransparency {
    if value == Some("transparent") {
        EventTransparency::Transparent
    } else {
        EventTransparency::Opaque
    }
}

fn parse_datetime(value: Option<&str>) -> Option<DateTime<Utc>> {
    value
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
}

fn report(error: impl std::error::Error + Send + Sync + 'static) -> Report {
    rootcause::report!(error).into()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleChannelResponse {
    resource_id: String,
    expiration: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarListResponse {
    #[serde(default)]
    items: Vec<GoogleCalendar>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleErrorResponse {
    error: GoogleErrorBody,
}

#[derive(Debug, Deserialize)]
struct GoogleErrorBody {
    message: String,
    #[serde(default)]
    errors: Vec<GoogleErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct GoogleErrorDetail {
    reason: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendar {
    id: String,
    summary: String,
    description: Option<String>,
    time_zone: Option<String>,
    background_color: Option<String>,
    access_role: Option<String>,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    selected: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEventListResponse {
    #[serde(default)]
    items: Vec<GoogleEvent>,
    next_page_token: Option<String>,
    next_sync_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEvent {
    id: String,
    #[serde(rename = "iCalUID")]
    #[serde(default)]
    ical_uid: String,
    etag: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    visibility: Option<String>,
    transparency: Option<String>,
    start: Option<GoogleEventDateTime>,
    end: Option<GoogleEventDateTime>,
    #[serde(default)]
    recurrence: Vec<String>,
    recurring_event_id: Option<String>,
    original_start_time: Option<GoogleEventDateTime>,
    organizer: Option<GooglePerson>,
    #[serde(default)]
    attendees: Option<Vec<GoogleAttendee>>,
    hangout_link: Option<String>,
    conference_data: Option<GoogleConferenceData>,
    sequence: Option<u32>,
    created: Option<String>,
    updated: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEventDateTime {
    date: Option<String>,
    date_time: Option<String>,
    time_zone: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GooglePerson {
    email: Option<String>,
    display_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleAttendee {
    email: Option<String>,
    display_name: Option<String>,
    response_status: Option<String>,
    #[serde(default)]
    organizer: bool,
    #[serde(default)]
    optional: bool,
    #[serde(default, rename = "self")]
    is_self: bool,
    comment: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleConferenceData {
    #[serde(default)]
    entry_points: Vec<GoogleEntryPoint>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEntryPoint {
    entry_point_type: Option<String>,
    uri: Option<String>,
}

#[cfg(test)]
mod test;
