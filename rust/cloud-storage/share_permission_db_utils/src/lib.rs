//! Small SQL helpers for `SharePermission` and `ChannelSharePermission` rows.

use anyhow::Context;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Executor, PgPool, Postgres};

/// The result of attempting to insert a channel share permission row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InsertChannelSharePermissionResult {
    /// A new row was inserted.
    Inserted,
    /// A row for the same share permission and channel already existed.
    AlreadyExists,
}

/// Look up the share permission ID for a supported shareable item.
pub async fn get_share_permission_id<'e, E>(
    executor: E,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<String>
where
    E: Executor<'e, Database = Postgres>,
{
    let share_permission_id = match item_type {
        "document" => {
            sqlx::query_scalar!(
                r#"
                SELECT dp."sharePermissionId" as "share_permission_id!"
                FROM "DocumentPermission" dp
                WHERE dp."documentId" = $1
                "#,
                item_id,
            )
            .fetch_one(executor)
            .await?
        }
        "chat" => {
            sqlx::query_scalar!(
                r#"
                SELECT cp."sharePermissionId" as "share_permission_id!"
                FROM "ChatPermission" cp
                WHERE cp."chatId" = $1
                "#,
                item_id,
            )
            .fetch_one(executor)
            .await?
        }
        "thread" => {
            sqlx::query_scalar!(
                r#"
                SELECT tp."sharePermissionId" as "share_permission_id!"
                FROM "EmailThreadPermission" tp
                WHERE tp."threadId" = $1
                "#,
                item_id,
            )
            .fetch_one(executor)
            .await?
        }
        "project" => {
            sqlx::query_scalar!(
                r#"
                SELECT pp."sharePermissionId" as "share_permission_id!"
                FROM "ProjectPermission" pp
                WHERE pp."projectId" = $1
                "#,
                item_id,
            )
            .fetch_one(executor)
            .await?
        }
        "call" => {
            let item_id = macro_uuid::string_to_uuid(item_id)?;
            sqlx::query_scalar!(
                r#"
                SELECT share_permission_id as "share_permission_id!"
                FROM (
                    SELECT share_permission_id FROM calls WHERE id = $1
                    UNION ALL
                    SELECT share_permission_id FROM call_records WHERE id = $1
                ) t
                LIMIT 1
                "#,
                item_id,
            )
            .fetch_one(executor)
            .await?
        }
        _ => anyhow::bail!("unsupported item type {item_type}"),
    };

    Ok(share_permission_id)
}

/// Insert a channel share permission row without mutating an existing row.
pub async fn insert_channel_share_permission<'e, E>(
    executor: E,
    share_permission_id: &str,
    channel_id: &str,
    access_level: AccessLevel,
) -> Result<InsertChannelSharePermissionResult, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"
        INSERT INTO "ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
        VALUES ($1, $2, $3)
        ON CONFLICT ("share_permission_id", "channel_id") DO NOTHING
        "#,
        share_permission_id,
        channel_id,
        access_level as _,
    )
    .execute(executor)
    .await?;

    if result.rows_affected() == 0 {
        Ok(InsertChannelSharePermissionResult::AlreadyExists)
    } else {
        Ok(InsertChannelSharePermissionResult::Inserted)
    }
}

/// Ensure a thread has a share permission and owner entity-access row.
pub async fn ensure_thread_share_permission(pool: &PgPool, thread_id: &str) -> anyhow::Result<()> {
    let existing_share_permission_id = sqlx::query_scalar!(
        r#"
        SELECT "sharePermissionId" as "share_permission_id!"
        FROM "EmailThreadPermission"
        WHERE "threadId" = $1
        "#,
        thread_id,
    )
    .fetch_optional(pool)
    .await
    .context("failed to get email thread permission")?;

    if existing_share_permission_id.is_some() {
        return Ok(());
    }

    let thread_uuid = macro_uuid::string_to_uuid(thread_id).context("invalid thread id")?;
    let owner_id = sqlx::query_scalar!(
        r#"
        SELECT l.macro_id as "macro_id!"
        FROM email_threads t
        JOIN email_links l ON t.link_id = l.id
        WHERE t.id = $1
        "#,
        thread_uuid,
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("failed to fetch macro_id for thread ID {thread_id}"))?
    .context("thread not found")?;
    let owner_id = MacroUserIdStr::parse_from_str(&owner_id)
        .context("invalid thread owner macro user id")?
        .into_owned();

    let mut transaction = pool.begin().await.context("failed to start transaction")?;
    let share_permission_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "SharePermission" ("isPublic", "publicAccessLevel", "createdAt", "updatedAt")
        VALUES (false, NULL, NOW(), NOW())
        RETURNING id as "id!"
        "#,
    )
    .fetch_one(transaction.as_mut())
    .await
    .context("failed to create thread share permission")?;

    sqlx::query!(
        r#"
        INSERT INTO "EmailThreadPermission" ("threadId", "sharePermissionId", "userId")
        VALUES ($1, $2, $3)
        "#,
        thread_id,
        share_permission_id,
        owner_id.as_ref(),
    )
    .execute(transaction.as_mut())
    .await
    .context("failed to create email thread permission")?;

    entity_access_db_utils::insert_entity_access_row(
        &mut transaction,
        &thread_uuid,
        entity_access_db_utils::EntityType::EmailThread,
        owner_id.as_ref(),
        entity_access_db_utils::EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await
    .context("failed to insert owner entity access row for thread")?;

    transaction
        .commit()
        .await
        .context("failed to commit thread share permission")?;

    Ok(())
}
