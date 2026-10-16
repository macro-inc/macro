use super::*;
use crate::outbound::pg::source_access::verify_calendar_snapshot;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_metadata_changes_never_certify_unchanged_ooo(pool: PgPool) {
    let owner = "macro|calendar-refresh@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account, calendar_id) = provider_ids(&repo, link).await;
    let mut tx = pool.begin().await.unwrap();
    let mut log = ChangeLogBatch::default();
    let mut calendar = ProviderCalendar {
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
    verify_calendar_snapshot(&mut tx, account, calendar_id)
        .await
        .unwrap();
    let (_, changed) =
        upsert_calendar_tx(&mut tx, &mut log, link, account, calendar.clone(), false)
            .await
            .unwrap();
    assert!(
        !changed,
        "an unchanged verified calendar leaves OOO rows intact"
    );

    calendar.is_primary = false;
    let (_, changed) =
        upsert_calendar_tx(&mut tx, &mut log, link, account, calendar.clone(), false)
            .await
            .unwrap();
    assert!(changed, "OOO reads only primary calendars");

    verify_calendar_snapshot(&mut tx, account, calendar_id)
        .await
        .unwrap();
    calendar.access_role = Some("reader".to_string());
    let (_, changed) = upsert_calendar_tx(&mut tx, &mut log, link, account, calendar, false)
        .await
        .unwrap();
    assert!(changed, "provider ACL changes require immediate clearing");
    tx.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refresh_hint_preserves_unrelated_events_but_clears_old_and_new_ooo(pool: PgPool) {
    let owner = "macro|refresh@example.com";
    insert_user(&pool, owner).await;
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool);
    let provider = provider_ids(&repo, link).await;
    let mut upsert = timed_upsert(owner, link, provider, "refresh@example.com", "Meeting", 1);

    let regular = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert!(!regular.team_ooo_changed);
    upsert.event.sequence += 1;
    upsert.event.title = "Renamed meeting".to_string();
    let renamed = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert!(!renamed.team_ooo_changed);

    upsert.event.sequence += 1;
    upsert.event.event_type = EventType::OutOfOffice;
    let ooo = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert!(ooo.team_ooo_changed);

    let replay = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert!(
        !replay.team_ooo_changed,
        "identical OOO snapshots do not withdraw cached rows"
    );

    upsert.event.sequence += 1;
    upsert.event.visibility = EventVisibility::Private;
    let private = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert!(
        private.team_ooo_changed,
        "a private OOO withdraws even its status"
    );

    upsert.event.sequence += 1;
    upsert.event.event_type = EventType::Default;
    let former_ooo = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert!(
        former_ooo.team_ooo_changed,
        "the stored source was OOO before this write"
    );

    upsert.event.sequence += 1;
    upsert.event.title = "Private meeting".to_string();
    let unrelated = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert))
        .await
        .unwrap();
    assert!(!unrelated.team_ooo_changed);
}
