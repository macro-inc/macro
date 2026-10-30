use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const LINK: Uuid = Uuid::from_u128(0x801);
const MESSAGE: Uuid = Uuid::from_u128(0x8501);
const INBOX_LABEL: Uuid = Uuid::from_u128(0x18001);

/// Stages a local INBOX change on `MESSAGE` the way a thread write does: the
/// label and the write's row change together.
async fn stage_inbox(pool: &Pool<Postgres>, present: bool, write_id: Uuid) -> Result<()> {
    let mut tx = pool.begin().await?;
    if present {
        sqlx::query!(
            "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
            MESSAGE,
            INBOX_LABEL
        )
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query!(
            "DELETE FROM email_message_labels WHERE message_id = $1 AND label_id = $2",
            MESSAGE,
            INBOX_LABEL
        )
        .execute(&mut *tx)
        .await?;
    }
    mark_pending_label_writes(&mut *tx, LINK, &[MESSAGE], "INBOX", present, write_id).await?;
    tx.commit().await?;
    Ok(())
}

async fn in_inbox(pool: &Pool<Postgres>) -> Result<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM email_message_labels WHERE message_id = $1 AND label_id = $2) AS "exists!""#,
        MESSAGE,
        INBOX_LABEL
    )
    .fetch_one(pool)
    .await?)
}

async fn turn(pool: &Pool<Postgres>, write_id: Uuid) -> Result<LabelWriteTurn> {
    Ok(label_write_turns(pool, &[MESSAGE], &["INBOX".to_string()], write_id).await?[&MESSAGE])
}

async fn abandon(pool: &Pool<Postgres>, write_id: Uuid) -> Result<Vec<Uuid>> {
    let mut tx = pool.begin().await?;
    let restored = abandon_pending_label_writes(&mut tx, LINK, &[MESSAGE], write_id).await?;
    tx.commit().await?;
    Ok(restored)
}

