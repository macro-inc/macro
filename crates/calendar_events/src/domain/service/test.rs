use super::*;
use crate::domain::{
    models::{
        AttendeeResponseStatus, CalendarAttendee, CalendarBackfillClaim,
        CalendarBackfillFailureDisposition, CalendarBackfillJobKey, CalendarEvent,
        CalendarEventSource, CalendarOccurrence, CalendarSyncStatus, EmailCalendarBackfillState,
        EmailCalendarScanAssociation, EmailCalendarScanJob, EmailCalendarScanStatus,
        EmailIcsSource, EventStatus, EventTime, EventTransparency, EventVisibility,
        GOOGLE_CALENDAR_SCOPES, GoogleCalendarSyncSnapshot, GoogleEventSyncBatch, ProviderCalendar,
        StoredGoogleCalendar,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventWrite, CalendarRepository,
        EmailCalendarBackfillPublisher, EmailCalendarBackfillRepository, GoogleCalendarProvider,
        GoogleEventSyncContext, GoogleProviderError,
    },
};
use chrono::{TimeZone, Utc};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct FakeRepo {
    upserts: Arc<Mutex<Vec<CalendarEventUpsert>>>,
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
            CalendarEventWrite::EmailIcs(upsert)
            | CalendarEventWrite::GoogleBackfill { upsert, .. }
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
        })
    }

    async fn commit_google_calendar_sync(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _sync: GoogleCalendarSyncSnapshot,
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
            created_at: starts_at,
            updated_at: starts_at,
        },
        source: CalendarEventSource::EmailIcs(EmailIcsSource {
            email_link_id: Uuid::now_v7(),
            email_thread_id: None,
            email_message_id: Uuid::now_v7(),
            email_attachment_id: None,
            content_hash: "hash".to_string(),
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

#[tokio::test]
async fn accepts_valid_event() {
    let repo = FakeRepo::default();
    let service = CalendarService::new(repo.clone());
    let upsert = valid_upsert();

    service.upsert_email_event(upsert).await.unwrap();

    assert_eq!(repo.upserts.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn rejects_invalid_occurrence_time() {
    let repo = FakeRepo::default();
    let service = CalendarService::new(repo.clone());
    let mut upsert = valid_upsert();
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    upsert.occurrences[0].time = EventTime::Timed {
        starts_at,
        ends_at: starts_at,
        time_zone: None,
    };

    assert!(service.upsert_email_event(upsert).await.is_err());
    assert!(repo.upserts.lock().unwrap().is_empty());
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
            materialized_range: Some(context.range),
            cancelled_provider_event_ids: Vec::new(),
        })
    }
}

#[derive(Clone)]
struct ReauthGoogleProvider;

impl GoogleCalendarProvider for ReauthGoogleProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
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
}

#[derive(Clone)]
struct FakeLifecycle {
    claim: CalendarBackfillClaim,
    completions: Arc<Mutex<Vec<usize>>>,
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
        extracted_count: usize,
    ) -> Result<(), Report> {
        self.completions.lock().unwrap().push(extracted_count);
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

#[tokio::test]
async fn google_coordinator_owns_claim_and_completion_lifecycle() {
    let lifecycle = FakeLifecycle::claimed();
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        FakeRepo::default(),
        FakeGoogleProvider,
        lifecycle.clone(),
    );

    let count = coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "macro|calendar@example.com",
            "secret",
            OccurrenceRange::historical_sync(Utc::now()),
        )
        .await
        .unwrap();

    assert_eq!(count, 0);
    assert_eq!(lifecycle.completions.lock().unwrap().as_slice(), &[0]);
}

#[derive(Clone)]
struct HangingGoogleProvider;

