use super::*;
use item_filters::{NotificationState, ast::EntityFilterAst};
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

const UNREAD_OWNER: &str = "macro|calendar-unread@example.com";
const UNREAD_CHILD: &str = "macro|calendar-unread-child@example.com";
const UNREAD_STRANGER: &str = "macro|calendar-unread-stranger@example.com";

/// The owner's events, newest first: `unseen` and `seen` each hold one live
/// notification in that state, `done` a done one, `deleted` only a
/// soft-deleted unseen one, `twice` a done and an unseen one, and `quiet`
/// only a stranger's unseen one. `delegated` belongs to the child whose
/// inbox the owner is delegated; `strangers` to a user the owner cannot
/// read, though the owner was notified about it.
struct UnreadFixture {
    unseen: Uuid,
    seen: Uuid,
    delegated: Uuid,
    twice: Uuid,
}

async fn seed_unread(pool: &PgPool) -> anyhow::Result<UnreadFixture> {
    let [owner_link, child_link, stranger_link] = std::array::from_fn(|_| Uuid::now_v7());
    for (user, link) in [
        (UNREAD_OWNER, owner_link),
        (UNREAD_CHILD, child_link),
        (UNREAD_STRANGER, stranger_link),
    ] {
        let macro_user = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
            macro_user,
            user,
        )
        .execute(pool)
        .await?;
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
            user,
            macro_user,
        )
        .execute(pool)
        .await?;
        sqlx::query!(
            "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES ($1, $2, $2, $3, 'GMAIL')",
            link,
            user,
            user,
        )
        .execute(pool)
        .await?;
    }
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ($1, $2, $3)",
        UNREAD_OWNER,
        UNREAD_CHILD,
        child_link,
    )
    .execute(pool)
    .await?;

    let [
        unseen,
        seen,
        done,
        deleted,
        quiet,
        delegated,
        strangers,
        twice,
    ] = std::array::from_fn(|_| Uuid::now_v7());
    for (id, owner, link, days_ago, status) in [
        (unseen, UNREAD_OWNER, owner_link, 1, "confirmed"),
        (seen, UNREAD_OWNER, owner_link, 2, "tentative"),
        (done, UNREAD_OWNER, owner_link, 3, "confirmed"),
        (deleted, UNREAD_OWNER, owner_link, 4, "confirmed"),
        (quiet, UNREAD_OWNER, owner_link, 5, "confirmed"),
        (delegated, UNREAD_CHILD, child_link, 6, "confirmed"),
        (strangers, UNREAD_STRANGER, stranger_link, 7, "confirmed"),
        (twice, UNREAD_OWNER, owner_link, 8, "confirmed"),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO calendar_events (
                id, owner_id, source_link_id, ical_uid, title, status,
                starts_at, ends_at, canonical_source_kind, updated_at
            )
            VALUES (
                $1, $2, $3, $6, 'Unread fixture', $4,
                now(), now() + interval '1 hour', 'google', now() - make_interval(days => $5)
            )
            "#,
            id,
            owner,
            link,
            status,
            days_ago,
            id.to_string(),
        )
        .execute(pool)
        .await?;
    }
    for (event, user, state, soft_deleted) in [
        (unseen, UNREAD_OWNER, "unseen", false),
        (seen, UNREAD_OWNER, "seen", false),
        (done, UNREAD_OWNER, "done", false),
        (deleted, UNREAD_OWNER, "unseen", true),
        (quiet, UNREAD_STRANGER, "unseen", false),
        (delegated, UNREAD_OWNER, "unseen", false),
        (strangers, UNREAD_OWNER, "unseen", false),
        (twice, UNREAD_OWNER, "done", false),
        (twice, UNREAD_OWNER, "unseen", false),
    ] {
        let notification = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender) VALUES ($1, 'calendar_reminder', $2, 'calendar_event', 'test')",
            notification,
            event.to_string(),
        )
        .execute(pool)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO user_notification (
                user_id, notification_id, state, deleted_at,
                event_item_type, event_item_id, notification_event_type
            )
            VALUES (
                $1, $2, ($3::text)::notification_state, CASE WHEN $4::bool THEN now() END,
                'calendar_event', $5, 'calendar_reminder'
            )
            "#,
            user,
            notification,
            state,
            soft_deleted,
            event.to_string(),
        )
        .execute(pool)
        .await?;
    }
    Ok(UnreadFixture {
        unseen,
        seen,
        delegated,
        twice,
    })
}

