use std::marker::PhantomData;

use async_graphql::{Context, Object};
use graphql_common::require_authenticated_user;
use graphql_properties::{EntityPropertyWriter, UpdateEntityPropertyOptionsInput};
use graphql_soup::{PrimarySoupItemLoader, SoupEntityEdges, SoupPatch};
use model_entity::{Entity, EntityType};
use uuid::Uuid;

/// Property option updates that also return the parent Soup entity.
pub(crate) struct EntityPropertyEffectsRoot<W, E>(PhantomData<fn() -> (W, E)>);

impl<W, E> Default for EntityPropertyEffectsRoot<W, E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

/// A committed option update and the entity whose assignments changed.
struct EntityPropertyOptionEffects<E> {
    /// Resolve using the authenticated viewer after the option transaction commits.
    entity: Entity<'static>,
    /// The composed Soup edges for this schema.
    edges: PhantomData<fn() -> E>,
}

/// The parent entity after its property options have been committed.
#[Object]
impl<E: SoupEntityEdges> EntityPropertyOptionEffects<E> {
    /// The current entity, including the committed option assignments.
    async fn effect(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<SoupPatch<E>>> {
        let effect = SoupPatch::hydrate_updated(
            require_authenticated_user(ctx)?,
            self.entity.clone(),
            ctx.data_opt::<PrimarySoupItemLoader>()
                .map(PrimarySoupItemLoader::loader),
        )
        .await;

        // The property transaction already committed. A hydration failure
        // leaves recovery to the readers and must not reject the write.
        match effect {
            Ok(effect) => Ok(effect),
            Err(_) => {
                tracing::warn!(entity_id = %self.entity.entity_id, "tag mutation effect unavailable");
                Ok(None)
            }
        }
    }
}

#[Object]
impl<W: EntityPropertyWriter, E: SoupEntityEdges> EntityPropertyEffectsRoot<W, E> {
    /// Apply option deltas and return the document or folder for normalized readers.
    #[tracing::instrument(skip_all, err(Debug), fields(entity_id = tracing::field::Empty))]
    async fn update_soup_entity_property_options(
        &self,
        ctx: &Context<'_>,
        input: UpdateEntityPropertyOptionsInput,
    ) -> async_graphql::Result<EntityPropertyOptionEffects<E>> {
        require_authenticated_user(ctx)?;
        let (entity, updates) = input.into_model()?;
        if !matches!(
            entity.entity_type,
            EntityType::Document | EntityType::Project
        ) {
            return Err(async_graphql::Error::new(
                "only documents and folders are supported",
            ));
        }
        let id = Uuid::parse_str(&entity.entity_id)
            .map_err(|_| async_graphql::Error::new("entityId must be a UUID"))?;
        tracing::Span::current().record("entity_id", tracing::field::display(id));

        ctx.data::<W>()?
            .apply_entity_property_options(entity.clone(), updates)
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        Ok(EntityPropertyOptionEffects {
            entity,
            edges: PhantomData,
        })
    }
}
