use super::*;
use crate::domain::models::{
    GOOGLE_CALENDAR_SCOPES, GoogleCalendarSyncSnapshot, GoogleEventSource, GoogleWatchChannel,
    REMINDER_METHOD_EMAIL, REMINDER_METHOD_POPUP,
};
use crate::domain::ports::GoogleCalendarSyncRepository;
use crate::domain::service::GoogleCalendarBackfillFailureService;
use chrono::{Duration, SubsecRound, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn complete_grant() -> GoogleScopeSet {
    GoogleScopeSet::parse(&GOOGLE_CALENDAR_SCOPES.join(" "))
}

async fn persist_complete_grant(pool: &PgPool, link_id: Uuid, grant_version: i64) {
    let scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
    sqlx::query!(
        r#"
        INSERT INTO email_link_google_scopes (link_id, granted_scopes, grant_version)
        VALUES ($1, $2, $3)
        ON CONFLICT (link_id) DO UPDATE
        SET granted_scopes = EXCLUDED.granted_scopes,
            grant_version = EXCLUDED.grant_version,
            updated_at = now()
        "#,
        link_id,
        &scopes,
        grant_version,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_link(pool: &PgPool, owner_id: &str) -> Uuid {
    let id = Uuid::now_v7();
    let email_address = format!("calendar-{id}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        id,
        owner_id,
        email_address,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    let stripe_customer_id = format!("cus_{macro_user_id}");
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
        macro_user_id,
        id,
        id,
        stripe_customer_id,
    )
    .execute(pool)
    .await
    .unwrap();
    let email = id.rsplit_once('|').map(|(_, email)| email).unwrap_or(id);
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
        id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Provision the account and calendar every event source now requires.
async fn provider_ids(repo: &PgCalendarRepository, link_id: Uuid) -> (Uuid, Uuid) {
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "primary".to_string(),
                name: "Primary".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: true,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();
    (account_id, calendar_id)
}

fn timed_upsert(
    owner_id: &str,
    link_id: Uuid,
    provider: (Uuid, Uuid),
    uid: &str,
    title: &str,
    sequence: u32,
) -> CalendarEventUpsert {
    let (account_id, calendar_id) = provider;
    let id = Uuid::now_v7();
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let ends_at = starts_at + Duration::hours(1);
    let second_start = starts_at + Duration::days(1);
    CalendarEventUpsert {
        event: CalendarEvent {
            id,
            owner_id: owner_id.to_string(),
            ical_uid: uid.to_string(),
            calendar_id: Some(calendar_id),
            title: title.to_string(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            event_type: EventType::Default,
            time: EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: Some("UTC".to_string()),
            },
            recurrence_lines: vec!["RRULE:FREQ=DAILY;COUNT=2".to_string()],
            organizer_email: Some("organizer@example.com".to_string()),
            organizer_name: Some("Organizer".to_string()),
            creator_email: Some("creator@example.com".to_string()),
            creator_name: Some("Creator".to_string()),
            conference_url: None,
            conference_provider: None,
            sequence,
            is_read_only: true,
            attendees: vec![CalendarAttendee {
                email: "guest@example.com".to_string(),
                display_name: Some("Guest".to_string()),
                response_status: AttendeeResponseStatus::Accepted,
                is_organizer: false,
                is_optional: false,
                is_self: false,
                comment: None,
            }],
            reminders: EventReminders::default(),
            created_at: starts_at,
            updated_at: starts_at + Duration::minutes(i64::from(sequence)),
        },
        source: CalendarEventSource::Google(GoogleEventSource {
            email_link_id: link_id,
            account_id,
            calendar_id,
            provider_event_id: format!("provider-{uid}"),
            provider_recurring_event_id: None,
            provider_etag: None,
            raw_payload: serde_json::json!({}),
        }),
        overrides: Vec::new(),
        occurrences: vec![
            CalendarOccurrence {
                event_id: id,
                occurrence_key: starts_at.to_rfc3339(),
                recurrence_id: None,
                time: EventTime::Timed {
                    starts_at,
                    ends_at,
                    time_zone: Some("UTC".to_string()),
                },
                is_cancelled: false,
            },
            CalendarOccurrence {
                event_id: id,
                occurrence_key: second_start.to_rfc3339(),
                recurrence_id: None,
                time: EventTime::Timed {
                    starts_at: second_start,
                    ends_at: second_start + Duration::hours(1),
                    time_zone: Some("UTC".to_string()),
                },
                is_cancelled: false,
            },
        ],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn applying_grant_recreates_missing_side_table_state_from_version_zero(pool: PgPool) {
    let link_id = insert_link(&pool, "macro|calendar-missing-grant@example.com").await;
    let sentinel_updated_at = Utc.with_ymd_and_hms(2020, 1, 2, 3, 4, 5).unwrap();
    sqlx::query!(
        "UPDATE email_links SET updated_at = $2 WHERE id = $1",
        link_id,
        sentinel_updated_at,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM email_link_google_scopes WHERE link_id = $1",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let grant = PgCalendarRepository::new(pool.clone())
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(grant.changed);
    assert_eq!(grant.grant_version, 1);

    let persisted = sqlx::query!(
        r#"
        SELECT
            l.updated_at AS "link_updated_at!",
            g.granted_scopes AS "side_scopes!",
            g.grant_version AS "side_version!"
        FROM email_links l
        JOIN email_link_google_scopes g ON g.link_id = l.id
        WHERE l.id = $1
        "#,
        link_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persisted.link_updated_at, sentinel_updated_at);
    assert_eq!(
        GoogleScopeSet::from_scopes(persisted.side_scopes),
        complete_grant()
    );
    assert_eq!(persisted.side_version, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_capability_transition_schedules_once_and_failed_jobs_can_retry(pool: PgPool) {
    let owner_id = "macro|calendar@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());

    let partial = repo
        .apply_google_grant(
            link_id,
            GoogleScopeSet::parse("https://www.googleapis.com/auth/gmail.modify"),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(partial.changed);
    assert!(partial.jobs.is_empty());

    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(enabled.changed);
    assert_eq!(enabled.jobs.len(), 1);

    let duplicate = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(!duplicate.changed);
    assert!(duplicate.jobs.is_empty());

    let failed_job = enabled.jobs[0].id;
    sqlx::query!(
        "UPDATE calendar_backfill_jobs SET status = 'failed' WHERE id = $1",
        failed_job
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendar_sync_outbox SET published_at = now() WHERE backfill_job_id = $1",
        failed_job
    )
    .execute(&pool)
    .await
    .unwrap();

    let retried = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(!retried.changed);
    assert_eq!(retried.jobs.len(), 1);
    assert_eq!(retried.jobs[0].id, failed_job);

    let status = sqlx::query_scalar!(
        "SELECT status FROM calendar_backfill_jobs WHERE id = $1",
        failed_job
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let published_at = sqlx::query_scalar!(
        "SELECT published_at FROM calendar_sync_outbox WHERE backfill_job_id = $1",
        failed_job
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "pending");
    assert!(published_at.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_calendar_scope_disables_sources_and_fences_the_running_job(pool: PgPool) {
    let owner_id = "macro|calendar-downgrade@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let google_job = enabled
        .jobs
        .iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let account_id = google_job.account_id.unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    let calendar_id = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            ProviderCalendar {
                provider_calendar_id: "primary".to_string(),
                name: "Primary".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: true,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap()
        .id;
    let mut google = timed_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "downgrade@example.com",
        "Removed with scope",
        1,
    );
    google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "provider-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: None,
        raw_payload: serde_json::json!({}),
    });
    let event_id = repo
        .upsert_event(CalendarEventWrite::GoogleBackfill {
            key,
            lease_token,
            upsert: google,
        })
        .await
        .unwrap()
        .event_id;

    let downgraded = repo
        .apply_google_grant(
            link_id,
            GoogleScopeSet::parse("https://www.googleapis.com/auth/gmail.modify"),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(downgraded.changed);
    assert!(downgraded.jobs.is_empty());

    let state = sqlx::query!(
        r#"
        SELECT
            account.sync_status,
            calendar.is_deleted,
            google_job.status AS google_job_status,
            google_job.lease_token,
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $3) AS "source_count!",
            (SELECT count(*) FROM calendar_events WHERE id = $3) AS "event_count!"
        FROM calendar_accounts account
        JOIN calendars calendar ON calendar.account_id = account.id
        JOIN calendar_backfill_jobs google_job ON google_job.id = $2
        WHERE account.id = $1
        "#,
        account_id,
        google_job.id,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state.sync_status, "disabled");
    assert!(state.is_deleted);
    assert_eq!(state.google_job_status, "failed");
    assert!(state.lease_token.is_none());
    assert_eq!(state.source_count, 0);
    assert_eq!(state.event_count, 0);
    assert!(matches!(
        repo.claim_google_backfill(key).await.unwrap(),
        CalendarBackfillClaim::Failed
    ));

    let reenabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert_eq!(reenabled.jobs.len(), 1);
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT sync_status FROM calendar_accounts WHERE id = $1"#,
            account_id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "pending"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completed_google_job_is_rearmed_and_reuses_calendar_sync_state(pool: PgPool) {
    let owner_id = "macro|calendar-periodic@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let account_id = google_job.account_id.unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    let provider_calendar = ProviderCalendar {
        provider_calendar_id: "primary".to_string(),
        name: "Primary".to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some("owner".to_string()),
        is_primary: true,
        is_selected: true,
        default_reminders: Vec::new(),
    };
    let calendar_id = repo
        .upsert_google_calendar(key, lease_token, account_id, provider_calendar.clone())
        .await
        .unwrap()
        .id;
    // Postgres stores timestamptz at microsecond precision, so the
    // round-tripped range only compares equal from a truncated instant.
    let range = OccurrenceRange::historical_sync(Utc::now().trunc_subsecs(6));
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "next-sync-token".to_string(),
            observed_provider_event_ids: Some(Vec::new()),
            materialized_range: Some(range.clone()),
            cancelled_provider_event_ids: Vec::new(),
        },
        3,
    )
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT extracted_count FROM calendar_backfill_jobs WHERE id = $1"#,
            key.job_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        3
    );
    repo.reconcile_google_calendar_list(key, lease_token, account_id, vec![calendar_id])
        .await
        .unwrap();
    repo.complete_google_backfill(key, lease_token)
        .await
        .unwrap();
    sqlx::query!(
        r#"
        UPDATE calendar_accounts
        SET last_synced_at = now() - interval '10 minutes'
        WHERE id = $1
        "#,
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.schedule_due_google_syncs(Utc::now() - Duration::minutes(5))
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        repo.schedule_due_google_syncs(Utc::now() - Duration::minutes(5))
            .await
            .unwrap(),
        0
    );
    let CalendarBackfillClaim::Claimed {
        lease_token: next_lease,
        ..
    } = repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("scheduled Google job should be claimable");
    };
    let stored = repo
        .upsert_google_calendar(key, next_lease, account_id, provider_calendar)
        .await
        .unwrap();
    assert_eq!(stored.sync_token.as_deref(), Some("next-sync-token"));
    assert_eq!(stored.materialized_range, Some(range));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn google_claim_rejects_a_job_without_its_grant_provisioned_account(pool: PgPool) {
    let link_id = insert_link(&pool, "macro|calendar-invalid-job@example.com").await;
    let job_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO calendar_backfill_jobs (
            id, email_link_id, kind, grant_version, status
        )
        VALUES ($1, $2, 'google_calendar', 1, 'pending')
        "#,
        job_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let result = PgCalendarRepository::new(pool.clone())
        .claim_google_backfill(CalendarBackfillJobKey {
            job_id,
            email_link_id: link_id,
        })
        .await;
    assert!(result.is_err());

    let state = sqlx::query!(
        r#"
        SELECT status, lease_token
        FROM calendar_backfill_jobs
        WHERE id = $1
        "#,
        job_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state.status, "pending");
    assert!(state.lease_token.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn canonical_precedence_uses_the_selected_source_clock(pool: PgPool) {
    let owner_id = "macro|calendar-source-clock@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let source_clock = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let later_clock = source_clock + Duration::hours(3);
    let winning_clock = source_clock + Duration::hours(2);

    repo.apply_google_grant(
        link_id,
        complete_grant(),
        CalendarGrantIntent::CalendarRequested,
    )
    .await
    .unwrap();
    let provider = provider_ids(&repo, link_id).await;

    let mut first = timed_upsert(
        owner_id,
        link_id,
        provider,
        "source-clock@example.com",
        "Earlier sequence, later clock",
        1,
    );
    first.event.updated_at = later_clock;
    let event_id = repo.upsert_event_fixture(first).await.unwrap();

    // A higher sequence wins regardless of clock, so the canonical clock moves
    // backwards while the entity's own updated_at keeps the latest it has seen.
    let mut second = timed_upsert(
        owner_id,
        link_id,
        provider,
        "source-clock@example.com",
        "Later sequence, earlier clock",
        2,
    );
    second.event.updated_at = winning_clock;
    repo.upsert_event_fixture(second).await.unwrap();

    let canonical = sqlx::query!(
        r#"
        SELECT title, canonical_source_updated_at, updated_at
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(canonical.title, "Later sequence, earlier clock");
    assert_eq!(canonical.canonical_source_updated_at, winning_clock);
    assert_eq!(canonical.updated_at, later_clock);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fenced_google_snapshot_removes_deleted_events_and_calendars(pool: PgPool) {
    let owner_id = "macro|calendar-snapshot@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "removed-calendar".to_string(),
                name: "Removed Calendar".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: false,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();
    let mut google = timed_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "deleted-google-event@example.com",
        "Deleted Google event",
        1,
    );
    google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "deleted-provider-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"old\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    let event_id = repo.upsert_event_fixture(google).await.unwrap();
    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed {
        lease_token,
        account_id: claimed_account_id,
    } = repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    assert_eq!(claimed_account_id, account_id);
    assert!(
        repo.reconcile_google_calendar_list(key, Uuid::new_v4(), account_id, Vec::new())
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM calendar_events WHERE id = $1"#,
            event_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );

    repo.reconcile_google_calendar_list(key, lease_token, account_id, Vec::new())
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM calendar_events WHERE id = $1"#,
            event_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert!(
        sqlx::query_scalar!(
            r#"SELECT is_deleted AS "is_deleted!" FROM calendars WHERE id = $1"#,
            calendar_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );

    let outside_start = Utc.with_ymd_and_hms(2026, 8, 2, 0, 0, 0).unwrap();
    let outside_end = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
    let occurrences = repo
        .list_occurrences(
            owner_id,
            OccurrenceRange {
                starts_at: outside_start,
                ends_at: outside_end,
                start_date: outside_start.date_naive(),
                end_date: outside_end.date_naive(),
            },
            None,
            100,
        )
        .await
        .unwrap();
    assert!(occurrences.is_empty());
    assert_eq!(
        repo.sync_status(owner_id).await.unwrap(),
        CalendarSyncStatus::Syncing
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_google_worker_cannot_resurrect_reconciled_provider_data(pool: PgPool) {
    let owner_id = "macro|calendar-stale-worker@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed {
        lease_token: stale_lease,
        ..
    } = repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    let provider_calendar = ProviderCalendar {
        provider_calendar_id: "primary".to_string(),
        name: "Primary".to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some("owner".to_string()),
        is_primary: true,
        is_selected: true,
        default_reminders: Vec::new(),
    };
    let calendar_id = repo
        .upsert_google_calendar(key, stale_lease, account_id, provider_calendar.clone())
        .await
        .unwrap()
        .id;
    let mut google = timed_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "stale-worker@example.com",
        "Stale worker event",
        1,
    );
    google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "stale-worker-provider-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"stale\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    repo.upsert_event(CalendarEventWrite::GoogleBackfill {
        key,
        lease_token: stale_lease,
        upsert: google.clone(),
    })
    .await
    .unwrap()
    .event_id;

    sqlx::query!(
        r#"
        UPDATE calendar_backfill_jobs
        SET lease_expires_at = now() - interval '1 second'
        WHERE id = $1
        "#,
        key.job_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let CalendarBackfillClaim::Claimed {
        lease_token: current_lease,
        ..
    } = repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("expired Google job should be reclaimable");
    };
    repo.reconcile_google_calendar_list(key, current_lease, account_id, Vec::new())
        .await
        .unwrap();
    repo.complete_google_backfill(key, current_lease)
        .await
        .unwrap();

    assert!(
        repo.mark_google_account_syncing(key, stale_lease)
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT sync_status FROM calendar_accounts WHERE id = $1"#,
            account_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "ready"
    );
    assert!(
        repo.upsert_google_calendar(key, stale_lease, account_id, provider_calendar)
            .await
            .is_err()
    );
    assert!(
        repo.upsert_event(CalendarEventWrite::GoogleBackfill {
            key,
            lease_token: stale_lease,
            upsert: google,
        })
        .await
        .is_err()
    );
    assert!(
        sqlx::query_scalar!(
            r#"SELECT is_deleted AS "is_deleted!" FROM calendars WHERE id = $1"#,
            calendar_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "count!"
            FROM calendar_events
            WHERE owner_id = $1
              AND ical_uid = 'stale-worker@example.com'
            "#,
            owner_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn google_snapshot_deletion_removes_an_event_without_a_surviving_source(pool: PgPool) {
    let owner_id = "macro|calendar-source-fallback@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let (account_id, calendar_id) = provider_ids(&repo, link_id).await;
    let mut google = timed_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "fallback@example.com",
        "Google canonical",
        2,
    );
    google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "google-fallback-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"etag\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    let event_id = repo.upsert_event_fixture(google).await.unwrap();

    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "next".to_string(),
            observed_provider_event_ids: Some(Vec::new()),
            materialized_range: Some(OccurrenceRange::historical_sync(Utc::now())),
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    repo.reconcile_google_calendar_list(key, lease_token, account_id, vec![calendar_id])
        .await
        .unwrap();

    let remaining = sqlx::query!(
        r#"
        SELECT
            (SELECT count(*) FROM calendar_events WHERE id = $1) AS "event_count!",
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1) AS "source_count!"
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((remaining.event_count, remaining.source_count), (0, 0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn incremental_cancellation_tombstones_retire_sources_without_a_snapshot(pool: PgPool) {
    let owner_id = "macro|calendar-tombstone@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let (account_id, calendar_id) = provider_ids(&repo, link_id).await;
    let mut google = timed_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "tombstone@example.com",
        "Google canonical",
        2,
    );
    google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "cancelled-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"etag\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    let event_id = repo.upsert_event_fixture(google).await.unwrap();
    let mut instance = timed_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "cancelled-series@example.com",
        "Series instance",
        1,
    );
    instance.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "series-instance".to_string(),
        provider_recurring_event_id: Some("cancelled-master".to_string()),
        provider_etag: Some("\"etag\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    let instance_event_id = repo.upsert_event_fixture(instance).await.unwrap();

    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "incremental-next".to_string(),
            observed_provider_event_ids: None,
            materialized_range: None,
            cancelled_provider_event_ids: vec![
                "cancelled-event".to_string(),
                "cancelled-master".to_string(),
            ],
        },
        0,
    )
    .await
    .unwrap();

    // The tombstone retires the only source, so the entity goes with it.
    let retired = sqlx::query!(
        r#"
        SELECT
            (SELECT count(*) FROM calendar_events WHERE id = $1) AS "event_count!",
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1) AS "source_count!"
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((retired.event_count, retired.source_count), (0, 0));

    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM calendar_events WHERE id = $1"#,
            instance_event_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT sync_token FROM calendars WHERE id = $1"#,
            calendar_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .as_deref(),
        Some("incremental-next")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn occurrence_range_uses_overlap_indexes_and_preserves_attendees(pool: PgPool) {
    let owner_id = "macro|calendar@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool);
    let provider = provider_ids(&repo, link_id).await;
    let upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "range@example.com",
        "Range test",
        1,
    );
    repo.upsert_event_fixture(upsert).await.unwrap();

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 30, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 26, 0, 0, 0).unwrap();
    let result = repo
        .list_occurrences(
            owner_id,
            OccurrenceRange {
                starts_at,
                ends_at,
                start_date: starts_at.date_naive(),
                end_date: ends_at.date_naive(),
            },
            None,
            100,
        )
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    assert!(result.iter().all(|(event, _)| event.attendees.len() == 1));
    assert!(result.iter().all(|(event, _)| {
        event.creator_email.as_deref() == Some("creator@example.com")
            && event.creator_name.as_deref() == Some("Creator")
    }));
}

/// A Google out-of-office auto-decline records the decline on the exception
/// instance and never on the series master, so the occurrence carrying that
/// exception must project the exception's attendees while its siblings keep
/// the series answer.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn occurrence_attendee_override_shadows_the_series_response(pool: PgPool) {
    let owner_id = "macro|calendar-rsvp@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool);
    let provider = provider_ids(&repo, link_id).await;
    let mut upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "declined@example.com",
        "Declined instance",
        1,
    );
    let self_attendee = CalendarAttendee {
        email: "self@example.com".to_string(),
        display_name: Some("Self".to_string()),
        response_status: AttendeeResponseStatus::Accepted,
        is_organizer: false,
        is_optional: false,
        is_self: true,
        comment: None,
    };
    upsert.event.attendees.push(self_attendee.clone());

    // The second occurrence is the exception: same event, declined for us.
    let declined_start = Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap();
    let recurrence_id = declined_start.to_rfc3339();
    upsert.occurrences[1].recurrence_id = Some(recurrence_id.clone());
    upsert.overrides = vec![CalendarEventOverride {
        recurrence_id: recurrence_id.clone(),
        original_time: EventStart::Timed(declined_start),
        time: EventTime::Timed {
            starts_at: declined_start,
            ends_at: declined_start + Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        title: None,
        description: None,
        location: None,
        status: Some(EventStatus::Confirmed),
        attendees: Some(vec![CalendarAttendee {
            response_status: AttendeeResponseStatus::Declined,
            comment: Some("Declined because I am out of office".to_string()),
            ..self_attendee
        }]),
    }];
    repo.upsert_event_fixture(upsert).await.unwrap();

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 26, 0, 0, 0).unwrap();
    let result = repo
        .list_occurrences(
            owner_id,
            OccurrenceRange {
                starts_at,
                ends_at,
                start_date: starts_at.date_naive(),
                end_date: ends_at.date_naive(),
            },
            None,
            100,
        )
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    let response_at = |key: &str| {
        result
            .iter()
            .find(|(_, occurrence)| occurrence.occurrence_key == key)
            .and_then(|(event, _)| event.attendees.iter().find(|attendee| attendee.is_self))
            .map(|attendee| attendee.response_status)
    };
    assert_eq!(
        response_at(&recurrence_id),
        Some(AttendeeResponseStatus::Declined)
    );
    let series_start = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    assert_eq!(
        response_at(&series_start.to_rfc3339()),
        Some(AttendeeResponseStatus::Accepted)
    );
}

/// An exception that explicitly replaces the attendee list with an empty one
/// must project no attendees for that occurrence — not fall back to the
/// series list, which only an exception without an attendee list inherits.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explicitly_empty_override_attendees_do_not_inherit_the_series_list(pool: PgPool) {
    let owner_id = "macro|calendar-empty-override@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool);
    let provider = provider_ids(&repo, link_id).await;
    let mut upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "emptied@example.com",
        "Emptied instance",
        1,
    );

    let emptied_start = Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap();
    let recurrence_id = emptied_start.to_rfc3339();
    upsert.occurrences[1].recurrence_id = Some(recurrence_id.clone());
    upsert.overrides = vec![CalendarEventOverride {
        recurrence_id: recurrence_id.clone(),
        original_time: EventStart::Timed(emptied_start),
        time: EventTime::Timed {
            starts_at: emptied_start,
            ends_at: emptied_start + Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        title: None,
        description: None,
        location: None,
        status: Some(EventStatus::Confirmed),
        attendees: Some(Vec::new()),
    }];
    repo.upsert_event_fixture(upsert).await.unwrap();

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 26, 0, 0, 0).unwrap();
    let result = repo
        .list_occurrences(
            owner_id,
            OccurrenceRange {
                starts_at,
                ends_at,
                start_date: starts_at.date_naive(),
                end_date: ends_at.date_naive(),
            },
            None,
            100,
        )
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    let attendees_at = |key: &str| {
        result
            .iter()
            .find(|(_, occurrence)| occurrence.occurrence_key == key)
            .map(|(event, _)| event.attendees.len())
    };
    let series_start = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    assert_eq!(attendees_at(&series_start.to_rfc3339()), Some(1));
    assert_eq!(attendees_at(&recurrence_id), Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn occurrence_cursor_is_stable_when_occurrences_share_a_start(pool: PgPool) {
    let owner_id = "macro|calendar-pagination@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool);
    let provider = provider_ids(&repo, link_id).await;
    for ordinal in 1..=3 {
        repo.upsert_event_fixture(timed_upsert(
            owner_id,
            link_id,
            provider,
            &format!("pagination-{ordinal}@example.com"),
            &format!("Pagination event {ordinal}"),
            ordinal,
        ))
        .await
        .unwrap();
    }

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 25, 0, 0, 0).unwrap();
    let range = OccurrenceRange {
        starts_at,
        ends_at,
        start_date: starts_at.date_naive(),
        end_date: ends_at.date_naive(),
    };
    let first_page = repo
        .list_occurrences(owner_id, range.clone(), None, 2)
        .await
        .unwrap();
    assert_eq!(first_page.len(), 2);
    let cursor = CalendarOccurrenceCursor::from_occurrence(&first_page[1].1);
    let second_page = repo
        .list_occurrences(owner_id, range, Some(cursor), 2)
        .await
        .unwrap();
    assert_eq!(second_page.len(), 1);

    let mut event_ids: Vec<_> = first_page
        .iter()
        .chain(&second_page)
        .map(|(event, _)| event.id)
        .collect();
    event_ids.sort_unstable();
    event_ids.dedup();
    assert_eq!(event_ids.len(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn watch_channels_round_trip_from_recording_to_targeted_rearm(pool: PgPool) {
    let owner_id = "macro|calendar-watch@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    let provider_calendar = ProviderCalendar {
        provider_calendar_id: "primary".to_string(),
        name: "Primary".to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some("owner".to_string()),
        is_primary: true,
        is_selected: true,
        default_reminders: Vec::new(),
    };
    let calendar_id = repo
        .upsert_google_calendar(key, lease_token, account_id, provider_calendar.clone())
        .await
        .unwrap()
        .id;

    let channel = GoogleWatchChannel {
        channel_id: Uuid::new_v4(),
        resource_id: "resource-1".to_string(),
        expires_at: (Utc::now() + Duration::days(6)).trunc_subsecs(6),
    };
    assert!(
        repo.record_watch_channel(
            key,
            Uuid::new_v4(),
            account_id,
            calendar_id,
            channel.clone()
        )
        .await
        .is_err(),
        "a stale lease must not record channels"
    );
    repo.record_watch_channel(key, lease_token, account_id, calendar_id, channel.clone())
        .await
        .unwrap();

    // The stored expiry feeds the renewal decision on the next run.
    let stored = repo
        .upsert_google_calendar(key, lease_token, account_id, provider_calendar)
        .await
        .unwrap();
    assert_eq!(stored.watch_expires_at, Some(channel.expires_at));

    // Notifications resolve the channel to its inbox; unknown or mismatched
    // identifiers resolve to nothing.
    assert_eq!(
        repo.find_watch_target(&channel.channel_id.to_string(), "resource-1")
            .await
            .unwrap(),
        Some(link_id)
    );
    assert_eq!(
        repo.find_watch_target(&channel.channel_id.to_string(), "other-resource")
            .await
            .unwrap(),
        None
    );

    // A completed job re-arms exactly once per notification burst.
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "next".to_string(),
            observed_provider_event_ids: Some(Vec::new()),
            materialized_range: Some(OccurrenceRange::historical_sync(Utc::now())),
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    repo.reconcile_google_calendar_list(key, lease_token, account_id, vec![calendar_id])
        .await
        .unwrap();
    repo.complete_google_backfill(key, lease_token)
        .await
        .unwrap();
    assert!(repo.schedule_google_sync_for_link(link_id).await.unwrap());
    assert!(
        !repo.schedule_google_sync_for_link(link_id).await.unwrap(),
        "a pending job absorbs further notifications"
    );

    // Disabled accounts stop resolving notifications.
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status = 'disabled' WHERE id = $1",
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.find_watch_target(&channel.channel_id.to_string(), "resource-1")
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_status_reflects_visible_account_ingestion_state(pool: PgPool) {
    let owner_id = "macro|calendar-sync-status@example.com";
    let repo = PgCalendarRepository::new(pool.clone());
    assert_eq!(
        repo.sync_status(owner_id).await.unwrap(),
        CalendarSyncStatus::Ready
    );

    let link_id = insert_link(&pool, owner_id).await;
    repo.apply_google_grant(
        link_id,
        complete_grant(),
        CalendarGrantIntent::CalendarRequested,
    )
    .await
    .unwrap();
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    assert_eq!(
        repo.sync_status(owner_id).await.unwrap(),
        CalendarSyncStatus::Syncing
    );

    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status = 'ready' WHERE id = $1",
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.sync_status(owner_id).await.unwrap(),
        CalendarSyncStatus::Ready
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unchanged_google_projection_skips_the_write_path(pool: PgPool) {
    let owner_id = "macro|calendar-idempotent@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    repo.apply_google_grant(
        link_id,
        complete_grant(),
        CalendarGrantIntent::CalendarRequested,
    )
    .await
    .unwrap();
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "primary".to_string(),
                name: "Primary".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: true,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();

    let build = |title: &str| {
        let mut upsert = timed_upsert(
            owner_id,
            link_id,
            (account_id, calendar_id),
            "idempotent@example.com",
            title,
            1,
        );
        upsert.source = CalendarEventSource::Google(GoogleEventSource {
            email_link_id: link_id,
            account_id,
            calendar_id,
            provider_event_id: "stable-event".to_string(),
            provider_recurring_event_id: None,
            provider_etag: Some("\"etag\"".to_string()),
            raw_payload: serde_json::json!({}),
        });
        upsert
    };

    let first_id = repo
        .upsert_event_fixture(build("Same title"))
        .await
        .unwrap();
    let generated_before = sqlx::query_scalar!(
        r#"SELECT max(generated_at) AS "max!" FROM calendar_event_occurrences WHERE event_id = $1"#,
        first_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    // A rebuild re-mints the proposed entity id, so a fresh mapping of the
    // same provider state must be recognized as unchanged and skipped.
    let second_id = repo
        .upsert_event_fixture(build("Same title"))
        .await
        .unwrap();
    assert_eq!(second_id, first_id);
    let generated_after = sqlx::query_scalar!(
        r#"SELECT max(generated_at) AS "max!" FROM calendar_event_occurrences WHERE event_id = $1"#,
        first_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(generated_after, generated_before);

    // A real change still writes through.
    repo.upsert_event_fixture(build("New title")).await.unwrap();
    let title = sqlx::query_scalar!("SELECT title FROM calendar_events WHERE id = $1", first_id,)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "New title");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delegated_inbox_source_grants_calendar_visibility(pool: PgPool) {
    let child_id = "macro|child@example.com";
    let primary_id = "macro|primary@example.com";
    insert_user(&pool, child_id).await;
    insert_user(&pool, primary_id).await;
    let link_id = insert_link(&pool, child_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    repo.upsert_event_fixture(timed_upsert(
        child_id,
        link_id,
        provider,
        "delegated@example.com",
        "Delegated event",
        1,
    ))
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        primary_id,
        child_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 26, 0, 0, 0).unwrap();
    let range = OccurrenceRange {
        starts_at,
        ends_at,
        start_date: starts_at.date_naive(),
        end_date: ends_at.date_naive(),
    };
    assert_eq!(
        repo.list_occurrences(primary_id, range.clone(), None, 100)
            .await
            .unwrap()
            .len(),
        2
    );
    assert!(
        repo.list_occurrences("macro|stranger@example.com", range, None, 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn identical_uids_from_distinct_inboxes_remain_distinct_and_link_scoped(pool: PgPool) {
    let child_id = "macro|child-two-inboxes@example.com";
    let primary_id = "macro|primary-two-inboxes@example.com";
    insert_user(&pool, child_id).await;
    insert_user(&pool, primary_id).await;
    let delegated_link_id = insert_link(&pool, child_id).await;
    let private_link_id = insert_link(&pool, child_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let delegated_provider = provider_ids(&repo, delegated_link_id).await;
    let private_provider = provider_ids(&repo, private_link_id).await;

    repo.upsert_event_fixture(timed_upsert(
        child_id,
        delegated_link_id,
        delegated_provider,
        "shared-provider-uid@example.com",
        "Delegated inbox",
        1,
    ))
    .await
    .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        child_id,
        private_link_id,
        private_provider,
        "shared-provider-uid@example.com",
        "Private inbox",
        1,
    ))
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        primary_id,
        child_id,
        delegated_link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 26, 0, 0, 0).unwrap();
    let result = repo
        .list_occurrences(
            primary_id,
            OccurrenceRange {
                starts_at,
                ends_at,
                start_date: starts_at.date_naive(),
                end_date: ends_at.date_naive(),
            },
            None,
            100,
        )
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    assert!(
        result
            .iter()
            .all(|(event, _)| event.title == "Delegated inbox")
    );
    let event_count = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM calendar_events WHERE owner_id = $1"#,
        child_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(event_count, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn equal_sequence_cannot_replace_a_newer_projection(pool: PgPool) {
    let owner_id = "macro|stale-calendar@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let mut latest = timed_upsert(
        owner_id,
        link_id,
        provider,
        "stale-sequence@example.com",
        "Latest",
        4,
    );
    latest.event.updated_at += Duration::days(2);
    let event_id = repo.upsert_event_fixture(latest).await.unwrap();

    let mut stale = timed_upsert(
        owner_id,
        link_id,
        provider,
        "stale-sequence@example.com",
        "Stale",
        4,
    );
    stale.event.updated_at -= Duration::days(2);
    repo.upsert_event_fixture(stale).await.unwrap();

    let title = sqlx::query_scalar!("SELECT title FROM calendar_events WHERE id = $1", event_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "Latest");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_google_source_projection_cannot_resurface_during_reconciliation(pool: PgPool) {
    let owner_id = "macro|stale-google-source@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let primary_calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "primary".to_string(),
                name: "Primary".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: true,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();
    let sibling_calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "sibling".to_string(),
                name: "Sibling".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: false,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();

    let mut latest = timed_upsert(
        owner_id,
        link_id,
        (account_id, primary_calendar_id),
        "stale-google-source@example.com",
        "Latest",
        4,
    );
    latest.event.updated_at += Duration::days(2);
    latest.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id: primary_calendar_id,
        provider_event_id: "primary-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"latest\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    let event_id = repo.upsert_event_fixture(latest).await.unwrap();

    let mut sibling = timed_upsert(
        owner_id,
        link_id,
        (account_id, sibling_calendar_id),
        "stale-google-source@example.com",
        "Sibling",
        1,
    );
    sibling.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id: sibling_calendar_id,
        provider_event_id: "sibling-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"sibling\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    repo.upsert_event_fixture(sibling).await.unwrap();

    let mut stale = timed_upsert(
        owner_id,
        link_id,
        (account_id, primary_calendar_id),
        "stale-google-source@example.com",
        "Stale",
        4,
    );
    stale.event.updated_at -= Duration::days(2);
    stale.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id: primary_calendar_id,
        provider_event_id: "primary-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"stale\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    repo.upsert_event_fixture(stale).await.unwrap();

    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id: primary_calendar_id,
            next_sync_token: "primary-next".to_string(),
            observed_provider_event_ids: Some(vec!["primary-event".to_string()]),
            materialized_range: Some(OccurrenceRange::historical_sync(Utc::now())),
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id: sibling_calendar_id,
            next_sync_token: "sibling-next".to_string(),
            observed_provider_event_ids: Some(Vec::new()),
            materialized_range: Some(OccurrenceRange::historical_sync(Utc::now())),
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    repo.reconcile_google_calendar_list(
        key,
        lease_token,
        account_id,
        vec![primary_calendar_id, sibling_calendar_id],
    )
    .await
    .unwrap();

    let restored = sqlx::query!(
        r#"
        SELECT title,
               (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1) AS "source_count!"
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(restored.title, "Latest");
    assert_eq!(restored.source_count, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unclaimed_google_reauth_failure_is_atomic_and_edge_triggered(pool: PgPool) {
    let owner_id = "macro|calendar-reauth@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    persist_complete_grant(&pool, link_id, 1).await;
    let account_id = Uuid::now_v7();
    let job_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO calendar_accounts (
            id, owner_id, email_link_id, provider, provider_account_id
        )
        VALUES ($1, $2, $3, 'google', $4)
        "#,
        account_id,
        owner_id,
        link_id,
        "calendar-reauth@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO calendar_backfill_jobs (
            id, email_link_id, account_id, kind, grant_version, status
        )
        VALUES ($1, $2, $3, 'google_calendar', 1, 'pending')
        "#,
        job_id,
        link_id,
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let repo = PgCalendarRepository::new(pool.clone());
    let key = CalendarBackfillJobKey {
        job_id,
        email_link_id: link_id,
    };
    let failure_service = GoogleCalendarBackfillFailureService::new(repo);
    let outcome = failure_service
        .fail_unclaimed(
            key,
            CalendarBackfillFailureDisposition::ReauthRequired,
            "grant expired",
        )
        .await
        .unwrap();
    assert!(outcome.job_transitioned);
    assert!(outcome.link_reauth_transitioned);

    let state = sqlx::query!(
        r#"
        SELECT
            job.status AS job_status,
            account.sync_status AS account_status,
            link.needs_reauth,
            link.last_sync_error_at
        FROM calendar_backfill_jobs job
        JOIN calendar_accounts account ON account.id = job.account_id
        JOIN email_links link ON link.id = job.email_link_id
        WHERE job.id = $1
        "#,
        job_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state.job_status, "failed");
    assert_eq!(state.account_status, "reauth_required");
    assert!(state.needs_reauth);
    assert!(state.last_sync_error_at.is_some());

    let duplicate = failure_service
        .fail_unclaimed(
            key,
            CalendarBackfillFailureDisposition::ReauthRequired,
            "duplicate",
        )
        .await
        .unwrap();
    assert!(!duplicate.job_transitioned);
    assert!(!duplicate.link_reauth_transitioned);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_permission_failure_does_not_mark_the_gmail_link_for_reauth(pool: PgPool) {
    let owner_id = "macro|calendar-permission-only@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let outcome = GoogleCalendarBackfillFailureService::new(repo)
        .fail_unclaimed(
            CalendarBackfillJobKey {
                job_id: job.id,
                email_link_id: link_id,
            },
            CalendarBackfillFailureDisposition::CalendarPermissionRequired,
            "calendar consent is missing",
        )
        .await
        .unwrap();

    assert!(outcome.job_transitioned);
    assert!(!outcome.link_reauth_transitioned);
    let state = sqlx::query!(
        r#"
        SELECT account.sync_status, link.needs_reauth
        FROM calendar_accounts account
        JOIN email_links link ON link.id = account.email_link_id
        WHERE account.id = $1
        "#,
        job.account_id.unwrap(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state.sync_status, "reauth_required");
    assert!(!state.needs_reauth);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unclaimed_permanent_google_failure_marks_account_error(pool: PgPool) {
    let owner_id = "macro|calendar-permanent@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    persist_complete_grant(&pool, link_id, 1).await;
    let account_id = Uuid::now_v7();
    let job_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO calendar_accounts (
            id, owner_id, email_link_id, provider, provider_account_id
        )
        VALUES ($1, $2, $3, 'google', $4)
        "#,
        account_id,
        owner_id,
        link_id,
        "calendar-permanent@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO calendar_backfill_jobs (
            id, email_link_id, account_id, kind, grant_version, status
        )
        VALUES ($1, $2, $3, 'google_calendar', 1, 'pending')
        "#,
        job_id,
        link_id,
        account_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let outcome =
        GoogleCalendarBackfillFailureService::new(PgCalendarRepository::new(pool.clone()))
            .fail_unclaimed(
                CalendarBackfillJobKey {
                    job_id,
                    email_link_id: link_id,
                },
                CalendarBackfillFailureDisposition::Permanent,
                "provider rejected data",
            )
            .await
            .unwrap();
    assert!(outcome.job_transitioned);
    assert!(!outcome.link_reauth_transitioned);

    let account = sqlx::query!(
        "SELECT sync_status, last_sync_error FROM calendar_accounts WHERE id = $1",
        account_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(account.sync_status, "error");
    assert_eq!(
        account.last_sync_error.as_deref(),
        Some("provider rejected data")
    );
}

async fn grant_and_provider_ids(repo: &PgCalendarRepository, link_id: Uuid) -> (Uuid, Uuid) {
    repo.apply_google_grant(
        link_id,
        complete_grant(),
        CalendarGrantIntent::CalendarRequested,
    )
    .await
    .unwrap();
    provider_ids(repo, link_id).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn user_mutation_write_persists_a_google_echo_without_a_lease(pool: PgPool) {
    let owner_id = "macro|calendar-user-mutation@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = grant_and_provider_ids(&repo, link_id).await;

    let upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "user-created@example.com",
        "Google event",
        1,
    );
    let event_id = repo
        .upsert_event(CalendarEventWrite::UserMutation(upsert))
        .await
        .unwrap()
        .event_id;

    let row = sqlx::query!(
        r#"
        SELECT
            (SELECT title FROM calendar_events WHERE id = $1) AS "title!",
            (SELECT count(*) FROM calendar_event_occurrences WHERE event_id = $1) AS "occurrences!",
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1 AND source_kind = 'google') AS "sources!"
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (row.title.as_str(), row.occurrences, row.sources),
        ("Google event", 2, 1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mutation_target_resolves_only_for_visible_requesters(pool: PgPool) {
    let owner_id = "macro|calendar-target-owner@example.com";
    let delegate_id = "macro|calendar-target-delegate@example.com";
    let stranger_id = "macro|calendar-target-stranger@example.com";
    insert_user(&pool, owner_id).await;
    insert_user(&pool, delegate_id).await;
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = grant_and_provider_ids(&repo, link_id).await;
    let event_id = repo
        .upsert_event(CalendarEventWrite::UserMutation(timed_upsert(
            owner_id,
            link_id,
            provider,
            "target@example.com",
            "Target event",
            1,
        )))
        .await
        .unwrap()
        .event_id;
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        delegate_id,
        owner_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let target = repo
        .get_event_mutation_target(owner_id, event_id)
        .await
        .unwrap()
        .expect("owner sees the mutation target");
    assert_eq!(target.provider_event_id, "provider-target@example.com");
    assert_eq!(
        target.master_provider_event_id(),
        "provider-target@example.com"
    );
    assert_eq!(target.account_id, provider.0);
    assert_eq!(target.calendar_id, provider.1);
    assert_eq!(target.provider_calendar_id, "primary");
    assert_eq!(target.owner_id, owner_id);
    let inbox = format!("calendar-{link_id}@example.com");
    assert_eq!(target.token_identity.provider, "GMAIL");
    assert_eq!(target.token_identity.email_address, inbox);
    assert!(
        target
            .actor
            .as_ref()
            .is_some_and(|actor| actor.matches(&inbox))
    );

    let delegated = repo
        .get_event_mutation_target(delegate_id, event_id)
        .await
        .unwrap()
        .expect("delegate sees the mutation target");
    assert_eq!(delegated.token_identity.email_address, inbox);
    assert!(
        delegated.actor.is_none(),
        "a delegate without their own inbox has no actor"
    );

    let hidden = repo
        .get_event_mutation_target(stranger_id, event_id)
        .await
        .unwrap();
    assert!(hidden.is_none(), "stranger cannot see the mutation target");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn creation_target_actor_is_owned_inboxes_not_the_calendar_inbox(pool: PgPool) {
    let owner_id = "macro|calendar-create-actor@example.com";
    let delegate_id = "macro|calendar-create-delegate@example.com";
    insert_user(&pool, owner_id).await;
    insert_user(&pool, delegate_id).await;
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    grant_and_provider_ids(&repo, link_id).await;
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        delegate_id,
        owner_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let inbox = format!("calendar-{link_id}@example.com");
    let owner = repo
        .get_creation_target(owner_id, None, None)
        .await
        .unwrap()
        .expect("owner resolves a creation target");
    assert_eq!(owner.token_identity.email_address, inbox);
    assert!(
        owner
            .actor
            .as_ref()
            .is_some_and(|actor| actor.matches(&inbox))
    );

    let delegated = repo
        .get_creation_target(delegate_id, None, None)
        .await
        .unwrap()
        .expect("delegate resolves a creation target");
    assert_eq!(delegated.token_identity.email_address, inbox);
    assert!(
        delegated.actor.is_none(),
        "a delegate without their own inbox has no actor"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn creation_target_prefers_the_requesters_own_primary_inbox(pool: PgPool) {
    let owner_id = "macro|calendar-create@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, calendar_id) = grant_and_provider_ids(&repo, link_id).await;

    let target = repo
        .get_creation_target(owner_id, None, None)
        .await
        .unwrap()
        .expect("owner resolves a creation target");
    assert_eq!(target.account_id, account_id);
    assert_eq!(target.calendar_id, calendar_id);
    assert_eq!(target.owner_id, owner_id);
    assert!(!target.is_read_only);

    let explicit = repo
        .get_creation_target(owner_id, Some(link_id), None)
        .await
        .unwrap();
    assert!(explicit.is_some());

    let unknown_link = repo
        .get_creation_target(owner_id, Some(Uuid::now_v7()), None)
        .await
        .unwrap();
    assert!(unknown_link.is_none());

    let stranger = repo
        .get_creation_target("macro|calendar-create-stranger@example.com", None, None)
        .await
        .unwrap();
    assert!(stranger.is_none());

    let team_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "team".to_string(),
                name: "Team".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: Some("#33b679".to_string()),
                access_role: Some("writer".to_string()),
                is_primary: false,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();
    let picked = repo
        .get_creation_target(owner_id, None, Some(team_id))
        .await
        .unwrap()
        .expect("an explicit calendar overrides the primary default");
    assert_eq!(picked.calendar_id, team_id);
    assert_eq!(picked.provider_calendar_id, "team");
    assert!(!picked.is_read_only);

    let foreign_calendar = repo
        .get_creation_target(
            "macro|calendar-create-stranger@example.com",
            None,
            Some(team_id),
        )
        .await
        .unwrap();
    assert!(
        foreign_calendar.is_none(),
        "calendar picks stay requester-scoped"
    );

    let calendars = repo.list_visible_calendars(owner_id).await.unwrap();
    assert_eq!(
        calendars
            .iter()
            .map(|calendar| (
                calendar.name.as_str(),
                calendar.is_primary,
                calendar.is_writable
            ))
            .collect::<Vec<_>>(),
        vec![("Primary", true, true), ("Team", false, true)]
    );
    assert!(
        repo.list_visible_calendars("macro|calendar-create-stranger@example.com")
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_a_google_source_restores_the_surviving_calendar_copy(pool: PgPool) {
    let owner_id = "macro|calendar-remove-source@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = grant_and_provider_ids(&repo, link_id).await;
    let secondary_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "team".to_string(),
                name: "Team".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("writer".to_string()),
                is_primary: false,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();

    // The same iCalUID observed through two calendars of one inbox: two
    // sources, one canonical entity.
    let mut primary_copy = timed_upsert(
        owner_id,
        link_id,
        (account_id, primary_id),
        "shared-remove@example.com",
        "Primary copy",
        2,
    );
    primary_copy.event.is_read_only = false;
    let event_id = repo
        .upsert_event(CalendarEventWrite::UserMutation(primary_copy))
        .await
        .unwrap()
        .event_id;
    let mut team_copy = timed_upsert(
        owner_id,
        link_id,
        (account_id, secondary_id),
        "shared-remove@example.com",
        "Team copy",
        1,
    );
    team_copy.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id: secondary_id,
        provider_event_id: "team-copy-id".to_string(),
        provider_recurring_event_id: None,
        provider_etag: None,
        raw_payload: serde_json::json!({}),
    });
    repo.upsert_event(CalendarEventWrite::UserMutation(team_copy))
        .await
        .unwrap()
        .event_id;

    repo.remove_google_source(account_id, primary_id, "provider-shared-remove@example.com")
        .await
        .unwrap();
    let row = sqlx::query!(
        r#"
        SELECT
            (SELECT title FROM calendar_events WHERE id = $1) AS "title!",
            (SELECT calendar_id FROM calendar_event_sources WHERE event_id = $1) AS "calendar_id",
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1) AS "sources!"
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (row.title.as_str(), row.calendar_id, row.sources),
        ("Team copy", Some(secondary_id), 1),
        "the surviving calendar's copy is promoted back to canonical"
    );

    repo.remove_google_source(account_id, secondary_id, "team-copy-id")
        .await
        .unwrap();
    let remaining = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM calendar_events WHERE id = $1"#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining, 0, "an event with no surviving source is deleted");
}

/// One-occurrence event fixture for reminder scheduling tests.
fn reminder_upsert(
    owner_id: &str,
    link_id: Uuid,
    provider: (Uuid, Uuid),
    uid: &str,
    starts_at: chrono::DateTime<Utc>,
    reminders: EventReminders,
) -> CalendarEventUpsert {
    let (account_id, calendar_id) = provider;
    let id = Uuid::now_v7();
    let ends_at = starts_at + Duration::hours(1);
    CalendarEventUpsert {
        event: CalendarEvent {
            id,
            owner_id: owner_id.to_string(),
            ical_uid: uid.to_string(),
            calendar_id: Some(calendar_id),
            title: "Reminder subject".to_string(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            event_type: EventType::Default,
            time: EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: Some("UTC".to_string()),
            },
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
            reminders,
            created_at: starts_at - Duration::days(1),
            updated_at: starts_at - Duration::days(1),
        },
        source: CalendarEventSource::Google(GoogleEventSource {
            email_link_id: link_id,
            account_id,
            calendar_id,
            provider_event_id: format!("provider-{uid}"),
            provider_recurring_event_id: None,
            provider_etag: None,
            raw_payload: serde_json::json!({}),
        }),
        overrides: Vec::new(),
        occurrences: vec![CalendarOccurrence {
            event_id: id,
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

fn reminder_attendee(email: &str, declined: bool, is_self: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_string(),
        display_name: None,
        response_status: if declined {
            AttendeeResponseStatus::Declined
        } else {
            AttendeeResponseStatus::Accepted
        },
        is_organizer: false,
        is_optional: false,
        is_self,
        comment: None,
    }
}

fn popup_reminders(minutes: &[u32]) -> EventReminders {
    EventReminders {
        use_default: false,
        overrides: minutes
            .iter()
            .map(|minutes| EventReminderOverride {
                method: REMINDER_METHOD_POPUP.to_string(),
                minutes: *minutes,
            })
            .collect(),
    }
}

async fn scheduled_firings(pool: &PgPool, event_id: Uuid) -> Vec<(String, i32, DateTime<Utc>)> {
    sqlx::query!(
        r#"
        SELECT occurrence_key, minutes_before, fire_at
        FROM calendar_event_reminder_firings
        WHERE event_id = $1
        ORDER BY fire_at, minutes_before
        "#,
        event_id,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.occurrence_key, row.minutes_before, row.fire_at))
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_materializes_popup_reminder_firings(pool: PgPool) {
    let owner_id = "macro|reminder-owner@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let starts_at = (Utc::now() + Duration::hours(2)).trunc_subsecs(0);

    let mut reminders = popup_reminders(&[10]);
    reminders.overrides.push(EventReminderOverride {
        method: REMINDER_METHOD_EMAIL.to_string(),
        minutes: 5,
    });
    let upsert = reminder_upsert(owner_id, link_id, provider, "alarms", starts_at, reminders);
    let event_id = repo.upsert_event_fixture(upsert.clone()).await.unwrap();

    assert_eq!(
        scheduled_firings(&pool, event_id).await,
        vec![(
            starts_at.to_rfc3339(),
            10,
            starts_at - Duration::minutes(10)
        )],
        "only popup reminders fire Macro notifications"
    );

    // Removing the overrides (back to empty defaults) clears the schedule.
    let mut cleared = upsert;
    cleared.event.reminders = EventReminders::default();
    let same_event = repo.upsert_event_fixture(cleared).await.unwrap();
    assert_eq!(same_event, event_id);
    assert_eq!(scheduled_firings(&pool, event_id).await, Vec::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_default_reminders_fan_out_to_use_default_events(pool: PgPool) {
    let owner_id = "macro|reminder-defaults@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, calendar_id) = provider_ids(&repo, link_id).await;
    let starts_at = (Utc::now() + Duration::hours(3)).trunc_subsecs(0);

    let follows_defaults = repo
        .upsert_event_fixture(reminder_upsert(
            owner_id,
            link_id,
            (account_id, calendar_id),
            "defaults",
            starts_at,
            EventReminders::default(),
        ))
        .await
        .unwrap();
    let has_overrides = repo
        .upsert_event_fixture(reminder_upsert(
            owner_id,
            link_id,
            (account_id, calendar_id),
            "overridden",
            starts_at,
            popup_reminders(&[10]),
        ))
        .await
        .unwrap();
    assert_eq!(
        scheduled_firings(&pool, follows_defaults).await,
        Vec::new(),
        "a calendar with no default reminders schedules nothing"
    );

    let updated = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: "primary".to_string(),
                name: "Primary".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: true,
                is_selected: true,
                default_reminders: vec![EventReminderOverride {
                    method: REMINDER_METHOD_POPUP.to_string(),
                    minutes: 30,
                }],
            },
        )
        .await
        .unwrap();
    assert_eq!(updated, calendar_id);

    assert_eq!(
        scheduled_firings(&pool, follows_defaults).await,
        vec![(
            starts_at.to_rfc3339(),
            30,
            starts_at - Duration::minutes(30)
        )],
        "new calendar defaults reschedule useDefault events"
    );
    assert_eq!(
        scheduled_firings(&pool, has_overrides).await,
        vec![(
            starts_at.to_rfc3339(),
            10,
            starts_at - Duration::minutes(10)
        )],
        "explicit overrides are untouched by a defaults change"
    );
}

/// Status-style events (working location, out of office, focus time,
/// birthdays) never resolve the calendar's default reminders — Google's
/// clients offer no notification setting on them — while explicit overrides
/// still schedule firings.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn status_events_ignore_calendar_default_reminders(pool: PgPool) {
    let owner_id = "macro|working-location@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, calendar_id) = provider_ids(&repo, link_id).await;
    let starts_at = (Utc::now() + Duration::hours(3)).trunc_subsecs(0);
    let primary_with_defaults = |minutes: &[u32]| ProviderCalendar {
        provider_calendar_id: "primary".to_string(),
        name: "Primary".to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some("owner".to_string()),
        is_primary: true,
        is_selected: true,
        default_reminders: minutes
            .iter()
            .map(|minutes| EventReminderOverride {
                method: REMINDER_METHOD_POPUP.to_string(),
                minutes: *minutes,
            })
            .collect(),
    };
    let updated = repo
        .upsert_calendar_fixture(account_id, primary_with_defaults(&[10]))
        .await
        .unwrap();
    assert_eq!(updated, calendar_id);

    let mut working_location = reminder_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "office",
        starts_at,
        EventReminders::default(),
    );
    working_location.event.event_type = EventType::WorkingLocation;
    let follows_defaults = repo.upsert_event_fixture(working_location).await.unwrap();
    let meeting = repo
        .upsert_event_fixture(reminder_upsert(
            owner_id,
            link_id,
            (account_id, calendar_id),
            "meeting",
            starts_at,
            EventReminders::default(),
        ))
        .await
        .unwrap();
    assert_eq!(
        scheduled_firings(&pool, follows_defaults).await,
        Vec::new(),
        "useDefault resolves to nothing on a status event"
    );
    assert_eq!(
        scheduled_firings(&pool, meeting).await,
        vec![(
            starts_at.to_rfc3339(),
            10,
            starts_at - Duration::minutes(10)
        )],
        "an ordinary event on the same calendar still follows the defaults"
    );

    let mut with_override = reminder_upsert(
        owner_id,
        link_id,
        (account_id, calendar_id),
        "office-override",
        starts_at,
        popup_reminders(&[5]),
    );
    with_override.event.event_type = EventType::WorkingLocation;
    let overridden = repo.upsert_event_fixture(with_override).await.unwrap();
    assert_eq!(
        scheduled_firings(&pool, overridden).await,
        vec![(starts_at.to_rfc3339(), 5, starts_at - Duration::minutes(5))],
        "an explicit override on a status event still fires"
    );

    repo.upsert_calendar_fixture(account_id, primary_with_defaults(&[30]))
        .await
        .unwrap();
    assert_eq!(
        scheduled_firings(&pool, follows_defaults).await,
        Vec::new(),
        "a defaults change never schedules a status event"
    );
    assert_eq!(
        scheduled_firings(&pool, meeting).await,
        vec![(
            starts_at.to_rfc3339(),
            30,
            starts_at - Duration::minutes(30)
        )],
        "the same defaults change still fans out to ordinary events"
    );
}

/// One event can hold sources on several calendars of one inbox. Only the
/// canonical source (highest sequence/updated_at/seen/id) may drive the
/// firing schedule: a defaults change on a secondary calendar must not
/// delete the canonical schedule and rebuild it from the secondary's
/// defaults.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn secondary_calendar_changes_leave_the_canonical_schedule_alone(pool: PgPool) {
    let owner_id = "macro|reminder-canonical@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, canonical_calendar) = provider_ids(&repo, link_id).await;
    let secondary = |minutes: &[u32]| ProviderCalendar {
        provider_calendar_id: "secondary".to_string(),
        name: "Secondary".to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some("reader".to_string()),
        is_primary: false,
        is_selected: true,
        default_reminders: minutes
            .iter()
            .map(|minutes| EventReminderOverride {
                method: REMINDER_METHOD_POPUP.to_string(),
                minutes: *minutes,
            })
            .collect(),
    };
    let secondary_calendar = repo
        .upsert_calendar_fixture(account_id, secondary(&[]))
        .await
        .unwrap();

    let starts_at = (Utc::now() + Duration::hours(3)).trunc_subsecs(0);
    let mut canonical_source = reminder_upsert(
        owner_id,
        link_id,
        (account_id, canonical_calendar),
        "shared",
        starts_at,
        popup_reminders(&[10]),
    );
    canonical_source.event.sequence = 1;
    let event_id = repo.upsert_event_fixture(canonical_source).await.unwrap();

    let mut secondary_source = reminder_upsert(
        owner_id,
        link_id,
        (account_id, secondary_calendar),
        "shared",
        starts_at,
        popup_reminders(&[10]),
    );
    secondary_source.event.sequence = 0;
    let same_event = repo.upsert_event_fixture(secondary_source).await.unwrap();
    assert_eq!(same_event, event_id, "both sources attach to one event");

    let canonical_schedule = vec![(
        starts_at.to_rfc3339(),
        10,
        starts_at - Duration::minutes(10),
    )];
    assert_eq!(scheduled_firings(&pool, event_id).await, canonical_schedule);

    repo.upsert_calendar_fixture(account_id, secondary(&[30]))
        .await
        .unwrap();

    assert_eq!(
        scheduled_firings(&pool, event_id).await,
        canonical_schedule,
        "a secondary calendar's defaults change leaves the canonical schedule alone"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelled_events_and_occurrences_schedule_no_firings(pool: PgPool) {
    let owner_id = "macro|reminder-cancelled@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let starts_at = (Utc::now() + Duration::hours(2)).trunc_subsecs(0);

    let mut cancelled_event = reminder_upsert(
        owner_id,
        link_id,
        provider,
        "cancelled-event",
        starts_at,
        popup_reminders(&[10]),
    );
    cancelled_event.event.status = EventStatus::Cancelled;
    let event_id = repo.upsert_event_fixture(cancelled_event).await.unwrap();
    assert_eq!(scheduled_firings(&pool, event_id).await, Vec::new());

    let mut cancelled_occurrence = reminder_upsert(
        owner_id,
        link_id,
        provider,
        "cancelled-occurrence",
        starts_at,
        popup_reminders(&[10]),
    );
    cancelled_occurrence.occurrences[0].is_cancelled = true;
    let event_id = repo
        .upsert_event_fixture(cancelled_occurrence)
        .await
        .unwrap();
    assert_eq!(scheduled_firings(&pool, event_id).await, Vec::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dispatch_repo_sweeps_claims_and_completes(pool: PgPool) {
    let owner_id = "macro|reminder-dispatch@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    // Ten minutes from now with a ten-minute reminder: due right now.
    let starts_at = (Utc::now() + Duration::minutes(10)).trunc_subsecs(0);

    let event_id = repo
        .upsert_event_fixture(reminder_upsert(
            owner_id,
            link_id,
            provider,
            "due",
            starts_at,
            popup_reminders(&[10]),
        ))
        .await
        .unwrap();

    let now = Utc::now();
    let due = repo.due_reminder_firings(now, None, 100).await.unwrap();
    assert_eq!(due.len(), 1);
    let firing = &due[0];
    assert_eq!(
        (firing.event_id, firing.minutes_before, firing.fire_at),
        (event_id, 10, starts_at - Duration::minutes(10)),
    );

    let resolved = repo.find_due_reminder(firing).await.unwrap().unwrap();
    assert_eq!(resolved.owner_id, owner_id);
    assert_eq!(resolved.title, "Reminder subject");
    assert_eq!(resolved.display_time_zone.as_deref(), Some("UTC"));
    assert!(!resolved.declined);

    let retry_before = now - Duration::minutes(5);
    assert!(
        repo.claim_reminder_delivery(firing, retry_before)
            .await
            .unwrap()
    );
    assert!(
        !repo
            .claim_reminder_delivery(firing, retry_before)
            .await
            .unwrap(),
        "a fresh claim is not taken over"
    );

    repo.release_reminder_delivery(firing).await.unwrap();
    assert!(
        repo.claim_reminder_delivery(firing, retry_before)
            .await
            .unwrap(),
        "a released claim can be retaken"
    );

    repo.complete_reminder_delivery(firing).await.unwrap();
    assert_eq!(
        repo.due_reminder_firings(Utc::now(), None, 100)
            .await
            .unwrap(),
        Vec::new(),
        "a completed delivery stops the firing being due"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_and_declined_firings_resolve_safely(pool: PgPool) {
    let owner_id = "macro|reminder-stale@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let starts_at = (Utc::now() + Duration::minutes(10)).trunc_subsecs(0);

    let mut declined = reminder_upsert(
        owner_id,
        link_id,
        provider,
        "declined",
        starts_at,
        popup_reminders(&[10]),
    );
    declined.event.attendees = vec![CalendarAttendee {
        email: format!("calendar-{link_id}@example.com"),
        display_name: None,
        response_status: AttendeeResponseStatus::Declined,
        is_organizer: false,
        is_optional: false,
        is_self: true,
        comment: None,
    }];
    repo.upsert_event_fixture(declined).await.unwrap();

    let due = repo
        .due_reminder_firings(Utc::now(), None, 100)
        .await
        .unwrap();
    assert_eq!(due.len(), 1);
    let firing = &due[0];
    let resolved = repo.find_due_reminder(firing).await.unwrap().unwrap();
    assert!(resolved.declined, "a declined occurrence must not alert");

    // A firing whose schedule row moved on (the event was rescheduled)
    // resolves to nothing rather than alerting at the old time.
    let mut moved = firing.clone();
    moved.fire_at += Duration::minutes(1);
    assert!(repo.find_due_reminder(&moved).await.unwrap().is_none());

    // Firings staler than the sweep grace are silently dropped.
    let past = repo
        .due_reminder_firings(Utc::now() + Duration::hours(2), None, 100)
        .await
        .unwrap();
    assert_eq!(past, Vec::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reminder_decline_follows_owner_inbox_not_calendar_self(pool: PgPool) {
    let owner_id = "macro|reminder-owner-inbox@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let owner_inbox = format!("calendar-{link_id}@example.com");
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let starts_at = (Utc::now() + Duration::minutes(10)).trunc_subsecs(0);

    let mut coworker_declined = reminder_upsert(
        owner_id,
        link_id,
        provider,
        "coworker-declined",
        starts_at,
        popup_reminders(&[10]),
    );
    coworker_declined.event.attendees = vec![
        reminder_attendee("jackson@example.com", true, true),
        reminder_attendee(&owner_inbox, false, false),
    ];
    let coworker_event_id = repo.upsert_event_fixture(coworker_declined).await.unwrap();

    let mut owner_declined = reminder_upsert(
        owner_id,
        link_id,
        provider,
        "owner-declined",
        starts_at,
        popup_reminders(&[10]),
    );
    owner_declined.event.attendees = vec![
        reminder_attendee("jackson@example.com", false, true),
        reminder_attendee(&owner_inbox, true, false),
    ];
    let owner_event_id = repo.upsert_event_fixture(owner_declined).await.unwrap();

    let due = repo
        .due_reminder_firings(Utc::now(), None, 100)
        .await
        .unwrap();
    let firing_for = |event_id| {
        due.iter()
            .find(|firing| firing.event_id == event_id)
            .expect("event has a due firing")
            .clone()
    };

    let coworker = repo
        .find_due_reminder(&firing_for(coworker_event_id))
        .await
        .unwrap()
        .unwrap();
    assert!(
        !coworker.declined,
        "a coworker's declined self row must not suppress the owner's reminder"
    );

    let owner = repo
        .find_due_reminder(&firing_for(owner_event_id))
        .await
        .unwrap()
        .unwrap();
    assert!(
        owner.declined,
        "the owner's own declined inbox must suppress the reminder even when is_self is on a coworker"
    );
}

/// The provider classification has to survive the write and come back on the
/// read path: it is what tells the product a conference is one Macro may
/// detach, so losing it in persistence would put a third-party conference at
/// risk of being destroyed by an edit.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn conference_provider_round_trips_through_persistence(pool: PgPool) {
    let owner_id = "macro|calendar-conference@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = grant_and_provider_ids(&repo, link_id).await;

    let mut upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "conference@example.com",
        "Meeting with a Meet",
        1,
    );
    upsert.event.conference_url = Some("https://meet.google.com/abc-defg-hij".to_string());
    upsert.event.conference_provider = Some(ConferenceProvider::GoogleMeet);
    repo.upsert_event(CalendarEventWrite::UserMutation(upsert))
        .await
        .unwrap()
        .event_id;

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).unwrap();
    let ends_at = starts_at + Duration::days(2);
    let occurrences = repo
        .list_occurrences(
            owner_id,
            OccurrenceRange {
                starts_at,
                ends_at,
                start_date: starts_at.date_naive(),
                end_date: ends_at.date_naive(),
            },
            None,
            100,
        )
        .await
        .unwrap();

    let (event, _) = occurrences.first().expect("the event is in range");
    assert_eq!(
        event.conference_url.as_deref(),
        Some("https://meet.google.com/abc-defg-hij")
    );
    assert_eq!(
        event.conference_provider,
        Some(ConferenceProvider::GoogleMeet)
    );
}

/// A grant that also carries Gmail, so a disconnect can be shown to take the
/// calendar scopes and nothing else.
fn gmail_and_calendar_grant() -> GoogleScopeSet {
    GoogleScopeSet::parse(&format!(
        "https://www.googleapis.com/auth/gmail.modify {}",
        GOOGLE_CALENDAR_SCOPES.join(" ")
    ))
}

/// Bring one inbox's calendar fully to life: account, calendar, open push
/// channel, and a synced event with an outstanding reminder delivery claim.
async fn connected_calendar(
    pool: &PgPool,
    repo: &PgCalendarRepository,
    owner_id: &str,
    link_id: Uuid,
) -> (Uuid, Uuid, Uuid, Uuid) {
    let enabled = repo
        .apply_google_grant(
            link_id,
            gmail_and_calendar_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let job = enabled
        .jobs
        .iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let account_id = job.account_id.unwrap();
    let key = CalendarBackfillJobKey {
        job_id: job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    let calendar_id = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            ProviderCalendar {
                provider_calendar_id: "primary".to_string(),
                name: "Primary".to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some("owner".to_string()),
                is_primary: true,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap()
        .id;
    let channel_id = Uuid::new_v4();
    repo.record_watch_channel(
        key,
        lease_token,
        account_id,
        calendar_id,
        GoogleWatchChannel {
            channel_id,
            resource_id: "resource-1".to_string(),
            expires_at: (Utc::now() + Duration::days(6)).trunc_subsecs(6),
        },
    )
    .await
    .unwrap();
    let event_id = repo
        .upsert_event(CalendarEventWrite::GoogleBackfill {
            key,
            lease_token,
            upsert: timed_upsert(
                owner_id,
                link_id,
                (account_id, calendar_id),
                "disconnect@example.com",
                "Removed by disconnect",
                1,
            ),
        })
        .await
        .unwrap()
        .event_id;
    sqlx::query!(
        r#"
        INSERT INTO calendar_event_reminder_deliveries (
            id, event_id, occurrence_key, minutes_before, fire_at
        )
        VALUES ($1, $2, 'key', 10, now())
        "#,
        Uuid::now_v7(),
        event_id,
    )
    .execute(pool)
    .await
    .unwrap();
    (account_id, calendar_id, event_id, channel_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disconnecting_calendar_removes_the_data_and_records_the_opt_out(pool: PgPool) {
    let owner_id = "macro|calendar-disconnect@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, _calendar_id, event_id, channel_id) =
        connected_calendar(&pool, &repo, owner_id, link_id).await;

    let disconnected = repo
        .disconnect_google_calendar(owner_id, link_id)
        .await
        .unwrap()
        .expect("the owner's inbox is disconnectable");

    assert_eq!(
        disconnected.watch_channels,
        vec![CalendarWatchRelease {
            channel_id: channel_id.to_string(),
            resource_id: "resource-1".to_string(),
        }]
    );
    assert_eq!(disconnected.token_identity.fusionauth_user_id, owner_id);
    assert_eq!(disconnected.token_identity.provider, "GMAIL");

    let remaining = sqlx::query!(
        r#"
        SELECT
            (SELECT count(*) FROM calendar_accounts WHERE email_link_id = $1) AS "accounts!",
            (SELECT count(*) FROM calendars WHERE account_id = $2) AS "calendars!",
            (SELECT count(*) FROM calendar_events WHERE source_link_id = $1) AS "events!",
            (SELECT count(*) FROM calendar_event_sources WHERE source_link_id = $1) AS "sources!",
            (SELECT count(*) FROM calendar_event_occurrences WHERE event_id = $3) AS "occurrences!",
            (SELECT count(*) FROM calendar_event_reminder_deliveries WHERE event_id = $3) AS "deliveries!",
            (SELECT count(*) FROM calendar_backfill_jobs WHERE email_link_id = $1) AS "jobs!"
        "#,
        link_id,
        account_id,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining.accounts, 0);
    assert_eq!(remaining.calendars, 0);
    assert_eq!(remaining.events, 0);
    assert_eq!(remaining.sources, 0);
    assert_eq!(remaining.occurrences, 0);
    assert_eq!(remaining.deliveries, 0);
    assert_eq!(remaining.jobs, 0);

    // A notification for the closed channel no longer resolves to the inbox.
    assert_eq!(
        repo.find_watch_target(&channel_id.to_string(), "resource-1")
            .await
            .unwrap(),
        None
    );

    let grant = sqlx::query!(
        r#"
        SELECT
            granted_scopes,
            grant_version,
            (calendar_disabled_at IS NOT NULL) AS "opted_out!"
        FROM email_link_google_scopes
        WHERE link_id = $1
        "#,
        link_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        GoogleScopeSet::from_scopes(grant.granted_scopes),
        GoogleScopeSet::parse("https://www.googleapis.com/auth/gmail.modify"),
        "Gmail keeps working; only the calendar scopes leave the grant"
    );
    assert_eq!(grant.grant_version, 2);
    assert!(grant.opted_out);
}

/// Consent requests carry `include_granted_scopes=true`, so a later Gmail-only
/// connect reports the calendar scopes Google still holds. That must not
/// resurrect calendar; only a flow that asked for calendar turns it back on.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reissued_grant_keeps_calendar_off_until_it_is_requested_again(pool: PgPool) {
    let owner_id = "macro|calendar-reissued@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    connected_calendar(&pool, &repo, owner_id, link_id).await;
    repo.disconnect_google_calendar(owner_id, link_id)
        .await
        .unwrap()
        .unwrap();

    let incidental = repo
        .apply_google_grant(
            link_id,
            gmail_and_calendar_grant(),
            CalendarGrantIntent::Incidental,
        )
        .await
        .unwrap();
    assert!(!incidental.changed);
    assert!(incidental.jobs.is_empty());
    let held = sqlx::query!(
        r#"
        SELECT granted_scopes, (calendar_disabled_at IS NOT NULL) AS "opted_out!"
        FROM email_link_google_scopes WHERE link_id = $1
        "#,
        link_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !GoogleScopeSet::from_scopes(held.granted_scopes).has_calendar_capability(),
        "a scope that merely rode along must not be recorded"
    );
    assert!(held.opted_out);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) AS \"count!\" FROM calendar_accounts WHERE email_link_id = $1",
            link_id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    let requested = repo
        .apply_google_grant(
            link_id,
            gmail_and_calendar_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    assert!(requested.changed);
    assert_eq!(requested.jobs.len(), 1);
    let restored = sqlx::query!(
        r#"
        SELECT granted_scopes, (calendar_disabled_at IS NOT NULL) AS "opted_out!"
        FROM email_link_google_scopes WHERE link_id = $1
        "#,
        link_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(GoogleScopeSet::from_scopes(restored.granted_scopes).has_calendar_capability());
    assert!(!restored.opted_out);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_owner_can_disconnect_an_inbox_calendar(pool: PgPool) {
    let owner_id = "macro|calendar-owner@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    connected_calendar(&pool, &repo, owner_id, link_id).await;

    assert!(
        repo.disconnect_google_calendar("macro|delegate@example.com", link_id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) AS \"count!\" FROM calendar_accounts WHERE email_link_id = $1",
            link_id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mention_previews_resolve_through_the_shared_uid(pool: PgPool) {
    let author_id = "macro|mention-author@example.com";
    let attendee_id = "macro|mention-attendee@example.com";
    let author_link = insert_link(&pool, author_id).await;
    let attendee_link = insert_link(&pool, attendee_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let author_provider = provider_ids(&repo, author_link).await;
    let attendee_provider = provider_ids(&repo, attendee_link).await;

    let author_copy = timed_upsert(
        author_id,
        author_link,
        author_provider,
        "meeting@example.com",
        "Smart Macro Discussion",
        1,
    );
    let author_event_id = author_copy.event.id;
    repo.upsert_event_fixture(author_copy).await.unwrap();
    let attendee_copy = timed_upsert(
        attendee_id,
        attendee_link,
        attendee_provider,
        "meeting@example.com",
        "Smart Macro Discussion",
        1,
    );
    let attendee_event_id = attendee_copy.event.id;
    repo.upsert_event_fixture(attendee_copy).await.unwrap();
    let private_copy = timed_upsert(
        author_id,
        author_link,
        author_provider,
        "private@example.com",
        "Author only",
        1,
    );
    let private_event_id = private_copy.event.id;
    repo.upsert_event_fixture(private_copy).await.unwrap();
    let mut cancelled_copy = timed_upsert(
        author_id,
        author_link,
        author_provider,
        "cancelled@example.com",
        "Cancelled",
        1,
    );
    cancelled_copy.event.status = EventStatus::Cancelled;
    let cancelled_event_id = cancelled_copy.event.id;
    repo.upsert_event_fixture(cancelled_copy).await.unwrap();

    let now = Utc.with_ymd_and_hms(2026, 7, 23, 0, 0, 0).unwrap();
    let request = |event_id| CalendarMentionRequestItem {
        event_id,
        occurrence_key: None,
    };

    let previews = repo
        .mention_previews(
            author_id,
            vec![request(author_event_id), request(Uuid::now_v7())],
            now,
        )
        .await
        .unwrap();
    let CalendarMentionPreview::Accessible(own) = &previews[0] else {
        panic!("author preview should be accessible: {:?}", previews[0]);
    };
    assert_eq!(own.viewer_event_id, author_event_id);
    assert_eq!(own.title, "Smart Macro Discussion");
    assert!(own.is_recurring);
    assert_eq!(own.attendee_count, 1);
    assert_eq!(previews[1], CalendarMentionPreview::DoesNotExist);

    // The attendee resolves the author's row to their own projection, and
    // never sees the author-only or cancelled meetings.
    let previews = repo
        .mention_previews(
            attendee_id,
            vec![
                request(author_event_id),
                request(private_event_id),
                request(cancelled_event_id),
            ],
            now,
        )
        .await
        .unwrap();
    let CalendarMentionPreview::Accessible(resolved) = &previews[0] else {
        panic!("attendee preview should be accessible: {:?}", previews[0]);
    };
    assert_eq!(resolved.viewer_event_id, attendee_event_id);
    assert_eq!(previews[1], CalendarMentionPreview::NoAccess);
    assert_eq!(previews[2], CalendarMentionPreview::DoesNotExist);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mention_preview_picks_the_requested_or_nearest_occurrence(pool: PgPool) {
    let owner_id = "macro|mention-occurrence@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "series@example.com",
        "Series",
        1,
    );
    let event_id = upsert.event.id;
    let first_start = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let second_start = first_start + Duration::days(1);
    repo.upsert_event_fixture(upsert).await.unwrap();

    let preview_time = |preview: &CalendarMentionPreview| match preview {
        CalendarMentionPreview::Accessible(event) => {
            (event.time.clone(), event.occurrence_key.clone())
        }
        other => panic!("expected an accessible preview: {other:?}"),
    };

    // Before the series: the next upcoming instance.
    let before = Utc.with_ymd_and_hms(2026, 7, 23, 0, 0, 0).unwrap();
    let previews = repo
        .mention_previews(
            owner_id,
            vec![CalendarMentionRequestItem {
                event_id,
                occurrence_key: None,
            }],
            before,
        )
        .await
        .unwrap();
    let (time, key) = preview_time(&previews[0]);
    assert_eq!(key.as_deref(), Some(first_start.to_rfc3339().as_str()));
    assert!(matches!(time, EventTime::Timed { starts_at, .. } if starts_at == first_start));

    // Between instances: still the next upcoming one.
    let between = Utc.with_ymd_and_hms(2026, 7, 24, 18, 0, 0).unwrap();
    let previews = repo
        .mention_previews(
            owner_id,
            vec![CalendarMentionRequestItem {
                event_id,
                occurrence_key: None,
            }],
            between,
        )
        .await
        .unwrap();
    let (_, key) = preview_time(&previews[0]);
    assert_eq!(key.as_deref(), Some(second_start.to_rfc3339().as_str()));

    // After the series: the latest past instance.
    let after = Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap();
    let previews = repo
        .mention_previews(
            owner_id,
            vec![CalendarMentionRequestItem {
                event_id,
                occurrence_key: None,
            }],
            after,
        )
        .await
        .unwrap();
    let (_, key) = preview_time(&previews[0]);
    assert_eq!(key.as_deref(), Some(second_start.to_rfc3339().as_str()));

    // A requested instance wins regardless of the clock.
    let previews = repo
        .mention_previews(
            owner_id,
            vec![CalendarMentionRequestItem {
                event_id,
                occurrence_key: Some(first_start.to_rfc3339()),
            }],
            after,
        )
        .await
        .unwrap();
    let (_, key) = preview_time(&previews[0]);
    assert_eq!(key.as_deref(), Some(first_start.to_rfc3339().as_str()));
}
