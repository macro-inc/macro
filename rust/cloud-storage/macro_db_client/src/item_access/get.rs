use chrono::{DateTime, Utc};
use models_permissions::share_permission::access_level::AccessLevel;

/// A record from entity_access representing a user's access to an entity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityAccessRecord {
    /// The entity ID (as a string, cast from UUID)
    pub entity_id: String,
    /// The entity type (e.g., "document", "project", "chat", "thread")
    pub entity_type: String,
    /// The source ID (user_id, team_id, or channel_id)
    pub source_id: String,
    /// The level of access granted
    pub access_level: AccessLevel,
    /// When this access record was created
    pub created_at: DateTime<Utc>,
    /// When this access record was last updated
    pub updated_at: DateTime<Utc>,
}

/// Gets the items owner and whether it's deleted
#[tracing::instrument(skip(db), err)]
pub async fn get_owner_and_deleted(
    db: &sqlx::Pool<sqlx::Postgres>,
    entity_id: &str,
    item_type: &str,
) -> anyhow::Result<(String, bool)> {
    let result = match item_type {
        "document" => {
            sqlx::query!(
                r#"SELECT owner, "deletedAt" as deleted_at FROM "Document" WHERE id=$1"#,
                entity_id
            )
            .map(|r| (r.owner, r.deleted_at.is_some()))
            .fetch_one(db)
            .await?
        }
        "chat" => {
            sqlx::query!(
                r#"SELECT "userId" as user_id, "deletedAt" as deleted_at FROM "Chat" WHERE id=$1"#,
                entity_id
            )
            .map(|r| (r.user_id, r.deleted_at.is_some()))
            .fetch_one(db)
            .await?
        }
        "project" => sqlx::query!(
            r#"SELECT "userId" as user_id, "deletedAt" as deleted_at FROM "Project" WHERE id=$1"#,
            entity_id
        )
        .map(|r| (r.user_id, r.deleted_at.is_some()))
        .fetch_one(db)
        .await?,
        _ => anyhow::bail!("unsupported item type"),
    };

    Ok(result)
}
