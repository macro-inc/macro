//! Google Calendar API adapter.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, NaiveDate, Utc};
use reqwest::{Client, RequestBuilder, StatusCode};
use rootcause::Report;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::{
    models::{
        ActorInboxes, AttendeeResponseStatus, CalendarAttendee, CalendarAttendeeInput,
        CalendarEvent, CalendarEventDraft, CalendarEventOverride, CalendarEventPatch,
        CalendarEventSource, CalendarEventUpsert, CalendarOccurrence, ConferenceChange,
        ConferenceProvider, EventReminderOverride, EventReminders, EventStart, EventStatus,
        EventTime, EventTransparency, EventType, EventVisibility, GoogleCalendarTarget,
        GoogleEventSource, GoogleEventSyncBatch, GoogleSyncPlan, GoogleWatchChannel,
        GoogleWatchConfig, OccurrenceRange, ProviderCalendar,
    },
    ports::{
        CalendarRsvpScope, GoogleCalendarMutationProvider, GoogleCalendarProvider,
        GoogleEventSyncContext, GoogleInstanceUpdateOutcome, GoogleProviderError,
        GoogleProviderErrorKind, GoogleRsvpOutcome, GoogleSeriesMutationOutcome,
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
                default_reminders: calendar
                    .default_reminders
                    .into_iter()
                    .map(Into::into)
                    .collect(),
            })
            .collect())
    }

    #[tracing::instrument(
        skip(self, access_token, context),
        fields(provider_calendar_id = %context.target.provider_calendar_id),
        err
    )]
    async fn sync_events(
        &self,
        access_token: &str,
        context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        let target = &context.target;
        let (changes, next_sync_token, token_was_reset) = match self
            .event_changes(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                context.sync_token.as_deref(),
                &target.range,
            )
            .await
        {
            Ok((changes, next_sync_token)) => (changes, next_sync_token, false),
            Err(error) if error.kind() == GoogleProviderErrorKind::SyncTokenExpired => {
                let (changes, next_sync_token) = self
                    .event_changes(
                        access_token,
                        target.email_link_id,
                        &target.provider_calendar_id,
                        None,
                        &target.range,
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
                    target.email_link_id,
                    &target.provider_calendar_id,
                    &target.range,
                    false,
                )
                .await?;
            let instances = self
                .events(
                    access_token,
                    target.email_link_id,
                    &target.provider_calendar_id,
                    &target.range,
                    true,
                )
                .await?;

            let mapped = map_snapshot(target, canonical_events, instances);

            return Ok(GoogleEventSyncBatch {
                upserts: mapped.upserts,
                observed_provider_event_ids: Some(mapped.observed_provider_event_ids),
                next_sync_token,
                materialized_range: Some(target.range.clone()),
                cancelled_provider_event_ids: Vec::new(),
            });
        }

        let mut applied = self
            .apply_change_feed(access_token, target, changes)
            .await?;
        let materialized_range =
            if let GoogleSyncPlan::ExtendTail { from, from_date } = context.plan {
                self.extend_tail(access_token, target, from, from_date, &mut applied)
                    .await?;
                Some(target.range.clone())
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
        target: &GoogleCalendarTarget,
        changes: Vec<GoogleEvent>,
    ) -> Result<AppliedChangeFeed, GoogleProviderError> {
        let classified = classify_changes(changes);
        let mut applied = AppliedChangeFeed {
            cancelled: classified.tombstoned_provider_event_ids,
            ..AppliedChangeFeed::default()
        };

        for single in classified.single_upserts {
            let provider_event_id = single.id.clone();
            match map_upsert(target, single.clone(), Vec::new(), vec![single]) {
                Ok(upsert) => {
                    applied.upserts.push(upsert);
                    applied.upserted_singles.insert(provider_event_id);
                }
                Err(error) => {
                    tracing::warn!(
                        error=?error,
                        provider_calendar_id=%target.provider_calendar_id,
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
                .refresh_series(access_token, target, &master_id, feed_master)
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
        target: &GoogleCalendarTarget,
        master_id: &str,
        feed_master: Option<GoogleEvent>,
    ) -> Result<SeriesOutcome, GoogleProviderError> {
        let master = match feed_master {
            Some(master) => Some(master),
            None => {
                self.event(
                    access_token,
                    target.email_link_id,
                    &target.provider_calendar_id,
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
                target.email_link_id,
                &target.provider_calendar_id,
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
                target.email_link_id,
                &target.provider_calendar_id,
                &master.id,
                &target.range,
            )
            .await?;
        let provider_event_id = master.id.clone();
        match map_upsert(target, master, exceptions, instances) {
            Ok(upsert) => Ok(SeriesOutcome::Refreshed(Box::new(upsert))),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%target.provider_calendar_id,
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
        target: &GoogleCalendarTarget,
        from: DateTime<Utc>,
        from_date: NaiveDate,
        applied: &mut AppliedChangeFeed,
    ) -> Result<(), GoogleProviderError> {
        let tail = OccurrenceRange {
            starts_at: from,
            ends_at: target.range.ends_at,
            start_date: from_date,
            end_date: target.range.end_date,
        };
        if tail.starts_at >= tail.ends_at {
            return Ok(());
        }
        let tail_events = self
            .events(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                &tail,
                true,
            )
            .await?;
        let (tail_series, tail_singles) = plan_tail_refreshes(tail_events, applied);

        for single in tail_singles {
            let provider_event_id = single.id.clone();
            match map_upsert(target, single.clone(), Vec::new(), vec![single]) {
                Ok(upsert) => {
                    applied.upserts.push(upsert);
                    applied.upserted_singles.insert(provider_event_id);
                }
                Err(error) => {
                    tracing::warn!(
                        error=?error,
                        provider_calendar_id=%target.provider_calendar_id,
                        provider_event_id,
                        "skipping malformed Google Calendar event in the coverage tail"
                    );
                }
            }
        }

        for master_id in tail_series {
            match self
                .refresh_series(access_token, target, &master_id, None)
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

/// Every mutation notifies affected guests, matching the Google Calendar
/// UI's default behavior for invitations and cancellations.
const SEND_UPDATES: (&str, &str) = ("sendUpdates", "all");

/// Google ignores `conferenceData` in a request body unless the client
/// declares conference support. Declaring it per-request, keyed off the body
/// actually carrying the field, keeps conference-free mutations on the
/// version the rest of the adapter was written against.
const CONFERENCE_DATA_VERSION: (&str, &str) = ("conferenceDataVersion", "1");

/// The conference query parameter a body requires, if any.
fn conference_query(body: &serde_json::Value) -> Option<(&'static str, &'static str)> {
    body.get("conferenceData").map(|_| CONFERENCE_DATA_VERSION)
}

/// Apply the conference parameter a body requires, if any.
fn with_conference_query(request: RequestBuilder, body: &serde_json::Value) -> RequestBuilder {
    match conference_query(body) {
        Some(parameter) => request.query(&[parameter]),
        None => request,
    }
}

impl<G: GoogleRequestGate> GoogleCalendarClient<G> {
    /// Resolve a conference Google is still generating.
    ///
    /// Meet creation is asynchronous, so a mutation echo can carry a
    /// conference whose entry points have not materialized yet — persisting
    /// that echo would store an event with a conference but no join URL. One
    /// re-read settles the common case; a slower one converges on the next
    /// sync, which Google's own push notification for this change triggers.
    async fn resolve_pending_conference(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        event: GoogleEvent,
    ) -> Result<GoogleEvent, GoogleProviderError> {
        if !conference_is_pending(event.conference_data.as_ref()) {
            return Ok(event);
        }
        let refreshed = self
            .event(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                &event.id,
            )
            .await?;
        Ok(refreshed.unwrap_or(event))
    }

    /// Normalize the provider echo of a mutation into a persistable upsert.
    ///
    /// Recurring series are re-read from the provider so Google stays the
    /// recurrence expansion authority, exactly like ingestion. `None` means
    /// the series master disappeared between the mutation and the refresh.
    async fn mutation_readback(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        event: GoogleEvent,
    ) -> Result<Option<CalendarEventUpsert>, GoogleProviderError> {
        let event = self
            .resolve_pending_conference(access_token, target, event)
            .await?;
        let outcome = if let Some(master_id) = event.recurring_event_id.clone() {
            self.refresh_series(access_token, target, &master_id, None)
                .await?
        } else if !event.recurrence.is_empty() {
            let master_id = event.id.clone();
            self.refresh_series(access_token, target, &master_id, Some(event))
                .await?
        } else {
            return map_upsert(target, event.clone(), Vec::new(), vec![event])
                .map(Some)
                .map_err(mutation_normalization_error);
        };
        match outcome {
            SeriesOutcome::Refreshed(upsert) => Ok(Some(*upsert)),
            SeriesOutcome::Gone => Ok(None),
            SeriesOutcome::Malformed => Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Permanent,
                "Google Calendar returned a malformed series after the mutation",
            )),
        }
    }

    async fn delete_event_raw(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
    ) -> Result<(), GoogleProviderError> {
        let calendar = urlencoding::encode(&target.provider_calendar_id);
        let event = urlencoding::encode(provider_event_id);
        self.gate.acquire(target.email_link_id).await?;
        let response = self
            .client
            .delete(format!(
                "{GOOGLE_CALENDAR_API}/calendars/{calendar}/events/{event}"
            ))
            .bearer_auth(access_token)
            .query(&[SEND_UPDATES])
            .send()
            .await
            .map_err(provider_transport_error)?;
        let status = response.status();
        // An event already deleted (or cancelled) at the provider is success.
        if status.is_success() || status == StatusCode::NOT_FOUND || status == StatusCode::GONE {
            return Ok(());
        }
        let body = response.text().await.map_err(provider_transport_error)?;
        Err(provider_response_error(status, &body))
    }

    /// Refresh a series after reshaping it, mapping the outcome for callers.
    async fn series_outcome(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
    ) -> Result<GoogleSeriesMutationOutcome, GoogleProviderError> {
        match self
            .refresh_series(access_token, target, master_provider_event_id, None)
            .await?
        {
            SeriesOutcome::Refreshed(upsert) => Ok(GoogleSeriesMutationOutcome::Applied(upsert)),
            SeriesOutcome::Gone => Ok(GoogleSeriesMutationOutcome::Gone),
            SeriesOutcome::Malformed => Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Permanent,
                "Google Calendar returned a malformed series after the mutation",
            )),
        }
    }

    async fn patch_event_raw(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
        body: serde_json::Value,
    ) -> Result<Option<GoogleEvent>, GoogleProviderError> {
        let calendar = urlencoding::encode(&target.provider_calendar_id);
        let event = urlencoding::encode(provider_event_id);
        self.gate.acquire(target.email_link_id).await?;
        let request = self
            .client
            .patch(format!(
                "{GOOGLE_CALENDAR_API}/calendars/{calendar}/events/{event}"
            ))
            .bearer_auth(access_token)
            .query(&[SEND_UPDATES]);
        let response = with_conference_query(request, &body)
            .json(&body)
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
}

impl<G: GoogleRequestGate> GoogleCalendarMutationProvider for GoogleCalendarClient<G> {
    #[tracing::instrument(
        skip(self, access_token, target, draft),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn create_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        draft: &CalendarEventDraft,
    ) -> Result<CalendarEventUpsert, GoogleProviderError> {
        let calendar = urlencoding::encode(&target.provider_calendar_id);
        let body = draft_body(draft);
        self.gate.acquire(target.email_link_id).await?;
        let request = self
            .client
            .post(format!("{GOOGLE_CALENDAR_API}/calendars/{calendar}/events"))
            .bearer_auth(access_token)
            .query(&[SEND_UPDATES]);
        let created: GoogleEvent =
            send_google(with_conference_query(request, &body).json(&body)).await?;
        // The insert already happened and carries no idempotency key, so a
        // readback miss must not surface as retryable: a client retry would
        // POST a duplicate event.
        self.mutation_readback(access_token, target, created)
            .await?
            .ok_or_else(|| {
                GoogleProviderError::new(
                    GoogleProviderErrorKind::Permanent,
                    "Google Calendar dropped the event immediately after creation",
                )
            })
    }

    #[tracing::instrument(
        skip(self, access_token, target, patch),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn update_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
        patch: &CalendarEventPatch,
    ) -> Result<Option<CalendarEventUpsert>, GoogleProviderError> {
        let Some(updated) = self
            .patch_event_raw(access_token, target, provider_event_id, patch_body(patch))
            .await?
        else {
            return Ok(None);
        };
        self.mutation_readback(access_token, target, updated).await
    }

    #[tracing::instrument(
        skip(self, access_token, target, patch),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn update_event_instance(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
        patch: &CalendarEventPatch,
    ) -> Result<GoogleInstanceUpdateOutcome, GoogleProviderError> {
        let refresh_without_writing = |gone_reason: &'static str| async move {
            tracing::info!(gone_reason, "occurrence-scoped update found no occurrence");
            match self
                .refresh_series(access_token, target, master_provider_event_id, None)
                .await?
            {
                SeriesOutcome::Refreshed(upsert) => {
                    Ok(GoogleInstanceUpdateOutcome::OccurrenceGone(upsert))
                }
                SeriesOutcome::Gone => Ok(GoogleInstanceUpdateOutcome::SeriesGone),
                SeriesOutcome::Malformed => Err(GoogleProviderError::new(
                    GoogleProviderErrorKind::Permanent,
                    "Google Calendar returned a malformed series after the mutation",
                )),
            }
        };
        let Some(instance_id) = self
            .instance_id_at(
                access_token,
                target,
                master_provider_event_id,
                original_start,
            )
            .await?
        else {
            return refresh_without_writing("no instance matches the occurrence key").await;
        };
        if self
            .patch_event_raw(access_token, target, &instance_id, patch_body(patch))
            .await?
            .is_none()
        {
            return refresh_without_writing("the instance vanished before the patch").await;
        }
        match self
            .series_outcome(access_token, target, master_provider_event_id)
            .await?
        {
            GoogleSeriesMutationOutcome::Applied(upsert) => {
                Ok(GoogleInstanceUpdateOutcome::Applied(upsert))
            }
            GoogleSeriesMutationOutcome::SeriesDeleted | GoogleSeriesMutationOutcome::Gone => {
                Ok(GoogleInstanceUpdateOutcome::SeriesGone)
            }
        }
    }

    #[tracing::instrument(
        skip(self, access_token, target),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn delete_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
    ) -> Result<(), GoogleProviderError> {
        self.delete_event_raw(access_token, target, provider_event_id)
            .await
    }

    #[tracing::instrument(
        skip(self, access_token, target),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn delete_event_instance(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> Result<GoogleSeriesMutationOutcome, GoogleProviderError> {
        let Some(start) = parse_occurrence_start(original_start) else {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Permanent,
                "the occurrence identifier is not a recognizable start",
            ));
        };
        // A one-day window around the occurrence bounds the lookup; the
        // exact instance is matched locally by its original start.
        let window = occurrence_window(&start);
        let instances = self
            .instances(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                master_provider_event_id,
                &window,
            )
            .await?;
        let matched = instances.into_iter().find(|instance| {
            instance
                .original_start_time
                .as_ref()
                .and_then(google_start)
                .is_some_and(|candidate| candidate == start)
        });
        if let Some(instance) = matched {
            self.delete_event_raw(access_token, target, &instance.id)
                .await?;
        }
        self.series_outcome(access_token, target, master_provider_event_id)
            .await
    }

    #[tracing::instrument(
        skip(self, access_token, target),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn truncate_recurring_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> Result<GoogleSeriesMutationOutcome, GoogleProviderError> {
        let Some(cutoff) = parse_occurrence_start(original_start) else {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Permanent,
                "the occurrence identifier is not a recognizable start",
            ));
        };
        let Some(master) = self
            .event(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                master_provider_event_id,
            )
            .await?
        else {
            return Ok(GoogleSeriesMutationOutcome::Gone);
        };
        // Removing everything from the first occurrence onward is a series
        // deletion, matching Google Calendar's own behavior.
        let master_start = google_time(&master).ok().map(|time| event_start_of(&time));
        if master_start.is_some_and(|start| !occurrence_is_after(&cutoff, &start)) {
            self.delete_event_raw(access_token, target, &master.id)
                .await?;
            return Ok(GoogleSeriesMutationOutcome::SeriesDeleted);
        }
        let truncated = truncate_recurrence_lines(&master.recurrence, &cutoff);
        let Some(updated) = self
            .patch_event_raw(
                access_token,
                target,
                &master.id,
                serde_json::json!({ "recurrence": truncated }),
            )
            .await?
        else {
            return Ok(GoogleSeriesMutationOutcome::Gone);
        };
        match self
            .mutation_readback(access_token, target, updated)
            .await?
        {
            Some(upsert) => Ok(GoogleSeriesMutationOutcome::Applied(Box::new(upsert))),
            None => Ok(GoogleSeriesMutationOutcome::Gone),
        }
    }

    #[tracing::instrument(
        skip(self, access_token, target, actor),
        fields(provider_calendar_id = %target.provider_calendar_id),
        err
    )]
    async fn rsvp_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        actor: &ActorInboxes,
        response: AttendeeResponseStatus,
        scope: &CalendarRsvpScope,
    ) -> Result<GoogleRsvpOutcome, GoogleProviderError> {
        let patch_target = match scope {
            CalendarRsvpScope::All => Some(master_provider_event_id.to_string()),
            CalendarRsvpScope::ThisEvent { recurrence_id } => {
                // The occurrence being gone from the series does not doom the
                // series itself; the refresh below converges the projection.
                self.instance_id_at(
                    access_token,
                    target,
                    master_provider_event_id,
                    recurrence_id,
                )
                .await?
            }
        };
        if let Some(provider_event_id) = &patch_target {
            match self
                .patch_actor_response(access_token, target, provider_event_id, actor, response)
                .await?
            {
                RsvpPatch::Applied => {}
                RsvpPatch::NotAttendee => return Ok(GoogleRsvpOutcome::NotAttendee),
                RsvpPatch::Gone => return Ok(GoogleRsvpOutcome::Gone),
            }
        }

        // Every scope resolves by refreshing the series from Google, which
        // owns recurrence expansion and now holds the exceptions just written.
        match self
            .series_outcome(access_token, target, master_provider_event_id)
            .await?
        {
            GoogleSeriesMutationOutcome::Applied(upsert) => Ok(GoogleRsvpOutcome::Applied(upsert)),
            GoogleSeriesMutationOutcome::SeriesDeleted | GoogleSeriesMutationOutcome::Gone => {
                Ok(GoogleRsvpOutcome::Gone)
            }
        }
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn stop_watch_channel(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        channel_id: &str,
        resource_id: &str,
    ) -> Result<(), GoogleProviderError> {
        self.gate.acquire(email_link_id).await?;
        let response = self
            .client
            .post(format!("{GOOGLE_CALENDAR_API}/channels/stop"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({
                "id": channel_id,
                "resourceId": resource_id,
            }))
            .send()
            .await
            .map_err(provider_transport_error)?;
        let status = response.status();
        // A channel Google has already forgotten is as stopped as it gets.
        if status.is_success() || status == StatusCode::NOT_FOUND || status == StatusCode::GONE {
            return Ok(());
        }
        let body = response.text().await.map_err(provider_transport_error)?;
        Err(provider_response_error(status, &body))
    }
}

/// Outcome of writing the connected account's response to one provider event.
enum RsvpPatch {
    Applied,
    NotAttendee,
    Gone,
}

impl<G: GoogleRequestGate> GoogleCalendarClient<G> {
    /// Resolve one occurrence of a series to the provider id that carries it,
    /// creating no exception of its own.
    async fn instance_id_at(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        recurrence_id: &str,
    ) -> Result<Option<String>, GoogleProviderError> {
        let Some(start) = parse_occurrence_start(recurrence_id) else {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Permanent,
                "the occurrence identifier is not a recognizable start",
            ));
        };
        let window = occurrence_window(&start);
        Ok(self
            .instances(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                master_provider_event_id,
                &window,
            )
            .await?
            .into_iter()
            .find(|instance| {
                instance
                    .original_start_time
                    .as_ref()
                    .and_then(google_start)
                    .is_some_and(|candidate| candidate == start)
            })
            .map(|instance| instance.id))
    }

    /// Rewrite just the actor's `responseStatus` on one provider event,
    /// leaving every other attendee untouched.
    ///
    /// The patch sends `attendeesOmitted: true` with only the actor's
    /// entry, which is Google's documented mechanism for updating one
    /// participant's response. A concurrent attendee change between our
    /// read and this write cannot be overwritten by a full-array replace.
    /// The read stays: it distinguishes a vanished event from a requester
    /// who simply is not on the guest list, which the patch alone would
    /// answer by quietly adding them.
    async fn patch_actor_response(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
        actor: &ActorInboxes,
        response: AttendeeResponseStatus,
    ) -> Result<RsvpPatch, GoogleProviderError> {
        let Some(current) = self
            .event(
                access_token,
                target.email_link_id,
                &target.provider_calendar_id,
                provider_event_id,
            )
            .await?
        else {
            return Ok(RsvpPatch::Gone);
        };
        let attendees: Vec<GoogleAttendee> = current.attendees.clone().unwrap_or_default();
        let Some(actor_attendee) = find_actor_attendee(&attendees, actor) else {
            return Ok(RsvpPatch::NotAttendee);
        };
        let body = rsvp_patch_body(actor_attendee, response);
        match self
            .patch_event_raw(access_token, target, provider_event_id, body)
            .await?
        {
            Some(_) => Ok(RsvpPatch::Applied),
            None => Ok(RsvpPatch::Gone),
        }
    }
}

