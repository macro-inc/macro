//! Backfill entity access records.

mod config;

use anyhow::Context;
use config::EnvVars;
use macro_entrypoint::MacroEntrypoint;
use macro_uuid::Uuid;
use sqlx::postgres::PgPoolOptions;
use sqlx::{Pool, Postgres};

/// Rows of `UserItemAccess` consumed per SQL statement for the 1:1 phases
/// (owned items, channel/team shares on non-project items). Each batch is a
/// single `INSERT ... SELECT` in its own autocommit transaction, so lock
/// windows and WAL size stay bounded.
const BATCH_SIZE: i64 = 5_000;

/// Smaller batch for the project phase, because each `UserItemAccess` row
/// fans out to every descendant of the shared project tree.
const PROJECT_BATCH_SIZE: i64 = 500;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let command = std::env::args()
        .nth(1)
        .context("usage: backfill_entity_access <backfill|verify>")?;

    let env_vars = EnvVars::new()?;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(4)
        .connect(&env_vars.database_url)
        .await
        .context("could not connect to db")?;

    match command.as_str() {
        "backfill" => {
            println!("Starting backfill...");

            backfill_non_project_channels_and_teams(&db).await?;
            backfill_owned_items(&db).await?;
            backfill_project_items(&db).await?;

            println!("All backfill phases COMPLETED");
        }
        "verify" => {
            let _user_access_items =
                get_legacy_user_items(&db, &env_vars.macro_user_id, false).await?;

            let _entity_access_items =
                get_entity_access_items(&db, &env_vars.macro_user_id, false).await?;
        }
        other => anyhow::bail!(
            "unknown command: {other}. usage: backfill_entity_access <backfill|verify>"
        ),
    }

    Ok(())
}

/// Drives a keyset-paginated loop. `sql` must bind `$1 = cursor uuid` and
/// `$2 = batch_size bigint`, and must return exactly one row
/// `(Option<Uuid>, i64)` — the maximum `UserItemAccess.id` processed in this
/// batch (NULL when empty = termination), and the number of source rows
/// considered in the batch.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn run_keyset(
    db: &Pool<Postgres>,
    label: &str,
    sql: &str,
    batch_size: i64,
) -> anyhow::Result<()> {
    let start = std::time::Instant::now();
    let mut cursor: Uuid = Uuid::nil();
    let mut batches: u64 = 0;
    let mut total_rows: i64 = 0;
    loop {
        let (next_cursor, batch_rows): (Option<Uuid>, i64) = sqlx::query_as(sql)
            .bind(cursor)
            .bind(batch_size)
            .fetch_one(db)
            .await
            .with_context(|| format!("[{label}] batch {batches} failed at cursor={cursor}"))?;

        match next_cursor {
            Some(max_id) => {
                batches += 1;
                total_rows += batch_rows;
                cursor = max_id;
                if batches.is_multiple_of(50) {
                    println!(
                        "[{label}] {batches} batches, {total_rows} rows, cursor={cursor}, elapsed={:?}",
                        start.elapsed()
                    );
                }
            }
            None => {
                println!(
                    "[{label}] DONE: {batches} batches, {total_rows} source rows in {:?}",
                    start.elapsed()
                );
                return Ok(());
            }
        }
    }
}

/// Phase 1: user-owned items — direct grants with `source_type = 'user'`
/// and `granted_from_project_id IS NULL`.
async fn backfill_owned_items(db: &Pool<Postgres>) -> anyhow::Result<()> {
    println!("[owned_items] STARTING");
    run_keyset(
        db,
        "owned_items",
        r#"
        WITH batch AS (
            SELECT uia.id, uia.item_id, uia.item_type, uia.user_id, uia.access_level
            FROM "UserItemAccess" uia
            WHERE uia.id > $1
              AND uia.granted_from_channel_id IS NULL
              AND uia.granted_from_team_id IS NULL
            ORDER BY uia.id
            LIMIT $2
        ),
        ins AS (
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            SELECT DISTINCT ON (entity_id, entity_type, source_id, source_type)
                b.item_id::uuid AS entity_id,
                CASE WHEN b.item_type = 'thread' THEN 'email_thread' ELSE b.item_type END AS entity_type,
                b.user_id AS source_id,
                'user'::entity_access_source_type AS source_type,
                b.access_level
            FROM batch b
            ORDER BY entity_id, entity_type, source_id, source_type, b.access_level DESC
            ON CONFLICT (entity_id, entity_type, source_id, source_type)
              WHERE granted_from_project_id IS NULL
              DO NOTHING
            RETURNING 1
        )
        SELECT
            (SELECT id FROM batch ORDER BY id DESC LIMIT 1),
            (SELECT COUNT(*)::bigint FROM batch)
        "#,
        BATCH_SIZE,
    )
    .await?;
    println!("[owned_items] COMPLETED");
    Ok(())
}

