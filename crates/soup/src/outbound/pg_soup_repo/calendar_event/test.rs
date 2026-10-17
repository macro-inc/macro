use super::*;
use filter_ast::Expr;
use item_filters::NotificationState;
use item_filters::ast::{EntityFilterAst, calendar_event::CalendarEventLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CursorVal, CursorWithValAndFilter, Frecency};
use std::sync::Arc;

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
            starts_at, ends_at, canonical_source_kind
        )
        VALUES (
            $1, $2, $3, 'calendar-frecency@example.com', 'Frecency event',
            now(), now() + interval '1 hour', 'google'
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
            updated_at, last_reminder_fired_at
        )
        VALUES (
            $1, $2, $3, 'reminded@example.com', 'Reminded event',
            now(), now() + interval '1 hour', 'google',
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
            updated_at
        )
        VALUES (
            $1, $2, $3, 'edited@example.com', 'Edited event',
            now(), now() + interval '1 hour', 'google',
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

fn state_expr(state: NotificationState) -> Expr<CalendarEventLiteral> {
    Expr::val(CalendarEventLiteral::NotificationState(state))
}

#[test]
fn notification_id_sql_rejects_negation_and_other_literals() {
    let unseen = state_expr(NotificationState::Unseen);
    let seen = state_expr(NotificationState::Seen);
    let or_sql = notification_event_ids_sql(&Expr::or(unseen.clone(), seen.clone())).unwrap();
    assert!(or_sql.contains("UNION"));
    assert!(or_sql.contains("OFFSET 0"));
    let and_sql = notification_event_ids_sql(&Expr::and(unseen.clone(), seen)).unwrap();
    assert!(and_sql.contains("INTERSECT"));
    assert!(notification_event_ids_sql(&Expr::is_not(unseen.clone())).is_none());
    assert!(
        notification_event_ids_sql(&Expr::and(
            unseen,
            Expr::val(CalendarEventLiteral::Status("confirmed".to_string())),
        ))
        .is_none()
    );
}

fn calendar_request(
    user: &'static str,
    limit: u16,
    filter: Expr<CalendarEventLiteral>,
) -> SimpleSortRequest<'static> {
    SimpleSortRequest {
        limit,
        cursor: SimpleSortQuery::ItemsFilter(Query::Sort(
            SimpleSortMethod::UpdatedAt,
            EntityFilterAst {
                calendar_event_filter: Some(Arc::new(filter)),
                ..EntityFilterAst::default()
            },
        )),
        user_id: MacroUserIdStr::parse_from_str(user).expect("valid user id"),
    }
}

fn event_ids(items: &[SoupItem<()>]) -> Vec<Uuid> {
    items
        .iter()
        .map(|item| match item {
            SoupItem::CalendarEvent(event) => event.id,
            other => panic!("unexpected soup item: {other:?}"),
        })
        .collect()
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::now_v7();
    let email = user_id
        .split_once('|')
        .map(|(_, email)| email)
        .unwrap_or(user_id);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
        macro_user_id,
        user_id,
        email,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_link(pool: &PgPool, user_id: &str, email: &str) -> anyhow::Result<Uuid> {
    let link_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        user_id,
        email,
    )
    .execute(pool)
    .await?;
    Ok(link_id)
}

async fn insert_event(
    pool: &PgPool,
    owner_id: &str,
    link_id: Uuid,
    title: &str,
    updated_at: DateTime<Utc>,
    status: &str,
) -> anyhow::Result<Uuid> {
    let event_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title, status,
            starts_at, ends_at, canonical_source_kind, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6,
            now(), now() + interval '1 hour', 'google', $7
        )
        "#,
        event_id,
        owner_id,
        link_id,
        format!("{title}@example.com"),
        title,
        status,
        updated_at,
    )
    .execute(pool)
    .await?;
    Ok(event_id)
}

