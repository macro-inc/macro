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
    sync_thread_attachment_flags(&mut conn, Uuid::parse_str(THREAD_WITH_ICS)?).await?;

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
    sync_thread_attachment_flags(&mut conn, Uuid::parse_str(THREAD_STALE_TRUE_PDF_ONLY)?).await?;

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
    sync_thread_attachment_flags(&mut conn, thread_id).await?;
    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);

    // Re-sync with no attachment changes: the value must stay put.
    sync_thread_attachment_flags(&mut conn, thread_id).await?;
    assert!(fetch_flag(&pool, THREAD_WITH_ICS).await?);
    Ok(())
}

// -- attachment kinds ---------------------------------------------------------

const KIND_THREAD_ALL_KINDS: &str = "00000000-0000-0000-0000-00000000c201";
const KIND_THREAD_STALE_NO_ATTACHMENTS: &str = "00000000-0000-0000-0000-00000000c202";
const KIND_LINK: &str = "00000000-0000-0000-0000-000000000c01";

/// `(pdf, image, document)` flags of one thread.
async fn fetch_kind_flags(
    pool: &Pool<Postgres>,
    thread_id: &str,
) -> anyhow::Result<(bool, bool, bool)> {
    let row = sqlx::query!(
        "SELECT has_pdf_attachment, has_image_attachment, has_document_attachment
         FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?;
    Ok((
        row.has_pdf_attachment,
        row.has_image_attachment,
        row.has_document_attachment,
    ))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("sync_thread_attachment_kind_flags")
    )
)]
async fn sync_sets_kind_flags_from_attachment_mime_types(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    sync_thread_attachment_flags(&mut conn, Uuid::parse_str(KIND_THREAD_ALL_KINDS)?).await?;

    assert_eq!(
        fetch_kind_flags(&pool, KIND_THREAD_ALL_KINDS).await?,
        (true, true, true)
    );
    assert!(!fetch_flag(&pool, KIND_THREAD_ALL_KINDS).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("sync_thread_attachment_kind_flags")
    )
)]
async fn sync_clears_stale_kind_flags(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    sync_thread_attachment_flags(
        &mut conn,
        Uuid::parse_str(KIND_THREAD_STALE_NO_ATTACHMENTS)?,
    )
    .await?;

    assert_eq!(
        fetch_kind_flags(&pool, KIND_THREAD_STALE_NO_ATTACHMENTS).await?,
        (false, false, false)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("sync_thread_attachment_kind_flags")
    )
)]
async fn backfill_only_sets_missing_kind_flags(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(KIND_LINK)?;

    assert_eq!(
        backfill_link_attachment_kind_flags(&pool, link_id).await?,
        1
    );
    assert_eq!(
        fetch_kind_flags(&pool, KIND_THREAD_ALL_KINDS).await?,
        (true, true, true)
    );
    // Clearing stale flags belongs to ingest and delete, not the backfill.
    assert_eq!(
        fetch_kind_flags(&pool, KIND_THREAD_STALE_NO_ATTACHMENTS).await?,
        (true, true, true)
    );

    // A rerun has nothing left to set.
    assert_eq!(
        backfill_link_attachment_kind_flags(&pool, link_id).await?,
        0
    );
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
const SIG_THREAD_MACRO_DIGEST: &str = "00000000-0000-0000-0000-00000000d209";

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

// Macro's own notification emails are never signal: the exclusion is
// case-insensitive on the sender domain and beats both the unlabeled
// default and an explicit address-important override.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_signal_flag"))
)]
async fn signal_cleared_for_macro_notification_sender(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert!(fetch_signal(&pool, SIG_THREAD_MACRO_DIGEST).await?);
    sync_signal(&pool, SIG_THREAD_MACRO_DIGEST).await?;
    assert!(!fetch_signal(&pool, SIG_THREAD_MACRO_DIGEST).await?);
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

/// Archived sent mail to `recipient` with a Macro reply draft, recomputed.
async fn reply_draft_to_sent_mail_inbox_state(
    pool: &Pool<Postgres>,
    recipient: &str,
) -> anyhow::Result<ThreadInboxState> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let (thread_id, sent_id) = (Uuid::now_v7(), Uuid::now_v7());
    let mut contacts = Vec::new();
    for email in ["me@example.com", recipient] {
        contacts.push(sqlx::query_scalar!(
            "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)
            ON CONFLICT (link_id, email_address) DO UPDATE SET email_address = EXCLUDED.email_address RETURNING id",
            Uuid::now_v7(), link_id, email,
        ).fetch_one(pool).await?);
    }
    let (sender, recipient_contact) = (contacts[0], contacts[1]);
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id, provider_id) VALUES ($1, $2, $3)",
        thread_id,
        link_id,
        thread_id.to_string(),
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, provider_id, from_contact_id, is_sent, internal_date_ts) VALUES ($1, $2, $3, $4, $5, TRUE, '2025-01-01T10:00:00Z')",
        sent_id, thread_id, link_id, sent_id.to_string(), sender,
    ).execute(pool).await?;
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'TO')",
        sent_id,
        recipient_contact,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, is_draft) VALUES ($1, $2, $3, TRUE)",
        Uuid::now_v7(),
        thread_id,
        link_id,
    )
    .execute(pool)
    .await?;
    update_thread_metadata(&mut *pool.acquire().await?, thread_id, link_id).await?;
    fetch_inbox_state(pool, &thread_id.to_string()).await
}

