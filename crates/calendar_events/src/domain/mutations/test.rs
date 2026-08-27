use super::*;
use crate::domain::models::{
    ActorInboxes, AppliedGoogleGrant, CalendarAttendee, CalendarAttendeeInput,
    CalendarBackfillJobKey, CalendarCreationTarget, CalendarEventSource, CalendarLinkTokenIdentity,
    CalendarOccurrence, CalendarOccurrenceCursor, CalendarSyncStatus, CalendarWatchRelease,
    ConferenceChange, DisconnectedGoogleCalendar, EventStatus, EventTransparency, EventType,
    EventVisibility, GoogleCalendarSyncSnapshot, GoogleCalendarTarget, GoogleEventSource,
    GoogleWatchChannel, ProviderCalendar, StoredGoogleCalendar, VisibleCalendar,
};
use crate::domain::ports::RetiredCalendarEvent;
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
        actor: Some(ActorInboxes::sole("self@example.com")),
    }
}

fn echo_attendee(email: &str, is_self: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_string(),
        display_name: None,
        response_status: AttendeeResponseStatus::NeedsAction,
        is_organizer: false,
        is_optional: false,
        is_self,
        comment: None,
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
        actor: Some(ActorInboxes::sole("self@example.com")),
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
            event_type: EventType::Default,
            time: timed_time(),
            recurrence_lines: Vec::new(),
            organizer_email: None,
            organizer_name: None,
            creator_email: None,
            creator_name: None,
            conference_url: None,
            conference_provider: None,
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
            response_status: None,
        }],
        recurrence_lines: Vec::new(),
        visibility: None,
        transparency: None,
        reminders: None,
        conference: None,
    }
}

#[derive(Clone)]
struct FakeRepo {
    mutation_target: Option<CalendarEventMutationTarget>,
    creation_target: Option<CalendarCreationTarget>,
    persisted_event_id: Option<Uuid>,
    /// What the upsert reports doing to the row. `Created` by default, since
    /// most fixtures persist a fresh event.
    write_change: CalendarEventChange,
    upserts: Arc<Mutex<Vec<CalendarEventUpsert>>>,
    removed_sources: Arc<Mutex<Vec<(Uuid, Uuid, String)>>>,
    /// Per-event fates `remove_google_source` reports back.
    retired_events: Vec<RetiredCalendarEvent>,
    disconnected: Option<DisconnectedGoogleCalendar>,
    disconnect_requests: Arc<Mutex<Vec<(String, Uuid)>>>,
    visible_calendars: Vec<VisibleCalendar>,
    fail_list_visible: bool,
    fail_owned_inboxes: bool,
}

impl Default for FakeRepo {
    fn default() -> Self {
        Self {
            mutation_target: None,
            creation_target: None,
            persisted_event_id: None,
            write_change: CalendarEventChange::Created,
            upserts: Default::default(),
            removed_sources: Default::default(),
            retired_events: Vec::new(),
            disconnected: None,
            disconnect_requests: Default::default(),
            visible_calendars: Vec::new(),
            fail_list_visible: false,
            fail_owned_inboxes: false,
        }
    }
}

impl CalendarRepository for FakeRepo {
    async fn apply_google_grant(
        &self,
        _email_link_id: Uuid,
        _scopes: crate::domain::models::GoogleScopeSet,
        _intent: crate::domain::models::CalendarGrantIntent,
    ) -> Result<AppliedGoogleGrant, rootcause::Report> {
        unreachable!()
    }

    async fn disconnect_google_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> Result<Option<DisconnectedGoogleCalendar>, rootcause::Report> {
        self.disconnect_requests
            .lock()
            .unwrap()
            .push((requester_id.to_string(), email_link_id));
        Ok(self.disconnected.clone())
    }

