//! Backfill entity access records.

mod config;

use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Context;
use config::EnvVars;
use futures::stream::{self, StreamExt};
use macro_entrypoint::MacroEntrypoint;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::QueryBuilder;
use sqlx::postgres::PgPoolOptions;
use sqlx::{Pool, Postgres};

/// Max rows per INSERT statement to stay well within Postgres bind parameter limits.
const WRITE_BATCH_SIZE: usize = 1000;

/// Max concurrent write tasks.
const WRITE_CONCURRENCY: usize = 10;

#[derive(Debug, Clone, Copy, sqlx::Type)]
#[sqlx(type_name = "\"entity_access_source_type\"", rename_all = "lowercase")]
/// Ordered from least to most access top -> bottom
pub enum SourceEntityType {
    Channel,
    Team,
    User,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let command = std::env::args()
        .nth(1)
        .context("usage: backfill_entity_access <backfill|verify>")?;

    let env_vars = EnvVars::new()?;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(50)
        .connect(&env_vars.database_url)
        .await
        .context("could not connect to db")?;

    match command.as_str() {
        "backfill" => {
            println!("Starting backfill...");

            backfill_non_projects_channels_and_teams(&db).await?;
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

/// Inserts rows into `entity_access` in chunks, running up to [`WRITE_CONCURRENCY`] inserts concurrently.
async fn bulk_upsert(
    db: &Pool<Postgres>,
    label: &str,
    inserts: Vec<(
        macro_uuid::Uuid,
        String,
        String,
        SourceEntityType,
        AccessLevel,
    )>,
) -> anyhow::Result<()> {
    if inserts.is_empty() {
        return Ok(());
    }

    let total = inserts.len();
    let chunks: Vec<_> = inserts
        .chunks(WRITE_BATCH_SIZE)
        .map(|c| c.to_vec())
        .collect();
    let num_chunks = chunks.len();
    println!("[{label}] writing {total} rows in {num_chunks} chunks");

    stream::iter(chunks)
        .map(|chunk| async move {
            let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) "#,
            );

            qb.push_values(&chunk, |mut b, row| {
                b.push_bind(row.0)
                    .push_bind(&row.1)
                    .push_bind(&row.2)
                    .push_bind(row.3)
                    .push_bind(row.4);
            });

            qb.push(" ON CONFLICT DO NOTHING");
            qb.build().execute(db).await?;

            Ok::<_, anyhow::Error>(())
        })
        .buffer_unordered(WRITE_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;

    println!("[{label}] write complete ({total} rows)");

    Ok(())
}

async fn backfill_owned_items(db: &Pool<Postgres>) -> anyhow::Result<()> {
    let limit = 10000_i64;
    let mut offset = 0_i64;

    println!("[owned_items] STARTING");

    loop {
        println!("[owned_items] BATCH offset={offset}");

        let batch = sqlx::query!(
            r#"
            SELECT DISTINCT
                "item_id",
                "item_type",
                "user_id",
                access_level AS "access_level: AccessLevel",
                "created_at"
            FROM "UserItemAccess"
            WHERE "granted_from_channel_id" IS NULL
            AND "granted_from_team_id" IS NULL
            ORDER BY created_at ASC
            LIMIT $1
            OFFSET $2
            "#,
            limit,
            offset
        )
        .fetch_all(db)
        .await?;

        if batch.is_empty() {
            break;
        }

        println!("[owned_items] read {} rows", batch.len());

        let inserts: Vec<_> = batch
            .iter()
            .map(|item| {
                let item_type = if item.item_type.eq("thread") {
                    "email_thread".to_string()
                } else {
                    item.item_type.to_string()
                };
                (
                    item.item_id.parse::<macro_uuid::Uuid>().unwrap(),
                    item_type,
                    item.user_id.to_string(),
                    SourceEntityType::User,
                    item.access_level,
                )
            })
            .collect();

        bulk_upsert(db, "owned_items", inserts).await?;

        offset += limit;
    }

    println!("[owned_items] COMPLETED");

    Ok(())
}

/// Handles backfilling non-project items for channels and teams
async fn backfill_non_projects_channels_and_teams(db: &Pool<Postgres>) -> anyhow::Result<()> {
    let limit = 10000_i64;
    let mut offset = 0_i64;

    println!("[channels_and_teams] STARTING");

    loop {
        println!("[channels_and_teams] BATCH offset={offset}");

        let batch = sqlx::query!(
            r#"
            SELECT DISTINCT
                "item_id",
                "item_type",
                "user_id",
                "granted_from_channel_id",
                "granted_from_team_id",
                access_level AS "access_level: AccessLevel",
                "created_at"
            FROM "UserItemAccess"
            WHERE "item_type" != 'project'
            AND ("granted_from_channel_id" IS NOT NULL OR "granted_from_team_id" IS NOT NULL)
            ORDER BY created_at ASC
            LIMIT $1
            OFFSET $2
            "#,
            limit,
            offset
        )
        .fetch_all(db)
        .await?;

        if batch.is_empty() {
            break;
        }

        println!("[channels_and_teams] read {} rows", batch.len());

        let mut inserts = Vec::new();

        for item in &batch {
            let item_type = if item.item_type.eq("thread") {
                "email_thread".to_string()
            } else {
                item.item_type.to_string()
            };
            if let Some(channel_id) = &item.granted_from_channel_id {
                inserts.push((
                    item.item_id.parse::<macro_uuid::Uuid>().unwrap(),
                    item_type.clone(),
                    channel_id.to_string(),
                    SourceEntityType::Channel,
                    item.access_level,
                ));
            }
            if let Some(team_id) = &item.granted_from_team_id {
                inserts.push((
                    item.item_id.parse::<macro_uuid::Uuid>().unwrap(),
                    item_type.clone(),
                    team_id.to_string(),
                    SourceEntityType::Team,
                    item.access_level,
                ));
            }
        }

        bulk_upsert(db, "channels_and_teams", inserts).await?;

        offset += limit;
    }

    println!("[channels_and_teams] COMPLETED");

    Ok(())
}

/// Backfills project shares
async fn backfill_project_items(db: &Pool<Postgres>) -> anyhow::Result<()> {
    let limit = 500_i64;
    let mut offset = 0_i64;

    println!("[project_items] STARTING");

    loop {
        println!("[project_items] BATCH offset={offset}");

        let project_batch = sqlx::query!(
            r#"
            SELECT DISTINCT
                uia."item_id",
                uia."item_type",
                uia."granted_from_channel_id",
                uia.access_level AS "access_level: AccessLevel",
                uia."created_at",
                p."userId" as project_owner -- project owner
            FROM "UserItemAccess" uia
            JOIN "Project" p ON p.id = uia.item_id
            WHERE item_type = 'project'
            ORDER BY created_at ASC
            LIMIT $1
            OFFSET $2
            "#,
            limit,
            offset
        )
        .fetch_all(db)
        .await?;

        if project_batch.is_empty() {
            break;
        }

        let batch_size = project_batch.len();
        println!("[project_items] read {batch_size} projects");

        let processed = AtomicUsize::new(0);

        // Process projects concurrently
        stream::iter(project_batch)
            .map(|project| {
                let processed = &processed;
                async move {
                    let item_ids = sqlx::query!(
                        r#"
                        WITH RECURSIVE project_tree AS (
                            SELECT id FROM "Project" WHERE id = $1
                            UNION ALL
                            SELECT p.id
                            FROM "Project" p
                            JOIN project_tree pt ON p."parentId" = pt.id
                        )
                        SELECT id AS "item_id!", 'project' AS "item_type!" FROM project_tree

                        UNION ALL

                        SELECT d.id, 'document' FROM "Document" d
                        WHERE d."projectId" IN (SELECT id FROM project_tree)

                        UNION ALL

                        SELECT c.id, 'chat' FROM "Chat" c
                        WHERE c."projectId" IN (SELECT id FROM project_tree)

                        UNION ALL

                        SELECT et.id::text, 'thread' FROM "email_threads" et
                        WHERE et.project_id IN (SELECT id FROM project_tree);
                        "#,
                        project.item_id
                    )
                    .fetch_all(db)
                    .await?;

                    let (source_id, source_entity_type) =
                        if let Some(granted_from_channel_id) = project.granted_from_channel_id {
                            (
                                granted_from_channel_id.to_string(),
                                SourceEntityType::Channel,
                            )
                        } else {
                            (project.project_owner, SourceEntityType::User)
                        };

                    let inserts: Vec<_> = item_ids
                        .iter()
                        .map(|item| {
                            let item_type = if item.item_type.eq("thread") {
                                "email_thread".to_string()
                            } else {
                                item.item_type.to_string()
                            };
                            (
                                item.item_id.parse::<macro_uuid::Uuid>().unwrap(),
                                item_type,
                                source_id.clone(),
                                source_entity_type,
                                project.access_level,
                            )
                        })
                        .collect();

                    let sub_items = inserts.len();
                    bulk_upsert(db, "project_items", inserts).await?;

                    let done = processed.fetch_add(1, Ordering::Relaxed) + 1;
                    println!(
                        "[project_items] processed {done}/{batch_size} projects \
                         (project {} had {sub_items} sub-items)",
                        project.item_id
                    );

                    Ok::<_, anyhow::Error>(())
                }
            })
            .buffer_unordered(WRITE_CONCURRENCY)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()?;

        offset += limit;
    }

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