async fn insert_notification(
    pool: &PgPool,
    user_id: &str,
    event_id: Uuid,
    state: NotificationState,
    deleted: bool,
) -> anyhow::Result<()> {
    let notification_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id, notification_event_type, event_item_id, event_item_type,
            service_sender, metadata
        )
        VALUES ($1, 'calendar_event_reminder', $2, 'calendar_event', 'test', '{}'::jsonb)
        "#,
        notification_id,
        event_id.to_string(),
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO user_notification (user_id, notification_id, state) VALUES ($1, $2, $3)",
        user_id,
        notification_id,
        state as _,
    )
    .execute(pool)
    .await?;
    if deleted {
        sqlx::query("UPDATE user_notification SET deleted_at = now() WHERE notification_id = $1")
            .bind(notification_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Notification-only filters name events from `user_notification` first.
/// The page must match the old per-event EXISTS: OR, AND across two rows,
/// deleted rows, another user's row, events the caller does not own, a
/// delegated link, and keyset order. A status literal stays on that EXISTS.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_state_pages_follow_the_callers_rows(pool: PgPool) -> anyhow::Result<()> {
    let owner = "macro|cal-notif-owner@example.com";
    let delegate = "macro|cal-notif-delegate@example.com";
    let stranger = "macro|cal-notif-stranger@example.com";
    insert_user(&pool, owner).await?;
    insert_user(&pool, delegate).await?;
    insert_user(&pool, stranger).await?;
    let owner_link = insert_link(&pool, owner, "cal-notif-owner@example.com").await?;
    let stranger_link = insert_link(&pool, stranger, "cal-notif-stranger@example.com").await?;
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        delegate,
        stranger,
        stranger_link,
    )
    .execute(&pool)
    .await?;

    let now = Utc::now();
    let newest_unseen =
        insert_event(&pool, owner, owner_link, "Newest unseen", now, "confirmed").await?;
    let both_states = insert_event(
        &pool,
        owner,
        owner_link,
        "Both states",
        now - chrono::Duration::days(1),
        "confirmed",
    )
    .await?;
    let seen_only = insert_event(
        &pool,
        owner,
        owner_link,
        "Seen only",
        now - chrono::Duration::days(2),
        "confirmed",
    )
    .await?;
    let deleted_unseen = insert_event(
        &pool,
        owner,
        owner_link,
        "Deleted unseen",
        now - chrono::Duration::days(3),
        "confirmed",
    )
    .await?;
    let cancelled = insert_event(
        &pool,
        owner,
        owner_link,
        "Cancelled",
        now - chrono::Duration::hours(12),
        "cancelled",
    )
    .await?;
    let delegated = insert_event(
        &pool,
        stranger,
        stranger_link,
        "Delegated",
        now - chrono::Duration::hours(1),
        "confirmed",
    )
    .await?;

    insert_notification(
        &pool,
        owner,
        newest_unseen,
        NotificationState::Unseen,
        false,
    )
    .await?;
    insert_notification(&pool, owner, both_states, NotificationState::Unseen, false).await?;
    insert_notification(&pool, owner, both_states, NotificationState::Seen, false).await?;
    insert_notification(&pool, owner, seen_only, NotificationState::Seen, false).await?;
    insert_notification(
        &pool,
        owner,
        deleted_unseen,
        NotificationState::Unseen,
        true,
    )
    .await?;
    insert_notification(&pool, owner, delegated, NotificationState::Unseen, false).await?;
    insert_notification(&pool, delegate, delegated, NotificationState::Unseen, false).await?;
    insert_notification(&pool, stranger, delegated, NotificationState::Unseen, false).await?;
    insert_notification(
        &pool,
        stranger,
        newest_unseen,
        NotificationState::Unseen,
        false,
    )
    .await?;

    let unseen_or_seen = Expr::or(
        state_expr(NotificationState::Unseen),
        state_expr(NotificationState::Seen),
    );
    let owner_page =
        cursor_soup(&pool, calendar_request(owner, 10, unseen_or_seen.clone())).await?;
    assert_eq!(
        event_ids(&owner_page),
        vec![newest_unseen, both_states, seen_only]
    );

    let both = cursor_soup(
        &pool,
        calendar_request(
            owner,
            10,
            Expr::and(
                state_expr(NotificationState::Unseen),
                state_expr(NotificationState::Seen),
            ),
        ),
    )
    .await?;
    assert_eq!(event_ids(&both), vec![both_states]);

    let first = cursor_soup(&pool, calendar_request(owner, 1, unseen_or_seen.clone())).await?;
    assert_eq!(event_ids(&first), vec![newest_unseen]);
    let SoupItem::CalendarEvent(first_event) = &first[0] else {
        unreachable!()
    };
    let rest = cursor_soup(
        &pool,
        SimpleSortRequest {
            limit: 10,
            cursor: SimpleSortQuery::ItemsFilter(Query::Cursor(CursorWithValAndFilter {
                id: first_event.id,
                limit: 10,
                val: CursorVal {
                    sort_type: SimpleSortMethod::UpdatedAt,
                    last_val: first_event.updated_at,
                },
                filter: EntityFilterAst {
                    calendar_event_filter: Some(Arc::new(unseen_or_seen)),
                    ..EntityFilterAst::default()
                },
            })),
            user_id: MacroUserIdStr::parse_from_str(owner)?,
        },
    )
    .await?;
    assert_eq!(event_ids(&rest), vec![both_states, seen_only]);

    let without_unseen = cursor_soup(
        &pool,
        calendar_request(
            owner,
            10,
            Expr::is_not(state_expr(NotificationState::Unseen)),
        ),
    )
    .await?;
    assert_eq!(
        event_ids(&without_unseen),
        vec![cancelled, seen_only, deleted_unseen]
    );

    let by_status = cursor_soup(
        &pool,
        calendar_request(
            owner,
            10,
            Expr::val(CalendarEventLiteral::Status("cancelled".to_string())),
        ),
    )
    .await?;
    assert_eq!(event_ids(&by_status), vec![cancelled]);

    let delegated_page = cursor_soup(
        &pool,
        calendar_request(delegate, 10, state_expr(NotificationState::Unseen)),
    )
    .await?;
    assert_eq!(event_ids(&delegated_page), vec![delegated]);

    let stranger_page = cursor_soup(
        &pool,
        calendar_request(stranger, 10, state_expr(NotificationState::Unseen)),
    )
    .await?;
    assert_eq!(event_ids(&stranger_page), vec![delegated]);
    Ok(())
}
