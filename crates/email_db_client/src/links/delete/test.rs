use super::*;
use crate::links::insert::upsert_link;
use crate::links::update::update_link_sync_status;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::link::{Link, UserProvider};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing_subscriber::layer::{Context, SubscriberExt as _};
use tracing_subscriber::registry::LookupSpan;

/// The fixture link that tests purge.
const PURGED: Uuid = Uuid::from_u128(0xa001);
/// The fixture link that must survive every purge of [`PURGED`].
const KEPT: Uuid = Uuid::from_u128(0xb001);

/// Rows the `purge_link` fixture stores for one link.
#[derive(Debug, PartialEq, Eq)]
struct LinkRows {
    links: i64,
    settings: i64,
    gmail_histories: i64,
    sync_tokens: i64,
    contacts: i64,
    labels: i64,
    threads: i64,
    messages: i64,
    message_labels: i64,
    recipients: i64,
    attachments: i64,
    attached_sfs: i64,
    user_history: i64,
    scheduled: i64,
}

impl LinkRows {
    const EMPTY: Self = Self {
        links: 0,
        settings: 0,
        gmail_histories: 0,
        sync_tokens: 0,
        contacts: 0,
        labels: 0,
        threads: 0,
        messages: 0,
        message_labels: 0,
        recipients: 0,
        attachments: 0,
        attached_sfs: 0,
        user_history: 0,
        scheduled: 0,
    };

    const FULL: Self = Self {
        links: 1,
        settings: 1,
        gmail_histories: 1,
        sync_tokens: 1,
        contacts: 4,
        labels: 3,
        threads: 11,
        messages: 30,
        message_labels: 60,
        recipients: 60,
        attachments: 10,
        attached_sfs: 10,
        user_history: 10,
        scheduled: 1,
    };
}

async fn link_rows(pool: &Pool<Postgres>, link_id: Uuid) -> anyhow::Result<LinkRows> {
    Ok(sqlx::query_as!(
        LinkRows,
        r#"
        SELECT
            (SELECT COUNT(*) FROM email_links WHERE id = $1) AS "links!",
            (SELECT COUNT(*) FROM email_settings WHERE link_id = $1) AS "settings!",
            (SELECT COUNT(*) FROM email_gmail_histories WHERE link_id = $1) AS "gmail_histories!",
            (SELECT COUNT(*) FROM email_sync_tokens WHERE link_id = $1) AS "sync_tokens!",
            (SELECT COUNT(*) FROM email_contacts WHERE link_id = $1) AS "contacts!",
            (SELECT COUNT(*) FROM email_labels WHERE link_id = $1) AS "labels!",
            (SELECT COUNT(*) FROM email_threads WHERE link_id = $1) AS "threads!",
            (SELECT COUNT(*) FROM email_messages WHERE link_id = $1) AS "messages!",
            (SELECT COUNT(*) FROM email_message_labels ml
                JOIN email_labels l ON l.id = ml.label_id WHERE l.link_id = $1) AS "message_labels!",
            (SELECT COUNT(*) FROM email_message_recipients r
                JOIN email_contacts c ON c.id = r.contact_id WHERE c.link_id = $1) AS "recipients!",
            (SELECT COUNT(*) FROM email_attachments a
                JOIN email_messages m ON m.id = a.message_id WHERE m.link_id = $1) AS "attachments!",
            (SELECT COUNT(*) FROM email_attachments_sfs s
                JOIN email_attachments a ON a.id = s.attachment_id
                JOIN email_messages m ON m.id = a.message_id WHERE m.link_id = $1) AS "attached_sfs!",
            (SELECT COUNT(*) FROM email_user_history WHERE link_id = $1) AS "user_history!",
            (SELECT COUNT(*) FROM email_scheduled_messages WHERE link_id = $1) AS "scheduled!"
        "#,
        link_id
    )
    .fetch_one(pool)
    .await?)
}

/// SFS rows left for `email_sfs_delete_handler` to clean up.
async fn detached_sfs_rows(pool: &Pool<Postgres>) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM email_attachments_sfs WHERE attachment_id IS NULL"#
    )
    .fetch_one(pool)
    .await?)
}

