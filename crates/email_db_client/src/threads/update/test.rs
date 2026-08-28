use super::*;
use crate::threads::get::get_thread_by_id_and_link_id;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use std::time::Duration;

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

// Discarding a draft via delete_message_with_tx — the drafts delete API
// path — must recompute the thread metadata the draft inflated: is_signal,
// inbox_visible, and latest_inbound_message_ts all count drafts, and stale
// values would strand the thread in inbox views (Signal) after the draft
// is gone.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn draft_discard_recomputes_thread_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const THREAD: &str = "00000000-0000-0000-0000-00000000d208";
    const DRAFT_MSG: &str = "00000000-0000-0000-0000-00000000d510";

    // Draft-inflated fixture state: signal, inbox-visible, draft ts standing
    // in for the inbound timestamp.
    assert!(fetch_signal(&pool, THREAD).await?);
    let before = fetch_inbox_state(&pool, THREAD).await?;
    assert!(before.inbox_visible);
    assert!(before.latest_inbound_message_ts.is_some());

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
    let deleted_thread = crate::messages::delete::delete_message_with_tx(&mut conn, &draft).await?;
    assert!(deleted_thread.is_none(), "thread should survive");

    // The remaining message is CATEGORY_PROMOTIONS-only: noise, and without
    // an INBOX label the thread leaves the inbox and has no inbound ts.
    assert!(!fetch_signal(&pool, THREAD).await?);
    let after = fetch_inbox_state(&pool, THREAD).await?;
    assert!(!after.inbox_visible);
    assert!(after.latest_inbound_message_ts.is_none());
    Ok(())
}

struct ThreadInboxState {
    inbox_visible: bool,
    latest_inbound_message_ts: Option<chrono::DateTime<chrono::Utc>>,
}

async fn fetch_inbox_state(
    pool: &Pool<Postgres>,
    thread_id: &str,
) -> anyhow::Result<ThreadInboxState> {
    Ok(sqlx::query_as!(
        ThreadInboxState,
        r#"SELECT inbox_visible, latest_inbound_message_ts FROM email_threads WHERE id = $1"#,
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

// update_thread_metadata piggybacks the is_signal sync, so every existing
// metadata-recompute call site keeps the flag fresh.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn update_thread_metadata_syncs_signal_flag(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str(SIG_THREAD_STALE_PROMO)?;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;

    assert!(fetch_signal(&pool, SIG_THREAD_STALE_PROMO).await?);
    let thread_before = get_thread_by_id_and_link_id(&pool, thread_id, link_id)
        .await?
        .expect("thread should exist");

    tokio::time::sleep(Duration::from_millis(10)).await;

    let mut conn = pool.acquire().await?;
    update_thread_metadata(&mut conn, thread_id, link_id).await?;

    assert!(!fetch_signal(&pool, SIG_THREAD_STALE_PROMO).await?);
    let thread_after = get_thread_by_id_and_link_id(&pool, thread_id, link_id)
        .await?
        .expect("thread should still exist");
    assert!(
        thread_after.updated_at > thread_before.updated_at,
        "metadata recomputation should advance the thread timestamp"
    );
    Ok(())
}

// A recomputation that produces the same values must not rewrite the row.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn repeated_metadata_recompute_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str(SIG_THREAD_STALE_PROMO)?;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;

    let mut conn = pool.acquire().await?;
    update_thread_metadata(&mut conn, thread_id, link_id).await?;
    let thread_after_first = get_thread_by_id_and_link_id(&pool, thread_id, link_id)
        .await?
        .expect("thread should exist");

    tokio::time::sleep(Duration::from_millis(10)).await;

    update_thread_metadata(&mut conn, thread_id, link_id).await?;
    let thread_after_second = get_thread_by_id_and_link_id(&pool, thread_id, link_id)
        .await?
        .expect("thread should still exist");
    assert_eq!(
        thread_after_second.updated_at, thread_after_first.updated_at,
        "no-op metadata recompute must not rewrite the row"
    );
    Ok(())
}
