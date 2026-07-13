use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const THREAD_WITH_ICS: &str = "00000000-0000-0000-0000-00000000b201";
const THREAD_STALE_TRUE_PDF_ONLY: &str = "00000000-0000-0000-0000-00000000b202";

async fn fetch_flag(pool: &Pool<Postgres>, thread_id: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT has_calendar_attachment FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn sync_sets_flag_when_thread_has_calendar_attachment(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert!(!fetch_flag(&pool, THREAD_WITH_ICS).await?);

    let mut conn = pool.acquire().await?;
    sync_thread_calendar_flag(&mut conn, Uuid::parse_str(THREAD_WITH_ICS)?).await?;

    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn sync_clears_stale_flag_when_no_calendar_attachment(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Fixture marks this thread true even though its only attachment is a PDF.
    assert!(fetch_flag(&pool, THREAD_STALE_TRUE_PDF_ONLY).await?);

    let mut conn = pool.acquire().await?;
    sync_thread_calendar_flag(&mut conn, Uuid::parse_str(THREAD_STALE_TRUE_PDF_ONLY)?).await?;

    assert!(!fetch_flag(&pool, THREAD_STALE_TRUE_PDF_ONLY).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn sync_is_stable_when_flag_already_matches(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str(THREAD_WITH_ICS)?;
    let mut conn = pool.acquire().await?;
    sync_thread_calendar_flag(&mut conn, thread_id).await?;
    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);

    // Re-sync with no attachment changes: the value must stay put.
    sync_thread_calendar_flag(&mut conn, thread_id).await?;
    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);
    Ok(())
}

// -- is_signal ---------------------------------------------------------------

const SIG_THREAD_UNLABELED: &str = "00000000-0000-0000-0000-00000000d201";
const SIG_THREAD_STALE_PROMO: &str = "00000000-0000-0000-0000-00000000d202";
const SIG_THREAD_MIXED: &str = "00000000-0000-0000-0000-00000000d203";
const SIG_THREAD_TRASH_ONLY: &str = "00000000-0000-0000-0000-00000000d204";
const SIG_THREAD_VIP_ADDRESS: &str = "00000000-0000-0000-0000-00000000d205";
const SIG_THREAD_DOMAIN_MUTED: &str = "00000000-0000-0000-0000-00000000d206";
const SIG_THREAD_DRAFT: &str = "00000000-0000-0000-0000-00000000d207";

async fn fetch_signal(pool: &Pool<Postgres>, thread_id: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT is_signal FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

async fn sync_signal(pool: &Pool<Postgres>, thread_id: &str) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    sync_thread_signal_flag(&mut conn, Uuid::parse_str(thread_id)?).await
}

// A message with no category labels counts as signal by default.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_set_for_unlabeled_message(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert!(!fetch_signal(&pool, SIG_THREAD_UNLABELED).await?);
    sync_signal(&pool, SIG_THREAD_UNLABELED).await?;
    assert!(fetch_signal(&pool, SIG_THREAD_UNLABELED).await?);
    Ok(())
}

// A stale true flag is cleared when the thread's only message carries a
// depriority category label.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_cleared_for_category_labeled_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Fixture marks this thread signal even though its only message is
    // CATEGORY_PROMOTIONS.
    assert!(fetch_signal(&pool, SIG_THREAD_STALE_PROMO).await?);
    sync_signal(&pool, SIG_THREAD_STALE_PROMO).await?;
    assert!(!fetch_signal(&pool, SIG_THREAD_STALE_PROMO).await?);
    Ok(())
}

// Any-message semantics: one signal message outweighs noise siblings.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_set_when_any_message_matches(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // One promotions message + one unlabeled message: the unlabeled one wins.
    sync_signal(&pool, SIG_THREAD_MIXED).await?;
    assert!(fetch_signal(&pool, SIG_THREAD_MIXED).await?);
    Ok(())
}

// TRASH messages are excluded: they can't make a thread signal.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_ignores_trashed_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Only message is TRASH: it would otherwise be signal (no category labels).
    sync_signal(&pool, SIG_THREAD_TRASH_ONLY).await?;
    assert!(!fetch_signal(&pool, SIG_THREAD_TRASH_ONLY).await?);
    Ok(())
}

// An important-address filter outranks both a muted-domain filter and a
// depriority category label.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_address_override_beats_domain_and_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // vip@corp.com is important by address even though corp.com is muted by
    // domain and the message carries a depriority label.
    sync_signal(&pool, SIG_THREAD_VIP_ADDRESS).await?;
    assert!(fetch_signal(&pool, SIG_THREAD_VIP_ADDRESS).await?);
    Ok(())
}

// A muted-domain filter forces noise when the sender has no address-level
// exception, even for an otherwise-signal message.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_domain_override_mutes_unlabeled_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // other@corp.com has no address exception, so the domain mute applies.
    sync_signal(&pool, SIG_THREAD_DOMAIN_MUTED).await?;
    assert!(!fetch_signal(&pool, SIG_THREAD_DOMAIN_MUTED).await?);
    Ok(())
}

// Drafts are always signal, even when labeled with a depriority category.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_set_for_draft_despite_category_label(pool: Pool<Postgres>) -> anyhow::Result<()> {
    sync_signal(&pool, SIG_THREAD_DRAFT).await?;
    assert!(fetch_signal(&pool, SIG_THREAD_DRAFT).await?);
    Ok(())
}

// Discarding a draft via delete_message_with_tx(update_thread_metadata =
// false) — the drafts delete API path — must still refresh is_signal.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn draft_discard_without_metadata_recompute_syncs_signal_flag(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const THREAD: &str = "00000000-0000-0000-0000-00000000d208";
    const DRAFT_MSG: &str = "00000000-0000-0000-0000-00000000d510";

    assert!(fetch_signal(&pool, THREAD).await?);

    let now = chrono::Utc::now();
    let draft = models_email::email::service::message::SimpleMessage {
        db_id: Uuid::parse_str(DRAFT_MSG)?,
        provider_id: None,
        thread_db_id: Uuid::parse_str(THREAD)?,
        provider_thread_id: None,
        replying_to_id: None,
        global_id: String::new(),
        link_id: Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?,
        subject: None,
        snippet: None,
        from_contact_id: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: true,
        has_attachments: false,
        headers_json: None,
        created_at: now,
        updated_at: now,
    };

    let mut conn = pool.acquire().await?;
    let deleted_thread =
        crate::messages::delete::delete_message_with_tx(&mut conn, &draft, false).await?;
    assert!(deleted_thread.is_none(), "thread should survive");

    // The remaining message is CATEGORY_PROMOTIONS-only: noise.
    assert!(!fetch_signal(&pool, THREAD).await?);
    Ok(())
}

// update_thread_metadata piggybacks the is_signal sync, so every existing
// metadata-recompute call site keeps the flag fresh.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn update_thread_metadata_syncs_signal_flag(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert!(fetch_signal(&pool, SIG_THREAD_STALE_PROMO).await?);

    let mut conn = pool.acquire().await?;
    update_thread_metadata(
        &mut conn,
        Uuid::parse_str(SIG_THREAD_STALE_PROMO)?,
        Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?,
    )
    .await?;

    assert!(!fetch_signal(&pool, SIG_THREAD_STALE_PROMO).await?);
    Ok(())
}
