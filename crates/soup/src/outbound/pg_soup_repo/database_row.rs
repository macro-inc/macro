//! Database row hydration for Soup's ID-based query modes. Cursor pages read
//! rows through the dynamic query's `database_row` arm.

#[cfg(test)]
mod test;

use model_entity::EntityType;
use model_owner::Owner;
use models_soup::{database_row::SoupDatabaseRow, item::SoupItem};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::AdvancedSortParams;

pub(super) async fn by_ids(
    db: &PgPool,
    req: AdvancedSortParams<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = req
        .entities
        .iter()
        .filter(|entity| entity.entity_type == EntityType::DatabaseRow)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_file!(
        "src/outbound/pg_soup_repo/database_row/by_ids.sql",
        req.user_id.as_ref(),
        &ids,
    )
    .fetch_all(db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(SoupItem::DatabaseRow(SoupDatabaseRow {
                id: row.id,
                table_id: row.table_id,
                database_id: row.database_id,
                position: row.position,
                owner_id: Owner::from_principal_str(&row.owner_id).map_err(super::type_err)?,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
                extra: (),
            }))
        })
        .collect()
}
