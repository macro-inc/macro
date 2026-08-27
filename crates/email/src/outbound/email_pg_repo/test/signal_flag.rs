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
        "SELECT inbox_visible, latest_inbound_message_ts FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

// Discarding a draft via delete_draft_message recomputes the thread metadata
// the draft inflated: is_signal, inbox_visible, and
// latest_inbound_message_ts all count drafts.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn delete_draft_message_recomputes_thread_metadata(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // The draft is the thread's only signal message and its stand-in
    // inbound timestamp.
    assert!(fetch_signal(&pool, THREAD_DRAFT_SIGNAL).await?);
    let before = fetch_inbox_state(&pool, THREAD_DRAFT_SIGNAL).await?;
    assert!(before.inbox_visible);
    assert!(before.latest_inbound_message_ts.is_some());

    let repo = EmailPgRepo::new(pool.clone());
    repo.delete_draft_message(
        Uuid::parse_str(DRAFT_MSG)?,
        Uuid::parse_str(THREAD_DRAFT_SIGNAL)?,
    )
    .await?;

    assert!(!fetch_signal(&pool, THREAD_DRAFT_SIGNAL).await?);
    let after = fetch_inbox_state(&pool, THREAD_DRAFT_SIGNAL).await?;
    assert!(!after.inbox_visible);
    assert!(after.latest_inbound_message_ts.is_none());
    Ok(())
}

const THREAD_SENT_DONE: &str = "00000000-0000-0000-0000-00000000e206";
const SENT_THREAD_DRAFT_MSG: &str = "00000000-0000-0000-0000-00000000e508";

// Starting a draft on a done sent thread resurfaces it into the inbox
// (Signal); discarding the draft must send it back out. is_signal stays
// true via the SENT label, so the inbox_visible / latest_inbound reset is
// the only thing keeping the thread out of inbox views.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn delete_draft_message_returns_sent_thread_out_of_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let before = fetch_inbox_state(&pool, THREAD_SENT_DONE).await?;
    assert!(before.inbox_visible);
    assert!(before.latest_inbound_message_ts.is_some());

    let repo = EmailPgRepo::new(pool.clone());
    repo.delete_draft_message(
        Uuid::parse_str(SENT_THREAD_DRAFT_MSG)?,
        Uuid::parse_str(THREAD_SENT_DONE)?,
    )
    .await?;

    assert!(fetch_signal(&pool, THREAD_SENT_DONE).await?);
    let after = fetch_inbox_state(&pool, THREAD_SENT_DONE).await?;
    assert!(!after.inbox_visible);
    assert!(after.latest_inbound_message_ts.is_none());
    Ok(())
}

const THREAD_SAME_DOMAIN: &str = "00000000-0000-0000-0000-00000000e205";

// The fan-out resync applies address-beats-domain precedence: muting a
// domain flips all its threads, and an address-important exception flips
// only that sender's threads back.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn address_exception_beats_domain_mute_via_filter_mutations(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: None,
            email_domain: Some("example.com".to_string()),
            is_important: false,
        },
    )
    .await?;
    assert!(!fetch_signal(&pool, THREAD_PLAIN_SIGNAL).await?);
    assert!(!fetch_signal(&pool, THREAD_SAME_DOMAIN).await?);

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("plain@example.com".to_string()),
            email_domain: None,
            is_important: true,
        },
    )
    .await?;
    assert!(fetch_signal(&pool, THREAD_PLAIN_SIGNAL).await?);
    assert!(!fetch_signal(&pool, THREAD_SAME_DOMAIN).await?);

    Ok(())
}

// Deleting a domain mute resyncs the whole domain's threads; a coexisting
// address-important exception keeps its sender signal throughout.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn deleting_domain_filter_keeps_address_exception(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    let domain_filter = repo
        .upsert_email_filter(
            link_id,
            UpsertEmailFilterInput {
                email_address: None,
                email_domain: Some("example.com".to_string()),
                is_important: false,
            },
        )
        .await?;
    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("plain@example.com".to_string()),
            email_domain: None,
            is_important: true,
        },
    )
    .await?;
    assert!(fetch_signal(&pool, THREAD_PLAIN_SIGNAL).await?);
    assert!(!fetch_signal(&pool, THREAD_SAME_DOMAIN).await?);

    assert!(repo.delete_email_filter(domain_filter.id, link_id).await?);
    assert!(fetch_signal(&pool, THREAD_PLAIN_SIGNAL).await?);
    assert!(fetch_signal(&pool, THREAD_SAME_DOMAIN).await?);

    Ok(())
}
