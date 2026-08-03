use super::*;
use crate::domain::models::{
    EmailIcsSource, GOOGLE_CALENDAR_SCOPES, GoogleCalendarSyncSnapshot, GoogleEventSource,
    GoogleWatchChannel,
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
        UPDATE email_links
        SET google_granted_scopes = $2,
            google_grant_version = $3
        WHERE id = $1
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

fn timed_upsert(
    owner_id: &str,
    link_id: Uuid,
    uid: &str,
    title: &str,
    sequence: u32,
) -> CalendarEventUpsert {
    let id = Uuid::now_v7();
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let ends_at = starts_at + Duration::hours(1);
    let second_start = starts_at + Duration::days(1);
    CalendarEventUpsert {
        event: CalendarEvent {
            id,
            owner_id: owner_id.to_string(),
            ical_uid: uid.to_string(),
            title: title.to_string(),
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
            recurrence_lines: vec!["RRULE:FREQ=DAILY;COUNT=2".to_string()],
            organizer_email: Some("organizer@example.com".to_string()),
            organizer_name: Some("Organizer".to_string()),
            conference_url: None,
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
            created_at: starts_at,
            updated_at: starts_at + Duration::minutes(i64::from(sequence)),
        },
        source: CalendarEventSource::EmailIcs(EmailIcsSource {
            email_link_id: link_id,
            email_thread_id: None,
            email_message_id: Uuid::now_v7(),
            email_attachment_id: Some("invite.ics".to_string()),
            content_hash: format!("hash-{sequence}"),
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
async fn calendar_capability_transition_schedules_once_and_failed_jobs_can_retry(pool: PgPool) {
    let owner_id = "macro|calendar@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());

    let partial = repo
        .apply_google_grant(
            link_id,
            GoogleScopeSet::parse("https://www.googleapis.com/auth/gmail.modify"),
        )
        .await
        .unwrap();
    assert!(partial.changed);
    assert!(partial.jobs.is_empty());

    let enabled = repo
        .apply_google_grant(link_id, complete_grant())
        .await
        .unwrap();
    assert!(enabled.changed);
    assert_eq!(enabled.jobs.len(), 2);

    let duplicate = repo
        .apply_google_grant(link_id, complete_grant())
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
        .apply_google_grant(link_id, complete_grant())
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
        .apply_google_grant(link_id, complete_grant())
        .await
        .unwrap();
    let google_job = enabled
        .jobs
        .iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let email_job = enabled
        .jobs
        .iter()
        .find(|job| job.kind == CalendarBackfillKind::EmailIcs)
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
            },
        )
        .await
        .unwrap()
        .id;
    let mut google = timed_upsert(
        owner_id,
        link_id,
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
        .unwrap();

    let downgraded = repo
        .apply_google_grant(
            link_id,
            GoogleScopeSet::parse("https://www.googleapis.com/auth/gmail.modify"),
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
            email_job.status AS email_job_status,
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $4) AS "source_count!",
            (SELECT count(*) FROM calendar_events WHERE id = $4) AS "event_count!"
        FROM calendar_accounts account
        JOIN calendars calendar ON calendar.account_id = account.id
        JOIN calendar_backfill_jobs google_job ON google_job.id = $2
        JOIN calendar_backfill_jobs email_job ON email_job.id = $3
        WHERE account.id = $1
        "#,
        account_id,
        google_job.id,
        email_job.id,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state.sync_status, "disabled");
    assert!(state.is_deleted);
    assert_eq!(state.google_job_status, "failed");
    assert!(state.lease_token.is_none());
    assert_eq!(state.email_job_status, "pending");
    assert_eq!(state.source_count, 0);
    assert_eq!(state.event_count, 0);
    assert!(matches!(
        repo.claim_google_backfill(key).await.unwrap(),
        CalendarBackfillClaim::Failed
    ));

    let reenabled = repo
        .apply_google_grant(link_id, complete_grant())
        .await
        .unwrap();
    assert_eq!(reenabled.jobs.len(), 2);
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
        .apply_google_grant(link_id, complete_grant())
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
async fn google_source_reconciles_email_invite_into_one_canonical_entity(pool: PgPool) {
    let owner_id = "macro|calendar@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let email = timed_upsert(
        owner_id,
        link_id,
        "shared-uid@example.com",
        "Email title",
        7,
    );
    let canonical_id = repo.upsert_event_fixture(email.clone()).await.unwrap();

    repo.apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();

    let mut google = timed_upsert(
        owner_id,
        link_id,
        "shared-uid@example.com",
        "Google title",
        1,
    );
    google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "google-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"etag\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    google.event.is_read_only = false;
    let reconciled_id = repo.upsert_event_fixture(google).await.unwrap();

    assert_eq!(reconciled_id, canonical_id);
    let row = sqlx::query!(
        r#"
        SELECT
            (SELECT count(*) FROM calendar_events WHERE owner_id = $1) AS "event_count!",
            (SELECT title FROM calendar_events WHERE id = $2) AS "title!",
            (SELECT count(*) FROM calendar_event_sources WHERE event_id = $2) AS "source_count!"
        "#,
        owner_id,
        canonical_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (row.event_count, row.title, row.source_count),
        (1, "Google title".to_string(), 2)
    );

    let mut later_email = timed_upsert(
        owner_id,
        link_id,
        "shared-uid@example.com",
        "Stale email title",
        99,
    );
    later_email.event.updated_at += Duration::days(1);
    repo.upsert_event_fixture(later_email).await.unwrap();
    let title = sqlx::query_scalar!(
        "SELECT title FROM calendar_events WHERE id = $1",
        canonical_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(title, "Google title");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn canonical_precedence_uses_the_selected_source_clock(pool: PgPool) {
    let owner_id = "macro|calendar-source-clock@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let source_clock = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let google_t1 = source_clock + Duration::hours(1);
    let google_t2 = source_clock + Duration::hours(2);
    let email_t3 = source_clock + Duration::hours(3);

    let mut email = timed_upsert(
        owner_id,
        link_id,
        "source-clock@example.com",
        "Email at T3",
        1,
    );
    email.event.updated_at = email_t3;
    let event_id = repo.upsert_event_fixture(email).await.unwrap();

    repo.apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();

    let mut first_google = timed_upsert(
        owner_id,
        link_id,
        "source-clock@example.com",
        "Google at T1",
        1,
    );
    first_google.event.updated_at = google_t1;
    first_google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "source-clock-google-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"t1\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    repo.upsert_event_fixture(first_google).await.unwrap();

    let mut second_google = timed_upsert(
        owner_id,
        link_id,
        "source-clock@example.com",
        "Google at T2",
        1,
    );
    second_google.event.updated_at = google_t2;
    second_google.source = CalendarEventSource::Google(GoogleEventSource {
        email_link_id: link_id,
        account_id,
        calendar_id,
        provider_event_id: "source-clock-google-event".to_string(),
        provider_recurring_event_id: None,
        provider_etag: Some("\"t2\"".to_string()),
        raw_payload: serde_json::json!({}),
    });
    repo.upsert_event_fixture(second_google).await.unwrap();

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
    assert_eq!(canonical.title, "Google at T2");
    assert_eq!(canonical.canonical_source_updated_at, google_t2);
    assert_eq!(canonical.updated_at, email_t3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fenced_google_snapshot_removes_deleted_events_and_calendars(pool: PgPool) {
    let owner_id = "macro|calendar-snapshot@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();
    let mut google = timed_upsert(
        owner_id,
        link_id,
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
        .apply_google_grant(link_id, complete_grant())
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
    };
    let calendar_id = repo
        .upsert_google_calendar(key, stale_lease, account_id, provider_calendar.clone())
        .await
        .unwrap()
        .id;
    let mut google = timed_upsert(
        owner_id,
        link_id,
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
    .unwrap();

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
async fn google_snapshot_deletion_restores_the_surviving_email_source(pool: PgPool) {
    let owner_id = "macro|calendar-source-fallback@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let email = timed_upsert(
        owner_id,
        link_id,
        "fallback@example.com",
        "Email fallback",
        1,
    );
    let event_id = repo.upsert_event_fixture(email).await.unwrap();
    let enabled = repo
        .apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();
    let mut google = timed_upsert(
        owner_id,
        link_id,
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
    repo.upsert_event_fixture(google).await.unwrap();

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

    let restored = sqlx::query!(
        r#"
        SELECT title, canonical_source_kind,
               (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1) AS "source_count!"
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(restored.title, "Email fallback");
    assert_eq!(restored.canonical_source_kind, "email_ics");
    assert_eq!(restored.source_count, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn incremental_cancellation_tombstones_retire_sources_without_a_snapshot(pool: PgPool) {
    let owner_id = "macro|calendar-tombstone@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let email = timed_upsert(
        owner_id,
        link_id,
        "tombstone@example.com",
        "Email fallback",
        1,
    );
    let event_id = repo.upsert_event_fixture(email).await.unwrap();
    let enabled = repo
        .apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();
    let mut google = timed_upsert(
        owner_id,
        link_id,
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
    repo.upsert_event_fixture(google).await.unwrap();
    let mut instance = timed_upsert(
        owner_id,
        link_id,
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

    let restored = sqlx::query!(
        r#"
        SELECT title, canonical_source_kind,
               (SELECT count(*) FROM calendar_event_sources WHERE event_id = $1) AS "source_count!"
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(restored.title, "Email fallback");
    assert_eq!(restored.canonical_source_kind, "email_ics");
    assert_eq!(restored.source_count, 1);

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
    let upsert = timed_upsert(owner_id, link_id, "range@example.com", "Range test", 1);
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
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn occurrence_cursor_is_stable_when_occurrences_share_a_start(pool: PgPool) {
    let owner_id = "macro|calendar-pagination@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool);
    for ordinal in 1..=3 {
        repo.upsert_event_fixture(timed_upsert(
            owner_id,
            link_id,
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
        .apply_google_grant(link_id, complete_grant())
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
    repo.apply_google_grant(link_id, complete_grant())
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
    repo.apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();

    let build = |title: &str| {
        let mut upsert = timed_upsert(owner_id, link_id, "idempotent@example.com", title, 1);
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
    repo.upsert_event_fixture(timed_upsert(
        child_id,
        link_id,
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

    repo.upsert_event_fixture(timed_upsert(
        child_id,
        delegated_link_id,
        "shared-provider-uid@example.com",
        "Delegated inbox",
        1,
    ))
    .await
    .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        child_id,
        private_link_id,
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
    let mut latest = timed_upsert(owner_id, link_id, "stale-sequence@example.com", "Latest", 4);
    latest.event.updated_at += Duration::days(2);
    let event_id = repo.upsert_event_fixture(latest).await.unwrap();

    let mut stale = timed_upsert(owner_id, link_id, "stale-sequence@example.com", "Stale", 4);
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
        .apply_google_grant(link_id, complete_grant())
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
            },
        )
        .await
        .unwrap();

    let mut latest = timed_upsert(
        owner_id,
        link_id,
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
        .apply_google_grant(link_id, complete_grant())
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
