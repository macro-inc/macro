use super::*;
use crate::domain::released_attachments::ReleasedAttachmentRepo;
use crate::domain::released_attachments::orphans::{
    OrphanCause, OrphanedAttachmentScan, ScanCounts, ScanOptions, ScanProgress, ScanProgressStore,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use std::sync::Mutex;

const OWNER: &str = "macro|owner@example.com";
const RECREATED_OWNER: &str = "macro|recreated@example.com";
const GONE_OWNER: &str = "macro|gone@example.com";

const THREAD: &str = "0e100000-0000-0000-0000-000000000001";
const MESSAGE: &str = "0e200000-0000-0000-0000-000000000001";
const MISSING_THREAD: &str = "0e100000-0000-0000-0000-000000000099";
const MISSING_MESSAGE: &str = "0e200000-0000-0000-0000-000000000099";

// Orphans, one per cause, and one its owner filed in a folder.
const MAILBOX_GONE: &str = "0d000000-0000-0000-0000-000000000001";
const MAILBOX_RECREATED: &str = "0d000000-0000-0000-0000-000000000002";
const THREAD_GONE: &str = "0d000000-0000-0000-0000-000000000003";
const MESSAGE_GONE: &str = "0d000000-0000-0000-0000-000000000004";
const ATTACHMENT_REPLACED: &str = "0d000000-0000-0000-0000-000000000005";
const ADOPTED: &str = "0d000000-0000-0000-0000-000000000006";

// Not orphans.
const LINKED: &str = "0d000000-0000-0000-0000-000000000007";
const TRASHED: &str = "0d000000-0000-0000-0000-000000000008";
const NO_SOURCE: &str = "0d000000-0000-0000-0000-000000000009";
const CHANNEL_SOURCE: &str = "0d000000-0000-0000-0000-000000000010";
const TASK_SOURCE: &str = "0d000000-0000-0000-0000-000000000011";
const PURGED: &str = "0d000000-0000-0000-0000-000000000012";

// Live and unlinked with a thread Source the import did not write: set apart
// from the Recipients row, edited after the import, or set on a plain file.
const SOURCE_SET_APART: &str = "0d000000-0000-0000-0000-000000000013";
const SOURCE_EDITED: &str = "0d000000-0000-0000-0000-000000000014";
const SOURCE_ON_PLAIN_FILE: &str = "0d000000-0000-0000-0000-000000000015";

const ORPHANS: [&str; 6] = [
    MAILBOX_GONE,
    MAILBOX_RECREATED,
    THREAD_GONE,
    MESSAGE_GONE,
    ATTACHMENT_REPLACED,
    ADOPTED,
];

/// Documents created 2026-01-01. OWNER's mailbox predates them,
/// RECREATED_OWNER's was connected after, GONE_OWNER has none. Every document
/// with a Source also has Sender, Recipients and Subject rows written in the
/// same transaction, as an import writes them, except the three whose Source
/// was set by hand.
async fn seed(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';

        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, created_at) VALUES
            ('0e000000-0000-0000-0000-000000000001', '{OWNER}', 'fa-owner', 'owner@example.com', 'GMAIL', '2025-01-01'),
            ('0e000000-0000-0000-0000-000000000002', '{RECREATED_OWNER}', 'fa-recreated', 'recreated@example.com', 'GMAIL', '2026-06-01');
        INSERT INTO email_threads (id, link_id) VALUES ('{THREAD}', '0e000000-0000-0000-0000-000000000001');
        INSERT INTO email_messages (id, thread_id, link_id)
        VALUES ('{MESSAGE}', '{THREAD}', '0e000000-0000-0000-0000-000000000001');

        CREATE TEMP TABLE seeded (document_id text, owner text, thread_id text, message_id text) ON COMMIT DROP;
        INSERT INTO seeded VALUES
            ('{MAILBOX_GONE}', '{GONE_OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{MAILBOX_RECREATED}', '{RECREATED_OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{THREAD_GONE}', '{OWNER}', '{MISSING_THREAD}', '{MISSING_MESSAGE}'),
            ('{MESSAGE_GONE}', '{OWNER}', '{THREAD}', '{MISSING_MESSAGE}'),
            ('{ATTACHMENT_REPLACED}', '{OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{ADOPTED}', '{GONE_OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{LINKED}', '{OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{TRASHED}', '{GONE_OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{NO_SOURCE}', '{GONE_OWNER}', NULL, NULL),
            ('{CHANNEL_SOURCE}', '{GONE_OWNER}', NULL, NULL),
            ('{TASK_SOURCE}', '{GONE_OWNER}', NULL, NULL),
            ('{SOURCE_SET_APART}', '{GONE_OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{SOURCE_EDITED}', '{GONE_OWNER}', '{THREAD}', '{MESSAGE}'),
            ('{SOURCE_ON_PLAIN_FILE}', '{GONE_OWNER}', '{THREAD}', '{MESSAGE}');

        INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        SELECT document_id, 'attachment.pdf', owner, '2026-01-01', '2026-01-01' FROM seeded;
        INSERT INTO entity (id, entity_type, owner_type, owner_id)
        SELECT document_id::uuid, 'document', 'user', owner FROM seeded;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT document_id::uuid, 'document', owner, 'user', 'owner' FROM seeded;
        INSERT INTO "DocumentInstance" ("documentId", sha) SELECT document_id, 'sha-' || document_id FROM seeded;
        UPDATE "Document" SET "projectId" = 'folder' WHERE id = '{ADOPTED}';
        UPDATE "Document" SET "deletedAt" = '2026-03-01' WHERE id = '{TRASHED}';
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES ('{LINKED}', '00000000-0000-0000-0000-0000000e0007');

        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        SELECT md5('source' || document_id)::uuid, document_id, 'DOCUMENT'::property_entity_type, '00000001-0000-0000-0000-00000000000b'::uuid,
               jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(jsonb_build_object(
                   'entity_type', 'THREAD', 'entity_id', thread_id, 'specific_message_id', message_id)))
        FROM seeded WHERE thread_id IS NOT NULL
        UNION ALL
        SELECT md5('source' || '{PURGED}')::uuid, '{PURGED}', 'DOCUMENT', '00000001-0000-0000-0000-00000000000b',
               jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(jsonb_build_object(
                   'entity_type', 'THREAD', 'entity_id', '{THREAD}', 'specific_message_id', '{MESSAGE}')))
        UNION ALL
        SELECT md5('source' || '{CHANNEL_SOURCE}')::uuid, '{CHANNEL_SOURCE}', 'DOCUMENT', '00000001-0000-0000-0000-00000000000b',
               jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(jsonb_build_object(
                   'entity_type', 'CHANNEL', 'entity_id', '0c000000-0000-0000-0000-000000000001')))
        UNION ALL
        SELECT md5('source' || '{TASK_SOURCE}')::uuid, '{TASK_SOURCE}', 'TASK', '00000001-0000-0000-0000-00000000000b',
               jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(jsonb_build_object(
                   'entity_type', 'THREAD', 'entity_id', '{THREAD}', 'specific_message_id', '{MESSAGE}')));

        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        SELECT md5(p.definition || document_id)::uuid, document_id, 'DOCUMENT', p.definition::uuid, p.value
        FROM seeded
        CROSS JOIN (VALUES
            ('00000001-0000-0000-0000-00000000000d', jsonb_build_object('type', 'EntityReference', 'value',
                jsonb_build_array(jsonb_build_object('entity_type', 'USER', 'entity_id', 'macro|sender@example.com')))),
            ('00000001-0000-0000-0000-00000000000e', jsonb_build_object('type', 'EntityReference', 'value', '[]'::jsonb)),
            ('00000001-0000-0000-0000-00000000000f', jsonb_build_object('type', 'String', 'value', 'Invoice'))
        ) p(definition, value)
        WHERE (thread_id IS NOT NULL AND document_id <> '{SOURCE_ON_PLAIN_FILE}') OR document_id = '{NO_SOURCE}';

        UPDATE entity_properties SET created_at = created_at + interval '1 day', updated_at = created_at + interval '1 day'
        WHERE entity_id IN ('{SOURCE_SET_APART}', '{SOURCE_ON_PLAIN_FILE}')
            AND property_definition_id = '00000001-0000-0000-0000-00000000000b';
        UPDATE entity_properties SET updated_at = created_at + interval '1 day'
        WHERE entity_id = '{SOURCE_EDITED}' AND property_definition_id = '00000001-0000-0000-0000-00000000000b';

        COMMIT;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

