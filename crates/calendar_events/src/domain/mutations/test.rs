use super::*;
use crate::domain::models::{
    AppliedGoogleGrant, CalendarAttendeeInput, CalendarBackfillJobKey, CalendarCreationTarget,
    CalendarEventSource, CalendarLinkTokenIdentity, CalendarOccurrence, CalendarOccurrenceCursor,
    CalendarSyncStatus, EventStatus, EventTransparency, EventVisibility,
    GoogleCalendarSyncSnapshot, GoogleCalendarTarget, GoogleEventSource, GoogleWatchChannel,
    ProviderCalendar, StoredGoogleCalendar,
};
use chrono::{Duration, TimeZone};
use std::sync::{Arc, Mutex};

fn token_identity() -> CalendarLinkTokenIdentity {
    CalendarLinkTokenIdentity {
        fusionauth_user_id: "fusion-user".to_string(),
        email_address: "self@example.com".to_string(),
        provider: "GMAIL".to_string(),
    }
}

fn mutation_target(is_read_only: bool) -> CalendarEventMutationTarget {
    CalendarEventMutationTarget {
        event_id: Uuid::now_v7(),
        is_read_only,
        provider_event_id: "instance-id".to_string(),
        provider_recurring_event_id: Some("master-id".to_string()),
        owner_id: "macro|self@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        token_identity: token_identity(),
    }
}

fn creation_target(is_read_only: bool) -> CalendarCreationTarget {
    CalendarCreationTarget {
        owner_id: "macro|self@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only,
        token_identity: token_identity(),
    }
}

fn timed_time() -> EventTime {
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 6, 14, 0, 0).unwrap();
    EventTime::Timed {
        starts_at,
        ends_at: starts_at + Duration::hours(1),
        time_zone: Some("UTC".to_string()),
    }
}

