//! Initiative hydration for Soup's ID-based query modes.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_owner::Owner;
use models_soup::{initiative::SoupInitiative, item::SoupItem};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::AdvancedSortParams;

pub(super) async fn by_ids(
    db: &PgPool,
    req: AdvancedSortParams<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = initiative_ids(req.entities);
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_file_as!(
        InitiativeRow,
        "src/outbound/pg_soup_repo/initiative/by_ids.sql",
        req.user_id.as_ref(),
        &ids,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(InitiativeRow::into_item)
    .collect()
}

/// Hydrate initiatives the caller already holds view receipts for. No access
/// predicate: a public or team link authorizes a single-item read even though
/// the listing never enumerates the initiative. `viewer` only joins view history.
pub(super) async fn viewable_by_ids(
    db: &PgPool,
    viewer: Option<MacroUserIdStr<'_>>,
    entities: &[Entity<'_>],
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = initiative_ids(entities);
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_file_as!(
        InitiativeRow,
        "src/outbound/pg_soup_repo/initiative/viewable_by_ids.sql",
        viewer.as_ref().map(|user| user.as_ref()),
        &ids,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(InitiativeRow::into_item)
    .collect()
}

fn initiative_ids(entities: &[Entity<'_>]) -> Vec<Uuid> {
    entities
        .iter()
        .filter(|entity| entity.entity_type == EntityType::Initiative)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect()
}

struct InitiativeRow {
    id: Uuid,
    name: String,
    owner_user_id: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
}

impl InitiativeRow {
    fn into_item(self) -> Result<SoupItem<()>, sqlx::Error> {
        Ok(SoupItem::Initiative(SoupInitiative {
            id: self.id,
            name: self.name,
            owner_id: Owner::from_principal_str(&self.owner_user_id).map_err(super::type_err)?,
            created_at: self.created_at,
            updated_at: self.updated_at,
            viewed_at: self.viewed_at,
            extra: (),
        }))
    }
}
