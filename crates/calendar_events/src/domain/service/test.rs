use super::*;
use crate::domain::{
    models::{
        ActiveWatchChannel, AttendeeResponseStatus, CalendarAttendee, CalendarBackfillClaim,
        CalendarBackfillFailureDisposition, CalendarBackfillJobKey, CalendarCreationTarget,
        CalendarEvent, CalendarEventMutationTarget, CalendarEventSource, CalendarLinkTokenIdentity,
        CalendarOccurrence, CalendarSyncStatus, EventReminders, EventStatus, EventTime,
        EventTransparency, EventVisibility, GOOGLE_CALENDAR_SCOPES, GoogleBackfillRunReport,
        GoogleCalendarSyncSnapshot, GoogleEventSource, GoogleEventSyncBatch, GoogleWatchChannel,
        GoogleWatchConfig, ProviderCalendar, StoredGoogleCalendar,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventWrite, CalendarRepository, CalendarTokenError,
        GoogleCalendarProvider, GoogleEventSyncContext, GoogleProviderError,
    },
};
use chrono::{TimeZone, Utc};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct FakeRepo {
    upserts: Arc<Mutex<Vec<CalendarEventUpsert>>>,
    stored_synced_at: Option<chrono::DateTime<Utc>>,
}

impl CalendarRepository for FakeRepo {
    async fn apply_google_grant(
        &self,
        _email_link_id: Uuid,
        _scopes: GoogleScopeSet,
    ) -> Result<AppliedGoogleGrant, Report> {
        unreachable!()
    }

    async fn upsert_event(&self, write: CalendarEventWrite) -> Result<Uuid, Report> {
        let upsert = match write {
            CalendarEventWrite::GoogleBackfill { upsert, .. }
            | CalendarEventWrite::UserMutation(upsert)
            | CalendarEventWrite::Fixture(upsert) => upsert,
        };
        let id = upsert.event.id;
        self.upserts.lock().unwrap().push(upsert);
        Ok(id)
    }

    async fn list_occurrences(
        &self,
        _owner_id: &str,
        _range: OccurrenceRange,
        _cursor: Option<CalendarOccurrenceCursor>,
        _limit: u16,
    ) -> Result<Vec<(CalendarEvent, CalendarOccurrence)>, Report> {
        Ok(Vec::new())
    }

    async fn sync_status(&self, _requester_id: &str) -> Result<CalendarSyncStatus, Report> {
        Ok(CalendarSyncStatus::Ready)
    }

