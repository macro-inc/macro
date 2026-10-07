use super::*;
use crate::domain::team::{CalendarTeamRepository, TeamCalendarCoverage, TeamCalendarSharing};
use crate::outbound::pg_team::PgCalendarTeamRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_sources_require_current_membership_and_verified_source_entitlement(pool: PgPool) {
    let viewer = "macro|team-viewer@example.com";
    let owner = "macro|team-owner@example.com";
    let outsider = "macro|outsider@example.com";
    let team_id = insert_team(&pool, viewer, &[viewer, owner]).await;
    insert_user(&pool, outsider).await;
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account, primary) = provider_ids(&repo, link).await;
    let secondary = repo
        .upsert_calendar_fixture(
            account,
            ProviderCalendar {
                provider_calendar_id: "subscribed".into(),
                name: "Coworker".into(),
                description: None,
                time_zone: Some("America/New_York".into()),
                color: None,
                access_role: Some("reader".into()),
                is_primary: false,
                is_selected: true,
                default_reminders: vec![],
            },
        )
        .await
        .unwrap();
    // The entity's primary content is deliberately richer than the secondary
    // copy. A source read must never attach that content to the reader source.
    let first = timed_upsert(
        owner,
        link,
        (account, primary),
        "same-meeting",
        "Primary secret",
        1,
    );
    repo.upsert_event_fixture(first).await.unwrap();
    let mut other = timed_upsert(
        owner,
        link,
        (account, secondary),
        "same-meeting",
        "Reader-visible title",
        2,
    );
    other.event.conference_url = Some("https://reader.example.com".into());
    let CalendarEventSource::Google(source) = &mut other.source;
    source.observed_access_role = Some("reader".to_owned());
    repo.upsert_event_fixture(other).await.unwrap();
    sqlx::query!(
        "UPDATE calendars SET synced_at=now(),materialized_starts_at='2026-07-01',materialized_ends_at='2026-08-01',materialized_start_date='2026-07-01',materialized_end_date='2026-08-01' WHERE account_id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status='ready',last_synced_at=now() WHERE id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=1 WHERE account_id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    let team = PgCalendarTeamRepository::new(pool.clone());
    assert_eq!(
        team.sharing(owner).await.unwrap(),
        TeamCalendarSharing::BusyOnly
    );
    let owners = [owner.to_owned()];
    assert_eq!(
        team.members(viewer, false, &july_2026_range())
            .await
            .unwrap()[0]
            .coverage,
        TeamCalendarCoverage::Ready
    );
    let pending_link = insert_link(&pool, owner).await;
    let pending_account = repo.upsert_google_account(pending_link).await.unwrap();
    assert_eq!(
        team.members(viewer, false, &july_2026_range())
            .await
            .unwrap()[0]
            .coverage,
        TeamCalendarCoverage::Unavailable,
        "a newly connected account without discovered calendars prevents a complete availability claim"
    );
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status='disabled' WHERE id=$1",
        pending_account
    )
    .execute(&pool)
    .await
    .unwrap();
    let rows = team
        .sources(viewer, july_2026_range(), &owners, None, 100)
        .await
        .unwrap();
    assert_eq!(rows.len(), 4, "all synced source calendars are included");
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=0 WHERE account_id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        team.members(viewer, false, &july_2026_range())
            .await
            .unwrap()[0]
            .coverage,
        TeamCalendarCoverage::Unavailable
    );
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=1 WHERE account_id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    let subscribed = rows
        .iter()
        .find(|row| row.calendar_id == secondary)
        .unwrap();
    assert_eq!(subscribed.event.title, "Reader-visible title");
    assert_eq!(
        subscribed.event.conference_url.as_deref(),
        Some("https://reader.example.com")
    );
    assert!(!subscribed.contributes_to_availability);
    assert!(
        team.sources(outsider, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty()
    );
    // A detected entitlement change hides the old source snapshot immediately.
    let initial_revision = team.projection_revision(viewer).await.unwrap();
    sqlx::query!(
        "UPDATE calendars SET access_role='freeBusyReader' WHERE id=$1",
        secondary
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .len(),
        2
    );
    assert_ne!(
        initial_revision,
        team.projection_revision(viewer).await.unwrap()
    );
    assert_eq!(
        team.members(viewer, false, &july_2026_range())
            .await
            .unwrap()[0]
            .coverage,
        TeamCalendarCoverage::Unavailable
    );
    team.set_sharing(owner, TeamCalendarSharing::None)
        .await
        .unwrap();
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty()
    );
    team.set_sharing(owner, TeamCalendarSharing::All)
        .await
        .unwrap();
    sqlx::query!("DELETE FROM team_user WHERE user_id=$1", owner)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty(),
        "membership revocation removes every source immediately"
    );
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES($1,$2,'member')",
        owner,
        team_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendar_accounts SET last_sync_error='provider failure' WHERE id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty(),
        "known provider failures cannot keep resharing old snapshots"
    );
    sqlx::query!("UPDATE calendar_accounts SET last_sync_error=NULL,last_synced_at=now()-interval '16 minutes' WHERE id=$1", account).execute(&pool).await.unwrap();
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty(),
        "stale source authorization fails closed"
    );
    assert!(
        !team
            .set_availability_calendar(outsider, primary, true)
            .await
            .unwrap()
    );
    assert!(
        team.set_availability_calendar(owner, secondary, true)
            .await
            .unwrap()
    );
    assert!(
        team.availability_calendars(owner)
            .await
            .unwrap()
            .iter()
            .find(|calendar| calendar.calendar_id == secondary)
            .unwrap()
            .contributes_to_availability
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_sources_follow_direct_delegation_without_recursive_resharing(pool: PgPool) {
    let viewer = "macro|delegation-viewer@example.com";
    let sharer = "macro|delegation-sharer@example.com";
    let account_owner = "macro|delegation-owner@example.com";
    insert_team(&pool, viewer, &[viewer, sharer]).await;
    insert_user(&pool, account_owner).await;
    let link = insert_link(&pool, account_owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account, calendar) = provider_ids(&repo, link).await;
    repo.upsert_event_fixture(timed_upsert(
        account_owner,
        link,
        (account, calendar),
        "directly-delegated-meeting",
        "Visible through a direct account link",
        1,
    ))
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status='ready',last_synced_at=now() WHERE id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("UPDATE calendars SET synced_at=now() WHERE id=$1", calendar)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=1 WHERE account_id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    let team = PgCalendarTeamRepository::new(pool.clone());
    let owners = [sharer.to_owned()];
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty(),
        "team membership alone does not create access to another user's sources"
    );
    sqlx::query!(
        "INSERT INTO macro_user_links(primary_macro_id,child_macro_id,link_id) VALUES($1,$2,$3)",
        sharer,
        account_owner,
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    let revision = team.projection_revision(viewer).await.unwrap();
    let rows = team
        .sources(viewer, july_2026_range(), &owners, None, 100)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.shared_by == sharer));
    assert!(rows.iter().all(|row| !row.contributes_to_availability));
    assert!(
        team.sources(
            viewer,
            july_2026_range(),
            &[account_owner.to_owned()],
            None,
            100,
        )
        .await
        .unwrap()
        .is_empty(),
        "a directly linked source does not add its owner to the viewer's team"
    );
    sqlx::query!(
        "DELETE FROM macro_user_links WHERE primary_macro_id=$1 AND link_id=$2",
        sharer,
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_ne!(revision, team.projection_revision(viewer).await.unwrap());
    assert!(
        team.sources(viewer, july_2026_range(), &owners, None, 100)
            .await
            .unwrap()
            .is_empty(),
        "revoking the direct link removes every team projection from that link"
    );
}
