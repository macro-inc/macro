use super::*;

/// Calendar events that still hold an access grant, in id order.
async fn granted_event_ids(pool: &PgPool) -> Vec<Uuid> {
    sqlx::query_scalar!(
        r#"
        SELECT entity_id AS "entity_id!"
        FROM entity_access
        WHERE entity_type = 'calendar_event'
        ORDER BY entity_id
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_an_event_through_macro_removes_its_channel_grants(pool: PgPool) {
    let sharer_id = "macro|grant-sharer@example.com";
    let member_id = "macro|grant-member@example.com";
    let sharer_link = insert_link(&pool, sharer_id).await;
    let member_link = insert_link(&pool, member_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = grant_and_provider_ids(&repo, sharer_link).await;
    let team_id = repo
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

    // The sharer holds the meeting on two of their calendars (one entity, two
    // sources); the member holds their own copy, which is a separate entity.
    let sharer_event_id = repo
        .upsert_event_fixture(timed_upsert(
            sharer_id,
            sharer_link,
            (account_id, primary_id),
            "grant-meeting@example.com",
            "Planning",
            1,
        ))
        .await
        .unwrap();
    let mut team_copy = timed_upsert(
        sharer_id,
        sharer_link,
        (account_id, team_id),
        "grant-meeting@example.com",
        "Planning",
        1,
    );
    team_copy.source = CalendarEventSource::Google(ProviderEventSource {
        automatic_decline: None,
        binding: None,
        observed_access_role: Some("writer".to_owned()),
        email_link_id: sharer_link,
        account_id,
        calendar_id: team_id,
        provider_event_id: "team-grant-meeting".to_string(),
        provider_recurring_event_id: None,
        provider_etag: None,
        raw_payload: serde_json::json!({}),
    });
    assert_eq!(
        repo.upsert_event_fixture(team_copy).await.unwrap(),
        sharer_event_id
    );
    let member_provider = provider_ids(&repo, member_link).await;
    let member_event_id = repo
        .upsert_event_fixture(timed_upsert(
            member_id,
            member_link,
            member_provider,
            "grant-meeting@example.com",
            "Planning",
            1,
        ))
        .await
        .unwrap();
    let channel_id = insert_channel(&pool, sharer_id, &[sharer_id, member_id]).await;
    share_with_channel(&pool, sharer_event_id, channel_id).await;
    share_with_channel(&pool, member_event_id, channel_id).await;
    let mut both = vec![sharer_event_id, member_event_id];
    both.sort();

    // Removing it from one calendar leaves the event, and its grant, in place.
    repo.remove_provider_source(account_id, primary_id, "provider-grant-meeting@example.com")
        .await
        .unwrap();
    assert_eq!(granted_event_ids(&pool).await, both);

    // Removing the last source deletes the sharer's copy and its grant; the
    // member's copy of the same meeting keeps its own.
    repo.remove_provider_source(account_id, team_id, "team-grant-meeting")
        .await
        .unwrap();
    assert_eq!(granted_event_ids(&pool).await, vec![member_event_id]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cancelled_occurrence_keeps_the_series_grant_and_a_cancelled_series_drops_it(
    pool: PgPool,
) {
    let owner_id = "macro|grant-series@example.com";
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
    let provider = provider_ids(&repo, link_id).await;
    let series = timed_upsert(
        owner_id,
        link_id,
        provider,
        "grant-series@example.com",
        "Standup",
        1,
    );
    let event_id = repo.upsert_event_fixture(series.clone()).await.unwrap();
    let channel_id = insert_channel(&pool, owner_id, &[owner_id]).await;
    share_with_channel(&pool, event_id, channel_id).await;

    // Google cancels one instance by refreshing the series without it.
    let mut one_cancelled = series;
    one_cancelled.event.sequence = 2;
    one_cancelled.event.updated_at += Duration::minutes(1);
    one_cancelled.occurrences[1].is_cancelled = true;
    assert_eq!(
        repo.upsert_event_fixture(one_cancelled).await.unwrap(),
        event_id
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM calendar_event_occurrences WHERE event_id = $1 AND is_cancelled"#,
            event_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    assert_eq!(granted_event_ids(&pool).await, vec![event_id]);

    // A tombstone for the series retires it, and the grant goes with it.
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
        provider.0,
        GoogleCalendarSyncSnapshot {
            calendar_id: provider.1,
            next_sync_token: "after-tombstone".to_string(),
            observed_provider_event_ids: None,
            materialized_range: None,
            cancelled_provider_event_ids: vec!["provider-grant-series@example.com".to_string()],
        },
        0,
    )
    .await
    .unwrap();
    assert_eq!(granted_event_ids(&pool).await, Vec::<Uuid>::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_the_calendar_or_the_inbox_removes_its_events_grants(pool: PgPool) {
    let owner_id = "macro|grant-inbox@example.com";
    let disconnected_link = insert_link(&pool, owner_id).await;
    let removed_link = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (_, _, disconnected_event_id, _) =
        connected_calendar(&pool, &repo, owner_id, disconnected_link).await;
    let removed_provider = provider_ids(&repo, removed_link).await;
    let removed_event_id = repo
        .upsert_event_fixture(timed_upsert(
            owner_id,
            removed_link,
            removed_provider,
            "grant-inbox@example.com",
            "Review",
            1,
        ))
        .await
        .unwrap();
    let channel_id = insert_channel(&pool, owner_id, &[owner_id]).await;
    share_with_channel(&pool, disconnected_event_id, channel_id).await;
    share_with_channel(&pool, removed_event_id, channel_id).await;

    // Turning calendar off for one inbox deletes its events.
    repo.disconnect_provider_calendar(owner_id, disconnected_link)
        .await
        .unwrap()
        .expect("the owner's inbox is disconnectable");
    assert_eq!(granted_event_ids(&pool).await, vec![removed_event_id]);

    // Removing the other inbox cascades to its events.
    sqlx::query!("DELETE FROM email_links WHERE id = $1", removed_link)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(granted_event_ids(&pool).await, Vec::<Uuid>::new());
}
