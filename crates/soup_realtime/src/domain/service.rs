//! Realtime Soup hydration and fan-out orchestration.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use futures::{StreamExt as _, stream};
use model_entity::Entity;
use rootcause::prelude::{Report, ResultExt as _};

use super::{
    models::SoupRealtimeMessage,
    ports::{SoupItemReader, SoupRealtimePublisher, SoupRealtimeService, UserAccessExpander},
};

/// Maximum number of Kafka publications polled concurrently.
const PUBLISH_CONCURRENCY: usize = 16;

/// Domain service that expands access, hydrates user-scoped items, and fans out.
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

        // Complete every read before publication so a later read failure cannot
        // cause an avoidable partial fan-out.
        let mut messages = Vec::with_capacity(users.len());
        for user_id in users {
            let item = self
                .item_reader
                .read_for_user(user_id.clone(), &entity)
                .await
                .context_with(|| format!("failed to hydrate Soup item for user {user_id}"))?
                .ok_or_else(|| {
                    rootcause::report!(
                        "Soup item for {} {} was missing for user {}",
                        entity.entity_type,
                        entity.entity_id,
                        user_id
                    )
                })?;

            let hydrated_entity = item.entity();
            if hydrated_entity != entity {
                return Err(rootcause::report!(
                    "Soup reader returned {} {} while hydrating {} {} for user {}",
                    hydrated_entity.entity_type,
                    hydrated_entity.entity_id,
                    entity.entity_type,
                    entity.entity_id,
                    user_id
                ));
            }

            messages.push(SoupRealtimeMessage::new(user_id, item));
        }

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