    async fn get_event_mutation_target(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<CalendarEventMutationTarget>, Report> {
        unreachable!("mutation lookups are not exercised by sync tests")
    }

    async fn get_creation_target(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
    ) -> Result<Option<CalendarCreationTarget>, Report> {
        unreachable!("mutation lookups are not exercised by sync tests")
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<crate::domain::models::VisibleCalendar>, Report> {
        unreachable!("mutation lookups are not exercised by sync tests")
    }

    async fn remove_google_source(
        &self,
        _account_id: Uuid,
        _calendar_id: Uuid,
        _provider_event_id: &str,
    ) -> Result<(), Report> {
        unreachable!("mutation cleanup is not exercised by sync tests")
    }

    async fn upsert_google_calendar(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _calendar: ProviderCalendar,
    ) -> Result<StoredGoogleCalendar, Report> {
        Ok(StoredGoogleCalendar {
            id: Uuid::nil(),
            sync_token: None,
            materialized_range: None,
            synced_at: self.stored_synced_at,
            watch_expires_at: None,
        })
    }

    async fn commit_google_calendar_sync(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _sync: GoogleCalendarSyncSnapshot,
        _events_upserted: usize,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn reconcile_google_calendar_list(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _calendar_ids: Vec<Uuid>,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn record_watch_channel(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _calendar_id: Uuid,
        _channel: GoogleWatchChannel,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn find_watch_target(
        &self,
        _channel_id: &str,
        _resource_id: &str,
    ) -> Result<Option<Uuid>, Report> {
        Ok(None)
    }

    async fn schedule_google_sync_for_link(&self, _email_link_id: Uuid) -> Result<bool, Report> {
        Ok(false)
    }
}

fn valid_upsert() -> CalendarEventUpsert {
    let event_id = Uuid::now_v7();
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 24, 15, 0, 0).unwrap();
    CalendarEventUpsert {
        event: CalendarEvent {
            id: event_id,
            owner_id: "macro|calendar@example.com".to_string(),
            ical_uid: "meeting@example.com".to_string(),
            calendar_id: None,
            title: "Meeting".to_string(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            time: EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: Some("UTC".to_string()),
            },
            recurrence_lines: Vec::new(),
            organizer_email: None,
            organizer_name: None,
            conference_url: None,
            sequence: 0,
            is_read_only: true,
            attendees: vec![CalendarAttendee {
                email: "calendar@example.com".to_string(),
                display_name: None,
                response_status: AttendeeResponseStatus::Accepted,
                is_organizer: false,
                is_optional: false,
                is_self: true,
                comment: None,
            }],
            reminders: EventReminders::default(),
            created_at: starts_at,
            updated_at: starts_at,
        },
        source: CalendarEventSource::Google(GoogleEventSource {
            email_link_id: Uuid::now_v7(),
            account_id: Uuid::now_v7(),
            calendar_id: Uuid::now_v7(),
            provider_event_id: "provider-event".to_string(),
            provider_recurring_event_id: None,
            provider_etag: None,
            raw_payload: serde_json::json!({}),
        }),
        overrides: Vec::new(),
        occurrences: vec![CalendarOccurrence {
            event_id,
            occurrence_key: starts_at.to_rfc3339(),
            recurrence_id: None,
            time: EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: Some("UTC".to_string()),
            },
            is_cancelled: false,
        }],
    }
}

#[test]
fn accepts_valid_event() {
    assert!(validate_upsert(&valid_upsert()).is_ok());
}

#[test]
fn rejects_invalid_occurrence_time() {
    let mut upsert = valid_upsert();
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    upsert.occurrences[0].time = EventTime::Timed {
        starts_at,
        ends_at: starts_at,
        time_zone: None,
    };

    assert!(validate_upsert(&upsert).is_err());
}

#[test]
fn complete_scope_capability_requires_top_level_scope() {
    let complete = GoogleScopeSet::parse(&GOOGLE_CALENDAR_SCOPES.join(" "));
    assert!(complete.has_calendar_capability());

    let partial = GoogleScopeSet::parse("https://www.googleapis.com/auth/calendar.events");
    assert!(!partial.has_calendar_capability());
}

#[derive(Clone)]
struct FakeGoogleProvider;

impl GoogleCalendarProvider for FakeGoogleProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
    ) -> Result<Vec<ProviderCalendar>, GoogleProviderError> {
        Ok(Vec::new())
    }

    async fn sync_events(
        &self,
        _access_token: &str,
        context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        Ok(GoogleEventSyncBatch {
            upserts: Vec::new(),
            observed_provider_event_ids: Some(Vec::new()),
            next_sync_token: "next".to_string(),
            materialized_range: Some(context.target.range),
            cancelled_provider_event_ids: Vec::new(),
        })
    }

    async fn watch_calendar(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
        _provider_calendar_id: &str,
        _channel_id: Uuid,
        _config: &GoogleWatchConfig,
    ) -> Result<GoogleWatchChannel, GoogleProviderError> {
        unreachable!("watch is disabled in these tests")
    }
}

#[derive(Clone)]
struct ReauthGoogleProvider;

impl GoogleCalendarProvider for ReauthGoogleProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
    ) -> Result<Vec<ProviderCalendar>, GoogleProviderError> {
        Err(GoogleProviderError::new(
            GoogleProviderErrorKind::ReauthRequired,
            "insufficient permissions",
        ))
    }

    async fn sync_events(
        &self,
        _access_token: &str,
        _context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        unreachable!("calendar listing fails first")
    }

    async fn watch_calendar(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
        _provider_calendar_id: &str,
        _channel_id: Uuid,
        _config: &GoogleWatchConfig,
    ) -> Result<GoogleWatchChannel, GoogleProviderError> {
        unreachable!("watch is disabled in these tests")
    }
}

