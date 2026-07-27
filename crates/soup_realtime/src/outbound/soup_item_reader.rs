//! Adapter for loading complete, user-scoped Soup items.

#[cfg(test)]
mod test;

use model_entity::{Entity, EntityType};
use models_soup::item::SoupItem;
use rootcause::prelude::{Report, ResultExt as _};
use soup::domain::{models::AdvancedSortParams, ports::SoupRepo};

use crate::domain::ports::SoupItemReader;

/// Soup item reader backed by an existing [`SoupRepo`].
pub struct SoupRepoItemReader<R> {
    repo: R,
}

impl<R> SoupRepoItemReader<R> {
    /// Creates a user-scoped item reader around a Soup repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> SoupItemReader for SoupRepoItemReader<R>
where
    R: SoupRepo,
    R::Err: std::error::Error + Send + Sync + 'static,
{
    #[tracing::instrument(
        skip(self),
        fields(
            user_id = %user_id,
            entity_type = %entity.entity_type,
            entity_id = %entity.entity_id,
        ),
        err
    )]
    async fn read_for_user(
        &self,
        user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        entity: &Entity<'static>,
    ) -> Result<Option<SoupItem<()>>, Report> {
        if entity.entity_type != EntityType::Document {
            return Err(rootcause::report!(
                "realtime Soup reader does not support entity type {}",
                entity.entity_type
            ));
        }

        let requested_entities = [entity.clone()];
        let items = self
            .repo
            .expanded_soup_by_ids(AdvancedSortParams {
                entities: &requested_entities,
                user_id,
            })
            .await
            .context("failed to read expanded user-scoped Soup item")?;

        let mut matches = items.into_iter().filter(|item| item.entity() == *entity);
        let Some(item) = matches.next() else {
            return Ok(None);
        };

        if matches.next().is_some() {
            return Err(rootcause::report!(
                "expanded Soup query returned duplicate items for {} {}",
                entity.entity_type,
                entity.entity_id
            ));
        }

        Ok(Some(item))
    }
}
