use super::*;
use crate::domain::models::{CalendarFreshness, CalendarSyncHealth};
use crate::domain::ports::CalendarSyncHealthReader;

fn google_calendar(provider_calendar_id: &str, is_primary: bool) -> ProviderCalendar {
    ProviderCalendar {
        provider_calendar_id: provider_calendar_id.to_string(),
        name: provider_calendar_id.to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some(if is_primary { "owner" } else { "reader" }.to_string()),
        is_primary,
        is_selected: true,
        default_reminders: Vec::new(),
    }
}

async fn set_account_status(pool: &PgPool, link_id: Uuid, status: &str) {
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status = $2, last_synced_at = now() WHERE email_link_id = $1",
        link_id,
        status,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn synced_at(pool: &PgPool, calendar_id: Uuid) -> DateTime<Utc> {
    sqlx::query_scalar!("SELECT synced_at FROM calendars WHERE id = $1", calendar_id)
        .fetch_one(pool)
        .await
        .unwrap()
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_health_reads_each_calendar_and_account_state(pool: PgPool) {
    let owner_id = "macro|calendar-sync-health@example.com";
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

    // A connected inbox whose first sync has not listed a calendar yet.
    assert_eq!(
        repo.calendar_sync_health(owner_id).await.unwrap(),
        CalendarSyncHealth {
            calendars: Vec::new(),
            unlisted_inboxes: vec![link_id],
        }
    );

    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    let primary = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            google_calendar("primary", true),
        )
        .await
        .unwrap()
        .id;
    let team = repo
        .upsert_google_calendar(key, lease_token, account_id, google_calendar("team", false))
        .await
        .unwrap()
        .id;

    // Listed but not synced, while the account runs its first import.
    let health = repo.calendar_sync_health(owner_id).await.unwrap();
    assert!(health.unlisted_inboxes.is_empty());
    assert_eq!(
        health.calendars.iter().find(|c| c.calendar_id == primary),
        Some(&CalendarFreshness {
            calendar_id: primary,
            refresh_due_at: None,
            failure: Some(CalendarSyncFailure::Transient),
        })
    );

    for calendar_id in [primary, team] {
        repo.commit_google_calendar_sync(
            key,
            lease_token,
            account_id,
            GoogleCalendarSyncSnapshot {
                calendar_id,
                next_sync_token: "synced".to_string(),
                observed_provider_event_ids: Some(Vec::new()),
                materialized_range: Some(OccurrenceRange::historical_sync(
                    Utc::now().trunc_subsecs(6),
                )),
                cancelled_provider_event_ids: Vec::new(),
            },
            0,
        )
        .await
        .unwrap();
    }
    set_account_status(&pool, link_id, "ready").await;
    let freshness = |health: &CalendarSyncHealth, id: Uuid| {
        health
            .calendars
            .iter()
            .find(|c| c.calendar_id == id)
            .cloned()
            .unwrap()
    };

    let health = repo.calendar_sync_health(owner_id).await.unwrap();
    let primary_synced_at = synced_at(&pool, primary).await;
    assert_eq!(
        freshness(&health, primary),
        CalendarFreshness {
            calendar_id: primary,
            refresh_due_at: Some(primary_synced_at),
            failure: None,
        }
    );

    // Each failure keeps the last successful sync and says what failed.
    for kind in [
        CalendarSyncFailure::Transient,
        CalendarSyncFailure::Permanent,
    ] {
        repo.record_google_calendar_sync_error(
            key,
            lease_token,
            account_id,
            primary,
            kind,
            "provider failure",
        )
        .await
        .unwrap();
        let health = repo.calendar_sync_health(owner_id).await.unwrap();
        assert_eq!(
            freshness(&health, primary),
            CalendarFreshness {
                calendar_id: primary,
                refresh_due_at: Some(primary_synced_at),
                failure: Some(kind),
            }
        );
        assert_eq!(freshness(&health, team).failure, None);
    }

    // A failure an older build stored without a kind reads as permanent.
    sqlx::query!(
        "UPDATE calendars SET last_sync_error_kind = NULL WHERE id = $1",
        primary
    )
    .execute(&pool)
    .await
    .unwrap();
    let health = repo.calendar_sync_health(owner_id).await.unwrap();
    assert_eq!(
        freshness(&health, primary).failure,
        Some(CalendarSyncFailure::Permanent)
    );

    // The account's state reaches every calendar it holds: a failed Google
    // run waiting to retry, a Google run that failed for good, a lost grant.
    for (status, failure) in [
        ("pending", CalendarSyncFailure::Transient),
        ("error", CalendarSyncFailure::Permanent),
        ("reauth_required", CalendarSyncFailure::ReauthRequired),
    ] {
        set_account_status(&pool, link_id, status).await;
        let health = repo.calendar_sync_health(owner_id).await.unwrap();
        assert_eq!(freshness(&health, team).failure, Some(failure), "{status}");
    }

    // A successful sync clears the calendar's failure and its kind.
    set_account_status(&pool, link_id, "ready").await;
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id: primary,
            next_sync_token: "recovered".to_string(),
            observed_provider_event_ids: Some(Vec::new()),
            materialized_range: Some(OccurrenceRange::historical_sync(
                Utc::now().trunc_subsecs(6),
            )),
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    let health = repo.calendar_sync_health(owner_id).await.unwrap();
    assert_eq!(freshness(&health, primary).failure, None);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT last_sync_error_kind FROM calendars WHERE id = $1",
            primary
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        None
    );
    assert!(
        repo.calendar_sync_health("macro|calendar-sync-health-stranger@example.com")
            .await
            .unwrap()
            .calendars
            .is_empty()
    );
}