#[derive(Clone)]
struct FakeLifecycle {
    claim: CalendarBackfillClaim,
    completions: Arc<Mutex<Vec<()>>>,
    failures: Arc<Mutex<Vec<CalendarBackfillFailureDisposition>>>,
    failure_outcome: CalendarBackfillFailureOutcome,
    lease_lost: bool,
}

impl FakeLifecycle {
    fn claimed() -> Self {
        Self {
            claim: CalendarBackfillClaim::Claimed {
                lease_token: Uuid::nil(),
                account_id: Uuid::nil(),
            },
            completions: Arc::new(Mutex::new(Vec::new())),
            failures: Arc::new(Mutex::new(Vec::new())),
            failure_outcome: CalendarBackfillFailureOutcome {
                job_transitioned: true,
                link_reauth_transitioned: false,
            },
            lease_lost: false,
        }
    }

    fn lease_lost() -> Self {
        Self {
            lease_lost: true,
            ..Self::claimed()
        }
    }
}

impl CalendarBackfillRepository for FakeLifecycle {
    async fn fail_unclaimed_google_backfill(
        &self,
        _key: CalendarBackfillJobKey,
        _disposition: CalendarBackfillFailureDisposition,
        _message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, Report> {
        Ok(self.failure_outcome)
    }

    async fn claim_google_backfill(
        &self,
        _key: CalendarBackfillJobKey,
    ) -> Result<CalendarBackfillClaim, Report> {
        Ok(self.claim)
    }

    async fn mark_google_account_syncing(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn maintain_google_backfill_lease(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
    ) -> Result<(), Report> {
        if self.lease_lost {
            return Ok(());
        }
        std::future::pending().await
    }

    async fn complete_google_backfill(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
    ) -> Result<(), Report> {
        self.completions.lock().unwrap().push(());
        Ok(())
    }

    async fn fail_google_backfill(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        disposition: CalendarBackfillFailureDisposition,
        _message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, Report> {
        self.failures.lock().unwrap().push(disposition);
        Ok(self.failure_outcome)
    }
}

/// Syncs the first calendar with one change, then fails the second.
#[derive(Clone)]
struct PartialFailureGoogleProvider;

impl GoogleCalendarProvider for PartialFailureGoogleProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
    ) -> Result<Vec<ProviderCalendar>, GoogleProviderError> {
        let calendar = |id: &str, primary: bool| ProviderCalendar {
            provider_calendar_id: id.to_string(),
            name: id.to_string(),
            description: None,
            time_zone: Some("UTC".to_string()),
            color: None,
            access_role: Some("owner".to_string()),
            is_primary: primary,
            is_selected: true,
            default_reminders: Vec::new(),
        };
        Ok(vec![calendar("primary", true), calendar("team", false)])
    }

    async fn sync_events(
        &self,
        _access_token: &str,
        context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        if context.target.provider_calendar_id == "team" {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Transient,
                "the second calendar's poll failed",
            ));
        }
        let mut upsert = valid_upsert();
        let CalendarEventSource::Google(source) = &mut upsert.source;
        source.calendar_id = Uuid::nil();
        Ok(GoogleEventSyncBatch {
            upserts: vec![upsert],
            observed_provider_event_ids: Some(vec!["provider-event".to_string()]),
            next_sync_token: "next".to_string(),
            materialized_range: Some(context.target.range),
            cancelled_provider_event_ids: Vec::new(),
        })
    }

    async fn watch_calendar(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
        _provider_calendar_id: &str,
        _channel_id: Uuid,
        _config: &GoogleWatchConfig,
    ) -> Result<GoogleWatchChannel, GoogleProviderError> {
        unreachable!("watch is disabled in these tests")
    }
}