fn echo_upsert(target_owner: &str) -> CalendarEventUpsert {
    let id = Uuid::now_v7();
    CalendarEventUpsert {
        event: CalendarEvent {
            id,
            owner_id: target_owner.to_string(),
            ical_uid: "echo@example.com".to_string(),
            calendar_id: Some(Uuid::now_v7()),
            title: "Echo".to_string(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            time: timed_time(),
            recurrence_lines: Vec::new(),
            organizer_email: None,
            organizer_name: None,
            conference_url: None,
            sequence: 0,
            is_read_only: false,
            attendees: Vec::new(),
            reminders: EventReminders::default(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
        source: CalendarEventSource::Google(GoogleEventSource {
            email_link_id: Uuid::now_v7(),
            account_id: Uuid::now_v7(),
            calendar_id: Uuid::now_v7(),
            provider_event_id: "echo-id".to_string(),
            provider_recurring_event_id: None,
            provider_etag: None,
            raw_payload: serde_json::json!({}),
        }),
        overrides: Vec::new(),
        occurrences: Vec::new(),
    }
}

fn draft() -> CalendarEventDraft {
    CalendarEventDraft {
        title: "New event".to_string(),
        description: None,
        location: None,
        time: timed_time(),
        attendees: vec![CalendarAttendeeInput {
            email: "guest@example.com".to_string(),
            is_optional: false,
        }],
        recurrence_lines: Vec::new(),
        visibility: None,
        transparency: None,
        reminders: None,
    }
}

#[derive(Clone, Default)]
struct FakeRepo {
    mutation_target: Option<CalendarEventMutationTarget>,
    creation_target: Option<CalendarCreationTarget>,
    persisted_event_id: Option<Uuid>,
    upserts: Arc<Mutex<Vec<CalendarEventUpsert>>>,
    removed_sources: Arc<Mutex<Vec<(Uuid, Uuid, String)>>>,
}

impl CalendarRepository for FakeRepo {
    async fn apply_google_grant(
        &self,
        _email_link_id: Uuid,
        _scopes: crate::domain::models::GoogleScopeSet,
    ) -> Result<AppliedGoogleGrant, rootcause::Report> {
        unreachable!()
    }

    async fn upsert_event(&self, write: CalendarEventWrite) -> Result<Uuid, rootcause::Report> {
        let CalendarEventWrite::UserMutation(upsert) = write else {
            panic!("mutations must persist through the UserMutation authority");
        };
        self.upserts.lock().unwrap().push(upsert);
        Ok(self.persisted_event_id.unwrap_or_else(Uuid::now_v7))
    }

    async fn list_occurrences(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _cursor: Option<CalendarOccurrenceCursor>,
        _limit: u16,
    ) -> Result<Vec<(CalendarEvent, CalendarOccurrence)>, rootcause::Report> {
        unreachable!()
    }

    async fn sync_status(
        &self,
        _requester_id: &str,
    ) -> Result<CalendarSyncStatus, rootcause::Report> {
        unreachable!()
    }

    async fn upsert_google_calendar(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _calendar: ProviderCalendar,
    ) -> Result<StoredGoogleCalendar, rootcause::Report> {
        unreachable!()
    }

    async fn commit_google_calendar_sync(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _sync: GoogleCalendarSyncSnapshot,
        _events_upserted: usize,
    ) -> Result<(), rootcause::Report> {
        unreachable!()
    }

    async fn record_watch_channel(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _calendar_id: Uuid,
        _channel: GoogleWatchChannel,
    ) -> Result<(), rootcause::Report> {
        unreachable!()
    }

    async fn find_watch_target(
        &self,
        _channel_id: &str,
        _resource_id: &str,
    ) -> Result<Option<Uuid>, rootcause::Report> {
        unreachable!()
    }

    async fn schedule_google_sync_for_link(
        &self,
        _email_link_id: Uuid,
    ) -> Result<bool, rootcause::Report> {
        Ok(true)
    }

    async fn reconcile_google_calendar_list(
        &self,
        _key: CalendarBackfillJobKey,
        _lease_token: Uuid,
        _account_id: Uuid,
        _calendar_ids: Vec<Uuid>,
    ) -> Result<(), rootcause::Report> {
        unreachable!()
    }

    async fn get_event_mutation_target(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<CalendarEventMutationTarget>, rootcause::Report> {
        Ok(self.mutation_target.clone())
    }

    async fn get_creation_target(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
    ) -> Result<Option<CalendarCreationTarget>, rootcause::Report> {
        Ok(self.creation_target.clone())
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<crate::domain::models::VisibleCalendar>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn remove_google_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> Result<(), rootcause::Report> {
        self.removed_sources.lock().unwrap().push((
            account_id,
            calendar_id,
            provider_event_id.to_string(),
        ));
        Ok(())
    }
}

#[derive(Clone)]
enum FakeProviderBehavior {
    Echo,
    Gone,
    NotAttendee,
    Fail(GoogleProviderErrorKind),
}

#[derive(Clone)]
struct FakeProvider {
    behavior: FakeProviderBehavior,
    calls: Arc<Mutex<Vec<String>>>,
}

impl FakeProvider {
    fn new(behavior: FakeProviderBehavior) -> Self {
        Self {
            behavior,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn fail(&self) -> Option<GoogleProviderError> {
        match &self.behavior {
            FakeProviderBehavior::Fail(kind) => {
                Some(GoogleProviderError::new(*kind, "provider says no"))
            }
            _ => None,
        }
    }
}

impl GoogleCalendarMutationProvider for FakeProvider {
    async fn create_event(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        _draft: &CalendarEventDraft,
    ) -> Result<CalendarEventUpsert, GoogleProviderError> {
        self.calls.lock().unwrap().push("create".to_string());
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(echo_upsert(&target.owner_id))
    }

    async fn update_event(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
        _patch: &CalendarEventPatch,
    ) -> Result<Option<CalendarEventUpsert>, GoogleProviderError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("update:{provider_event_id}"));
        if let Some(error) = self.fail() {
            return Err(error);
        }
        if matches!(self.behavior, FakeProviderBehavior::Gone) {
            return Ok(None);
        }
        Ok(Some(echo_upsert(&target.owner_id)))
    }

    async fn delete_event(
        &self,
        _access_token: &str,
        _target: &GoogleCalendarTarget,
        provider_event_id: &str,
    ) -> Result<(), GoogleProviderError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("delete:{provider_event_id}"));
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(())
    }

    async fn delete_event_instance(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> Result<GoogleSeriesMutationOutcome, GoogleProviderError> {
        self.calls.lock().unwrap().push(format!(
            "instance:{master_provider_event_id}:{original_start}"
        ));
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(match self.behavior {
            FakeProviderBehavior::Gone => GoogleSeriesMutationOutcome::Gone,
            _ => GoogleSeriesMutationOutcome::Applied(Box::new(echo_upsert(&target.owner_id))),
        })
    }

    async fn truncate_recurring_event(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> Result<GoogleSeriesMutationOutcome, GoogleProviderError> {
        self.calls.lock().unwrap().push(format!(
            "truncate:{master_provider_event_id}:{original_start}"
        ));
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(match self.behavior {
            FakeProviderBehavior::Gone => GoogleSeriesMutationOutcome::SeriesDeleted,
            _ => GoogleSeriesMutationOutcome::Applied(Box::new(echo_upsert(&target.owner_id))),
        })
    }

    async fn rsvp_event(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        _self_email: &str,
        _response: AttendeeResponseStatus,
        scope: &CalendarRsvpScope,
    ) -> Result<GoogleRsvpOutcome, GoogleProviderError> {
        let scope = match scope {
            CalendarRsvpScope::All => "all".to_string(),
            CalendarRsvpScope::ThisEvent { recurrence_id } => format!("this:{recurrence_id}"),
        };
        self.calls
            .lock()
            .unwrap()
            .push(format!("rsvp:{master_provider_event_id}:{scope}"));
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(match self.behavior {
            FakeProviderBehavior::Gone => GoogleRsvpOutcome::Gone,
            FakeProviderBehavior::NotAttendee => GoogleRsvpOutcome::NotAttendee,
            _ => GoogleRsvpOutcome::Applied(Box::new(echo_upsert(&target.owner_id))),
        })
    }
}

#[derive(Clone)]
struct FakeTokens {
    error: Option<fn() -> CalendarTokenError>,
}

impl FakeTokens {
    fn ok() -> Self {
        Self { error: None }
    }

    fn reauth() -> Self {
        Self {
            error: Some(|| CalendarTokenError::ReauthRequired("grant revoked".to_string())),
        }
    }
}

impl CalendarAccessTokenProvider for FakeTokens {
    async fn fetch_access_token(
        &self,
        _identity: &CalendarLinkTokenIdentity,
    ) -> Result<String, CalendarTokenError> {
        match self.error {
            Some(make_error) => Err(make_error()),
            None => Ok("access-token".to_string()),
        }
    }
}

fn service(
    repo: FakeRepo,
    provider: FakeProvider,
    tokens: FakeTokens,
) -> CalendarMutationServiceImpl<FakeRepo, FakeProvider, FakeTokens> {
    CalendarMutationServiceImpl::new(repo, provider, tokens)
}

#[tokio::test]
async fn create_requires_a_writable_calendar() {
    let missing = service(
        FakeRepo::default(),
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    );
    assert!(matches!(
        missing
            .create_event("macro|user", None, None, draft())
            .await,
        Err(CalendarMutationError::NoWritableCalendar)
    ));

    let read_only = service(
        FakeRepo {
            creation_target: Some(creation_target(true)),
            ..FakeRepo::default()
        },
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    );
    assert!(matches!(
        read_only
            .create_event("macro|user", None, None, draft())
            .await,
        Err(CalendarMutationError::ReadOnly)
    ));
}

#[tokio::test]
async fn create_persists_the_provider_echo_and_returns_the_applied_id() {
    let applied_id = Uuid::now_v7();
    let repo = FakeRepo {
        creation_target: Some(creation_target(false)),
        persisted_event_id: Some(applied_id),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
    let created = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .unwrap();

    assert_eq!(created.id, applied_id);
    assert_eq!(upserts.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn create_rejects_invalid_input_before_reaching_the_provider() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let svc = service(
        FakeRepo {
            creation_target: Some(creation_target(false)),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    );

    let mut inverted = draft();
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 6, 14, 0, 0).unwrap();
    inverted.time = EventTime::Timed {
        starts_at,
        ends_at: starts_at - Duration::hours(1),
        time_zone: None,
    };
    assert!(matches!(
        svc.create_event("macro|user", None, None, inverted).await,
        Err(CalendarMutationError::InvalidInput(_))
    ));

    let mut bad_email = draft();
    bad_email.attendees[0].email = "not-an-email".to_string();
    assert!(matches!(
        svc.create_event("macro|user", None, None, bad_email).await,
        Err(CalendarMutationError::InvalidInput(_))
    ));
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn update_validates_lookup_policy_and_addresses_the_series_master() {
    let empty_patch = service(
        FakeRepo::default(),
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    );
    assert!(matches!(
        empty_patch
            .update_event("macro|user", Uuid::now_v7(), CalendarEventPatch::default())
            .await,
        Err(CalendarMutationError::InvalidInput(_))
    ));

    let patch = CalendarEventPatch {
        title: Some("Renamed".to_string()),
        ..CalendarEventPatch::default()
    };

    let not_found = service(
        FakeRepo::default(),
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    );
    assert!(matches!(
        not_found
            .update_event("macro|user", Uuid::now_v7(), patch.clone())
            .await,
        Err(CalendarMutationError::NotFound)
    ));

    let read_only = service(
        FakeRepo {
            mutation_target: Some(mutation_target(true)),
            ..FakeRepo::default()
        },
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    );
    assert!(matches!(
        read_only
            .update_event("macro|user", Uuid::now_v7(), patch.clone())
            .await,
        Err(CalendarMutationError::ReadOnly)
    ));

    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .update_event("macro|user", Uuid::now_v7(), patch)
    .await
    .unwrap();
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["update:master-id"],
        "instance-backed targets patch their recurring master"
    );
}

#[tokio::test]
async fn update_on_a_provider_deleted_event_retires_the_stale_source() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let removed = repo.removed_sources.clone();
    let result = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Gone),
        FakeTokens::ok(),
    )
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        CalendarEventPatch {
            title: Some("Renamed".to_string()),
            ..CalendarEventPatch::default()
        },
    )
    .await;

    assert!(matches!(result, Err(CalendarMutationError::NotFound)));
    let removed = removed.lock().unwrap();
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].2, "master-id");
}

#[tokio::test]
async fn delete_pushes_to_the_provider_then_retires_the_local_source() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let removed = repo.removed_sources.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .delete_event("macro|user", Uuid::now_v7(), CalendarDeletionScope::All)
        .await
        .unwrap();

    assert_eq!(calls.lock().unwrap().as_slice(), ["delete:master-id"]);
    assert_eq!(removed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn rsvp_surfaces_attendance_and_persists_the_echo() {
    let not_attendee = service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        FakeProvider::new(FakeProviderBehavior::NotAttendee),
        FakeTokens::ok(),
    );
    assert!(matches!(
        not_attendee
            .respond_to_event(
                "macro|user",
                Uuid::now_v7(),
                AttendeeResponseStatus::Accepted,
                CalendarRsvpScope::All,
            )
            .await,
        Err(CalendarMutationError::NotAttendee)
    ));

    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    service(repo, provider, FakeTokens::ok())
        .respond_to_event(
            "macro|user",
            Uuid::now_v7(),
            AttendeeResponseStatus::Declined,
            CalendarRsvpScope::ThisEvent {
                recurrence_id: "2026-08-14T22:00:00+00:00".to_string(),
            },
        )
        .await
        .unwrap();
    assert_eq!(upserts.lock().unwrap().len(), 1);
    // The scope reaches the provider intact: an occurrence-scoped response
    // must not silently widen to the series.
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["rsvp:master-id:this:2026-08-14T22:00:00+00:00"]
    );
}