// Mail the user sent to themselves is mail they received, so a reply draft
// brings it back to the inbox. Mail sent only to others stays archived.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../email/fixtures", scripts("email_thread_labels"))
)]
async fn a_message_sent_to_its_own_sender_counts_as_received_mail(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let to_self = reply_draft_to_sent_mail_inbox_state(&pool, "me@example.com").await?;
    assert!(to_self.inbox_visible);
    assert!(to_self.latest_inbound_message_ts.is_some());

    let to_other = reply_draft_to_sent_mail_inbox_state(&pool, "other@example.com").await?;
    assert!(!to_other.inbox_visible);
    assert!(to_other.latest_inbound_message_ts.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../email/fixtures", scripts("email_thread_labels"))
)]
async fn returned_sent_only_metadata_preserves_visibility_without_rewriting(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let sent_label = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_labels (id, link_id, provider_label_id, name) VALUES ($1, $2, 'SENT', 'SENT')",
        sent_label, link_id,
    ).execute(&pool).await?;
    sqlx::query!(
        "UPDATE email_messages SET is_sent = TRUE WHERE thread_id = $1",
        thread_id
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_message_labels (message_id, label_id) SELECT id, $2 FROM email_messages WHERE thread_id = $1",
        thread_id, sent_label,
    ).execute(&pool).await?;
    update_thread_metadata(&mut *pool.acquire().await?, thread_id, link_id).await?;
    // All ordinary metadata already matches, including raw inbox_visible=false.
    sqlx::query!(
        "UPDATE email_threads SET reminder_returned_at = NOW() WHERE id = $1",
        thread_id
    )
    .execute(&pool)
    .await?;
    update_thread_metadata(&mut *pool.acquire().await?, thread_id, link_id).await?;
    let restored = sqlx::query!(
        "SELECT inbox_visible, latest_inbound_message_ts FROM email_threads WHERE id = $1",
        thread_id
    )
    .fetch_one(&pool)
    .await?;
    assert!(
        restored.inbox_visible,
        "the effective override must repair false visibility"
    );
    assert!(restored.latest_inbound_message_ts.is_none());

    // A fixed old timestamp makes an unintended rewrite observable without sleeps.
    let previous = sqlx::query_scalar!(
        "UPDATE email_threads SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1 RETURNING updated_at",
        thread_id,
    ).fetch_one(&pool).await?;
    update_thread_metadata(&mut *pool.acquire().await?, thread_id, link_id).await?;
    let repeated = sqlx::query!(
        "SELECT inbox_visible, updated_at FROM email_threads WHERE id = $1",
        thread_id
    )
    .fetch_one(&pool)
    .await?;
    assert!(repeated.inbox_visible);
    assert_eq!(
        repeated.updated_at, previous,
        "matching effective visibility must not rewrite metadata"
    );
    Ok(())
}
