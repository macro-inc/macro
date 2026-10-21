use super::*;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const LINK: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD: &str = "11111111-1111-1111-1111-111111111111";
const RECEIVED: &str = "ee000001-0000-0000-0000-000000000001";
const SENT: &str = "ee000002-0000-0000-0000-000000000002";
const DRAFT: &str = "ee000003-0000-0000-0000-000000000003";

fn id(value: &str) -> Uuid {
    Uuid::parse_str(value).unwrap()
}

async fn stored_receipt(pool: &PgPool, message: &str) -> (i32, Option<DateTime<Utc>>) {
    let row = sqlx::query!(
        "SELECT open_count, first_opened_at FROM email_message_read_receipts WHERE message_id = $1",
        id(message)
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.open_count, row.first_opened_at)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_message"))
)]
async fn tracking_follows_the_inbox_setting(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = ReadReceiptPgRepository(pool.clone());
    assert!(!repo.tracking_enabled(id(LINK)).await?);

    sqlx::query!(
        "INSERT INTO email_settings (link_id, read_receipts_enabled) VALUES ($1, TRUE)",
        id(LINK)
    )
    .execute(&pool)
    .await?;
    assert!(repo.tracking_enabled(id(LINK)).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_message"))
)]
async fn a_message_keeps_its_first_token(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = ReadReceiptPgRepository(pool);
    let first = ReadReceiptToken::generate();
    assert_eq!(repo.message_token(id(SENT), &first).await?, first);
    assert_eq!(
        repo.message_token(id(SENT), &ReadReceiptToken::generate())
            .await?,
        first
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_message"))
)]
async fn opens_count_only_for_sent_messages_outside_the_debounce(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = ReadReceiptPgRepository(pool.clone());
    let draft = repo
        .message_token(id(DRAFT), &ReadReceiptToken::generate())
        .await?;
    let sent = repo
        .message_token(id(SENT), &ReadReceiptToken::generate())
        .await?;
    let first = Utc::now();
    let debounce = Duration::seconds(5);

    assert!(!repo.record_open(&draft, first, first - debounce).await?);
    assert_eq!(stored_receipt(&pool, DRAFT).await, (0, None));

    assert!(repo.record_open(&sent, first, first - debounce).await?);
    let soon = first + Duration::seconds(1);
    assert!(!repo.record_open(&sent, soon, soon - debounce).await?);
    let later = first + Duration::minutes(1);
    assert!(repo.record_open(&sent, later, later - debounce).await?);

    let (count, first_opened_at) = stored_receipt(&pool, SENT).await;
    assert_eq!(count, 2);
    assert_eq!(
        first_opened_at.map(|at| at.timestamp_micros()),
        Some(first.timestamp_micros())
    );
    assert!(
        !repo
            .record_open(&ReadReceiptToken::generate(), later, later - debounce)
            .await?
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_message"))
)]
async fn thread_receipts_list_sent_messages_of_the_given_inboxes(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = ReadReceiptPgRepository(pool);
    for message in [RECEIVED, SENT] {
        repo.message_token(id(message), &ReadReceiptToken::generate())
            .await?;
    }

    let receipts = repo.thread_receipts(id(THREAD), &[id(LINK)], 10).await?;
    assert_eq!(
        receipts,
        [MessageReadReceipt {
            message_id: id(SENT),
            open_count: 0,
            first_opened_at: None,
            last_opened_at: None,
        }]
    );
    assert!(
        repo.thread_receipts(id(THREAD), &[Uuid::now_v7()], 10)
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_message"))
)]
async fn accessible_inboxes_include_the_owners_link(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = ReadReceiptPgRepository(pool);
    let owner = MacroUserIdStr::try_from("macro|user1@test.com").unwrap();
    assert_eq!(repo.accessible_inboxes(&owner).await?, [id(LINK)]);
    Ok(())
}