#[tokio::test]
async fn token_and_provider_failures_map_to_typed_errors() {
    let reauth = service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::reauth(),
    );
    assert!(matches!(
        reauth
            .delete_event("macro|user", Uuid::now_v7(), CalendarDeletionScope::All)
            .await,
        Err(CalendarMutationError::ReauthRequired(_))
    ));

    let transient = service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        FakeProvider::new(FakeProviderBehavior::Fail(
            GoogleProviderErrorKind::Transient,
        )),
        FakeTokens::ok(),
    );
    assert!(matches!(
        transient
            .delete_event("macro|user", Uuid::now_v7(), CalendarDeletionScope::All)
            .await,
        Err(CalendarMutationError::Retryable(_))
    ));

    let permanent = service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        FakeProvider::new(FakeProviderBehavior::Fail(
            GoogleProviderErrorKind::Permanent,
        )),
        FakeTokens::ok(),
    );
    assert!(matches!(
        permanent
            .delete_event("macro|user", Uuid::now_v7(), CalendarDeletionScope::All)
            .await,
        Err(CalendarMutationError::ProviderRejected(_))
    ));
}

#[test]
fn empty_patch_is_detected() {
    assert!(CalendarEventPatch::default().is_empty());
    assert!(
        !CalendarEventPatch {
            title: Some("t".to_string()),
            ..CalendarEventPatch::default()
        }
        .is_empty()
    );
}