#[tokio::test]
async fn partial_progress_reports_changes_when_a_later_calendar_fails() {
    let lifecycle = FakeLifecycle::claimed();
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        FakeRepo::default(),
        PartialFailureGoogleProvider,
        lifecycle.clone(),
        None,
    );

    let mut report = GoogleBackfillRunReport::default();
    let error = coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "macro|calendar@example.com",
            "secret",
            OccurrenceRange::maintenance_horizon(Utc::now()),
            &mut report,
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        GoogleCalendarBackfillRunError::Retryable(_)
    ));
    assert_eq!(
        report.events_upserted, 1,
        "the first calendar's durable commit must surface through the failed run"
    );
    assert!(report.changed());
}

#[tokio::test]
async fn google_coordinator_owns_claim_and_completion_lifecycle() {
    let lifecycle = FakeLifecycle::claimed();
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        FakeRepo::default(),
        FakeGoogleProvider,
        lifecycle.clone(),
        None,
    );

    let mut report = GoogleBackfillRunReport::default();
    coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "macro|calendar@example.com",
            "secret",
            OccurrenceRange::historical_sync(Utc::now()),
            &mut report,
        )
        .await
        .unwrap();

    assert_eq!(report, GoogleBackfillRunReport::default());
    assert_eq!(lifecycle.completions.lock().unwrap().len(), 1);
}

#[derive(Clone)]
struct SystemCalendarProvider;

impl GoogleCalendarProvider for SystemCalendarProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
    ) -> Result<Vec<ProviderCalendar>, GoogleProviderError> {
        Ok(vec![ProviderCalendar {
            provider_calendar_id: "en.usa#holiday@group.v.calendar.google.com".to_string(),
            name: "Holidays in United States".to_string(),
            description: None,
            time_zone: Some("UTC".to_string()),
            color: None,
            access_role: Some("reader".to_string()),
            is_primary: false,
            is_selected: true,
            default_reminders: Vec::new(),
        }])
    }

    async fn sync_events(
        &self,
        _access_token: &str,
        _context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        unreachable!("freshly synced system calendars must not sync")
    }

    async fn watch_calendar(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
        _provider_calendar_id: &str,
        _channel_id: Uuid,
        _config: &GoogleWatchConfig,
    ) -> Result<GoogleWatchChannel, GoogleProviderError> {
        unreachable!("watch is disabled in these tests")
    }
}

#[tokio::test]
async fn freshly_synced_system_calendars_are_skipped() {
    let lifecycle = FakeLifecycle::claimed();
    let repo = FakeRepo {
        stored_synced_at: Some(Utc::now()),
        ..FakeRepo::default()
    };
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        repo,
        SystemCalendarProvider,
        lifecycle.clone(),
        None,
    );

    let mut report = GoogleBackfillRunReport::default();
    coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "macro|calendar@example.com",
            "secret",
            OccurrenceRange::maintenance_horizon(Utc::now()),
            &mut report,
        )
        .await
        .unwrap();

    assert_eq!(report, GoogleBackfillRunReport::default());
    assert_eq!(lifecycle.completions.lock().unwrap().len(), 1);
}

#[derive(Clone)]
struct HangingGoogleProvider;

impl GoogleCalendarProvider for HangingGoogleProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
    ) -> Result<Vec<ProviderCalendar>, GoogleProviderError> {
        std::future::pending().await
    }

    async fn sync_events(
        &self,
        _access_token: &str,
        _context: GoogleEventSyncContext,
    ) -> Result<GoogleEventSyncBatch, GoogleProviderError> {
        unreachable!("provider hangs before syncing events")
    }

    async fn watch_calendar(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
        _provider_calendar_id: &str,
        _channel_id: Uuid,
        _config: &GoogleWatchConfig,
    ) -> Result<GoogleWatchChannel, GoogleProviderError> {
        unreachable!("watch is disabled in these tests")
    }
}