    async fn upsert_event(
        &self,
        write: CalendarEventWrite,
    ) -> Result<CalendarEventWriteOutcome, rootcause::Report> {
        let CalendarEventWrite::UserMutation(upsert) = write else {
            panic!("mutations must persist through the UserMutation authority");
        };
        let owner_id = upsert.event.owner_id.clone();
        self.upserts.lock().unwrap().push(upsert);
        Ok(CalendarEventWriteOutcome {
            event_id: self.persisted_event_id.unwrap_or_else(Uuid::now_v7),
            owner_id,
            change: self.write_change,
        })
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

    async fn mention_previews(
        &self,
        _requester_id: &str,
        _items: Vec<crate::domain::models::CalendarMentionRequestItem>,
        _now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<crate::domain::models::CalendarMentionPreview>, rootcause::Report> {
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
    ) -> Result<Vec<RetiredCalendarEvent>, rootcause::Report> {
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
    ) -> Result<Vec<RetiredCalendarEvent>, rootcause::Report> {
        unreachable!()
    }

    async fn get_event_mutation_target(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<CalendarEventMutationTarget>, rootcause::Report> {
        if self.fail_owned_inboxes {
            return Err(rootcause::report!("owned inboxes unavailable"));
        }
        Ok(self.mutation_target.clone())
    }

    async fn get_creation_target(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
    ) -> Result<Option<CalendarCreationTarget>, rootcause::Report> {
        if self.fail_owned_inboxes {
            return Err(rootcause::report!("owned inboxes unavailable"));
        }
        Ok(self.creation_target.clone())
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<crate::domain::models::VisibleCalendar>, rootcause::Report> {
        if self.fail_list_visible {
            return Err(rootcause::report!("visible calendars unavailable"));
        }
        Ok(self.visible_calendars.clone())
    }

    async fn owned_inbox_emails(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<String>, rootcause::Report> {
        if self.fail_owned_inboxes {
            return Err(rootcause::report!("owned inboxes unavailable"));
        }
        Ok(Vec::new())
    }

    async fn remove_google_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> Result<Vec<RetiredCalendarEvent>, rootcause::Report> {
        self.removed_sources.lock().unwrap().push((
            account_id,
            calendar_id,
            provider_event_id.to_string(),
        ));
        Ok(self.retired_events.clone())
    }
}

#[derive(Clone)]
enum FakeProviderBehavior {
    Echo,
    Gone,
    OccurrenceGone,
    NotAttendee,
    Fail(GoogleProviderErrorKind),
}

#[derive(Clone)]
struct FakeProvider {
    behavior: FakeProviderBehavior,
    calls: Arc<Mutex<Vec<String>>>,
    rsvp_self_emails: Arc<Mutex<Vec<Vec<String>>>>,
    echo_attendees: Vec<CalendarAttendee>,
    created_drafts: Arc<Mutex<Vec<CalendarEventDraft>>>,
}

impl FakeProvider {
    fn new(behavior: FakeProviderBehavior) -> Self {
        Self {
            behavior,
            calls: Arc::new(Mutex::new(Vec::new())),
            rsvp_self_emails: Arc::new(Mutex::new(Vec::new())),
            echo_attendees: Vec::new(),
            created_drafts: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn echo(&self, owner_id: &str) -> CalendarEventUpsert {
        let mut upsert = echo_upsert(owner_id);
        upsert.event.attendees = self.echo_attendees.clone();
        upsert
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
        draft: &CalendarEventDraft,
    ) -> Result<CalendarEventUpsert, GoogleProviderError> {
        self.calls.lock().unwrap().push("create".to_string());
        self.created_drafts.lock().unwrap().push(draft.clone());
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(self.echo(&target.owner_id))
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
        Ok(Some(self.echo(&target.owner_id)))
    }

    async fn update_event_instance(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
        _patch: &CalendarEventPatch,
    ) -> Result<GoogleInstanceUpdateOutcome, GoogleProviderError> {
        self.calls.lock().unwrap().push(format!(
            "instance-update:{master_provider_event_id}:{original_start}"
        ));
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(match self.behavior {
            FakeProviderBehavior::Gone => GoogleInstanceUpdateOutcome::SeriesGone,
            FakeProviderBehavior::OccurrenceGone => {
                GoogleInstanceUpdateOutcome::OccurrenceGone(Box::new(self.echo(&target.owner_id)))
            }
            _ => GoogleInstanceUpdateOutcome::Applied(Box::new(self.echo(&target.owner_id))),
        })
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

    async fn stop_watch_channel(
        &self,
        _access_token: &str,
        _email_link_id: Uuid,
        channel_id: &str,
        resource_id: &str,
    ) -> Result<(), GoogleProviderError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("stop:{channel_id}:{resource_id}"));
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
            _ => GoogleSeriesMutationOutcome::Applied(Box::new(self.echo(&target.owner_id))),
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
            _ => GoogleSeriesMutationOutcome::Applied(Box::new(self.echo(&target.owner_id))),
        })
    }

    async fn rsvp_event(
        &self,
        _access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        actor: &ActorInboxes,
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
        self.rsvp_self_emails
            .lock()
            .unwrap()
            .push(actor.iter().map(str::to_string).collect());
        if let Some(error) = self.fail() {
            return Err(error);
        }
        Ok(match self.behavior {
            FakeProviderBehavior::Gone => GoogleRsvpOutcome::Gone,
            FakeProviderBehavior::NotAttendee => GoogleRsvpOutcome::NotAttendee,
            _ => GoogleRsvpOutcome::Applied(Box::new(self.echo(&target.owner_id))),
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

/// One event captured off the broker.
#[derive(Clone, Debug)]
struct PublishedEvent {
    topic: &'static str,
    key: String,
    payload: serde_json::Value,
}

/// Records the calendar events a mutation published to the broker.
#[derive(Clone, Default)]
struct RecordingEventBroker {
    published: Arc<Mutex<Vec<PublishedEvent>>>,
    fail: bool,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            published: Default::default(),
            fail: true,
        }
    }

    fn published(&self) -> Vec<PublishedEvent> {
        self.published.lock().expect("broker lock").clone()
    }
}

impl macro_event_broker::MacroEventBroker for RecordingEventBroker {
    fn send_event<E: macro_event_broker::MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<
        tokio::task::JoinHandle<Result<(), macro_event_broker::EventBrokerError>>,
        macro_event_broker::EventBrokerError,
    > {
        if self.fail {
            return Err(macro_event_broker::EventBrokerError::Publish(
                "test failure".to_string(),
            ));
        }
        self.published
            .lock()
            .expect("broker lock")
            .push(PublishedEvent {
                topic: event.topic(),
                key: event.key().to_string(),
                payload: serde_json::to_value(event.event())?,
            });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn service(
    repo: FakeRepo,
    provider: FakeProvider,
    tokens: FakeTokens,
) -> CalendarMutationServiceImpl<FakeRepo, FakeProvider, FakeTokens, RecordingEventBroker> {
    CalendarMutationServiceImpl::new(repo, provider, tokens, RecordingEventBroker::default())
}

fn service_with_broker(
    repo: FakeRepo,
    provider: FakeProvider,
    tokens: FakeTokens,
    broker: RecordingEventBroker,
) -> CalendarMutationServiceImpl<FakeRepo, FakeProvider, FakeTokens, RecordingEventBroker> {
    CalendarMutationServiceImpl::new(repo, provider, tokens, broker)
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
async fn create_does_not_write_when_inbox_lookup_fails() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let repo = FakeRepo {
        creation_target: Some(creation_target(false)),
        fail_owned_inboxes: true,
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();

    let error = service(repo, provider, FakeTokens::ok())
        .create_event("macro|user", None, None, draft())
        .await
        .unwrap_err();

    assert!(matches!(error, CalendarMutationError::Retryable(_)));
    assert!(calls.lock().unwrap().is_empty());
    assert!(upserts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_returned_echo_marks_requester_inboxes_as_self() {
    let mut provider = FakeProvider::new(FakeProviderBehavior::Echo);
    provider.echo_attendees = vec![
        echo_attendee("jacob@example.com", true),
        echo_attendee("jackson@example.com", false),
    ];
    let created = service(
        FakeRepo {
            creation_target: Some(CalendarCreationTarget {
                actor: ActorInboxes::from_owned(vec!["jackson@example.com".to_string()]),
                ..creation_target(false)
            }),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .unwrap();

    assert!(!created.attendees[0].is_self);
    assert!(created.attendees[1].is_self);
}

#[tokio::test]
async fn create_publishes_created_when_the_row_was_inserted() {
    let applied_id = Uuid::now_v7();
    let repo = FakeRepo {
        creation_target: Some(creation_target(false)),
        persisted_event_id: Some(applied_id),
        write_change: CalendarEventChange::Created,
        ..FakeRepo::default()
    };
    let broker = RecordingEventBroker::default();
    service_with_broker(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
        broker.clone(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .unwrap();

    let published = broker.published();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.calendar");
    // Keyed by entity id: the consumer shards on the key, so every change to
    // one event must land on one partition to stay ordered.
    assert_eq!(event.key, applied_id.to_string());
    let metadata = &event.payload["calendar_event.created"];
    // The applied entity id, not the draft's — consumers read what persisted.
    assert_eq!(metadata["event_id"], serde_json::json!(applied_id));
    assert_eq!(
        metadata["owner_id"],
        serde_json::json!("macro|self@example.com")
    );
    assert_eq!(event.payload["schema_version"], serde_json::json!(1));
}

#[tokio::test]
async fn an_idempotent_create_that_hits_the_conflict_path_publishes_updated() {
    // The variant reports what happened to the row, not what the caller asked
    // for: replaying a create lands on the upsert's DO UPDATE.
    let applied_id = Uuid::now_v7();
    let repo = FakeRepo {
        creation_target: Some(creation_target(false)),
        persisted_event_id: Some(applied_id),
        write_change: CalendarEventChange::Updated,
        ..FakeRepo::default()
    };
    let broker = RecordingEventBroker::default();
    service_with_broker(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
        broker.clone(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .unwrap();

    let published = broker.published();
    assert_eq!(published.len(), 1);
    assert!(
        published[0].payload.get("calendar_event.updated").is_some(),
        "expected an updated event, got {:?}",
        published[0].payload
    );
}

#[tokio::test]
async fn a_write_that_changed_nothing_publishes_nothing() {
    // The upsert skips identical projections and rejects stale sequences.
    // Publishing those would flood the topic on a full provider snapshot.
    let repo = FakeRepo {
        creation_target: Some(creation_target(false)),
        persisted_event_id: Some(Uuid::now_v7()),
        write_change: CalendarEventChange::Unchanged,
        ..FakeRepo::default()
    };
    let broker = RecordingEventBroker::default();
    service_with_broker(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
        broker.clone(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .unwrap();

    assert!(
        broker.published().is_empty(),
        "an unchanged row must stay off the topic"
    );
}

#[tokio::test]
async fn deleting_a_series_publishes_deleted_per_removed_event() {
    // Retiring a recurring master's source also retires its expanded
    // instances, so every affected event announces its own fate — not just
    // the one the caller named.
    let master = Uuid::now_v7();
    let instance = Uuid::now_v7();
    let survivor = Uuid::now_v7();
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        retired_events: vec![
            RetiredCalendarEvent {
                event_id: master,
                owner_id: "macro|owner".to_string(),
                deleted: true,
            },
            RetiredCalendarEvent {
                event_id: instance,
                owner_id: "macro|owner".to_string(),
                deleted: true,
            },
            // Still backed by another source, so the row was rewritten.
            RetiredCalendarEvent {
                event_id: survivor,
                owner_id: "macro|owner".to_string(),
                deleted: false,
            },
        ],
        ..FakeRepo::default()
    };
    let broker = RecordingEventBroker::default();
    service_with_broker(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
        broker.clone(),
    )
    .delete_event("macro|user", master, CalendarDeletionScope::All)
    .await
    .unwrap();

    let published = broker.published();
    assert_eq!(published.len(), 3, "one event per affected entity");
    let variants: Vec<(String, &'static str)> = published
        .iter()
        .map(|event| {
            let variant = if event.payload.get("calendar_event.deleted").is_some() {
                "deleted"
            } else if event.payload.get("calendar_event.updated").is_some() {
                "updated"
            } else {
                "other"
            };
            (event.key.clone(), variant)
        })
        .collect();
    assert_eq!(
        variants,
        vec![
            (master.to_string(), "deleted"),
            (instance.to_string(), "deleted"),
            // A surviving row is an update, not a deletion.
            (survivor.to_string(), "updated"),
        ]
    );
}

#[tokio::test]
async fn a_failed_publish_does_not_fail_the_mutation() {
    // Google and the local projection are already updated by this point, so a
    // broker failure must cost index freshness rather than the write. The
    // search backfill re-enumerates from Postgres to recover.
    let applied_id = Uuid::now_v7();
    let repo = FakeRepo {
        creation_target: Some(creation_target(false)),
        persisted_event_id: Some(applied_id),
        ..FakeRepo::default()
    };
    let created = service_with_broker(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
        RecordingEventBroker::failing(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .expect("a publish failure must not fail the mutation");

    assert_eq!(created.id, applied_id);
}

#[tokio::test]
async fn a_rejected_mutation_publishes_nothing() {
    let broker = RecordingEventBroker::default();
    let svc = service_with_broker(
        FakeRepo::default(),
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
        broker.clone(),
    );
    assert!(
        svc.create_event("macro|user", None, None, draft())
            .await
            .is_err()
    );
    assert!(
        broker.published().is_empty(),
        "nothing persisted, so nothing to announce"
    );
}

#[tokio::test]
async fn create_includes_the_calendar_inbox_as_an_accepted_guest() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let drafts = provider.created_drafts.clone();
    service(
        FakeRepo {
            creation_target: Some(creation_target(false)),
            persisted_event_id: Some(Uuid::now_v7()),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .create_event("macro|user", None, None, draft())
    .await
    .unwrap();

    let sent = drafts.lock().unwrap();
    assert_eq!(sent.len(), 1);
    let organizer = sent[0]
        .attendees
        .iter()
        .find(|attendee| attendee.email.eq_ignore_ascii_case("self@example.com"))
        .expect("the creation-target inbox must be on the guest list");
    assert_eq!(
        organizer.response_status,
        Some(AttendeeResponseStatus::Accepted)
    );
    assert!(!organizer.is_optional);
    assert!(
        sent[0]
            .attendees
            .iter()
            .any(|attendee| attendee.email == "guest@example.com"),
        "invited guests must still be sent"
    );
}

#[tokio::test]
async fn create_does_not_duplicate_an_organizer_already_on_the_guest_list() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let drafts = provider.created_drafts.clone();
    let mut already_listed = draft();
    already_listed.attendees.push(CalendarAttendeeInput {
        email: "Self@example.com".to_string(),
        is_optional: true,
        response_status: None,
    });
    service(
        FakeRepo {
            creation_target: Some(creation_target(false)),
            persisted_event_id: Some(Uuid::now_v7()),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .create_event("macro|user", None, None, already_listed)
    .await
    .unwrap();

    let sent = drafts.lock().unwrap();
    let organizers: Vec<_> = sent[0]
        .attendees
        .iter()
        .filter(|attendee| attendee.email.eq_ignore_ascii_case("self@example.com"))
        .collect();
    assert_eq!(organizers.len(), 1);
    assert_eq!(
        organizers[0].response_status,
        Some(AttendeeResponseStatus::Accepted)
    );
}

#[tokio::test]
async fn create_collapses_duplicate_organizer_rows() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let drafts = provider.created_drafts.clone();
    let mut listed = draft();
    listed.attendees.push(CalendarAttendeeInput {
        email: "Self@example.com".to_string(),
        is_optional: true,
        response_status: None,
    });
    listed.attendees.push(CalendarAttendeeInput {
        email: "self@EXAMPLE.com".to_string(),
        is_optional: false,
        response_status: Some(AttendeeResponseStatus::NeedsAction),
    });
    service(
        FakeRepo {
            creation_target: Some(creation_target(false)),
            persisted_event_id: Some(Uuid::now_v7()),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .create_event("macro|user", None, None, listed)
    .await
    .unwrap();

    let sent = drafts.lock().unwrap();
    let organizers: Vec<_> = sent[0]
        .attendees
        .iter()
        .filter(|attendee| attendee.email.eq_ignore_ascii_case("self@example.com"))
        .collect();
    assert_eq!(organizers.len(), 1);
    assert_eq!(
        organizers[0].response_status,
        Some(AttendeeResponseStatus::Accepted)
    );
    assert!(
        sent[0]
            .attendees
            .iter()
            .any(|attendee| attendee.email == "guest@example.com")
    );
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
            .update_event(
                "macro|user",
                Uuid::now_v7(),
                CalendarEventPatch::default(),
                CalendarUpdateScope::All,
            )
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
            .update_event(
                "macro|user",
                Uuid::now_v7(),
                patch.clone(),
                CalendarUpdateScope::All,
            )
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
            .update_event(
                "macro|user",
                Uuid::now_v7(),
                patch.clone(),
                CalendarUpdateScope::All,
            )
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
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        patch,
        CalendarUpdateScope::All,
    )
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
        CalendarUpdateScope::All,
    )
    .await;

    assert!(matches!(result, Err(CalendarMutationError::NotFound)));
    let removed = removed.lock().unwrap();
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].2, "master-id");
}

#[tokio::test]
async fn occurrence_scoped_update_patches_the_instance_not_the_master() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            CalendarEventPatch {
                time: Some(timed_time()),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::ThisEvent {
                recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["instance-update:master-id:2026-08-18T20:00:00+00:00"],
        "an occurrence-scoped update must never patch the series master"
    );
    assert_eq!(upserts.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn occurrence_scoped_update_rejects_recurrence_changes() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let result = service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        CalendarEventPatch {
            recurrence_lines: Some(vec!["RRULE:FREQ=WEEKLY".to_string()]),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::ThisEvent {
            recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
        },
    )
    .await;

    assert!(matches!(
        result,
        Err(CalendarMutationError::InvalidInput(_))
    ));
    assert!(calls.lock().unwrap().is_empty());
}

/// The listed occurrence may be a phantom from a stale projection. Nothing
/// must be written, the caller must hear the target is gone, and the fresh
/// series echo must be persisted so the phantom disappears from listings.
#[tokio::test]
async fn occurrence_scoped_update_on_a_vanished_occurrence_persists_the_refresh_and_errors() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
    let removed = repo.removed_sources.clone();
    let result = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::OccurrenceGone),
        FakeTokens::ok(),
    )
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        CalendarEventPatch {
            time: Some(timed_time()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::ThisEvent {
            recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
        },
    )
    .await;

    assert!(matches!(
        result,
        Err(CalendarMutationError::OccurrenceNotFound)
    ));
    assert_eq!(
        upserts.lock().unwrap().len(),
        1,
        "the provider's fresh view of the series converges the stale projection"
    );
    assert!(removed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn occurrence_scoped_update_on_a_vanished_series_retires_the_source() {
    let repo = FakeRepo {
        mutation_target: Some(mutation_target(false)),
        ..FakeRepo::default()
    };
    let upserts = repo.upserts.clone();
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
        CalendarUpdateScope::ThisEvent {
            recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
        },
    )
    .await;

    assert!(matches!(result, Err(CalendarMutationError::NotFound)));
    assert!(upserts.lock().unwrap().is_empty());
    assert_eq!(removed.lock().unwrap().len(), 1);
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
async fn rsvp_addresses_the_requester_inbox_not_the_source_calendar() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let emails = provider.rsvp_self_emails.clone();
    let mut target = mutation_target(false);
    target.actor = ActorInboxes::from_owned(vec!["jackson@example.com".to_string()]);
    service(
        FakeRepo {
            mutation_target: Some(target),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .respond_to_event(
        "macro|user",
        Uuid::now_v7(),
        AttendeeResponseStatus::Accepted,
        CalendarRsvpScope::All,
    )
    .await
    .unwrap();

    assert_eq!(
        emails.lock().unwrap().as_slice(),
        [vec!["jackson@example.com".to_string()]]
    );
}

#[tokio::test]
async fn rsvp_through_a_delegated_inbox_never_hands_the_subject_email_to_the_provider() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let emails = provider.rsvp_self_emails.clone();
    let mut target = mutation_target(false);
    target.token_identity = CalendarLinkTokenIdentity {
        fusionauth_user_id: "fusion-jacob".to_string(),
        email_address: "jacob@example.com".to_string(),
        provider: "GMAIL".to_string(),
    };
    target.actor = ActorInboxes::from_owned(vec!["jackson@example.com".to_string()]);
    service(
        FakeRepo {
            mutation_target: Some(target),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .respond_to_event(
        "macro|user",
        Uuid::now_v7(),
        AttendeeResponseStatus::Accepted,
        CalendarRsvpScope::All,
    )
    .await
    .unwrap();

    let recorded = emails.lock().unwrap();
    assert_eq!(recorded.len(), 1);
    assert!(
        recorded[0]
            .iter()
            .any(|email| email == "jackson@example.com")
    );
    assert!(!recorded[0].iter().any(|email| email == "jacob@example.com"));
}

#[tokio::test]
async fn rsvp_through_a_delegated_inbox_without_an_own_inbox_is_not_attendee_before_any_provider_call()
 {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let mut target = mutation_target(false);
    target.actor = None;
    let error = service(
        FakeRepo {
            mutation_target: Some(target),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .respond_to_event(
        "macro|user",
        Uuid::now_v7(),
        AttendeeResponseStatus::Accepted,
        CalendarRsvpScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::NotAttendee));
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rsvp_echo_marks_actor_inboxes_as_self() {
    let mut provider = FakeProvider::new(FakeProviderBehavior::Echo);
    provider.echo_attendees = vec![
        echo_attendee("jacob@example.com", true),
        echo_attendee("self@example.com", false),
    ];
    let event = service(
        FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .respond_to_event(
        "macro|user",
        Uuid::now_v7(),
        AttendeeResponseStatus::Accepted,
        CalendarRsvpScope::All,
    )
    .await
    .unwrap();

    assert!(!event.attendees[0].is_self);
    assert!(event.attendees[1].is_self);
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

/// Attaching or detaching a conference is a complete edit on its own, so a
/// patch carrying only a conference change must not be rejected as empty.
#[test]
fn a_conference_only_patch_is_not_empty() {
    for change in [ConferenceChange::GoogleMeet, ConferenceChange::Removed] {
        assert!(
            !CalendarEventPatch {
                conference: Some(change),
                ..CalendarEventPatch::default()
            }
            .is_empty()
        );
    }
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

/// A third-party conference is replaced or detached like any other once the
/// request is explicit: the caller asked, and deleting the event outright —
/// which Macro already allows — destroys strictly more. What protects such a
/// conference is that omitting the field leaves it untouched, covered below.
#[tokio::test]
async fn conference_changes_reach_the_provider_for_any_conference() {
    for change in [ConferenceChange::GoogleMeet, ConferenceChange::Removed] {
        let repo = FakeRepo {
            mutation_target: Some(mutation_target(false)),
            ..FakeRepo::default()
        };
        let provider = FakeProvider::new(FakeProviderBehavior::Echo);
        let calls = provider.calls.clone();
        let result = service(repo, provider, FakeTokens::ok())
            .update_event(
                "macro|user",
                Uuid::now_v7(),
                CalendarEventPatch {
                    conference: Some(change),
                    ..CalendarEventPatch::default()
                },
                CalendarUpdateScope::All,
            )
            .await;

        assert!(result.is_ok(), "{change:?} failed: {result:?}");
        assert_eq!(calls.lock().unwrap().as_slice(), ["update:master-id"]);
    }
}

fn disconnected(channels: &[(&str, &str)]) -> DisconnectedGoogleCalendar {
    DisconnectedGoogleCalendar {
        token_identity: token_identity(),
        watch_channels: channels
            .iter()
            .map(|(channel_id, resource_id)| CalendarWatchRelease {
                channel_id: (*channel_id).to_string(),
                resource_id: (*resource_id).to_string(),
            })
            .collect(),
    }
}

#[tokio::test]
async fn disconnecting_calendar_closes_every_open_watch_channel() {
    let link_id = Uuid::now_v7();
    let repo = FakeRepo {
        disconnected: Some(disconnected(&[
            ("channel-a", "resource-a"),
            ("channel-b", "resource-b"),
        ])),
        ..FakeRepo::default()
    };
    let requests = repo.disconnect_requests.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .disconnect_calendar("macro|user", link_id)
        .await
        .unwrap();

    assert_eq!(
        requests.lock().unwrap().as_slice(),
        [("macro|user".to_string(), link_id)]
    );
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        [
            "stop:channel-a:resource-a".to_string(),
            "stop:channel-b:resource-b".to_string()
        ]
    );
}

/// The local removal has already committed by the time channels are closed, so
/// a provider or token failure must not report the disconnect as failed — the
/// stale channel resolves to no watch target and expires on its own.
#[tokio::test]
async fn disconnecting_calendar_survives_a_provider_that_cannot_close_channels() {
    let repo = FakeRepo {
        disconnected: Some(disconnected(&[("channel-a", "resource-a")])),
        ..FakeRepo::default()
    };
    let provider = FakeProvider::new(FakeProviderBehavior::Fail(
        GoogleProviderErrorKind::Transient,
    ));
    assert!(
        service(repo.clone(), provider, FakeTokens::ok())
            .disconnect_calendar("macro|user", Uuid::now_v7())
            .await
            .is_ok()
    );

    let unreachable_token = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = unreachable_token.calls.clone();
    assert!(
        service(repo, unreachable_token, FakeTokens::reauth())
            .disconnect_calendar("macro|user", Uuid::now_v7())
            .await
            .is_ok()
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disconnecting_an_inbox_the_requester_does_not_own_is_not_found() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    assert!(matches!(
        service(FakeRepo::default(), provider, FakeTokens::ok())
            .disconnect_calendar("macro|other", Uuid::now_v7())
            .await,
        Err(CalendarMutationError::NotFound)
    ));
    assert!(calls.lock().unwrap().is_empty());
}