#[tokio::test]
async fn scoped_deletions_reshape_or_retire_the_series() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
    let removed = repo.removed_sources.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let svc = service(repo, provider, FakeTokens::ok());

    svc.delete_event(
        "macro|user",
        Uuid::now_v7(),
        CalendarDeletionScope::ThisEvent {
            recurrence_id: "2026-08-10T09:00:00+00:00".to_string(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["instance:master-id:2026-08-10T09:00:00+00:00"],
        "single-occurrence deletions address the recurring master"
    );
    assert_eq!(
        upserts.lock().unwrap().len(),
        1,
        "the surviving series echo is persisted"
    );
    assert!(removed.lock().unwrap().is_empty());

    svc.delete_event(
        "macro|user",
        Uuid::now_v7(),
        CalendarDeletionScope::ThisAndFollowing {
            recurrence_id: "2026-08-12T09:00:00+00:00".to_string(),
        },
    )
    .await
    .unwrap();
    assert_eq!(upserts.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn truncation_that_empties_the_series_retires_the_local_source() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
    let removed = repo.removed_sources.clone();
    let svc = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Gone),
        FakeTokens::ok(),
    );

    svc.delete_event(
        "macro|user",
        Uuid::now_v7(),
        CalendarDeletionScope::ThisAndFollowing {
            recurrence_id: "2026-08-04T09:00:00+00:00".to_string(),
        },
    )
    .await
    .unwrap();

    assert!(upserts.lock().unwrap().is_empty());
    assert_eq!(removed.lock().unwrap().len(), 1);
}
