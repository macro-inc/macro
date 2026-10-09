use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pre_migration_sources_force_a_full_refresh_before_team_readiness(pool: PgPool) {
    let owner = "macro|snapshot-upgrade@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let original = timed_upsert(owner, link, provider, "upgrade@example.com", "Unchanged", 1);
    let event_id = repo.upsert_event_fixture(original.clone()).await.unwrap();
    sqlx::query!(
        "UPDATE calendar_event_sources SET provider_access_role = NULL WHERE event_id = $1",
        event_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendars SET sync_token = 'old-token', synced_at = now() WHERE id = $1",
        provider.1
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.upsert_calendar_fixture(
        provider.0,
        ProviderCalendar {
            provider_calendar_id: "primary".to_owned(),
            name: "Primary".to_owned(),
            description: None,
            time_zone: Some("UTC".to_owned()),
            color: None,
            access_role: Some("owner".to_owned()),
            is_primary: true,
            is_selected: true,
            default_reminders: Vec::new(),
        },
    )
    .await
    .unwrap();
    let refreshed = sqlx::query!(
        "SELECT sync_token, synced_at FROM calendars WHERE id = $1",
        provider.1
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(refreshed.sync_token.is_none());
    assert!(refreshed.synced_at.is_none());
    assert_eq!(repo.upsert_event_fixture(original).await.unwrap(), event_id);
    let role = sqlx::query_scalar!(
        "SELECT provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role.as_deref(), Some("owner"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn role_change_requires_a_new_snapshot_without_changing_event_identity(pool: PgPool) {
    let owner = "macro|role-change@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let mut original = timed_upsert(
        owner,
        link,
        provider,
        "stable-role@example.com",
        "Original",
        1,
    );
    let event_id = repo.upsert_event_fixture(original.clone()).await.unwrap();
    sqlx::query!(
        "UPDATE calendars SET sync_token = 'old-token', synced_at = now(), materialized_starts_at = now(), materialized_ends_at = now() + interval '1 day', materialized_start_date = current_date, materialized_end_date = current_date + 1 WHERE id = $1",
        provider.1,
    ).execute(&pool).await.unwrap();

    repo.upsert_calendar_fixture(
        provider.0,
        ProviderCalendar {
            provider_calendar_id: "primary".to_owned(),
            name: "Primary".to_owned(),
            description: None,
            time_zone: Some("UTC".to_owned()),
            color: None,
            access_role: Some("reader".to_owned()),
            is_primary: true,
            is_selected: true,
            default_reminders: Vec::new(),
        },
    )
    .await
    .unwrap();
    let invalidated = sqlx::query!(
        "SELECT calendar.sync_token, calendar.synced_at, calendar.materialized_starts_at, source.provider_access_role FROM calendars calendar JOIN calendar_event_sources source ON source.calendar_id = calendar.id WHERE source.event_id = $1",
        event_id,
    ).fetch_one(&pool).await.unwrap();
    assert!(invalidated.sync_token.is_none());
    assert!(invalidated.synced_at.is_none());
    assert!(invalidated.materialized_starts_at.is_none());
    assert_eq!(invalidated.provider_access_role.as_deref(), Some("owner"));

    // The provider can return the same content and sequence under the new
    // role. Verification must work through the no-op fast path too.
    let CalendarEventSource::Google(source) = &mut original.source;
    source.observed_access_role = Some("reader".to_owned());
    assert_eq!(repo.upsert_event_fixture(original).await.unwrap(), event_id);
    let verified = sqlx::query_scalar!(
        "SELECT provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(verified.as_deref(), Some("reader"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn provider_redaction_replaces_details_even_without_a_sequence_change(pool: PgPool) {
    let owner = "macro|role-redaction@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let mut snapshot = timed_upsert(
        owner,
        link,
        provider,
        "redacted@example.com",
        "Private title",
        1,
    );
    snapshot.event.description = Some("Private body".to_owned());
    snapshot.event.visibility = EventVisibility::Private;
    let event_id = repo.upsert_event_fixture(snapshot.clone()).await.unwrap();
    sqlx::query!(
        "UPDATE calendars SET access_role = 'reader' WHERE id = $1",
        provider.1
    )
    .execute(&pool)
    .await
    .unwrap();
    snapshot.event.title.clear();
    snapshot.event.description = None;
    snapshot.event.attendees.clear();
    let CalendarEventSource::Google(source) = &mut snapshot.source;
    source.observed_access_role = Some("reader".to_owned());
    assert_eq!(repo.upsert_event_fixture(snapshot).await.unwrap(), event_id);
    let redacted = sqlx::query!(
        "SELECT title, description, provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    ).fetch_one(&pool).await.unwrap();
    assert!(redacted.title.is_empty());
    assert!(redacted.description.is_none());
    assert_eq!(redacted.provider_access_role.as_deref(), Some("reader"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_mutation_echo_cannot_verify_content_under_a_new_role(pool: PgPool) {
    let owner = "macro|delayed-mutation@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let original = timed_upsert(owner, link, provider, "late@example.com", "Old details", 1);
    let event_id = repo.upsert_event_fixture(original.clone()).await.unwrap();

    // The worker has already detected a lower role and reconciled the source
    // before an in-flight mutation's richer provider response arrives.
    sqlx::query!(
        "UPDATE calendars SET access_role = 'reader', synced_at = now() WHERE id = $1",
        provider.1,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut redacted = original.clone();
    redacted.event.title.clear();
    let CalendarEventSource::Google(source) = &mut redacted.source;
    source.observed_access_role = Some("reader".to_owned());
    repo.upsert_event_fixture(redacted.clone()).await.unwrap();
    repo.upsert_event(CalendarEventWrite::UserMutation(original.clone()))
        .await
        .unwrap();

    let role = sqlx::query_scalar!(
        "SELECT provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role.as_deref(), Some("owner"));
    let eligible = sqlx::query_scalar!(
        "SELECT source.provider_access_role = calendar.access_role AS \"eligible!\" FROM calendar_event_sources source JOIN calendars calendar ON calendar.id=source.calendar_id WHERE source.event_id=$1",
        event_id,
    ).fetch_one(&pool).await.unwrap();
    assert!(
        !eligible,
        "the delayed response retains its old, ineligible role"
    );

    // Retrying the identical mutation takes the no-op path. It must not turn
    // the mismatched snapshot into evidence of the current reader grant.
    repo.upsert_event(CalendarEventWrite::UserMutation(original))
        .await
        .unwrap();
    let role = sqlx::query_scalar!(
        "SELECT provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role.as_deref(), Some("owner"));

    repo.upsert_event_fixture(redacted).await.unwrap();
    let verified = sqlx::query!(
        "SELECT title, provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(verified.title.is_empty());
    assert_eq!(verified.provider_access_role.as_deref(), Some("reader"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unchanged_mutation_preserves_but_never_elevates_source_verification(pool: PgPool) {
    let owner = "macro|unchanged-mutation@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let original = timed_upsert(owner, link, provider, "noop@example.com", "Same details", 1);
    let event_id = repo.upsert_event_fixture(original.clone()).await.unwrap();
    repo.upsert_event(CalendarEventWrite::UserMutation(original.clone()))
        .await
        .unwrap();
    let role = sqlx::query_scalar!(
        "SELECT provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role.as_deref(), Some("owner"));

    sqlx::query!(
        "UPDATE calendars SET access_role = 'reader' WHERE id = $1",
        provider.1,
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.upsert_event(CalendarEventWrite::UserMutation(original))
        .await
        .unwrap();
    let role = sqlx::query_scalar!(
        "SELECT provider_access_role FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role.as_deref(), Some("owner"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ordinary_mutation_preserves_incremental_sync_and_verified_access(pool: PgPool) {
    let owner = "macro|ordinary-mutation@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let mut original = timed_upsert(owner, link, provider, "ordinary@example.com", "Before", 1);
    original.event.is_read_only = false;
    let event_id = repo.upsert_event_fixture(original.clone()).await.unwrap();
    let target = repo
        .get_event_mutation_target(owner, event_id, Some(provider.1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(target.observed_access_role.as_deref(), Some("owner"));
    assert_eq!(target.account_id, provider.0);
    assert_eq!(target.calendar_id, provider.1);

    sqlx::query!(
        "UPDATE calendars SET sync_token='keep-token', synced_at=now(), materialized_starts_at='2026-07-01', materialized_ends_at='2026-08-01', materialized_start_date='2026-07-01', materialized_end_date='2026-08-01' WHERE id=$1",
        provider.1,
    ).execute(&pool).await.unwrap();
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=1 WHERE id=$1",
        provider.1,
    )
    .execute(&pool)
    .await
    .unwrap();
    original.event.title = "After".to_owned();
    original.event.sequence += 1;
    original.event.updated_at += Duration::minutes(1);
    let CalendarEventSource::Google(source) = &mut original.source;
    source.observed_access_role = target.observed_access_role;
    repo.upsert_event(CalendarEventWrite::UserMutation(original))
        .await
        .unwrap();

    // A routine CalendarList refresh must keep the event-change token and
    // materialized range; an edit alone is not an entitlement transition.
    repo.upsert_calendar_fixture(
        provider.0,
        ProviderCalendar {
            provider_calendar_id: "primary".to_owned(),
            name: "Primary".to_owned(),
            description: None,
            time_zone: Some("UTC".to_owned()),
            color: None,
            access_role: Some("owner".to_owned()),
            is_primary: true,
            is_selected: true,
            default_reminders: Vec::new(),
        },
    )
    .await
    .unwrap();
    let state = sqlx::query!(
        "SELECT calendar.sync_token, calendar.synced_at, calendar.materialized_starts_at, source.provider_access_role, source.title FROM calendars calendar JOIN calendar_event_sources source ON source.calendar_id=calendar.id WHERE source.event_id=$1",
        event_id,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(state.sync_token.as_deref(), Some("keep-token"));
    assert!(state.synced_at.is_some());
    assert!(state.materialized_starts_at.is_some());
    assert_eq!(state.provider_access_role.as_deref(), Some("owner"));
    assert_eq!(state.title, "After");
}
