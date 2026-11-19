use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const VIEWER: &str = "macro|unread-viewer@example.com";
const OTHER: &str = "macro|unread-other@example.com";
const LINK_1: &str = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_UNSEEN: &str = "a1111111-0000-0000-0000-000000000001";
const DOC_SEEN: &str = "a1111111-0000-0000-0000-000000000002";
const DOC_DONE: &str = "a1111111-0000-0000-0000-000000000003";
const DOC_DELETED: &str = "a1111111-0000-0000-0000-000000000004";
const DOC_OTHERS: &str = "a1111111-0000-0000-0000-000000000005";
const DOC_UNSEEN_LATER: &str = "a1111111-0000-0000-0000-000000000006";
const CHANNEL_BUSY: &str = "b1111111-0000-0000-0000-000000000001";
const MAIL_UNREAD_SEEN: &str = "c1111111-0000-0000-0000-000000000001";
const MAIL_READ_SEEN: &str = "c1111111-0000-0000-0000-000000000002";
const MAIL_ARCHIVED_SEEN: &str = "c1111111-0000-0000-0000-000000000003";
const MAIL_READ_UNSEEN: &str = "c1111111-0000-0000-0000-000000000004";
const MAIL_UNREAD_DONE: &str = "c1111111-0000-0000-0000-000000000005";

const EVERY_TYPE: &[EntityType] = &[
    EntityType::Document,
    EntityType::Channel,
    EntityType::EmailThread,
];