/// Parse a stored occurrence key (RFC 3339 instant or local date).
fn parse_occurrence_start(value: &str) -> Option<EventStart> {
    if let Ok(instant) = DateTime::parse_from_rfc3339(value) {
        return Some(EventStart::Timed(instant.with_timezone(&Utc)));
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .map(EventStart::AllDay)
}

fn start_instant(start: &EventStart) -> DateTime<Utc> {
    match start {
        EventStart::Timed(instant) => *instant,
        EventStart::AllDay(date) => date
            .and_hms_opt(0, 0, 0)
            .expect("midnight is a valid time")
            .and_utc(),
    }
}

fn event_start_of(time: &EventTime) -> EventStart {
    match time {
        EventTime::Timed { starts_at, .. } => EventStart::Timed(*starts_at),
        EventTime::AllDay { start_date, .. } => EventStart::AllDay(*start_date),
    }
}

fn occurrence_is_after(cutoff: &EventStart, master_start: &EventStart) -> bool {
    start_instant(cutoff) > start_instant(master_start)
}

/// One-day range around an occurrence, bounding an exact-instance lookup.
fn occurrence_window(start: &EventStart) -> OccurrenceRange {
    let instant = start_instant(start);
    let date = match start {
        EventStart::Timed(instant) => instant.date_naive(),
        EventStart::AllDay(date) => *date,
    };
    OccurrenceRange {
        starts_at: instant - chrono::Duration::days(1),
        ends_at: instant + chrono::Duration::days(1),
        start_date: date - chrono::Duration::days(1),
        end_date: date + chrono::Duration::days(1),
    }
}

/// Rewrite a recurrence property list to end just before `cutoff`,
/// replacing any existing `UNTIL` or `COUNT` bound.
fn truncate_recurrence_lines(lines: &[String], cutoff: &EventStart) -> Vec<String> {
    let until = match cutoff {
        EventStart::Timed(instant) => (*instant - chrono::Duration::seconds(1))
            .format("%Y%m%dT%H%M%SZ")
            .to_string(),
        EventStart::AllDay(date) => (*date - chrono::Duration::days(1))
            .format("%Y%m%d")
            .to_string(),
    };
    lines
        .iter()
        .map(|line| {
            let Some(params) = line.strip_prefix("RRULE:") else {
                return line.clone();
            };
            let mut kept: Vec<&str> = params
                .split(';')
                .filter(|param| {
                    let upper = param.to_ascii_uppercase();
                    !upper.starts_with("UNTIL=") && !upper.starts_with("COUNT=")
                })
                .collect();
            let until_param = format!("UNTIL={until}");
            kept.push(&until_param);
            format!("RRULE:{}", kept.join(";"))
        })
        .collect()
}

fn mutation_normalization_error(error: Report) -> GoogleProviderError {
    GoogleProviderError::new(
        GoogleProviderErrorKind::Permanent,
        format!("Google Calendar returned a malformed event after the mutation: {error:?}"),
    )
}

fn google_response_status(status: AttendeeResponseStatus) -> &'static str {
    match status {
        AttendeeResponseStatus::NeedsAction => "needsAction",
        AttendeeResponseStatus::Accepted => "accepted",
        AttendeeResponseStatus::Declined => "declined",
        AttendeeResponseStatus::Tentative => "tentative",
    }
}

