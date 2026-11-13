//! Adapter from entity access to current realtime Soup recipients.

#[cfg(test)]
mod test;

use entity_access::domain::ports::EntityAudienceLookup;
use model_entity::{Entity, EntityType};
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::{models::SharedAccess, ports::UserAccessExpander};

/// Current-access expander backed by an entity-access service.
pub struct EntityAccessExpander<S> {
    service: S,
}

impl<S> EntityAccessExpander<S> {
    /// Creates an expander around an entity-access service.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

impl<S> UserAccessExpander for EntityAccessExpander<S>
where
    S: EntityAudienceLookup,
{
    /// Makes one entity-access lookup per entity type among `entities`.
    #[tracing::instrument(
        skip_all,
        fields(
            entity_count = entities.len(),
            entity_type_count = tracing::field::Empty,
        ),
        err
    )]
    async fn expand_user_access(
        &self,
        entities: &[Entity<'static>],
    ) -> Result<Vec<SharedAccess>, Report> {
        let mut ids_by_type: Vec<(EntityType, Vec<&str>)> = Vec::new();
        for entity in entities {
            let entity_id = entity.entity_id.as_ref();
            match ids_by_type
                .iter_mut()
                .find(|(entity_type, _)| *entity_type == entity.entity_type)
            {
                Some((_, ids)) => ids.push(entity_id),
                None => ids_by_type.push((entity.entity_type, vec![entity_id])),
            }
        }
        tracing::Span::current().record("entity_type_count", ids_by_type.len());

        let mut shared_access = Vec::new();
        for (entity_type, entity_ids) in ids_by_type {
            let audiences = self
                .service
                .get_entity_audiences(entity_type, &entity_ids)
                .await
                .context("failed to query current entity accessors")
                .map_err(Report::into_dynamic)?;
            shared_access.extend(audiences.into_iter().map(|audience| {
                SharedAccess {
                    entities: audience
                        .entity_ids
                        .into_iter()
                        .map(|entity_id| entity_type.with_entity_string(entity_id))
                        .collect(),
                    users: audience.users,
                }
            }));
        }
        Ok(shared_access)
    }
}