/// Phase 2: non-project items shared via a channel or a team — direct grants
/// with `source_type = 'channel'` or `'team'` and
/// `granted_from_project_id IS NULL`.
async fn backfill_non_project_channels_and_teams(db: &Pool<Postgres>) -> anyhow::Result<()> {
    println!("[channels_and_teams] STARTING");

    run_keyset(
        db,
        "channels_and_teams:channels",
        r#"
        WITH batch AS (
            SELECT uia.id, uia.item_id, uia.item_type, uia.granted_from_channel_id, uia.access_level
            FROM "UserItemAccess" uia
            WHERE uia.id > $1
              AND uia.item_type <> 'project'
              AND uia.granted_from_channel_id IS NOT NULL
            ORDER BY uia.id
            LIMIT $2
        ),
        ins AS (
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            SELECT DISTINCT ON (entity_id, entity_type, source_id, source_type)
                b.item_id::uuid AS entity_id,
                CASE WHEN b.item_type = 'thread' THEN 'email_thread' ELSE b.item_type END AS entity_type,
                b.granted_from_channel_id::text AS source_id,
                'channel'::entity_access_source_type AS source_type,
                b.access_level
            FROM batch b
            ORDER BY entity_id, entity_type, source_id, source_type, b.access_level DESC
            ON CONFLICT (entity_id, entity_type, source_id, source_type)
              WHERE granted_from_project_id IS NULL
              DO NOTHING
            RETURNING 1
        )
        SELECT
            (SELECT id FROM batch ORDER BY id DESC LIMIT 1),
            (SELECT COUNT(*)::bigint FROM batch)
        "#,
        BATCH_SIZE,
    )
    .await?;

    run_keyset(
        db,
        "channels_and_teams:teams",
        r#"
        WITH batch AS (
            SELECT uia.id, uia.item_id, uia.item_type, uia.granted_from_team_id, uia.access_level
            FROM "UserItemAccess" uia
            WHERE uia.id > $1
              AND uia.item_type <> 'project'
              AND uia.granted_from_team_id IS NOT NULL
            ORDER BY uia.id
            LIMIT $2
        ),
        ins AS (
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            SELECT DISTINCT ON (entity_id, entity_type, source_id, source_type)
                b.item_id::uuid AS entity_id,
                CASE WHEN b.item_type = 'thread' THEN 'email_thread' ELSE b.item_type END AS entity_type,
                b.granted_from_team_id::text AS source_id,
                'team'::entity_access_source_type AS source_type,
                b.access_level
            FROM batch b
            ORDER BY entity_id, entity_type, source_id, source_type, b.access_level DESC
            ON CONFLICT (entity_id, entity_type, source_id, source_type)
              WHERE granted_from_project_id IS NULL
              DO NOTHING
            RETURNING 1
        )
        SELECT
            (SELECT id FROM batch ORDER BY id DESC LIMIT 1),
            (SELECT COUNT(*)::bigint FROM batch)
        "#,
        BATCH_SIZE,
    )
    .await?;

    println!("[channels_and_teams] COMPLETED");
    Ok(())
}

