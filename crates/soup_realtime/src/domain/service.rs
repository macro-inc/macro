//! Realtime Soup hydration and fan-out orchestration.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use futures::{StreamExt as _, stream};
use model_entity::Entity;
use models_soup::item::SoupItem;
use rootcause::prelude::{Report, ResultExt as _};

use super::{
    models::SoupRealtimeMessage,
    ports::{SoupItemReader, SoupRealtimePublisher, SoupRealtimeService, UserAccessExpander},
};

/// Maximum number of Kafka publications polled concurrently.
const PUBLISH_CONCURRENCY: usize = 16;

/// Domain service that expands access, hydrates one normalized item, and fans out.
pub struct SoupRealtimeServiceImpl<A, R, P> {
    access_expander: A,
    item_reader: R,
    publisher: P,
}

impl<A, R, P> SoupRealtimeServiceImpl<A, R, P> {
    /// Creates a realtime Soup service from its three outbound capabilities.
    pub fn new(access_expander: A, item_reader: R, publisher: P) -> Self {
        Self {
            access_expander,
            item_reader,
            publisher,
        }
    }
}

impl<A, R, P> SoupRealtimeService for SoupRealtimeServiceImpl<A, R, P>
where
    A: UserAccessExpander,
    R: SoupItemReader,
    P: SoupRealtimePublisher,
{
    #[tracing::instrument(
        skip(self),
        fields(
            entity_type = %entity.entity_type,
            entity_id = %entity.entity_id,
            recipient_count = tracing::field::Empty,
        ),
        err
    )]
    async fn notify_users(&self, entity: Entity<'static>) -> Result<(), Report> {
        let mut users = self
            .access_expander
            .expand_user_access(&entity)
            .await
            .context("failed to expand current user access")?;

        let mut seen = HashSet::with_capacity(users.len());
        users.retain(|user_id| seen.insert(user_id.clone()));
        tracing::Span::current().record("recipient_count", users.len());

        if users.is_empty() {
            return Ok(());
        }

        let hydration_user_id = users[0].clone();
        let item = self
            .item_reader
            .read_for_user(hydration_user_id.clone(), &entity)
            .await
            .context_with(|| {
                format!("failed to hydrate Soup item through accessor {hydration_user_id}")
            })?
            .ok_or_else(|| {
                rootcause::report!(
                    "Soup item for {} {} was missing for accessor {}",
                    entity.entity_type,
                    entity.entity_id,
                    hydration_user_id
                )
            })?;

        let hydrated_entity = item.entity();
        if hydrated_entity != entity {
            return Err(rootcause::report!(
                "Soup reader returned {} {} while hydrating {} {} through accessor {}",
                hydrated_entity.entity_type,
                hydrated_entity.entity_id,
                entity.entity_type,
                entity.entity_id,
                hydration_user_id
            ));
        }

        let SoupItem::Document(mut document) = item else {
            return Err(rootcause::report!(
                "realtime Soup fan-out currently supports document items only"
            ));
        };
        document.viewed_at = None;

        let messages = users
            .into_iter()
            .map(|user_id| SoupRealtimeMessage::new(user_id, SoupItem::Document(document.clone())))
            .collect::<Vec<_>>();

        let results = stream::iter(
            messages
                .into_iter()
                .map(|message| self.publisher.publish(message)),
        )
        .buffer_unordered(PUBLISH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

        let failure_count = results.iter().filter(|result| result.is_err()).count();
        if let Some(error) = results.into_iter().find_map(Result::err) {
            return Err(error
                .context(format!(
                    "{failure_count} realtime Soup publication(s) failed"
                ))
                .into_dynamic());
        }

        Ok(())
    }
}