async fn queued(pool: &Pool<Postgres>) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT document_id FROM released_email_attachment_documents ORDER BY document_id",
    )
    .fetch_all(pool)
    .await?)
}

async fn in_trash(pool: &Pool<Postgres>) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM "Document" WHERE "deletedAt" IS NOT NULL ORDER BY id"#,
    )
    .fetch_all(pool)
    .await?)
}

#[derive(Default)]
struct Memory(Mutex<Vec<ScanProgress>>);

impl ScanProgressStore for Memory {
    type Err = std::convert::Infallible;

    async fn save(&self, progress: &ScanProgress) -> Result<(), Self::Err> {
        self.0.lock().expect("saved lock").push(progress.clone());
        Ok(())
    }
}

fn options(page_size: u32) -> ScanOptions {
    ScanOptions {
        page_size: NonZeroU32::new(page_size).expect("page size"),
        per_second: NonZeroU32::MAX,
        max_queue_depth: 10_000,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_walk_finds_each_live_unlinked_document_with_a_thread_source_and_why(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let repo = PgReleasedAttachmentRepo::new(pool.clone());

    let mut found = Vec::new();
    let mut after = String::new();
    let mut pages = 0;
    loop {
        let page = repo
            .orphan_page(&after, NonZeroU32::new(2).expect("2"))
            .await?;
        pages += 1;
        found.extend(page.orphans.iter().map(|orphan| {
            (
                orphan.document_id.clone(),
                orphan.cause(),
                orphan.source_from_import,
            )
        }));
        match page.last_entity_id {
            Some(last) => after = last,
            None => break,
        }
    }

    assert_eq!(
        found,
        vec![
            (MAILBOX_GONE.to_string(), OrphanCause::MailboxGone, true),
            (
                MAILBOX_RECREATED.to_string(),
                OrphanCause::MailboxRecreated,
                true
            ),
            (THREAD_GONE.to_string(), OrphanCause::ThreadGone, true),
            (MESSAGE_GONE.to_string(), OrphanCause::MessageGone, true),
            (
                ATTACHMENT_REPLACED.to_string(),
                OrphanCause::AttachmentReplaced,
                true
            ),
            (ADOPTED.to_string(), OrphanCause::MailboxGone, true),
            (
                SOURCE_SET_APART.to_string(),
                OrphanCause::MailboxGone,
                false
            ),
            (SOURCE_EDITED.to_string(), OrphanCause::MailboxGone, false),
            (
                SOURCE_ON_PLAIN_FILE.to_string(),
                OrphanCause::MailboxGone,
                false
            ),
        ]
    );
    // Fifteen entities, each checked whole on the page its first row lands
    // on, two rows a page (single-row ones share), then the empty page that
    // ends the walk.
    assert_eq!(pages, 14);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_page_checks_every_entity_in_its_window_whole(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let repo = PgReleasedAttachmentRepo::new(pool.clone());

    // One row is one of MAILBOX_GONE's three, Source or not; the entity is
    // checked whole and the next page starts after it.
    let first = repo.orphan_page("", NonZeroU32::new(1).expect("1")).await?;
    let second = repo
        .orphan_page(MAILBOX_GONE, NonZeroU32::new(1).expect("1"))
        .await?;

    assert_eq!(first.last_entity_id.as_deref(), Some(MAILBOX_GONE));
    assert_eq!(
        first
            .orphans
            .iter()
            .map(|orphan| orphan.document_id.as_str())
            .collect::<Vec<_>>(),
        vec![MAILBOX_GONE]
    );
    assert_eq!(second.last_entity_id.as_deref(), Some(MAILBOX_RECREATED));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_drain_preview_applies_its_adoption_checks_and_writes_nothing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let repo = PgReleasedAttachmentRepo::new(pool.clone());

    let mut preview = repo
        .preview_drain(&[
            MAILBOX_GONE.to_string(),
            ADOPTED.to_string(),
            TRASHED.to_string(),
            LINKED.to_string(),
            PURGED.to_string(),
        ])
        .await?;
    preview.kept.sort();

    assert_eq!(
        preview,
        ReleasedBatch {
            claimed: 5,
            trashed: vec![MAILBOX_GONE.to_string()],
            kept: vec![ADOPTED.to_string(), TRASHED.to_string()],
            adopted: 1,
            relinked: 1,
            missing: 1,
        }
    );
    assert_eq!(in_trash(&pool).await?, vec![TRASHED.to_string()]);
    assert!(queued(&pool).await?.is_empty());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enqueue_queues_each_document_once_and_notify_wakes_the_drain(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgReleasedAttachmentRepo::new(pool.clone());
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool).await?;
    listener
        .listen("email_attachment_documents_released")
        .await?;

    let first = repo
        .enqueue(&[MAILBOX_GONE.to_string(), THREAD_GONE.to_string()])
        .await?;
    let second = repo
        .enqueue(&[THREAD_GONE.to_string(), MESSAGE_GONE.to_string()])
        .await?;
    repo.notify_drain().await?;
    let notification = listener.recv().await?;

    assert_eq!((first, second), (2, 1));
    assert_eq!(
        queued(&pool).await?,
        vec![
            MAILBOX_GONE.to_string(),
            THREAD_GONE.to_string(),
            MESSAGE_GONE.to_string()
        ]
    );
    assert_eq!(
        notification.channel(),
        "email_attachment_documents_released"
    );
    assert_eq!(repo.queue_depth().await?, 3);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_dry_run_counts_the_orphans_and_writes_nothing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let scan = OrphanedAttachmentScan::new(
        PgReleasedAttachmentRepo::new(pool.clone()),
        Memory::default(),
    );

    let done = scan
        .run(options(4), ScanProgress::start(false, None))
        .await?;

    assert!(done.finished);
    assert_eq!(
        done.counts,
        ScanCounts {
            orphans: 6,
            source_not_from_import: 3,
            mailbox_gone: 2,
            mailbox_recreated: 1,
            thread_gone: 1,
            message_gone: 1,
            attachment_replaced: 1,
            would_trash: 5,
            would_keep_adopted: 1,
            ..ScanCounts::default()
        }
    );
    assert!(queued(&pool).await?.is_empty());
    assert_eq!(in_trash(&pool).await?, vec![TRASHED.to_string()]);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_applied_scan_queues_every_orphan_and_the_drain_settles_them(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let repo = PgReleasedAttachmentRepo::new(pool.clone());
    let scan = OrphanedAttachmentScan::new(repo.clone(), Memory::default());

    let done = scan
        .run(options(4), ScanProgress::start(true, None))
        .await?;
    let queued_orphans = queued(&pool).await?;
    let mut batch = repo.trash_released_batch(500).await?;
    batch.trashed.sort();

    assert_eq!(done.counts.orphans, 6);
    assert_eq!(done.counts.source_not_from_import, 3);
    assert_eq!(done.counts.enqueued, 6);
    assert_eq!(queued_orphans, ORPHANS.map(String::from).to_vec());
    assert_eq!(
        batch.trashed,
        [
            MAILBOX_GONE,
            MAILBOX_RECREATED,
            THREAD_GONE,
            MESSAGE_GONE,
            ATTACHMENT_REPLACED
        ]
        .map(String::from)
        .to_vec()
    );
    assert_eq!(batch.kept, vec![ADOPTED.to_string()]);
    assert_eq!(batch.adopted, 1);

    // Once the drain has run, a rerun finds only the adopted document, which
    // the drain keeps again.
    let rerun = OrphanedAttachmentScan::new(repo, Memory::default())
        .run(options(4), ScanProgress::start(true, None))
        .await?;
    assert_eq!(rerun.counts.orphans, 1);
    assert_eq!(rerun.counts.enqueued, 1);

    Ok(())
}