fn state(state: NotificationState) -> Expr<CalendarEventLiteral> {
    Expr::val(CalendarEventLiteral::NotificationState(state))
}

/// The Home inbox's calendar clause, `calendarEventDone = false`.
fn inbox() -> Expr<CalendarEventLiteral> {
    Expr::or(
        state(NotificationState::Unseen),
        state(NotificationState::Seen),
    )
}

/// The inbox's unread facet adds `AND unseen` to [`inbox`].
fn unread() -> Expr<CalendarEventLiteral> {
    Expr::and(inbox(), state(NotificationState::Unseen))
}

fn owner_request(
    filter: Expr<CalendarEventLiteral>,
    limit: u16,
    after: Option<&SoupCalendarEvent>,
) -> SimpleSortRequest<'static> {
    let filter = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(filter)),
        ..EntityFilterAst::default()
    };
    let cursor = match after {
        Some(event) => SimpleSortQuery::ItemsFilter(Query::Cursor(CursorWithValAndFilter {
            id: event.id,
            limit: limit.into(),
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: event.updated_at,
            },
            filter,
        })),
        None => SimpleSortQuery::ItemsFilter(Query::Sort(SimpleSortMethod::UpdatedAt, filter)),
    };
    SimpleSortRequest {
        limit,
        cursor,
        user_id: MacroUserIdStr::parse_from_str(UNREAD_OWNER).expect("valid user id"),
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unread_feed_lists_events_the_caller_holds_an_unseen_notification_for(
    pool: PgPool,
) -> anyhow::Result<()> {
    let fixture = seed_unread(&pool).await?;

    let unread_items = cursor_soup(&pool, owner_request(unread(), 10, None)).await?;
    assert_eq!(
        event_ids(&unread_items),
        vec![fixture.unseen, fixture.delegated, fixture.twice]
    );

    let inbox_items = cursor_soup(&pool, owner_request(inbox(), 10, None)).await?;
    assert_eq!(
        event_ids(&inbox_items),
        vec![
            fixture.unseen,
            fixture.seen,
            fixture.delegated,
            fixture.twice
        ]
    );

    // What remains of the tree still applies to the notified events.
    let tentative = Expr::and(
        inbox(),
        Expr::val(CalendarEventLiteral::Status("tentative".to_string())),
    );
    let tentative_items = cursor_soup(&pool, owner_request(tentative, 10, None)).await?;
    assert_eq!(event_ids(&tentative_items), vec![fixture.seen]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unread_feed_pages_without_repeating_or_skipping(pool: PgPool) -> anyhow::Result<()> {
    let fixture = seed_unread(&pool).await?;

    let first = cursor_soup(&pool, owner_request(unread(), 2, None)).await?;
    assert_eq!(event_ids(&first), vec![fixture.unseen, fixture.delegated]);
    let SoupItem::CalendarEvent(last) = &first[1] else {
        unreachable!()
    };

    let second = cursor_soup(&pool, owner_request(unread(), 2, Some(last))).await?;
    assert_eq!(event_ids(&second), vec![fixture.twice]);
    Ok(())
}

/// A notification literal under OR keeps the per-event fold; the semi-join
/// over the caller's notifications must agree with it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notified_semi_join_matches_the_per_event_fold(pool: PgPool) -> anyhow::Result<()> {
    let fixture = seed_unread(&pool).await?;
    let folded = Expr::or(
        state(NotificationState::Unseen),
        Expr::and(
            state(NotificationState::Unseen),
            Expr::val(CalendarEventLiteral::Id(Uuid::nil())),
        ),
    );

    let semi_joined = cursor_soup(&pool, owner_request(unread(), 10, None)).await?;
    let per_event = cursor_soup(&pool, owner_request(folded, 10, None)).await?;

    assert_eq!(event_ids(&semi_joined), event_ids(&per_event));
    assert_eq!(
        event_ids(&semi_joined),
        vec![fixture.unseen, fixture.delegated, fixture.twice]
    );
    Ok(())
}