fn find_actor_attendee<'a>(
    attendees: &'a [GoogleAttendee],
    actor: &ActorInboxes,
) -> Option<&'a GoogleAttendee> {
    attendees.iter().find(|attendee| {
        attendee
            .email
            .as_deref()
            .is_some_and(|email| actor.matches(email))
    })
}

/// Body updating only the connected attendee's response: `attendeesOmitted`
/// tells Google the array is partial, so other attendees survive untouched.
fn rsvp_patch_body(
    self_attendee: &GoogleAttendee,
    response: AttendeeResponseStatus,
) -> serde_json::Value {
    let mut entry = self_attendee.clone();
    entry.response_status = Some(google_response_status(response).to_string());
    serde_json::json!({
        "attendeesOmitted": true,
        "attendees": [entry],
    })
}

/// Serialize an event time as Google `start`/`end` objects. The unused shape
/// is set to an explicit `null` so a patch can switch between timed and
/// all-day; inserts ignore the nulls.
fn google_time_body(time: &EventTime) -> (serde_json::Value, serde_json::Value) {
    match time {
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        } => {
            let mut start = serde_json::json!({
                "dateTime": starts_at.to_rfc3339(),
                "date": null,
            });
            let mut end = serde_json::json!({
                "dateTime": ends_at.to_rfc3339(),
                "date": null,
            });
            if let Some(time_zone) = time_zone {
                start["timeZone"] = serde_json::Value::String(time_zone.clone());
                end["timeZone"] = serde_json::Value::String(time_zone.clone());
            }
            (start, end)
        }
        EventTime::AllDay {
            start_date,
            end_date,
        } => (
            serde_json::json!({ "date": start_date.to_string(), "dateTime": null }),
            serde_json::json!({ "date": end_date.to_string(), "dateTime": null }),
        ),
    }
}