#[tokio::test]
async fn google_coordinator_surfaces_lease_loss_while_work_is_running() {
    let lifecycle = FakeLifecycle::lease_lost();
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        FakeRepo::default(),
        HangingGoogleProvider,
        lifecycle.clone(),
        None,
    );

    let error = coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "macro|calendar@example.com",
            "secret",
            OccurrenceRange::historical_sync(Utc::now()),
            &mut GoogleBackfillRunReport::default(),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, GoogleCalendarBackfillRunError::LeaseLost));
    assert!(lifecycle.completions.lock().unwrap().is_empty());
    assert!(lifecycle.failures.lock().unwrap().is_empty());
}

#[tokio::test]
async fn google_coordinator_keeps_calendar_permission_health_separate_from_gmail() {
    let lifecycle = FakeLifecycle::claimed();
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        FakeRepo::default(),
        ReauthGoogleProvider,
        lifecycle.clone(),
        None,
    );

    let error = coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "macro|calendar@example.com",
            "secret",
            OccurrenceRange::historical_sync(Utc::now()),
            &mut GoogleBackfillRunReport::default(),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        GoogleCalendarBackfillRunError::ReauthRequired {
            link_reauth_transitioned: false,
            ..
        }
    ));
    assert_eq!(
        lifecycle.failures.lock().unwrap().as_slice(),
        &[CalendarBackfillFailureDisposition::CalendarPermissionRequired]
    );
}

#[derive(Clone, Default)]
struct FakeTeardownRepo {
    channels: Vec<ActiveWatchChannel>,
    fail_clear_for: Option<String>,
    cleared: Arc<Mutex<Vec<(Uuid, String)>>>,
}

impl WatchChannelTeardownRepository for FakeTeardownRepo {
    async fn list_active_watch_channels(&self) -> Result<Vec<ActiveWatchChannel>, Report> {
        Ok(self.channels.clone())
    }

