use super::*;
use crate::domain::{
    models::{
        AttendeeResponseStatus, CalendarAttendee, CalendarBackfillClaim,
        CalendarBackfillFailureDisposition, CalendarBackfillJobKey, CalendarCreationTarget,
        CalendarEvent, CalendarEventMutationTarget, CalendarEventSource, CalendarOccurrence,
        CalendarSyncStatus, EventReminders, EventStatus, EventTime, EventTransparency,
        EventVisibility, GOOGLE_CALENDAR_SCOPES, GoogleBackfillRunReport,
        GoogleCalendarSyncSnapshot, GoogleEventSource, GoogleEventSyncBatch, GoogleWatchChannel,
        GoogleWatchConfig, ProviderCalendar, StoredGoogleCalendar,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventWrite, CalendarRepository, GoogleCalendarProvider,
        GoogleEventSyncContext, GoogleProviderError,
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
            conference_provider: None,
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
