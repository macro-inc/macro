use super::*;
use crate::domain::calendar_color::{CalendarColor, CalendarColorWrite};
use crate::domain::changes::{CalendarChangeOp, CalendarChangeRepository};

use super::changes::{claimed_job, ops_after, primary_calendar};

const OWNER: &str = "macro|color-owner@example.com";
const DELEGATE: &str = "macro|color-delegate@example.com";

fn color(value: &str) -> CalendarColor {
    CalendarColor::parse(value).unwrap()
}

/// What each viewer reads back for `calendar_id`: provider color, own color.
async fn colors(
    repo: &PgCalendarRepository,
    viewer: &str,
    calendar_id: Uuid,
) -> (Option<String>, Option<String>) {
    let listed = repo
        .list_visible_calendars(viewer)
        .await
        .unwrap()
        .into_iter()
        .find(|calendar| calendar.id == calendar_id)
        .unwrap();
    let changed = repo
        .list_calendars_by_ids(viewer, &[calendar_id])
        .await
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(
        (&listed.color, &listed.custom_color),
        (&changed.color, &changed.custom_color),
        "the list and the change log read the same colors"
    );
    (listed.color, listed.custom_color)
}

/// An owner's Google inbox with one calendar in `provider_color`, delegated
/// to `DELEGATE`.
async fn delegated_calendar(
    pool: &PgPool,
    provider_color: &str,
) -> (PgCalendarRepository, Uuid, Uuid) {
    insert_user(pool, OWNER).await;
    insert_user(pool, DELEGATE).await;
    let link_id = insert_link(pool, OWNER).await;
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        DELEGATE,
        OWNER,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    let repo = PgCalendarRepository::new(pool.clone());
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                color: Some(provider_color.to_string()),
                ..primary_calendar("primary", "Primary")
            },
        )
        .await
        .unwrap();
    (repo, link_id, calendar_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_viewer_keeps_their_own_color_and_the_inbox_logs_the_change(pool: PgPool) {
    let (repo, link_id, calendar_id) = delegated_calendar(&pool, "#9fe1e7").await;
    let before = super::changes::counter(&pool, link_id).await;

    let written = repo
        .set_calendar_color(OWNER, calendar_id, Some(&color("#5C8AEE")))
        .await
        .unwrap();

    assert_eq!(
        written,
        CalendarColorWrite::Changed {
            email_link_id: link_id
        }
    );
    assert_eq!(
        colors(&repo, OWNER, calendar_id).await,
        (Some("#9fe1e7".to_string()), Some("#5c8aee".to_string()))
    );
    assert_eq!(
        colors(&repo, DELEGATE, calendar_id).await,
        (Some("#9fe1e7".to_string()), None),
        "the delegate sees the provider color until they choose their own"
    );
    assert_eq!(
        ops_after(&pool, link_id, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)],
        "every viewer of the inbox rereads the calendar"
    );

    repo.set_calendar_color(DELEGATE, calendar_id, Some(&color("#ed6a86")))
        .await
        .unwrap();

    assert_eq!(
        colors(&repo, OWNER, calendar_id).await.1,
        Some("#5c8aee".to_string())
    );
    assert_eq!(
        colors(&repo, DELEGATE, calendar_id).await.1,
        Some("#ed6a86".to_string())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_provider_sync_never_overwrites_a_chosen_color(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let link_id = insert_link(&pool, OWNER).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (key, lease_token, account_id) = claimed_job(&repo, link_id).await;
    let calendar_id = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            ProviderCalendar {
                color: Some("#9fe1e7".to_string()),
                ..primary_calendar("primary", "Primary")
            },
        )
        .await
        .unwrap()
        .id;
    repo.set_calendar_color(OWNER, calendar_id, Some(&color("#5c8aee")))
        .await
        .unwrap();

    repo.upsert_google_calendar(
        key,
        lease_token,
        account_id,
        ProviderCalendar {
            color: Some("#16a765".to_string()),
            ..primary_calendar("primary", "Primary")
        },
    )
    .await
    .unwrap();

    assert_eq!(
        colors(&repo, OWNER, calendar_id).await,
        (Some("#16a765".to_string()), Some("#5c8aee".to_string()))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn clearing_a_color_goes_back_to_the_provider_color(pool: PgPool) {
    let (repo, link_id, calendar_id) = delegated_calendar(&pool, "#9fe1e7").await;
    repo.set_calendar_color(OWNER, calendar_id, Some(&color("#5c8aee")))
        .await
        .unwrap();
    let before = super::changes::counter(&pool, link_id).await;

    let cleared = repo
        .set_calendar_color(OWNER, calendar_id, None)
        .await
        .unwrap();

    assert_eq!(
        cleared,
        CalendarColorWrite::Changed {
            email_link_id: link_id
        }
    );
    assert_eq!(
        colors(&repo, OWNER, calendar_id).await,
        (Some("#9fe1e7".to_string()), None)
    );
    assert_eq!(
        ops_after(&pool, link_id, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repeating_the_stored_color_changes_and_logs_nothing(pool: PgPool) {
    let (repo, link_id, calendar_id) = delegated_calendar(&pool, "#9fe1e7").await;
    repo.set_calendar_color(OWNER, calendar_id, Some(&color("#5c8aee")))
        .await
        .unwrap();
    let before = super::changes::counter(&pool, link_id).await;

    let repeated = repo
        .set_calendar_color(OWNER, calendar_id, Some(&color("#5C8AEE")))
        .await
        .unwrap();
    repo.set_calendar_color(DELEGATE, calendar_id, None)
        .await
        .unwrap();

    assert_eq!(repeated, CalendarColorWrite::Unchanged);
    assert_eq!(ops_after(&pool, link_id, before).await, Vec::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_outside_the_requesters_inboxes_takes_no_color(pool: PgPool) {
    let (repo, _link_id, calendar_id) = delegated_calendar(&pool, "#9fe1e7").await;
    let stranger = "macro|color-stranger@example.com";
    insert_user(&pool, stranger).await;

    let written = repo
        .set_calendar_color(stranger, calendar_id, Some(&color("#5c8aee")))
        .await
        .unwrap();

    assert_eq!(written, CalendarColorWrite::NotVisible);
    let stored = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM calendar_color_preferences WHERE calendar_id = $1",
        calendar_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 0);
}