    async fn clear_watch_channel(&self, calendar_id: Uuid, channel_id: &str) -> Result<(), Report> {
        if self.fail_clear_for.as_deref() == Some(channel_id) {
            return Err(rootcause::report!(CalendarValidationError::MissingIdentity).into());
        }
        self.cleared
            .lock()
            .unwrap()
            .push((calendar_id, channel_id.to_owned()));
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeStopper {
    fail_channel: Option<String>,
    stopped: Arc<Mutex<Vec<(String, String)>>>,
}

impl GoogleWatchChannelStopper for FakeStopper {
    async fn stop_watch_channel(
        &self,
        access_token: &str,
        _email_link_id: Uuid,
        channel_id: &str,
        _resource_id: &str,
    ) -> Result<(), GoogleProviderError> {
        if self.fail_channel.as_deref() == Some(channel_id) {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Transient,
                "stop refused",
            ));
        }
        self.stopped
            .lock()
            .unwrap()
            .push((access_token.to_owned(), channel_id.to_owned()));
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeTokens {
    fail_for: Option<String>,
    minted: Arc<Mutex<Vec<String>>>,
}

impl CalendarAccessTokenProvider for FakeTokens {
    async fn fetch_access_token(
        &self,
        identity: &CalendarLinkTokenIdentity,
    ) -> Result<String, CalendarTokenError> {
        if self.fail_for.as_deref() == Some(identity.email_address.as_str()) {
            return Err(CalendarTokenError::Transient("mint refused".to_owned()));
        }
        self.minted
            .lock()
            .unwrap()
            .push(identity.email_address.clone());
        Ok(format!("token-{}", identity.email_address))
    }
}

fn active_channel(link_id: Uuid, email: &str, channel_id: &str) -> ActiveWatchChannel {
    ActiveWatchChannel {
        calendar_id: Uuid::now_v7(),
        channel_id: channel_id.to_owned(),
        resource_id: format!("resource-{channel_id}"),
        email_link_id: link_id,
        token_identity: CalendarLinkTokenIdentity {
            fusionauth_user_id: format!("fa-{email}"),
            email_address: email.to_owned(),
            provider: "GMAIL".to_owned(),
        },
    }
}

#[tokio::test]
async fn stop_all_stops_and_clears_every_channel_minting_once_per_link() {
    let link_a = Uuid::now_v7();
    let link_b = Uuid::now_v7();
    let repo = FakeTeardownRepo {
        channels: vec![
            active_channel(link_a, "a@example.com", "chan-1"),
            active_channel(link_a, "a@example.com", "chan-2"),
            active_channel(link_b, "b@example.com", "chan-3"),
        ],
        ..Default::default()
    };
    let stopper = FakeStopper::default();
    let tokens = FakeTokens::default();

    let summary = stop_all_watch_channels(&repo, &stopper, &tokens)
        .await
        .unwrap();

    assert_eq!(summary.stopped, 3);
    assert_eq!(summary.failed, 0);
    assert_eq!(
        tokens.minted.lock().unwrap().len(),
        2,
        "one token per link, not per channel"
    );
    let stopped = stopper.stopped.lock().unwrap();
    assert!(
        stopped
            .iter()
            .any(|(token, channel)| { token == "token-a@example.com" && channel == "chan-1" })
    );
    assert_eq!(repo.cleared.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn stop_all_keeps_bookkeeping_for_channels_that_fail_to_stop() {
    let link = Uuid::now_v7();
    let repo = FakeTeardownRepo {
        channels: vec![
            active_channel(link, "a@example.com", "chan-ok"),
            active_channel(link, "a@example.com", "chan-bad"),
        ],
        ..Default::default()
    };
    let stopper = FakeStopper {
        fail_channel: Some("chan-bad".to_owned()),
        ..Default::default()
    };
    let tokens = FakeTokens::default();

    let summary = stop_all_watch_channels(&repo, &stopper, &tokens)
        .await
        .unwrap();

    assert_eq!(summary.stopped, 1);
    assert_eq!(summary.failed, 1);
    let cleared = repo.cleared.lock().unwrap();
    assert_eq!(cleared.len(), 1);
    assert_eq!(cleared[0].1, "chan-ok");
}

#[tokio::test]
async fn stop_all_counts_a_failed_bookkeeping_clear_as_failed() {
    let link = Uuid::now_v7();
    let repo = FakeTeardownRepo {
        channels: vec![
            active_channel(link, "a@example.com", "chan-ok"),
            active_channel(link, "a@example.com", "chan-uncleared"),
        ],
        fail_clear_for: Some("chan-uncleared".to_owned()),
        ..Default::default()
    };
    let stopper = FakeStopper::default();
    let tokens = FakeTokens::default();

    let summary = stop_all_watch_channels(&repo, &stopper, &tokens)
        .await
        .unwrap();

    assert_eq!(summary.stopped, 1);
    assert_eq!(
        summary.failed, 1,
        "a stopped channel whose bookkeeping survives is not fully torn down"
    );
    let cleared = repo.cleared.lock().unwrap();
    assert_eq!(cleared.len(), 1);
    assert_eq!(cleared[0].1, "chan-ok");
}

#[tokio::test]
async fn stop_all_counts_channels_whose_token_cannot_be_minted() {
    let failing_link = Uuid::now_v7();
    let healthy_link = Uuid::now_v7();
    let repo = FakeTeardownRepo {
        channels: vec![
            active_channel(failing_link, "broken@example.com", "chan-1"),
            active_channel(failing_link, "broken@example.com", "chan-2"),
            active_channel(healthy_link, "ok@example.com", "chan-3"),
        ],
        ..Default::default()
    };
    let stopper = FakeStopper::default();
    let tokens = FakeTokens {
        fail_for: Some("broken@example.com".to_owned()),
        ..Default::default()
    };

    let summary = stop_all_watch_channels(&repo, &stopper, &tokens)
        .await
        .unwrap();

    assert_eq!(summary.stopped, 1);
    assert_eq!(summary.failed, 2);
    assert_eq!(
        stopper.stopped.lock().unwrap().len(),
        1,
        "no stop attempts without a token"
    );
}
