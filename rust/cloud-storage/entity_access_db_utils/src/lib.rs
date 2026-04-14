#![deny(missing_docs)]

//! entity_access_db_utils crate contains common db queries that are required when manipulating entity_access table.

pub use model_entity::EntityType;
pub use models_entity_access_management::EntityAccessSourceType;
pub use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Postgres, Transaction};

/// Inserts a row into the entity access table
/// *NOTE*: The transaction does not get committed automatically
#[tracing::instrument(skip(transaction), err)]
pub async fn insert_entity_access_row(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    source_id: &str,
    source_type: EntityAccessSourceType,
    access_level: AccessLevel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, $2, $3, $4, $5)
        "#,
        entity_id,
        entity_type.as_ref(),
        source_id,
        source_type as _,
        access_level as _,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
