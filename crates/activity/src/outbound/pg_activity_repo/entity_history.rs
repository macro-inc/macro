//! Keyset history for native entity views, independent of Soup.

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use std::num::NonZeroU32;
use uuid::Uuid;

use super::{PgActivityRepo, StoredRow};
use crate::domain::ports::{ActivityFeedPage, EntityActivityReads};

impl EntityActivityReads for PgActivityRepo {
    type Err = sqlx::Error;

    async fn entity_feed(
        &self,
        entity_type: EntityType,
        entity_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        let limit = limit.get();
        let fetch = i64::from(limit) + 1;
        let mut rows = match cursor {
            None => sqlx::query_as!(StoredRow,
                r#"SELECT id, actor_id, action, action_payload, subject_id, entity_type, entity_id, occurred_at
                   FROM activity_events WHERE entity_type = $1 AND entity_id = $2
                   ORDER BY occurred_at DESC, id DESC LIMIT $3"#,
                entity_type.as_ref(), entity_id, fetch,
            ).fetch_all(&self.pool).await?,
            Some((cursor_at, cursor_id)) => sqlx::query_as!(StoredRow,
                r#"SELECT id, actor_id, action, action_payload, subject_id, entity_type, entity_id, occurred_at
                   FROM activity_events WHERE entity_type = $1 AND entity_id = $2 AND (occurred_at, id) < ($3, $4)
                   ORDER BY occurred_at DESC, id DESC LIMIT $5"#,
                entity_type.as_ref(), entity_id, cursor_at, cursor_id, fetch,
            ).fetch_all(&self.pool).await?,
        };
        let has_more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        let next = has_more
            .then(|| rows.last().map(|row| (row.occurred_at, row.id)))
            .flatten();
        Ok(ActivityFeedPage {
            records: rows.into_iter().filter_map(StoredRow::decode).collect(),
            next,
        })
    }
}