impl GoogleCalendarProvider for HangingGoogleProvider {
    async fn list_calendars(
        &self,
        _access_token: &str,
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
}

#[tokio::test]
async fn google_coordinator_surfaces_lease_loss_while_work_is_running() {
    let lifecycle = FakeLifecycle::lease_lost();
    let coordinator = GoogleCalendarBackfillCoordinator::new(
        FakeRepo::default(),
        HangingGoogleProvider,
        lifecycle.clone(),
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

#[derive(Clone)]
struct FakeEmailLifecycle {
    state: EmailCalendarBackfillState,
    active: Option<EmailCalendarScanJob>,
    associations: Arc<Mutex<usize>>,
    failures: Arc<Mutex<usize>>,
}

impl EmailCalendarBackfillRepository for FakeEmailLifecycle {
    async fn get_email_calendar_backfill_state(
        &self,
        _key: CalendarBackfillJobKey,
    ) -> Result<EmailCalendarBackfillState, Report> {
        Ok(self.state)
    }

    async fn get_email_scan_job(
        &self,
        _email_link_id: Uuid,
        _email_job_id: Uuid,
    ) -> Result<Option<EmailCalendarScanJob>, Report> {
        Ok(self.active)
    }

    async fn get_active_email_scan_job(
        &self,
        _email_link_id: Uuid,
    ) -> Result<Option<EmailCalendarScanJob>, Report> {
        Ok(self.active)
    }

    async fn create_email_scan_job(
        &self,
        _email_link_id: Uuid,
        _fusionauth_user_id: &str,
    ) -> Result<EmailCalendarScanJob, Report> {
        self.active
            .ok_or_else(|| rootcause::report!("test scan was not configured"))
    }

    async fn associate_email_scan(
        &self,
        _key: CalendarBackfillJobKey,
        _email_job_id: Uuid,
        _allow_in_progress: bool,
    ) -> Result<EmailCalendarScanAssociation, Report> {
        *self.associations.lock().unwrap() += 1;
        Ok(EmailCalendarScanAssociation::Associated(
            self.active.expect("configured scan").status,
        ))
    }

    async fn fail_email_calendar_backfill(
        &self,
        _key: CalendarBackfillJobKey,
        _message: &str,
    ) -> Result<bool, Report> {
        *self.failures.lock().unwrap() += 1;
        Ok(true)
    }
}

#[derive(Clone, Default)]
struct FakeEmailPublisher {
    publications: Arc<Mutex<usize>>,
}

impl EmailCalendarBackfillPublisher for FakeEmailPublisher {
    async fn publish_email_scan_init(
        &self,
        _email_link_id: Uuid,
        _email_job_id: Uuid,
    ) -> Result<(), Report> {
        *self.publications.lock().unwrap() += 1;
        Ok(())
    }
}

#[tokio::test]
async fn email_coordinator_waits_instead_of_joining_a_partial_scan() {
    let repository = FakeEmailLifecycle {
        state: EmailCalendarBackfillState::Unassociated,
        active: Some(EmailCalendarScanJob {
            id: Uuid::now_v7(),
            status: EmailCalendarScanStatus::InProgress,
            is_full_scan: true,
        }),
        associations: Arc::new(Mutex::new(0)),
        failures: Arc::new(Mutex::new(0)),
    };
    let publisher = FakeEmailPublisher::default();
    let coordinator = EmailCalendarBackfillCoordinator::new(repository.clone(), publisher.clone());

    let error = coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "fusion-user",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, EmailCalendarBackfillRunError::Busy));
    assert_eq!(*repository.associations.lock().unwrap(), 0);
    assert_eq!(*publisher.publications.lock().unwrap(), 0);
}

#[tokio::test]
async fn email_coordinator_rejects_a_bounded_scan() {
    let repository = FakeEmailLifecycle {
        state: EmailCalendarBackfillState::Unassociated,
        active: Some(EmailCalendarScanJob {
            id: Uuid::now_v7(),
            status: EmailCalendarScanStatus::Init,
            is_full_scan: false,
        }),
        associations: Arc::new(Mutex::new(0)),
        failures: Arc::new(Mutex::new(0)),
    };
    let publisher = FakeEmailPublisher::default();
    let coordinator = EmailCalendarBackfillCoordinator::new(repository.clone(), publisher.clone());

    let error = coordinator
        .run(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "fusion-user",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, EmailCalendarBackfillRunError::Busy));
    assert_eq!(*repository.associations.lock().unwrap(), 0);
    assert_eq!(*publisher.publications.lock().unwrap(), 0);
}

#[tokio::test]
async fn email_coordinator_applies_terminal_failure_through_its_repository() {
    let repository = FakeEmailLifecycle {
        state: EmailCalendarBackfillState::NotFound,
        active: None,
        associations: Arc::new(Mutex::new(0)),
        failures: Arc::new(Mutex::new(0)),
    };
    let coordinator =
        EmailCalendarBackfillCoordinator::new(repository.clone(), FakeEmailPublisher::default());

    coordinator
        .fail_terminal(
            CalendarBackfillJobKey {
                job_id: Uuid::now_v7(),
                email_link_id: Uuid::now_v7(),
            },
            "invalid calendar data",
        )
        .await
        .unwrap();

    assert_eq!(*repository.failures.lock().unwrap(), 1);
}
