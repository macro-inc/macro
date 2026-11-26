use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const OWNER: &str = "macro|owner@example.com";

// Queued documents, one per outcome.
const PLAIN: &str = "0d000000-0000-0000-0000-000000000001";
const IN_FOLDER: &str = "0d000000-0000-0000-0000-000000000002";
const SHARED_WITH_TEAM: &str = "0d000000-0000-0000-0000-000000000003";
const SHARING_CHANGED: &str = "0d000000-0000-0000-0000-000000000004";
const SAVED_CONTENT: &str = "0d000000-0000-0000-0000-000000000005";
const HIGHLIGHTED: &str = "0d000000-0000-0000-0000-000000000006";
const COMMENTED: &str = "0d000000-0000-0000-0000-000000000007";
const RELINKED: &str = "0d000000-0000-0000-0000-000000000008";
const ALREADY_TRASHED: &str = "0d000000-0000-0000-0000-000000000009";
const PURGED: &str = "0d000000-0000-0000-0000-000000000010";
const OPENED: &str = "0d000000-0000-0000-0000-000000000011";
const OPENED_WITH_ITS_ANNOTATION: &str = "0d000000-0000-0000-0000-000000000012";
const TEXT_BOX_ADDED: &str = "0d000000-0000-0000-0000-000000000013";
const ANNOTATION_REMOVED: &str = "0d000000-0000-0000-0000-000000000014";
const RENAMED: &str = "0d000000-0000-0000-0000-000000000015";

/// What the PDF viewer saves the first time someone who can edit opens a PDF
/// with no annotations of its own.
const VIEWER_SAVE: &str =
    r#"{"highlights":null,"bookmarks":[],"placeables":[],"pinnedTermsNames":[]}"#;
/// The same save for a PDF with one annotation of its own, which the viewer
/// loads as a placeable.
const VIEWER_SAVE_WITH_ITS_ANNOTATION: &str = r#"{"highlights":null,"bookmarks":[],"placeables":[{"originalIndex":0,"wasEdited":false}],"pinnedTermsNames":[]}"#;
/// A save after the user placed a text box.
const TEXT_BOX_SAVE: &str = r#"{"highlights":null,"bookmarks":[],"placeables":[{"originalIndex":-1,"wasEdited":true}],"pinnedTermsNames":[]}"#;

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
            ('{SAVED_CONTENT}', 5), ('{HIGHLIGHTED}', 6), ('{COMMENTED}', 7), ('{RELINKED}', 8),
            ('{ALREADY_TRASHED}', 9), ('{OPENED}', 11), ('{OPENED_WITH_ITS_ANNOTATION}', 12),
            ('{TEXT_BOX_ADDED}', 13), ('{ANNOTATION_REMOVED}', 14), ('{RENAMED}', 15);

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
        INSERT INTO "DocumentInstance" ("documentId", sha) VALUES ('{SAVED_CONTENT}', 'sha5-edited');
        CREATE TEMP TABLE viewer_saves (document_id text, n int, modification_data jsonb) ON COMMIT DROP;
        INSERT INTO viewer_saves VALUES
            ('{OPENED}', 1, '{VIEWER_SAVE}'),
            ('{OPENED}', 2, '{VIEWER_SAVE}'),
            ('{OPENED_WITH_ITS_ANNOTATION}', 1, '{VIEWER_SAVE_WITH_ITS_ANNOTATION}'),
            ('{OPENED_WITH_ITS_ANNOTATION}', 2, '{VIEWER_SAVE_WITH_ITS_ANNOTATION}'),
            ('{TEXT_BOX_ADDED}', 1, '{VIEWER_SAVE}'),
            ('{TEXT_BOX_ADDED}', 2, '{TEXT_BOX_SAVE}'),
            ('{ANNOTATION_REMOVED}', 1, '{VIEWER_SAVE_WITH_ITS_ANNOTATION}'),
            ('{ANNOTATION_REMOVED}', 2, '{VIEWER_SAVE}');
        INSERT INTO "DocumentInstance" ("documentId", sha)
        SELECT document_id, 'viewer-save-' || n FROM viewer_saves;
        INSERT INTO "DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
        SELECT i.id, s.modification_data
        FROM viewer_saves s
        JOIN "DocumentInstance" i ON i."documentId" = s.document_id AND i.sha = 'viewer-save-' || s.n;
        UPDATE "Document" SET name = 'renamed by its owner' WHERE id = '{RENAMED}';
        INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
        VALUES ('00000000-0000-0000-0000-0000000ac015', '{OWNER}', '{OWNER}', 'edited', 'document', '{RENAMED}', now());
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
    batch.trashed.sort();
    batch.kept.sort();

    // Opening a PDF in the viewer is not adopting it, whatever the viewer
    // saved. The document already in the Trash is kept as it is; only the
    // purged one is missing.
    assert_eq!(
        batch,
        ReleasedBatch {
            claimed: 15,
            trashed: [PLAIN, OPENED, OPENED_WITH_ITS_ANNOTATION]
                .map(String::from)
                .to_vec(),
            kept: [
                IN_FOLDER,
                SHARED_WITH_TEAM,
                SHARING_CHANGED,
                SAVED_CONTENT,
                HIGHLIGHTED,
                COMMENTED,
                ALREADY_TRASHED,
                TEXT_BOX_ADDED,
                ANNOTATION_REMOVED,
                RENAMED,
            ]
            .map(String::from)
            .to_vec(),
            adopted: 9,
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
    assert_eq!(
        trashed(&pool).await?,
        [PLAIN, OPENED, OPENED_WITH_ITS_ANNOTATION]
            .map(String::from)
            .to_vec()
    );
    for document in [PLAIN, OPENED, OPENED_WITH_ITS_ANNOTATION] {
        assert_eq!(
            trash_marks(&pool, document).await?,
            (true, 0, 0),
            "{document}"
        );
    }
    for kept in [
        IN_FOLDER,
        SHARED_WITH_TEAM,
        SHARING_CHANGED,
        SAVED_CONTENT,
        HIGHLIGHTED,
        COMMENTED,
        RELINKED,
        TEXT_BOX_ADDED,
        ANNOTATION_REMOVED,
        RENAMED,
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
    assert_eq!(repo.queue().await?.depth, 13);

    Ok(())
}
