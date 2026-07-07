//! Permission-related query helpers.
//!
//! These queries read tables owned by other domains but are needed by the
//! permission outbound adapter. They are inlined here so this crate does not
//! depend on the monolithic db client crates.

use models_properties::EntityType;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Gets the entity's owner and whether it's deleted.
/// Errors if the entity doesn't exist or the entity type is unsupported.
pub async fn get_owner_and_deleted(
    pool: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
) -> anyhow::Result<(String, bool)> {
    let result = match entity_type {
        // The following entity types are either deleted immediately or simply unsupported
        EntityType::Channel | EntityType::Company | EntityType::User | EntityType::Thread => {
            anyhow::bail!("unsupported entity type")
        }
        EntityType::Document | EntityType::Task => {
            sqlx::query!(
                r#"SELECT owner, "deletedAt" as deleted_at FROM "Document" WHERE id=$1"#,
                entity_id
            )
            .map(|r| (r.owner, r.deleted_at.is_some()))
            .fetch_one(pool)
            .await?
        }
        EntityType::Chat => {
            sqlx::query!(
                r#"SELECT "userId" as user_id, "deletedAt" as deleted_at FROM "Chat" WHERE id=$1"#,
                entity_id
            )
            .map(|r| (r.user_id, r.deleted_at.is_some()))
            .fetch_one(pool)
            .await?
        }
        EntityType::Project => sqlx::query!(
            r#"SELECT "userId" as user_id, "deletedAt" as deleted_at FROM "Project" WHERE id=$1"#,
            entity_id
        )
        .map(|r| (r.user_id, r.deleted_at.is_some()))
        .fetch_one(pool)
        .await?,
    };

    Ok(result)
}

/// Gets the macro user id of the owner of an email thread via its link.
/// Returns `None` if the thread doesn't exist.
pub async fn get_macro_id_from_thread_id(
    pool: &Pool<Postgres>,
    thread_id: Uuid,
) -> anyhow::Result<Option<String>> {
    let macro_id = sqlx::query_scalar!(
        r#"
        SELECT l.macro_id
        FROM email_threads t
        JOIN email_links l ON t.link_id = l.id
        WHERE t.id = $1
        "#,
        thread_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(macro_id)
}
