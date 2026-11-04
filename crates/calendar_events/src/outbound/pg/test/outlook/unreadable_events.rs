//! `OutlookCalendarSync` against real checkpoints: one event Macro cannot read
//! never stops a scan, and no other failure is skipped.
use super::*;
use crate::domain::models::ProviderCalendarTarget;
use crate::domain::outlook::automatic_decline::{
    AutomaticDeclineProvider, AwayOccurrence, AwaySubmissionOutcome,
};
use crate::domain::ports::{
    CalendarAccessTokenProvider, CalendarProviderError, CalendarRefreshNotifier, CalendarTokenError,
};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

const UNREADABLE: &str = "a-unreadable";
const READABLE: &str = "b-readable";
const FIELD: &str = "recurrence.range.recurrenceTimeZone";

fn unreadable() -> CalendarProviderError {
    CalendarProviderError::unreadable_event(FIELD, "Microsoft returned an invalid response")
}

/// What Graph answers for an event id; an absent id is an event that reads fine.
type Failures = Arc<Mutex<BTreeMap<&'static str, fn() -> CalendarProviderError>>>;

#[derive(Clone, Default)]
struct FakeGraph {
    failures: Failures,
}

impl FakeGraph {
    fn fail(&self, id: &'static str, failure: fn() -> CalendarProviderError) {
        self.failures.lock().unwrap().insert(id, failure);
    }

    fn heal(&self, id: &'static str) {
        self.failures.lock().unwrap().remove(id);
    }
}

impl OutlookCalendarReader for FakeGraph {
    async fn calendars(
        &self,
        _token: &str,
        _binding: CalendarGrantBinding,
    ) -> Result<Vec<OutlookCalendar>, CalendarProviderError> {
        Ok(vec![discovered_calendar("primary")])
    }

    async fn calendar_page(
        &self,
        _token: &str,
        _target: &ProviderCalendarTarget,
        _primary: bool,
        _cursor: Option<&str>,
    ) -> Result<OutlookCalendarPage, CalendarProviderError> {
        Ok(OutlookCalendarPage {
            members: vec![
                (UNREADABLE.into(), UNREADABLE.into()),
                (READABLE.into(), READABLE.into()),
            ],
            removed: vec![],
            next: None,
            delta: Some("delta-cursor".into()),
        })
    }

    async fn refresh_calendar_event(
        &self,
        _token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        if let Some(failure) = self.failures.lock().unwrap().get(id) {
            return Err(failure());
        }
        let mut upsert = timed_upsert(
            &target.owner_id,
            target.email_link_id,
            (target.account_id, target.calendar_id),
            id,
            "Outlook meeting",
            0,
        );
        let mut source = upsert.source.details().clone();
        source.binding = target.binding;
        source.observed_access_role = target.observed_access_role.clone();
        source.provider_event_id = id.into();
        upsert.source = CalendarEventSource::Outlook(source);
        upsert.event.is_read_only = false;
        Ok(Some(upsert))
    }
}

impl AutomaticDeclineProvider for FakeGraph {
    async fn away_occurrence(
        &self,
        _token: &str,
        _target: &ProviderCalendarTarget,
        _id: &str,
        _recurrence: Option<&str>,
    ) -> Result<Option<AwayOccurrence>, CalendarProviderError> {
        Ok(None)
    }

    async fn decline_away_invitation(
        &self,
        _token: &str,
        _target: &ProviderCalendarTarget,
        _invitation: &str,
        _comment: Option<&str>,
    ) -> Result<AwaySubmissionOutcome, CalendarProviderError> {
        Ok(AwaySubmissionOutcome::Submitted)
    }
}

struct FixedToken;

impl CalendarAccessTokenProvider for FixedToken {
    async fn fetch_access_token(
        &self,
        _identity: &CalendarLinkTokenIdentity,
    ) -> Result<String, CalendarTokenError> {
        Ok("token".into())
    }
}

struct NoOpenClients;

impl CalendarRefreshNotifier for NoOpenClients {
    async fn calendar_changed(
        &self,
        _owner_id: &str,
        _email_link_id: Uuid,
        _team_ooo_changed: bool,
    ) {
    }

    async fn join_request_answered(&self, _requester_id: &str, _event_id: Uuid) {}
}

type Sync = OutlookCalendarSync<PgCalendarRepository, FakeGraph, FixedToken, NoOpenClients>;

/// Discover the calendar and load its first page, so its two events are pending.
async fn loaded_scan(pool: &PgPool) -> (Sync, FakeGraph) {
    let (repo, _, _) = mailbox(pool).await;
    let graph = FakeGraph::default();
    let sync = OutlookCalendarSync::new(repo, graph.clone(), FixedToken, NoOpenClients);
    assert!(sync.run_once().await.unwrap(), "discovery");
    assert!(sync.run_once().await.unwrap(), "first page");
    (sync, graph)
}

struct ScanState {
    pending_ids: Vec<String>,
    full_scan: bool,
    attempts: i32,
    synced: bool,
    sync_error: Option<String>,
    failures: i32,
    account_status: String,
    stored_events: Vec<String>,
}

