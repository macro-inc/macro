use super::*;
use crate::domain::models::UpsertEmailFilterInput;

const LINK_ID: &str = "00000000-0000-0000-0000-000000000e01";
const THREAD_PLAIN_SIGNAL: &str = "00000000-0000-0000-0000-00000000e201";
const THREAD_PROMO_NOISE: &str = "00000000-0000-0000-0000-00000000e202";
const THREAD_STALE_SIGNAL: &str = "00000000-0000-0000-0000-00000000e203";

async fn fetch_signal(pool: &Pool<Postgres>, thread_id: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT is_signal FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

// Upserting a mute filter for a sender flips their threads to noise via the
// fan-out resync; deleting the filter flips them back.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn filter_upsert_and_delete_resync_signal_flags(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    // Mute the sender: their unlabeled (signal) thread flips to noise.
    let filter = repo
        .upsert_email_filter(
            link_id,
            UpsertEmailFilterInput {
                email_address: Some("plain@example.com".to_string()),
                email_domain: None,
                is_important: false,
            },
        )
        .await?;
    assert!(!fetch_signal(&pool, THREAD_PLAIN_SIGNAL).await?);

    // Deleting the filter restores the heuristic verdict.
    assert!(repo.delete_email_filter(filter.id, link_id).await?);
    assert!(fetch_signal(&pool, THREAD_PLAIN_SIGNAL).await?);

    Ok(())
}

// Marking a whole domain important promotes its category-labeled (noise)
// threads to signal.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn domain_filter_upsert_promotes_category_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    assert!(!fetch_signal(&pool, THREAD_PROMO_NOISE).await?);

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: None,
            email_domain: Some("newsletter.com".to_string()),
            is_important: true,
        },
    )
    .await?;

    assert!(fetch_signal(&pool, THREAD_PROMO_NOISE).await?);
    Ok(())
}

// The email-crate update_thread_metadata port piggybacks the is_signal sync
// (clears a stale flag), matching the email_db_client behavior.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn update_thread_metadata_syncs_signal_flag(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert!(fetch_signal(&pool, THREAD_STALE_SIGNAL).await?);

    let mut tx = pool.begin().await?;
    super::super::thread::update_thread_metadata(
        &mut tx,
        Uuid::parse_str(THREAD_STALE_SIGNAL)?,
        Uuid::parse_str(LINK_ID)?,
    )
    .await?;
    tx.commit().await?;

    assert!(!fetch_signal(&pool, THREAD_STALE_SIGNAL).await?);
    Ok(())
}

const THREAD_DRAFT_SIGNAL: &str = "00000000-0000-0000-0000-00000000e204";
const DRAFT_MSG: &str = "00000000-0000-0000-0000-00000000e505";

// Discarding a draft via the new-crate delete_draft_message (no metadata
// recompute on this path) still refreshes is_signal.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn delete_draft_message_syncs_signal_flag(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // The draft is the thread's only signal message.
    assert!(fetch_signal(&pool, THREAD_DRAFT_SIGNAL).await?);

    let repo = EmailPgRepo::new(pool.clone());
    repo.delete_draft_message(
        Uuid::parse_str(DRAFT_MSG)?,
        Uuid::parse_str(THREAD_DRAFT_SIGNAL)?,
    )
    .await?;

    assert!(!fetch_signal(&pool, THREAD_DRAFT_SIGNAL).await?);
    Ok(())
}