/// Phase 3: project shares — direct grant on the shared project itself, plus
/// inherited grants on every descendant (child projects, docs, chats, email
/// threads) keyed to the shared project via `granted_from_project_id`.
/// Mirrors `entity_access_db_utils::update_entity_access_channel_share_permissions`.
///
/// Team-shared projects are intentionally skipped: the product does not
/// support sharing a project directly with a team.
///
/// Both direct and inherited inserts happen in one statement per batch via
/// two data-modifying CTEs; they target different partial unique indexes, so
/// they do not compete for locks.
async fn backfill_project_items(db: &Pool<Postgres>) -> anyhow::Result<()> {
    println!("[project_items] STARTING");
    run_keyset(
        db,
        "project_items",
        r#"
        WITH RECURSIVE batch AS (
            SELECT uia.id, uia.item_id, uia.granted_from_channel_id, uia.access_level
            FROM "UserItemAccess" uia
            WHERE uia.id > $1
              AND uia.item_type = 'project'
              AND uia.granted_from_team_id IS NULL
            ORDER BY uia.id
            LIMIT $2
        ),
        share_sources AS (
            SELECT DISTINCT ON (project_id, source_id, source_type)
                b.item_id AS project_id,
                COALESCE(b.granted_from_channel_id::text, p."userId") AS source_id,
                CASE WHEN b.granted_from_channel_id IS NOT NULL
                     THEN 'channel' ELSE 'user' END::entity_access_source_type AS source_type,
                b.access_level
            FROM batch b
            JOIN "Project" p ON p.id = b.item_id
            ORDER BY project_id, source_id, source_type, b.access_level DESC
        ),
        direct_ins AS (
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            SELECT DISTINCT ON (entity_id, source_id, source_type)
                ss.project_id::uuid AS entity_id,
                'project' AS entity_type,
                ss.source_id,
                ss.source_type,
                ss.access_level
            FROM share_sources ss
            ORDER BY entity_id, source_id, source_type, ss.access_level DESC
            ON CONFLICT (entity_id, entity_type, source_id, source_type)
              WHERE granted_from_project_id IS NULL
              DO NOTHING
            RETURNING 1
        ),
        descendant_projects AS (
            SELECT ss.project_id AS root_project_id, ss.project_id AS id
            FROM share_sources ss
            UNION ALL
            SELECT dp.root_project_id, p.id
            FROM "Project" p
            JOIN descendant_projects dp ON p."parentId" = dp.id
        ),
        descendants AS (
            SELECT dp.root_project_id, dp.id::uuid AS entity_id, 'project' AS entity_type
            FROM descendant_projects dp
            WHERE dp.id <> dp.root_project_id

            UNION ALL
            SELECT dp.root_project_id, d.id::uuid, 'document'
            FROM "Document" d
            JOIN descendant_projects dp ON d."projectId" = dp.id

            UNION ALL
            SELECT dp.root_project_id, c.id::uuid, 'chat'
            FROM "Chat" c
            JOIN descendant_projects dp ON c."projectId" = dp.id

            UNION ALL
            SELECT dp.root_project_id, et.id::uuid, 'email_thread'
            FROM email_threads et
            JOIN descendant_projects dp ON et.project_id = dp.id
        ),
        inherited_ins AS (
            INSERT INTO entity_access
                (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
            SELECT DISTINCT ON (entity_id, entity_type, source_id, source_type, granted_from_project_id)
                d.entity_id,
                d.entity_type,
                ss.source_id,
                ss.source_type,
                ss.access_level,
                d.root_project_id AS granted_from_project_id
            FROM descendants d
            JOIN share_sources ss ON ss.project_id = d.root_project_id
            ORDER BY entity_id, entity_type, source_id, source_type, granted_from_project_id, ss.access_level DESC
            ON CONFLICT (entity_id, entity_type, source_id, source_type, granted_from_project_id)
              WHERE granted_from_project_id IS NOT NULL
              DO NOTHING
            RETURNING 1
        )
        SELECT
            (SELECT id FROM batch ORDER BY id DESC LIMIT 1),
            (SELECT COUNT(*)::bigint FROM batch)
        "#,
        PROJECT_BATCH_SIZE,
    )
    .await?;
    println!("[project_items] COMPLETED");
    Ok(())
}

/// Copied from `get_user_accessible_items` in macro_db_client crate
pub async fn get_legacy_user_items(
    db: &Pool<Postgres>,
    user_id: &str,
    _exclude_owned: bool,
) -> anyhow::Result<Vec<(String, String)>> {
    let start = std::time::Instant::now();
    let results = sqlx::query!(
        r#"
        WITH RECURSIVE ProjectHierarchy AS (
            -- Find direct user access to projects first as starting point
            SELECT
                p.id,
                uia.access_level
            FROM "Project" p
            JOIN "UserItemAccess" uia ON p.id = uia.item_id AND uia.item_type = 'project'
            WHERE uia.user_id = $1 AND p."deletedAt" IS NULL

            UNION ALL

            -- Then walk down the project tree and grab child projects, keeping parent's access
            SELECT
                p.id,
                ph.access_level
            FROM "Project" p
            JOIN ProjectHierarchy ph ON p."parentId" = ph.id
            WHERE p."deletedAt" IS NULL
        ),
        -- Now build up all the ways a user can have access to stuff
        AllAccessGrants AS (
            -- Explicit access to items via UserItemAccess table
            SELECT uia.item_id, uia.item_type, uia.access_level
            FROM "UserItemAccess" uia
            -- We join to each table to check its "deletedAt" status.
            -- This is more explicit and robust than using subqueries.
            LEFT JOIN "Document" d ON uia.item_type = 'document' AND uia.item_id = d.id
            LEFT JOIN "Chat" c ON uia.item_type = 'chat' AND uia.item_id = c.id
            LEFT JOIN "Project" p ON uia.item_type = 'project' AND uia.item_id = p.id
            WHERE uia.user_id = $1
              -- Rule: The item must not be deleted.
              AND (
                  (uia.item_type = 'document' AND d."deletedAt" IS NULL) OR
                  (uia.item_type = 'chat' AND c."deletedAt" IS NULL) OR
                  (uia.item_type = 'project' AND p."deletedAt" IS NULL)
              )

            -- The rest of the unions are to get implicit access to items via project access
            UNION ALL

            -- Access to docs in visible projects
            SELECT
                d.id AS item_id,
                'document' AS item_type,
                ph.access_level
            FROM "Document" d
            JOIN ProjectHierarchy ph ON d."projectId" = ph.id
            WHERE d."projectId" IS NOT NULL AND d."deletedAt" IS NULL

            UNION ALL

            -- Access to chats in visible projects
            SELECT
                c.id AS item_id,
                'chat' AS item_type,
                ph.access_level
            FROM "Chat" c
            JOIN ProjectHierarchy ph ON c."projectId" = ph.id
            WHERE c."projectId" IS NOT NULL AND c."deletedAt" IS NULL

            UNION ALL

            -- Include the projects we found earlier
            SELECT
                ph.id AS item_id,
                'project' AS item_type,
                ph.access_level
            FROM ProjectHierarchy ph
        ),
        UserAccessibleItems AS (
            SELECT
                item_id,
                item_type
            FROM AllAccessGrants
            GROUP BY item_id, item_type
        )
        SELECT item_id as "item_id!", item_type as "item_type!" FROM UserAccessibleItems
        "#,
        user_id,
    )
    .map(|r| (r.item_id, r.item_type))
    .fetch_all(db)
    .await?;

    let elapsed = start.elapsed();
    println!(
        "[get_legacy_user_items] user={user_id} returned {} items in {elapsed:.2?}",
        results.len()
    );

    Ok(results)
}

pub async fn get_entity_access_items(
    db: &Pool<Postgres>,
    user_id: &str,
    _exclude_owned: bool,
) -> anyhow::Result<Vec<(macro_uuid::Uuid, String)>> {
    let start = std::time::Instant::now();
    // Fetch source IDs first
    let source_ids = sqlx::query_scalar!(
        r#"
    SELECT cp.channel_id::text FROM comms_channel_participants cp
    WHERE cp.user_id = $1 AND cp.left_at IS NULL
    UNION ALL
    SELECT t.team_id::text FROM team_user t
    WHERE t.user_id = $1
    UNION ALL
    SELECT $1
    "#,
        user_id
    )
    .fetch_all(db)
    .await?;

    let source_ids: Vec<String> = source_ids.into_iter().flatten().collect();

    // Then use ANY($2) which plays nicely with the source_id index
    let results = sqlx::query!(
        r#"
    SELECT DISTINCT
        ea.entity_id,
        ea.entity_type
    FROM entity_access ea
    WHERE ea.source_id = ANY($1)
    "#,
        &source_ids,
    )
    .map(|r| (r.entity_id, r.entity_type))
    .fetch_all(db)
    .await?;

    let elapsed = start.elapsed();
    println!(
        "[get_entity_access_items] user={user_id} returned {} items in {elapsed:.2?}",
        results.len()
    );

    Ok(results)
}