async fn scan_state(pool: &PgPool) -> ScanState {
    let row = sqlx::query!(
        r#"SELECT w.pending_ids,w.full_scan,w.attempts,c.id AS calendar_id,c.synced_at IS NOT NULL AS "synced!",c.last_sync_error,c.consecutive_sync_failures,a.sync_status
        FROM calendar_outlook_work w JOIN calendars c ON c.id=w.calendar_id JOIN calendar_accounts a ON a.id=w.account_id"#
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let stored_events = sqlx::query_scalar!(
        r#"SELECT provider_event_id AS "provider_event_id!" FROM calendar_event_sources WHERE calendar_id=$1 ORDER BY provider_event_id"#,
        row.calendar_id
    )
    .fetch_all(pool)
    .await
    .unwrap();
    ScanState {
        pending_ids: row.pending_ids,
        full_scan: row.full_scan,
        attempts: row.attempts,
        synced: row.synced,
        sync_error: row.last_sync_error,
        failures: row.consecutive_sync_failures,
        account_status: row.sync_status,
        stored_events,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unreadable_event_no_longer_blocks_the_scan_from_completing(pool: PgPool) {
    let (sync, graph) = loaded_scan(&pool).await;
    graph.fail(UNREADABLE, unreadable);
    assert_eq!(
        scan_state(&pool).await.pending_ids,
        [UNREADABLE, READABLE],
        "the unreadable event is first, so it would hold back the other"
    );

    assert!(sync.run_once().await.unwrap());
    let skipped = scan_state(&pool).await;
    assert_eq!(skipped.pending_ids, [READABLE]);
    assert_eq!(skipped.attempts, 0);
    assert!(skipped.sync_error.is_none());

    assert!(sync.run_once().await.unwrap());
    assert!(sync.run_once().await.unwrap());

    let finished = scan_state(&pool).await;
    assert!(finished.pending_ids.is_empty());
    assert!(finished.synced);
    assert!(!finished.full_scan);
    assert_eq!(finished.failures, 0);
    assert_eq!(finished.account_status, "ready");
    assert_eq!(finished.stored_events, [READABLE]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_full_scan_keeps_the_stored_copy_of_an_event_it_can_no_longer_read(pool: PgPool) {
    let (sync, graph) = loaded_scan(&pool).await;
    for step in ["first event", "second event", "finish"] {
        assert!(sync.run_once().await.unwrap(), "{step}");
    }
    assert_eq!(
        scan_state(&pool).await.stored_events,
        [UNREADABLE, READABLE]
    );

    // The event turns unreadable before a full scan that could retire it.
    graph.fail(UNREADABLE, unreadable);
    sqlx::query!("UPDATE calendar_outlook_work SET cursor=NULL,page_cursor=NULL,full_scan=true,scan_id=$1,next_run_at=now() WHERE calendar_id IS NOT NULL",Uuid::now_v7())
        .execute(&pool)
        .await
        .unwrap();
    for step in ["page", "skip", "readable event", "finish"] {
        assert!(sync.run_once().await.unwrap(), "{step}");
    }

    let finished = scan_state(&pool).await;
    assert!(finished.pending_ids.is_empty());
    assert!(!finished.full_scan);
    assert_eq!(finished.stored_events, [UNREADABLE, READABLE]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_failures_keep_the_event_pending_and_report_the_calendar(pool: PgPool) {
    let cases: [(fn() -> CalendarProviderError, _); 3] = [
        (
            || {
                CalendarProviderError::new(
                    CalendarProviderErrorKind::Permanent,
                    "Microsoft calendar request failed",
                )
            },
            "Microsoft could not synchronize this calendar",
        ),
        (
            || {
                CalendarProviderError::new(
                    CalendarProviderErrorKind::Transient,
                    "Microsoft calendar request failed",
                )
            },
            "Microsoft calendar synchronization will retry",
        ),
        (
            || {
                CalendarProviderError::new(
                    CalendarProviderErrorKind::ReauthRequired,
                    "Microsoft calendar request failed",
                )
            },
            "Reconnect Microsoft calendar",
        ),
    ];
    let (sync, graph) = loaded_scan(&pool).await;

    for (attempt, (failure, message)) in cases.into_iter().enumerate() {
        graph.fail(UNREADABLE, failure);
        sqlx::query!(
            "UPDATE calendar_outlook_work SET next_run_at=now() WHERE calendar_id IS NOT NULL"
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(sync.run_once().await.is_err(), "{message}");

        let state = scan_state(&pool).await;
        assert_eq!(state.pending_ids, [UNREADABLE, READABLE], "{message}");
        assert_eq!(state.sync_error.as_deref(), Some(message));
        assert_eq!(state.attempts, i32::try_from(attempt).unwrap() + 1);
    }

    // The same event reads once the provider recovers: nothing was lost.
    graph.heal(UNREADABLE);
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE calendar_id IS NOT NULL"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("UPDATE calendar_accounts SET sync_status='ready'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(sync.run_once().await.unwrap());
    assert_eq!(scan_state(&pool).await.pending_ids, [READABLE]);
}