async fn confirm(pool: &Pool<Postgres>, write_id: Uuid) -> Result<()> {
    let mut tx = pool.begin().await?;
    confirm_pending_label_writes(&mut tx, &[MESSAGE], write_id).await?;
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn marks_only_messages_of_the_link(pool: Pool<Postgres>) -> Result<()> {
    let other_link = Uuid::from_u128(0x802);
    let second = Uuid::from_u128(0x8502);
    let write_id = Uuid::from_u128(0xaa01);

    mark_pending_label_writes(&pool, LINK, &[MESSAGE], "INBOX", false, write_id).await?;
    mark_pending_label_writes(&pool, other_link, &[second], "INBOX", false, write_id).await?;

    assert_eq!(pending_provider_label_ids(&pool, MESSAGE).await?, ["INBOX"]);
    assert!(pending_provider_label_ids(&pool, second).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn an_older_write_waits_until_a_newer_one_is_confirmed(pool: Pool<Postgres>) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let unarchive = Uuid::from_u128(0xaa02);

    stage_inbox(&pool, false, archive).await?;
    stage_inbox(&pool, true, unarchive).await?;
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Wait);
    assert_eq!(turn(&pool, unarchive).await?, LabelWriteTurn::Send);

    confirm(&pool, unarchive).await?;
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Superseded);
    assert!(pending_provider_label_ids(&pool, MESSAGE).await?.is_empty());
    assert!(in_inbox(&pool).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn an_abandoned_write_puts_the_label_back_for_the_older_write_still_waiting(
    pool: Pool<Postgres>,
) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let unarchive = Uuid::from_u128(0xaa02);

    stage_inbox(&pool, false, archive).await?;
    stage_inbox(&pool, true, unarchive).await?;
    assert_eq!(abandon(&pool, unarchive).await?, [MESSAGE]);

    assert!(!in_inbox(&pool).await?);
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Send);
    assert_eq!(pending_provider_label_ids(&pool, MESSAGE).await?, ["INBOX"]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn abandoned_writes_keep_every_older_write_they_took_over(
    pool: Pool<Postgres>,
) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let unarchive = Uuid::from_u128(0xaa02);
    let archive_again = Uuid::from_u128(0xaa03);

    stage_inbox(&pool, false, archive).await?;
    stage_inbox(&pool, true, unarchive).await?;
    stage_inbox(&pool, false, archive_again).await?;

    // The second archive can't be queued, then Gmail rejects the unarchive.
    abandon(&pool, archive_again).await?;
    assert!(in_inbox(&pool).await?);
    abandon(&pool, unarchive).await?;

    assert!(!in_inbox(&pool).await?);
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Send);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn when_every_write_is_abandoned_the_label_returns_to_its_state_before_the_first(
    pool: Pool<Postgres>,
) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let unarchive = Uuid::from_u128(0xaa02);

    stage_inbox(&pool, false, archive).await?;
    stage_inbox(&pool, true, unarchive).await?;

    // Gmail rejects the archive while the unarchive waits: nothing changes
    // locally, but the unarchive now starts from the original state.
    assert!(abandon(&pool, archive).await?.is_empty());
    assert!(in_inbox(&pool).await?);
    assert_eq!(turn(&pool, unarchive).await?, LabelWriteTurn::Send);

    let archive_again = Uuid::from_u128(0xaa03);
    stage_inbox(&pool, false, archive_again).await?;
    abandon(&pool, archive_again).await?;
    abandon(&pool, unarchive).await?;
    assert!(in_inbox(&pool).await?);
    assert!(pending_provider_label_ids(&pool, MESSAGE).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn a_confirmed_write_is_what_a_newer_abandoned_write_falls_back_to(
    pool: Pool<Postgres>,
) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let unarchive = Uuid::from_u128(0xaa02);
    let archive_again = Uuid::from_u128(0xaa03);

    stage_inbox(&pool, false, archive).await?;
    stage_inbox(&pool, true, unarchive).await?;
    stage_inbox(&pool, false, archive_again).await?;
    // The unarchive reached Gmail before the second archive was staged.
    confirm(&pool, unarchive).await?;
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Superseded);

    abandon(&pool, archive_again).await?;
    assert!(in_inbox(&pool).await?);
    assert!(pending_provider_label_ids(&pool, MESSAGE).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn a_write_waits_for_live_newer_writes_whatever_their_ids(
    pool: Pool<Postgres>,
) -> Result<()> {
    let unarchive = Uuid::from_u128(0xaa01);
    let archive = Uuid::from_u128(0xaa02);

    // Staged in the opposite order to their ids, as when two requests race.
    stage_inbox(&pool, false, archive).await?;
    stage_inbox(&pool, true, unarchive).await?;
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Wait);
    assert_eq!(turn(&pool, unarchive).await?, LabelWriteTurn::Send);

    // Gmail rejects the unarchive, or it can't be queued: the archive is the
    // user's last change again, and it sends.
    assert_eq!(abandon(&pool, unarchive).await?, [MESSAGE]);
    assert!(!in_inbox(&pool).await?);
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Send);

    let unarchive_again = Uuid::from_u128(0xaa03);
    stage_inbox(&pool, true, unarchive_again).await?;
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Wait);
    sqlx::query!(
        "UPDATE email_gmail_pending_label_writes SET expires_at = now() - interval '1 second' WHERE write_id = $1",
        unarchive_again
    )
    .execute(&pool)
    .await?;
    assert_eq!(turn(&pool, archive).await?, LabelWriteTurn::Superseded);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn writes_newer_than_each_other_on_two_messages_each_have_one_to_send(
    pool: Pool<Postgres>,
) -> Result<()> {
    let second = Uuid::from_u128(0x8502);
    let first_write = Uuid::from_u128(0xaa01);
    let second_write = Uuid::from_u128(0xaa02);
    let labels = ["INBOX".to_string()];

    // Two bulk writes reach the messages' threads in opposite orders.
    mark_pending_label_writes(&pool, LINK, &[MESSAGE], "INBOX", false, first_write).await?;
    mark_pending_label_writes(&pool, LINK, &[MESSAGE], "INBOX", true, second_write).await?;
    mark_pending_label_writes(&pool, LINK, &[second], "INBOX", true, second_write).await?;
    mark_pending_label_writes(&pool, LINK, &[second], "INBOX", false, first_write).await?;
    let first_turns = label_write_turns(&pool, &[MESSAGE, second], &labels, first_write).await?;
    assert_eq!(first_turns[&MESSAGE], LabelWriteTurn::Wait);
    assert_eq!(first_turns[&second], LabelWriteTurn::Send);
    let second_turns = label_write_turns(&pool, &[MESSAGE, second], &labels, second_write).await?;
    assert_eq!(second_turns[&MESSAGE], LabelWriteTurn::Send);
    assert_eq!(second_turns[&second], LabelWriteTurn::Wait);

    // Each write sends the message it is newest on, which settles the other's
    // wait.
    let mut tx = pool.begin().await?;
    confirm_pending_label_writes(&mut tx, &[second], first_write).await?;
    confirm_pending_label_writes(&mut tx, &[MESSAGE], second_write).await?;
    tx.commit().await?;
    for write_id in [first_write, second_write] {
        let turns = label_write_turns(&pool, &[MESSAGE, second], &labels, write_id).await?;
        assert!(
            turns
                .values()
                .all(|turn| *turn == LabelWriteTurn::Superseded)
        );
    }
    assert!(pending_provider_label_ids(&pool, MESSAGE).await?.is_empty());
    assert!(pending_provider_label_ids(&pool, second).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn an_abandoned_write_does_not_bring_back_an_expired_older_write(
    pool: Pool<Postgres>,
) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let archive_again = Uuid::from_u128(0xaa02);

    stage_inbox(&pool, false, archive).await?;
    sqlx::query!(
        "UPDATE email_gmail_pending_label_writes SET expires_at = now() - interval '1 second' WHERE write_id = $1",
        archive
    )
    .execute(&pool)
    .await?;
    // With the marker expired, inbox sync puts Gmail's INBOX back.
    sqlx::query!(
        "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
        MESSAGE,
        INBOX_LABEL
    )
    .execute(&pool)
    .await?;

    stage_inbox(&pool, false, archive_again).await?;
    assert_eq!(abandon(&pool, archive_again).await?, [MESSAGE]);
    assert!(in_inbox(&pool).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn writes_abandoned_after_an_older_write_expired_return_to_the_state_before_them(
    pool: Pool<Postgres>,
) -> Result<()> {
    let archive = Uuid::from_u128(0xaa01);
    let archive_again = Uuid::from_u128(0xaa02);
    let unarchive = Uuid::from_u128(0xaa03);

    stage_inbox(&pool, false, archive).await?;
    sqlx::query!(
        "UPDATE email_gmail_pending_label_writes SET expires_at = now() - interval '1 second' WHERE write_id = $1",
        archive
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
        MESSAGE,
        INBOX_LABEL
    )
    .execute(&pool)
    .await?;
    stage_inbox(&pool, false, archive_again).await?;
    stage_inbox(&pool, true, unarchive).await?;

    // The second archive gives up first and passes the state before it on to
    // the unarchive, which keeps the label meanwhile.
    assert!(abandon(&pool, archive_again).await?.is_empty());
    assert!(in_inbox(&pool).await?);
    assert_eq!(abandon(&pool, unarchive).await?, [MESSAGE]);
    assert!(in_inbox(&pool).await?);
    assert!(pending_provider_label_ids(&pool, MESSAGE).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn expired_changes_no_longer_apply(pool: Pool<Postgres>) -> Result<()> {
    let write_id = Uuid::from_u128(0xaa01);

    mark_pending_label_writes(&pool, LINK, &[MESSAGE], "TRASH", true, write_id).await?;
    mark_pending_label_writes(&pool, LINK, &[MESSAGE], "UNREAD", true, write_id).await?;
    sqlx::query!(
        "UPDATE email_gmail_pending_label_writes SET expires_at = now() - interval '1 second' WHERE provider_label_id = 'TRASH'"
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        pending_provider_label_ids(&pool, MESSAGE).await?,
        ["UNREAD"]
    );
    Ok(())
}