struct DeletionState {
    is_sync_active: bool,
    deleting_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn deletion_state(pool: &Pool<Postgres>, link_id: Uuid) -> anyhow::Result<DeletionState> {
    Ok(sqlx::query_as!(
        DeletionState,
        "SELECT is_sync_active, deleting_at FROM email_links WHERE id = $1",
        link_id
    )
    .fetch_one(pool)
    .await?)
}

fn batch_sizes(messages: u32, threads: u32, contacts: u32) -> PurgePacing {
    PurgePacing {
        messages: NonZeroU32::new(messages).expect("non-zero"),
        threads: NonZeroU32::new(threads).expect("non-zero"),
        contacts: NonZeroU32::new(contacts).expect("non-zero"),
        pause: Duration::ZERO,
    }
}

/// Small enough that every phase of the fixture takes several batches, with a partial last one.
fn tiny_batches() -> PurgePacing {
    batch_sizes(4, 3, 3)
}

fn gmail_link(email: &str) -> anyhow::Result<Link> {
    Ok(Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id: MacroUserIdStr::try_from(format!("macro|{email}"))?,
        fusionauth_user_id: "33333333-3333-3333-3333-333333333333".to_string(),
        email_address: EmailStr::try_from(email.to_string())?,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    })
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("purge_link"))
)]
async fn purge_removes_all_link_data_in_batches(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_eq!(link_rows(&pool, PURGED).await?, LinkRows::FULL);

    let summary = purge_link(&pool, PURGED, tiny_batches()).await?;

    assert_eq!(
        summary,
        PurgeSummary {
            messages: 30,
            threads: 11,
            contacts: 4,
            link_deleted: true,
        }
    );
    assert_eq!(link_rows(&pool, PURGED).await?, LinkRows::EMPTY);
    assert_eq!(link_rows(&pool, KEPT).await?, LinkRows::FULL);
    // The purged link's stored files are handed to the SFS cleanup instead of leaking.
    assert_eq!(detached_sfs_rows(&pool).await?, 10);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("purge_link"))
)]
async fn purge_pauses_between_batches(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // 30 messages in batches of 20 take one full batch and one partial one; threads and
    // contacts each fit in a single partial batch. So the purge pauses exactly once.
    let pause = Duration::from_secs(1);
    let started = std::time::Instant::now();

    let summary = purge_link(
        &pool,
        PURGED,
        PurgePacing {
            pause,
            ..batch_sizes(20, 100, 100)
        },
    )
    .await?;

    assert!(started.elapsed() >= pause);
    assert!(summary.link_deleted);
    assert_eq!(link_rows(&pool, PURGED).await?, LinkRows::EMPTY);
    assert_eq!(link_rows(&pool, KEPT).await?, LinkRows::FULL);

    Ok(())
}

/// The integer fields recorded on each span while installed, by span and field name.
#[derive(Clone, Default)]
struct RecordedFields(Arc<Mutex<HashMap<&'static str, HashMap<&'static str, u128>>>>);

impl RecordedFields {
    fn of(&self, span: &str) -> HashMap<&'static str, u128> {
        let spans = self.0.lock().expect("recorded fields lock poisoned");
        spans.get(span).cloned().unwrap_or_default()
    }
}

impl<S> tracing_subscriber::Layer<S> for RecordedFields
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_record(
        &self,
        id: &tracing::span::Id,
        values: &tracing::span::Record<'_>,
        ctx: Context<'_, S>,
    ) {
        let Some(span) = ctx.span(id) else {
            return;
        };
        let mut spans = self.0.lock().expect("recorded fields lock poisoned");
        values.record(&mut IntegerFields(spans.entry(span.name()).or_default()));
    }
}

struct IntegerFields<'a>(&'a mut HashMap<&'static str, u128>);

