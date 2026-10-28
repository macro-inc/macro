use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn empty_calendars_require_strict_full_verification_and_old_writes_revoke_it(pool: PgPool) {
    let owner = "macro|empty-snapshot@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let grant = repo
        .apply_google_grant(
            link,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let job = grant
        .jobs
        .iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let account = job.account_id.unwrap();
    let key = CalendarBackfillJobKey {
        job_id: job.id,
        email_link_id: link,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("the calendar job should be claimable");
    };
    let calendar = ProviderCalendar {
        provider_calendar_id: "primary".to_owned(),
        name: "Primary".to_owned(),
        description: None,
        time_zone: Some("UTC".to_owned()),
        color: None,
        access_role: Some("owner".to_owned()),
        is_primary: true,
        is_selected: true,
        default_reminders: Vec::new(),
    };
    let calendar_id = repo
        .upsert_google_calendar(key, lease_token, account, calendar.clone())
        .await
        .unwrap()
        .id;
    let version = || async {
        sqlx::query_scalar!(
            "SELECT snapshot_normalization_version FROM calendars WHERE id=$1",
            calendar_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    // The migration preserves a legacy worker's token and coverage while its
    // certificate remains zero. This empty snapshot has no source row whose
    // role could demand a rebuild: strict calendar upsert must independently
    // invalidate that preserved incremental state before provider sync.
    sqlx::query!("UPDATE calendars SET sync_token='legacy',synced_at=now(),materialized_starts_at='2026-07-01',materialized_ends_at='2026-08-01',materialized_start_date='2026-07-01',materialized_end_date='2026-08-01' WHERE id=$1", calendar_id).execute(&pool).await.unwrap();
    assert_eq!(version().await, 0);
    let stored = repo
        .upsert_google_calendar(key, lease_token, account, calendar.clone())
        .await
        .unwrap();
    assert!(stored.sync_token.is_none());
    assert!(stored.materialized_range.is_none());
    assert!(stored.synced_at.is_none());
    assert_eq!(
        version().await,
        0,
        "invalidating preserved state cannot itself certify an empty calendar"
    );
    let full = GoogleCalendarSyncSnapshot {
        calendar_id,
        next_sync_token: "strict-full".to_owned(),
        observed_provider_event_ids: Some(Vec::new()),
        materialized_range: Some(july_2026_range()),
        cancelled_provider_event_ids: Vec::new(),
    };
    repo.commit_google_calendar_sync(key, lease_token, account, full.clone(), 0)
        .await
        .unwrap();
    assert_eq!(version().await, 1);

    let incremental = GoogleCalendarSyncSnapshot {
        next_sync_token: "strict-incremental".to_owned(),
        observed_provider_event_ids: None,
        materialized_range: None,
        ..full.clone()
    };
    repo.commit_google_calendar_sync(key, lease_token, account, incremental.clone(), 0)
        .await
        .unwrap();
    assert_eq!(
        version().await,
        1,
        "ordinary strict polling preserves certification"
    );
    let stored = repo
        .upsert_google_calendar(key, lease_token, account, calendar.clone())
        .await
        .unwrap();
    assert_eq!(stored.sync_token.as_deref(), Some("strict-incremental"));
    assert!(stored.materialized_range.is_some());

    // An old worker omits the new certification column. The database must
    // revoke the certificate even if this follows a newer worker's success.
    sqlx::query!(
        "UPDATE calendars SET sync_token='legacy-after-strict',synced_at=now() WHERE id=$1",
        calendar_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(version().await, 0);
    repo.commit_google_calendar_sync(key, lease_token, account, incremental, 0)
        .await
        .unwrap();
    assert_eq!(
        version().await,
        0,
        "a token-only response cannot repair lost coverage"
    );
    let stored = repo
        .upsert_google_calendar(key, lease_token, account, calendar)
        .await
        .unwrap();
    assert!(stored.sync_token.is_none());
    assert!(stored.materialized_range.is_none());
    repo.commit_google_calendar_sync(key, lease_token, account, full, 0)
        .await
        .unwrap();
    assert_eq!(version().await, 1);
}