fn google_attendees_body(attendees: &[CalendarAttendeeInput]) -> serde_json::Value {
    attendees
        .iter()
        .map(|attendee| {
            let mut entry = serde_json::json!({
                "email": attendee.email,
                "optional": attendee.is_optional,
            });
            if let Some(status) = attendee.response_status {
                entry["responseStatus"] =
                    serde_json::Value::String(google_response_status(status).to_string());
            }
            entry
        })
        .collect()
}

/// Map an optional user-supplied text field: empty clears the provider value.
fn google_text_body(value: &str) -> serde_json::Value {
    if value.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(value.to_string())
    }
}

fn draft_body(draft: &CalendarEventDraft) -> serde_json::Value {
    let (start, end) = google_time_body(&draft.time);
    let mut body = serde_json::json!({
        "summary": draft.title,
        "start": start,
        "end": end,
    });
    if let Some(description) = &draft.description {
        body["description"] = google_text_body(description);
    }
    if let Some(location) = &draft.location {
        body["location"] = google_text_body(location);
    }
    if !draft.attendees.is_empty() {
        body["attendees"] = google_attendees_body(&draft.attendees);
    }
    if !draft.recurrence_lines.is_empty() {
        body["recurrence"] = serde_json::json!(draft.recurrence_lines);
    }
    if let Some(visibility) = draft.visibility {
        body["visibility"] = serde_json::Value::String(visibility.as_str().to_string());
    }
    if let Some(transparency) = draft.transparency {
        body["transparency"] = serde_json::Value::String(transparency.as_str().to_string());
    }
    if let Some(reminders) = &draft.reminders {
        body["reminders"] = google_reminders_body(reminders);
    }
    if let Some(conference) = draft.conference {
        body["conferenceData"] = google_conference_body(conference);
    }
    body
}