/// File one notification for `user` under an entity, as notification ingress
/// does: the entity and event type are copied onto the recipient row.
async fn notify(
    pool: &Pool<Postgres>,
    user: &str,
    (item_type, item_id): (&str, &str),
    state: &str,
    minute: i32,
    deleted: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        WITH filed AS (
            INSERT INTO notification
                (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata)
            VALUES ($1, 'test_event', $3, $4, 'test', '{}')
        )
        INSERT INTO user_notification
            (user_id, notification_id, created_at, state, deleted_at,
             event_item_type, event_item_id, notification_event_type)
        VALUES (
            $2, $1, timestamp '2024-06-01 10:00:00' + make_interval(mins => $6),
            $5::text::notification_state, CASE WHEN $7::bool THEN now() END,
            $4, $3, 'test_event'
        )
        "#,
        uuid::Uuid::now_v7(),
        user,
        item_id,
        item_type,
        state,
        minute,
        deleted,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn mail_thread(
    pool: &Pool<Postgres>,
    id: &str,
    inbox_visible: bool,
    is_read: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id, inbox_visible, is_read) VALUES ($1, $2, $3, $4)",
        uuid::Uuid::parse_str(id)?,
        uuid::Uuid::parse_str(LINK_1)?,
        inbox_visible,
        is_read,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn unread(
    pool: &Pool<Postgres>,
    types: &[EntityType],
    limit: u16,
) -> anyhow::Result<Vec<(EntityType, String)>> {
    let viewer = MacroUserIdStr::parse_from_str(VIEWER)?;
    let mut found: Vec<(EntityType, String)> =
        attention_unread_entities(pool, viewer, types, limit)
            .await?
            .into_iter()
            .map(|entity| (entity.entity_type, entity.entity_id.to_string()))
            .collect();
    found.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(found)
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn finds_each_entity_with_an_unseen_notification_once(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    notify(&pool, VIEWER, ("document", DOC_UNSEEN), "unseen", 1, false).await?;
    notify(&pool, VIEWER, ("document", DOC_UNSEEN), "seen", 2, false).await?;
    notify(&pool, VIEWER, ("document", DOC_SEEN), "seen", 3, false).await?;
    notify(&pool, VIEWER, ("document", DOC_DONE), "done", 4, false).await?;
    notify(&pool, VIEWER, ("document", DOC_DELETED), "unseen", 5, true).await?;
    notify(&pool, OTHER, ("document", DOC_OTHERS), "unseen", 6, false).await?;
    notify(
        &pool,
        VIEWER,
        ("document", DOC_UNSEEN_LATER),
        "unseen",
        7,
        false,
    )
    .await?;
    for minute in 10..40 {
        notify(
            &pool,
            VIEWER,
            ("channel", CHANNEL_BUSY),
            "unseen",
            minute,
            false,
        )
        .await?;
    }

    assert_eq!(
        unread(&pool, EVERY_TYPE, 100).await?,
        vec![
            (EntityType::Document, DOC_UNSEEN.to_string()),
            (EntityType::Document, DOC_UNSEEN_LATER.to_string()),
            (EntityType::Channel, CHANNEL_BUSY.to_string()),
        ]
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn limit_and_types_bound_what_is_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    notify(&pool, VIEWER, ("document", DOC_UNSEEN), "unseen", 1, false).await?;
    notify(
        &pool,
        VIEWER,
        ("document", DOC_UNSEEN_LATER),
        "unseen",
        2,
        false,
    )
    .await?;
    notify(&pool, VIEWER, ("channel", CHANNEL_BUSY), "unseen", 3, false).await?;

    // The limit is per type: one document, and the channel still.
    assert_eq!(
        unread(&pool, EVERY_TYPE, 1).await?,
        vec![
            (EntityType::Document, DOC_UNSEEN.to_string()),
            (EntityType::Channel, CHANNEL_BUSY.to_string()),
        ]
    );
    assert_eq!(
        unread(&pool, &[EntityType::Channel], 100).await?,
        vec![(EntityType::Channel, CHANNEL_BUSY.to_string())]
    );
    assert_eq!(unread(&pool, &[], 100).await?, vec![]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn unread_mail_is_found_whatever_its_notifications_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    mail_thread(&pool, MAIL_UNREAD_SEEN, true, false).await?;
    mail_thread(&pool, MAIL_READ_SEEN, true, true).await?;
    mail_thread(&pool, MAIL_ARCHIVED_SEEN, false, false).await?;
    mail_thread(&pool, MAIL_READ_UNSEEN, true, true).await?;
    mail_thread(&pool, MAIL_UNREAD_DONE, true, false).await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_UNREAD_SEEN),
        "seen",
        1,
        false,
    )
    .await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_UNREAD_SEEN),
        "seen",
        2,
        false,
    )
    .await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_READ_SEEN),
        "seen",
        3,
        false,
    )
    .await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_ARCHIVED_SEEN),
        "seen",
        4,
        false,
    )
    .await?;
    // An unseen reminder keeps a read thread unread.
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_READ_UNSEEN),
        "unseen",
        5,
        false,
    )
    .await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_UNREAD_DONE),
        "done",
        6,
        false,
    )
    .await?;
    // A malformed id is skipped, not a failed read.
    notify(
        &pool,
        VIEWER,
        ("email_thread", "not-a-uuid"),
        "seen",
        7,
        false,
    )
    .await?;

    assert_eq!(
        unread(&pool, EVERY_TYPE, 100).await?,
        vec![
            (EntityType::EmailThread, MAIL_UNREAD_SEEN.to_string()),
            (EntityType::EmailThread, MAIL_READ_UNSEEN.to_string()),
        ]
    );
    // Without mail asked for, mail is not looked for.
    assert_eq!(unread(&pool, &[EntityType::Document], 100).await?, vec![]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn unread_mail_is_looked_for_among_the_newest_pending_notifications(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    mail_thread(&pool, MAIL_UNREAD_SEEN, true, false).await?;
    mail_thread(&pool, MAIL_READ_SEEN, true, true).await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_UNREAD_SEEN),
        "seen",
        1,
        false,
    )
    .await?;
    notify(
        &pool,
        VIEWER,
        ("email_thread", MAIL_READ_SEEN),
        "seen",
        2,
        false,
    )
    .await?;

    // The unread thread's notification is the older of the two.
    assert_eq!(unread(&pool, EVERY_TYPE, 1).await?, vec![]);
    assert_eq!(
        unread(&pool, EVERY_TYPE, 2).await?,
        vec![(EntityType::EmailThread, MAIL_UNREAD_SEEN.to_string())]
    );
    Ok(())
}