impl Visit for IntegerFields<'_> {
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.insert(field.name(), value.into());
    }

    fn record_u128(&mut self, field: &Field, value: u128) {
        self.0.insert(field.name(), value);
    }

    fn record_debug(&mut self, _field: &Field, _value: &dyn std::fmt::Debug) {}
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("purge_link"))
)]
async fn purge_phases_record_their_batches_and_pauses(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let recorded = RecordedFields::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(recorded.clone()));
    tracing::callsite::rebuild_interest_cache();
    let pause = Duration::from_millis(5);

    let summary = purge_link(
        &pool,
        PURGED,
        PurgePacing {
            pause,
            ..tiny_batches()
        },
    )
    .await?;

    // 30 messages in batches of 4 take 7 full batches and a partial one. A full batch keeps
    // its last thread even when it emptied it, so they finish 8 of the 11 threads, and the
    // thread phase takes the other 3 in one full batch and an empty one. 4 contacts in
    // batches of 3 take a full batch and a partial one. Every full batch is followed by a
    // pause.
    let messages = recorded.of("email.purge_link.messages");
    assert_eq!(messages["batches"], 8);
    assert_eq!(messages["paused_ms"], 7 * pause.as_millis());
    assert_eq!(messages["messages"], 30);
    assert_eq!(messages["threads"], 8);
    let threads = recorded.of("email.purge_link.threads");
    assert_eq!(threads["batches"], 2);
    assert_eq!(threads["paused_ms"], pause.as_millis());
    assert_eq!(threads["deleted"], 3);
    let contacts = recorded.of("email.purge_link.contacts");
    assert_eq!(contacts["batches"], 2);
    assert_eq!(contacts["paused_ms"], pause.as_millis());
    assert_eq!(contacts["deleted"], 4);
    assert_eq!(
        summary,
        PurgeSummary {
            messages: 30,
            threads: 11,
            contacts: 4,
            link_deleted: true,
        }
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("purge_link"))
)]
async fn purge_resumes_after_an_interrupted_run(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // A worker that crashed partway through the message phase. Threads hold 3 messages, so
    // two batches of 7 finish 4 threads and stop partway into a fifth.
    mark_link_deleting(&pool, PURGED).await?;
    let limit = NonZeroU32::new(7).expect("non-zero");
    let first = purge_message_batch(&pool, PURGED, Uuid::nil(), limit).await?;
    assert_eq!((first.messages, first.threads), (7, 2));
    let cursor = first.next_cursor.expect("more messages remain");
    let second = purge_message_batch(&pool, PURGED, cursor, limit).await?;
    assert_eq!((second.messages, second.threads), (7, 2));

    let partial = link_rows(&pool, PURGED).await?;
    assert_eq!(partial.links, 1);
    assert_eq!(partial.messages, 16);
    assert_eq!(partial.threads, 7);
    let state = deletion_state(&pool, PURGED).await?;
    assert!(!state.is_sync_active);
    assert!(state.deleting_at.is_some());

    // The redelivered message resumes from what is left.
    let resumed = purge_link(&pool, PURGED, tiny_batches()).await?;
    assert_eq!(
        resumed,
        PurgeSummary {
            messages: 16,
            threads: 7,
            contacts: 4,
            link_deleted: true,
        }
    );

    // A duplicate delivery after completion finds nothing left to do.
    let duplicate = purge_link(&pool, PURGED, tiny_batches()).await?;
    assert_eq!(duplicate, PurgeSummary::default());

    assert_eq!(link_rows(&pool, PURGED).await?, LinkRows::EMPTY);
    assert_eq!(link_rows(&pool, KEPT).await?, LinkRows::FULL);
    assert_eq!(detached_sfs_rows(&pool).await?, 10);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("purge_link"))
)]
async fn message_batches_keep_a_thread_until_its_last_message_is_gone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Threads hold 3 messages, so a batch of 2 ends inside a thread every time.
    mark_link_deleting(&pool, PURGED).await?;
    let limit = NonZeroU32::new(2).expect("non-zero");

    let first = purge_message_batch(&pool, PURGED, Uuid::nil(), limit).await?;
    assert_eq!((first.messages, first.threads), (2, 0));
    let partial = link_rows(&pool, PURGED).await?;
    assert_eq!((partial.messages, partial.threads), (28, 11));

    let cursor = first.next_cursor.expect("more messages remain");
    let second = purge_message_batch(&pool, PURGED, cursor, limit).await?;
    assert_eq!((second.messages, second.threads), (2, 1));
    let partial = link_rows(&pool, PURGED).await?;
    assert_eq!((partial.messages, partial.threads), (26, 10));
    assert_eq!(partial.user_history, 9);

    assert_eq!(link_rows(&pool, KEPT).await?, LinkRows::FULL);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("purge_link"))
)]
async fn concurrent_purges_of_one_link_both_succeed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (first, second) = tokio::try_join!(
        purge_link(&pool, PURGED, batch_sizes(2, 2, 1)),
        purge_link(&pool, PURGED, batch_sizes(3, 1, 2)),
    )?;

    assert_eq!(first.messages + second.messages, 30);
    assert_eq!(first.threads + second.threads, 11);
    assert_eq!(first.contacts + second.contacts, 4);
    assert!(first.link_deleted != second.link_deleted);

    assert_eq!(link_rows(&pool, PURGED).await?, LinkRows::EMPTY);
    assert_eq!(link_rows(&pool, KEPT).await?, LinkRows::FULL);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_does_not_resume_on_a_link_being_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    let link = upsert_link(&mut conn, gmail_link("resume@purge.test")?).await?;

    mark_link_deleting(&pool, link.id).await?;
    let marked = deletion_state(&pool, link.id).await?;
    assert!(!marked.is_sync_active);
    let deleting_at = marked.deleting_at.expect("deleting_at is set");

    update_link_sync_status(&pool, link.id, true).await?;
    assert!(!deletion_state(&pool, link.id).await?.is_sync_active);

    // Reconnecting the same mailbox mid-purge must not revive the doomed row.
    assert!(
        upsert_link(&mut conn, gmail_link("resume@purge.test")?)
            .await
            .is_err()
    );

    // Marking again (a redelivered delete) keeps the original mark.
    mark_link_deleting(&pool, link.id).await?;
    let state = deletion_state(&pool, link.id).await?;
    assert!(!state.is_sync_active);
    assert_eq!(state.deleting_at, Some(deleting_at));

    assert!(
        purge_link(&pool, link.id, PurgePacing::default())
            .await?
            .link_deleted
    );

    // Once the purge is done, reconnecting creates a fresh, syncing link.
    let reconnected = upsert_link(&mut conn, gmail_link("resume@purge.test")?).await?;
    assert_ne!(reconnected.id, link.id);
    let state = deletion_state(&pool, reconnected.id).await?;
    assert!(state.is_sync_active);
    assert!(state.deleting_at.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purge_of_a_missing_link_is_a_no_op(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let missing = macro_uuid::generate_uuid_v7();

    mark_link_deleting(&pool, missing).await?;
    assert_eq!(
        purge_link(&pool, missing, PurgePacing::default()).await?,
        PurgeSummary::default()
    );

    Ok(())
}
