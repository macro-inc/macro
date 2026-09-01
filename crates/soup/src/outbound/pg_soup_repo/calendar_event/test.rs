use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::Frecency;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn frecency_fallback_keeps_calendar_events_with_aggregates(
    pool: PgPool,
) -> anyhow::Result<()> {
    let owner_id = "macro|calendar-frecency@example.com";
    let link_id = Uuid::now_v7();
    let event_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, 'calendar-frecency@example.com', 'GMAIL')
        "#,
        link_id,
        owner_id,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title,
            starts_at, ends_at, canonical_source_kind,
            canonical_source_updated_at
        )
        VALUES (
            $1, $2, $3, 'calendar-frecency@example.com', 'Frecency event',
            now(), now() + interval '1 hour', 'google', now()
        )
        "#,
        event_id,
        owner_id,
        link_id,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO frecency_aggregates (
            entity_id, entity_type, user_id, event_count,
            frecency_score, first_event, recent_events
        )
        VALUES ($1, 'calendar_event', $2, 1, 10, now(), '[]')
        "#,
        event_id.to_string(),
        owner_id,
    )
    .execute(&pool)
    .await?;

    let items = cursor_soup(
        &pool,
        SimpleSortRequest {
            limit: 10,
            cursor: SimpleSortQuery::FilterFrecency(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                Frecency,
            )),
            user_id: MacroUserIdStr::parse_from_str(owner_id)?,
        },
    )
    .await?;

    assert_eq!(items.len(), 1);
    assert!(matches!(
        &items[0],
        SoupItem::CalendarEvent(event) if event.id == event_id
    ));
    Ok(())
}

/// A fired reminder counts as the event's latest activity: recency sorting
/// must place the event at its delivery time, not at the older Google
/// last-modified time that made reminder rows surface in the past.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recency_sort_uses_reminder_delivery_time(pool: PgPool) -> anyhow::Result<()> {
    let owner_id = "macro|calendar-fired@example.com";
    let link_id = Uuid::now_v7();
    let reminded_id = Uuid::now_v7();
    let edited_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, 'calendar-fired@example.com', 'GMAIL')
        "#,
        link_id,
        owner_id,
    )
    .execute(&pool)
    .await?;
    // Created long ago and never edited since, but its alarm just fired.
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title,
            starts_at, ends_at, canonical_source_kind,
            canonical_source_updated_at, updated_at, last_reminder_fired_at
        )
        VALUES (
            $1, $2, $3, 'reminded@example.com', 'Reminded event',
            now(), now() + interval '1 hour', 'google', now(),
            now() - interval '10 days', now()
        )
        "#,
        reminded_id,
        owner_id,
        link_id,
    )
    .execute(&pool)
    .await?;
    // Edited more recently than the reminded event, no alarm fired.
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title,
            starts_at, ends_at, canonical_source_kind,
            canonical_source_updated_at, updated_at
        )
        VALUES (
            $1, $2, $3, 'edited@example.com', 'Edited event',
            now(), now() + interval '1 hour', 'google', now(),
            now() - interval '1 day'
        )
        "#,
        edited_id,
        owner_id,
        link_id,
    )
    .execute(&pool)
    .await?;

    let items = cursor_soup(
        &pool,
        SimpleSortRequest {
            limit: 10,
            cursor: SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::UpdatedAt, ())),
            user_id: MacroUserIdStr::parse_from_str(owner_id)?,
        },
    )
    .await?;

    let ids: Vec<Uuid> = items
        .iter()
        .map(|item| match item {
            SoupItem::CalendarEvent(event) => event.id,
            other => panic!("unexpected soup item: {other:?}"),
        })
        .collect();
    assert_eq!(ids, vec![reminded_id, edited_id]);
    assert!(matches!(
        &items[0],
        SoupItem::CalendarEvent(event) if event.last_reminder_fired_at.is_some()
    ));
    Ok(())
}
