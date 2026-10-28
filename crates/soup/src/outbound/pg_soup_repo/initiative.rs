//! Initiative hydration for Soup's ID-based query modes.

#[cfg(test)]
mod test;

use model_entity::EntityType;
use model_owner::Owner;
use models_soup::{initiative::SoupInitiative, item::SoupItem};
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
        .filter(|entity| entity.entity_type == EntityType::Initiative)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_file!(
        "src/outbound/pg_soup_repo/initiative/by_ids.sql",
        req.user_id.as_ref(),
        &ids,
    )
    .fetch_all(db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(SoupItem::Initiative(SoupInitiative {
                id: row.id,
                name: row.name,
                owner_id: Owner::from_principal_str(&row.owner_user_id).map_err(super::type_err)?,
                created_at: row.created_at,
                updated_at: row.updated_at,
                viewed_at: row.viewed_at,
                extra: (),
            }))
        })
        .collect()
}
