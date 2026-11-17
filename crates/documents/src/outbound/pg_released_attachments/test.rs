use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const OWNER: &str = "macro|owner@example.com";

// Queued documents, one per outcome.
const PLAIN: &str = "0d000000-0000-0000-0000-000000000001";
const IN_FOLDER: &str = "0d000000-0000-0000-0000-000000000002";
const SHARED_WITH_TEAM: &str = "0d000000-0000-0000-0000-000000000003";
const SHARING_CHANGED: &str = "0d000000-0000-0000-0000-000000000004";
const NEW_VERSION: &str = "0d000000-0000-0000-0000-000000000005";
const HIGHLIGHTED: &str = "0d000000-0000-0000-0000-000000000006";
const COMMENTED: &str = "0d000000-0000-0000-0000-000000000007";
const RELINKED: &str = "0d000000-0000-0000-0000-000000000008";
const ALREADY_TRASHED: &str = "0d000000-0000-0000-0000-000000000009";
const PURGED: &str = "0d000000-0000-0000-0000-000000000010";

/// Every document except PURGED is an import the owner holds with its owner
/// grant, one version, a pin and view history; the others add what their name
/// says. All of them are queued, oldest first in id order.
async fn seed(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';

        CREATE TEMP TABLE seeded (document_id text, n int) ON COMMIT DROP;
        INSERT INTO seeded VALUES
            ('{PLAIN}', 1), ('{IN_FOLDER}', 2), ('{SHARED_WITH_TEAM}', 3), ('{SHARING_CHANGED}', 4),
            ('{NEW_VERSION}', 5), ('{HIGHLIGHTED}', 6), ('{COMMENTED}', 7), ('{RELINKED}', 8),
            ('{ALREADY_TRASHED}', 9);

        INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        SELECT document_id, 'attachment ' || n || '.pdf', '{OWNER}', '2026-01-01', '2026-01-01' FROM seeded;
        INSERT INTO entity (id, entity_type, owner_type, owner_id)
        SELECT document_id::uuid, 'document', 'user', '{OWNER}' FROM seeded;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT document_id::uuid, 'document', '{OWNER}', 'user', 'owner' FROM seeded;
        INSERT INTO "DocumentInstance" ("documentId", sha) SELECT document_id, 'sha' || n FROM seeded;
        INSERT INTO "SharePermission" (id, "createdAt", "updatedAt")
        SELECT 'share-' || n, '2026-01-01', '2026-01-01' FROM seeded;
        INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
        SELECT document_id, 'share-' || n FROM seeded;
        INSERT INTO "Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex")
        SELECT '{OWNER}', document_id, 'document', n FROM seeded;
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType")
        SELECT '{OWNER}', document_id, 'document' FROM seeded;

        UPDATE "Document" SET "projectId" = 'folder' WHERE id = '{IN_FOLDER}';
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('{SHARED_WITH_TEAM}', 'document', '7ea30000-0000-0000-0000-000000000001', 'team', 'view');
        UPDATE "SharePermission" SET "linkShare" = 'PUBLIC', "linkShareAccessLevel" = 'view', "updatedAt" = '2026-02-01'
        WHERE id = 'share-4';
        INSERT INTO "DocumentInstance" ("documentId", sha) VALUES ('{NEW_VERSION}', 'sha5-edited');
        INSERT INTO "PdfHighlightAnchor" (
            "documentId", owner, page, red, green, blue, alpha, type, text, "pageViewportWidth", "pageViewportHeight"
        ) VALUES ('{HIGHLIGHTED}', '{OWNER}', 1, 255, 255, 0, 1, 1, 'note', 600, 800);
        INSERT INTO comms_message_threads (root_id, parent_entity_type, parent_entity_id, user_id, created_at, updated_at)
        VALUES ('00000000-0000-0000-0000-00000000d001', 'document', '{COMMENTED}', '{OWNER}', now(), now());
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES ('{RELINKED}', '00000000-0000-0000-0000-0000000e0008');
        UPDATE "Document" SET "deletedAt" = '2026-03-01' WHERE id = '{ALREADY_TRASHED}';

        INSERT INTO released_email_attachment_documents (document_id, released_at)
        SELECT document_id, timestamp '2026-04-01' + n * interval '1 second' FROM seeded
        UNION ALL SELECT '{PURGED}', timestamp '2026-04-01' + interval '10 seconds';

        COMMIT;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

async fn trashed(pool: &Pool<Postgres>) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM "Document" WHERE "deletedAt" > '2026-03-01' ORDER BY id"#,
    )
    .fetch_all(pool)
    .await?)
}

/// The registry mark, pins and view history a document's trash removes.
async fn trash_marks(pool: &Pool<Postgres>, document_id: &str) -> anyhow::Result<(bool, i64, i64)> {
    Ok(sqlx::query_as::<_, (bool, i64, i64)>(
        r#"
        SELECT
            (SELECT deleted_at IS NOT NULL FROM entity WHERE id = $1::uuid),
            (SELECT COUNT(*) FROM "Pin" WHERE "pinnedItemId" = $1),
            (SELECT COUNT(*) FROM "UserHistory" WHERE "itemId" = $1)
        "#,
    )
    .bind(document_id)
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_batch_trashes_only_unlinked_unadopted_live_documents(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let repo = PgReleasedAttachmentRepo::new(pool.clone());

    let mut batch = repo.trash_released_batch(100).await?;
    batch.kept.sort();

    // The document already in the Trash is kept as it is; only the purged one
    // is missing.
    assert_eq!(
        batch,
        ReleasedBatch {
            claimed: 10,
            trashed: vec![PLAIN.to_string()],
            kept: [
                IN_FOLDER,
                SHARED_WITH_TEAM,
                SHARING_CHANGED,
                NEW_VERSION,
                HIGHLIGHTED,
                COMMENTED,
                ALREADY_TRASHED,
            ]
            .map(String::from)
            .to_vec(),
            adopted: 6,
            relinked: 1,
            missing: 1,
        }
    );
    let still_trashed_at: bool =
        sqlx::query_scalar(r#"SELECT "deletedAt" = '2026-03-01' FROM "Document" WHERE id = $1"#)
            .bind(ALREADY_TRASHED)
            .fetch_one(&pool)
            .await?;
    assert!(still_trashed_at);
    assert_eq!(trashed(&pool).await?, vec![PLAIN.to_string()]);
    assert_eq!(trash_marks(&pool, PLAIN).await?, (true, 0, 0));
    for kept in [
        IN_FOLDER,
        SHARED_WITH_TEAM,
        SHARING_CHANGED,
        NEW_VERSION,
        HIGHLIGHTED,
        COMMENTED,
        RELINKED,
    ] {
        assert_eq!(trash_marks(&pool, kept).await?, (false, 1, 1), "{kept}");
    }
    assert_eq!(repo.queue().await?, ReleaseQueue::default());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_batch_claims_the_oldest_rows_up_to_its_limit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;
    let repo = PgReleasedAttachmentRepo::new(pool.clone());

    let batch = repo.trash_released_batch(2).await?;

    assert_eq!(batch.claimed, 2);
    assert_eq!(batch.trashed, vec![PLAIN.to_string()]);
    assert_eq!(batch.kept, vec![IN_FOLDER.to_string()]);
    assert_eq!(batch.adopted, 1);
    assert_eq!(repo.queue().await?.depth, 8);

    Ok(())
}
