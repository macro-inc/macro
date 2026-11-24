use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const GMAIL: Uuid = Uuid::from_u128(0xa1);
const FINANCE: Uuid = Uuid::from_u128(0xb1);
const TRAVEL: Uuid = Uuid::from_u128(0xb2);
const THREAD: Uuid = Uuid::from_u128(0xc1);
const OLDER: Uuid = Uuid::from_u128(0xd1);
const NEWER: Uuid = Uuid::from_u128(0xd2);
const DRAFT: Uuid = Uuid::from_u128(0xd3);

fn labels(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

async fn label_message(pool: &PgPool, message: Uuid, label: Uuid) -> Result<()> {
    sqlx::query("INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)")
        .bind(message)
        .bind(label)
        .execute(pool)
        .await?;
    Ok(())
}

/// An Outlook category write the provider has not confirmed.
async fn pending_category(pool: &PgPool, message: Uuid, name: &str, desired: bool) -> Result<()> {
    let command = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO email_mailbox_commands (id, link_id, generation, actor_id, intent, status)
         VALUES ($1, $2, 0, 'macro|gain@example.com', '{}', 'pending')",
    )
    .bind(command)
    .bind(GMAIL)
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO email_pending_mailbox_state (message_id, attribute, command_id, desired)
         VALUES ($1, $2, $3, to_jsonb($4))",
    )
    .bind(message)
    .bind(format!("tag:{name}"))
    .bind(command)
    .bind(desired)
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("thread_gain"))
)]
async fn only_this_inboxs_user_labels_missing_from_sent_mail_are_absent(
    pool: PgPool,
) -> Result<()> {
    let mut conn = pool.acquire().await?;
    let absent = absent_from_thread(
        &mut conn,
        GMAIL,
        THREAD,
        &labels(&["Finance", "Travel", "INBOX", "Unknown"]),
    )
    .await?;

    // Finance is on a message, INBOX is Gmail's own, Unknown is not a label
    // here, and the draft's Travel is not on the thread.
    assert_eq!(absent, [TRAVEL]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("thread_gain"))
)]
async fn a_thread_that_does_not_exist_yet_lacks_every_label(pool: PgPool) -> Result<()> {
    let mut conn = pool.acquire().await?;
    let absent = absent_from_thread(
        &mut conn,
        GMAIL,
        Uuid::from_u128(0xff),
        &labels(&["Finance", "Travel"]),
    )
    .await?;

    assert_eq!(absent, [FINANCE, TRAVEL]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("thread_gain"))
)]
async fn a_write_waiting_on_outlook_already_counts(pool: PgPool) -> Result<()> {
    pending_category(&pool, NEWER, "Travel", true).await?;
    pending_category(&pool, OLDER, "Finance", false).await?;

    let mut conn = pool.acquire().await?;
    let absent =
        absent_from_thread(&mut conn, GMAIL, THREAD, &labels(&["Finance", "Travel"])).await?;
    assert_eq!(absent, [FINANCE]);

    // Still listed on the message, but being removed.
    let carried = carried_by_messages(&mut conn, &[OLDER], &absent).await?;
    assert_eq!(carried, []);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("thread_gain"))
)]
async fn a_label_on_many_messages_is_carried_once_and_never_by_a_draft(pool: PgPool) -> Result<()> {
    label_message(&pool, OLDER, TRAVEL).await?;
    label_message(&pool, NEWER, TRAVEL).await?;

    let mut conn = pool.acquire().await?;
    let carried = carried_by_messages(&mut conn, &[NEWER, DRAFT, OLDER], &[TRAVEL]).await?;
    assert_eq!(
        carried,
        [CarriedLabel {
            label_id: TRAVEL,
            message_id: OLDER,
            thread_id: THREAD,
        }]
    );
    assert_eq!(
        carried_by_messages(&mut conn, &[DRAFT], &[TRAVEL]).await?,
        []
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("thread_gain"))
)]
async fn a_thread_imported_whole_gains_what_its_earlier_messages_lack(pool: PgPool) -> Result<()> {
    label_message(&pool, NEWER, FINANCE).await?;
    label_message(&pool, NEWER, TRAVEL).await?;

    assert_eq!(new_to_thread(&pool, NEWER).await?, [TRAVEL]);
    assert_eq!(new_to_thread(&pool, OLDER).await?, [FINANCE]);
    assert_eq!(new_to_thread(&pool, DRAFT).await?, Vec::<Uuid>::new());
    Ok(())
}