fn google_reminders_body(reminders: &EventReminders) -> serde_json::Value {
    serde_json::json!({
        "useDefault": reminders.use_default,
        "overrides": reminders
            .overrides
            .iter()
            .map(|reminder| {
                serde_json::json!({
                    "method": reminder.method,
                    "minutes": reminder.minutes,
                })
            })
            .collect::<Vec<_>>(),
    })
}

/// Build the `conferenceData` write for a requested conference change.
///
/// Google generates Meet conferences asynchronously from a `createRequest`,
/// whose `requestId` is the idempotency key: reusing one makes Google ignore
/// the request, so every attach mints a fresh identifier. An explicit JSON
/// null is how the API expresses detachment.
fn google_conference_body(change: ConferenceChange) -> serde_json::Value {
    match change {
        ConferenceChange::GoogleMeet => serde_json::json!({
            "createRequest": {
                "requestId": Uuid::new_v4().to_string(),
                "conferenceSolutionKey": { "type": "hangoutsMeet" },
            }
        }),
        ConferenceChange::Removed => serde_json::Value::Null,
    }
}

fn patch_body(patch: &CalendarEventPatch) -> serde_json::Value {
    let mut body = serde_json::json!({});
    if let Some(title) = &patch.title {
        body["summary"] = google_text_body(title);
    }
    if let Some(description) = &patch.description {
        body["description"] = google_text_body(description);
    }
    if let Some(location) = &patch.location {
        body["location"] = google_text_body(location);
    }
    if let Some(time) = &patch.time {
        let (start, end) = google_time_body(time);
        body["start"] = start;
        body["end"] = end;
    }
    if let Some(attendees) = &patch.attendees {
        body["attendees"] = google_attendees_body(attendees);
    }
    if let Some(recurrence_lines) = &patch.recurrence_lines {
        body["recurrence"] = serde_json::json!(recurrence_lines);
    }
    if let Some(visibility) = patch.visibility {
        body["visibility"] = serde_json::Value::String(visibility.as_str().to_string());
    }
    if let Some(transparency) = patch.transparency {
        body["transparency"] = serde_json::Value::String(transparency.as_str().to_string());
    }
    if let Some(reminders) = &patch.reminders {
        body["reminders"] = google_reminders_body(reminders);
    }
    if let Some(conference) = patch.conference {
        body["conferenceData"] = google_conference_body(conference);
    }
    body
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
    target: &GoogleCalendarTarget,
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
                target,
                master,
                exceptions.remove(&uid).unwrap_or_default(),
                occurrences.remove(&uid).unwrap_or_default(),
            )
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%target.provider_calendar_id,
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
    target: &GoogleCalendarTarget,
    master: GoogleEvent,
    exceptions: Vec<GoogleEvent>,
    instances: Vec<GoogleEvent>,
) -> Result<CalendarEventUpsert, Report> {
    let event_id = Uuid::now_v7();
    let time = google_time(&master)?;
    let created_at = parse_datetime(master.created.as_deref()).unwrap_or_else(Utc::now);
    let updated_at = parse_datetime(master.updated.as_deref()).unwrap_or(created_at);
    let source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: target.email_link_id,
        account_id: target.account_id,
        calendar_id: target.calendar_id,
        provider_event_id: master.id.clone(),
        provider_recurring_event_id: master.recurring_event_id.clone(),
        provider_etag: master.etag.clone(),
        raw_payload: serde_json::to_value(&master).map_err(report)?,
    });
    let join_url = master
        .hangout_link
        .clone()
        .or_else(|| conference_url(master.conference_data.as_ref()));
    let event = CalendarEvent {
        id: event_id,
        owner_id: target.owner_id.clone(),
        ical_uid: master.ical_uid.clone(),
        calendar_id: Some(target.calendar_id),
        title: master.summary.clone().unwrap_or_default(),
        description: master.description.clone(),
        location: master.location.clone(),
        status: google_status(master.status.as_deref()),
        visibility: google_visibility(master.visibility.as_deref()),
        transparency: google_transparency(master.transparency.as_deref()),
        event_type: google_event_type(master.event_type.as_deref()),
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
        creator_email: master
            .creator
            .as_ref()
            .and_then(|value| value.email.clone()),
        creator_name: master
            .creator
            .as_ref()
            .and_then(|value| value.display_name.clone()),
        conference_provider: conference_provider(
            master.conference_data.as_ref(),
            join_url.is_some(),
        ),
        conference_url: join_url,
        sequence: master.sequence.unwrap_or_default(),
        is_read_only: target.is_read_only,
        attendees: master
            .attendees
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter_map(map_attendee)
            .collect(),
        reminders: map_reminders(master.reminders.as_ref()),
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
                    attendees: exception
                        .attendees
                        .map(|attendees| attendees.into_iter().filter_map(map_attendee).collect()),
                })
            })()
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    provider_calendar_id=%target.provider_calendar_id,
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
                Ok(time.overlaps(&target.range).then(|| CalendarOccurrence {
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
                    provider_calendar_id=%target.provider_calendar_id,
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

/// An absent `reminders` field means the calendar defaults apply — the same
/// resolution Google performs, so a calendar with no defaults fires nothing.
fn map_reminders(value: Option<&GoogleEventReminders>) -> EventReminders {
    value.map_or_else(EventReminders::default, |reminders| EventReminders {
        use_default: reminders.use_default,
        overrides: reminders
            .overrides
            .iter()
            .cloned()
            .map(Into::into)
            .collect(),
    })
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

/// Classify the conference behind a join URL. Only `hangoutsMeet` is one
/// Macro may rewrite; a bare `hangoutLink` with no conference data is a
/// legacy classic Hangout, which Macro also leaves alone.
fn conference_provider(
    data: Option<&GoogleConferenceData>,
    has_url: bool,
) -> Option<ConferenceProvider> {
    if !has_url {
        return None;
    }
    let solution_type = data
        .and_then(|data| data.conference_solution.as_ref())
        .and_then(|solution| solution.key.as_ref())
        .and_then(|key| key.solution_type.as_deref());
    Some(match solution_type {
        Some("hangoutsMeet") => ConferenceProvider::GoogleMeet,
        _ => ConferenceProvider::Other,
    })
}

/// Whether Google is still generating a requested conference. Creation is
/// asynchronous, so the mutation echo can carry a conference with no entry
/// points yet; callers re-read the event instead of persisting that gap.
fn conference_is_pending(data: Option<&GoogleConferenceData>) -> bool {
    data.and_then(|data| data.create_request.as_ref())
        .and_then(|request| request.status.as_ref())
        .and_then(|status| status.status_code.as_deref())
        == Some("pending")
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

/// Unknown provider types fall back to `default` so a new Google event type
/// never breaks ingestion.
fn google_event_type(value: Option<&str>) -> EventType {
    match value {
        Some("outOfOffice") => EventType::OutOfOffice,
        Some("focusTime") => EventType::FocusTime,
        Some("workingLocation") => EventType::WorkingLocation,
        Some("birthday") => EventType::Birthday,
        Some("fromGmail") => EventType::FromGmail,
        _ => EventType::Default,
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
    #[serde(default)]
    default_reminders: Vec<GoogleReminderOverride>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    event_type: Option<String>,
    start: Option<GoogleEventDateTime>,
    end: Option<GoogleEventDateTime>,
    #[serde(default)]
    recurrence: Vec<String>,
    recurring_event_id: Option<String>,
    original_start_time: Option<GoogleEventDateTime>,
    organizer: Option<GooglePerson>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    creator: Option<GooglePerson>,
    #[serde(default)]
    attendees: Option<Vec<GoogleAttendee>>,
    hangout_link: Option<String>,
    conference_data: Option<GoogleConferenceData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reminders: Option<GoogleEventReminders>,
    sequence: Option<u32>,
    created: Option<String>,
    updated: Option<String>,
}

/// The requester's private reminder configuration on an event.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEventReminders {
    #[serde(default)]
    use_default: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    overrides: Vec<GoogleReminderOverride>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleReminderOverride {
    method: String,
    minutes: u32,
}

impl From<GoogleReminderOverride> for EventReminderOverride {
    fn from(value: GoogleReminderOverride) -> Self {
        Self {
            method: value.method,
            minutes: value.minutes,
        }
    }
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

/// Writes replace the whole `attendees` array, so every field Google returns
/// must survive a deserialize/serialize round trip; unmapped fields (id,
/// additionalGuests, resource, ...) are carried through `extra`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleAttendee {
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_status: Option<String>,
    #[serde(default)]
    organizer: bool,
    #[serde(default)]
    optional: bool,
    #[serde(default, rename = "self")]
    is_self: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleConferenceData {
    #[serde(default)]
    entry_points: Vec<GoogleEntryPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conference_solution: Option<GoogleConferenceSolution>,
    #[serde(skip_serializing_if = "Option::is_none")]
    create_request: Option<GoogleConferenceCreateRequest>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleConferenceSolution {
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<GoogleConferenceSolutionKey>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleConferenceSolutionKey {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    solution_type: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleConferenceCreateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<GoogleConferenceCreateStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleConferenceCreateStatus {
    #[serde(skip_serializing_if = "Option::is_none")]
    status_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEntryPoint {
    entry_point_type: Option<String>,
    uri: Option<String>,
}

#[cfg(test)]
mod test;
