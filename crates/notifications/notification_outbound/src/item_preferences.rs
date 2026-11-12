//! Postgres persistence for user-owned item notification preferences.

use chrono::{DateTime, Utc};
use entity_kind::{Entity, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::item_preferences::{
    ItemNotificationPreference, ItemNotificationPreferenceRepository,
};
use rootcause::Report;
use sqlx::PgPool;

/// Adapter for the notification domain's item unsubscribe table.
#[derive(Clone)]
pub struct PgItemNotificationPreferenceRepository(pub PgPool);

impl ItemNotificationPreferenceRepository for PgItemNotificationPreferenceRepository {
    async fn list(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<Vec<ItemNotificationPreference>, Report> {
        let rows = sqlx::query!(
            r#"SELECT item_id, item_type, snoozed_until
               FROM user_notification_item_unsubscribe
               WHERE user_id = $1 AND (snoozed_until IS NULL OR snoozed_until > NOW())
               ORDER BY snoozed_until NULLS LAST, item_id"#,
            user.as_ref()
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let entity_type: EntityType = match row.item_type.as_str() {
                    "email" | "thread" => EntityType::EmailThread,
                    "foreign" => EntityType::ForeignEntity,
                    value => match value.parse() {
                        Ok(entity_type) => entity_type,
                        Err(error) => {
                            tracing::warn!(
                                item_type = value,
                                ?error,
                                "Skipping unknown notification preference type"
                            );
                            return None;
                        }
                    },
                };
                Some(ItemNotificationPreference {
                    entity: entity_type.with_entity_string(row.item_id),
                    snoozed_until: row.snoozed_until,
                })
            })
            .collect())
    }

    async fn set(
        &self,
        user: MacroUserIdStr<'_>,
        entity: Entity<'_>,
        until: Option<DateTime<Utc>>,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"INSERT INTO user_notification_item_unsubscribe (user_id, item_id, item_type, snoozed_until)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id, item_id) DO UPDATE
               SET item_type = EXCLUDED.item_type, snoozed_until = EXCLUDED.snoozed_until"#,
            user.as_ref(), entity.entity_id.as_ref(), entity.entity_type.as_ref(), until
        ).execute(&self.0).await?;
        Ok(())
    }

    async fn set_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
        until: Option<DateTime<Utc>>,
    ) -> Result<(), Report> {
        let ids: Vec<String> = entities
            .iter()
            .map(|entity| entity.entity_id.to_string())
            .collect();
        let types: Vec<String> = entities
            .iter()
            .map(|entity| entity.entity_type.to_string())
            .collect();

        sqlx::query!(
            r#"INSERT INTO user_notification_item_unsubscribe (user_id, item_id, item_type, snoozed_until)
               SELECT $1, item_id, item_type, $4
               FROM UNNEST($2::text[], $3::text[]) AS items(item_id, item_type)
               ON CONFLICT (user_id, item_id) DO UPDATE
               SET item_type = EXCLUDED.item_type, snoozed_until = EXCLUDED.snoozed_until"#,
            user.as_ref(), &ids, &types, until
        ).execute(&self.0).await?;
        Ok(())
    }

    async fn remove_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> Result<(), Report> {
        let ids: Vec<String> = entities
            .iter()
            .map(|entity| entity.entity_id.to_string())
            .collect();

        sqlx::query!(
            "DELETE FROM user_notification_item_unsubscribe WHERE user_id = $1 AND item_id = ANY($2::text[])",
            user.as_ref(), &ids
        ).execute(&self.0).await?;
        Ok(())
    }

    async fn remove(&self, user: MacroUserIdStr<'_>, entity: Entity<'_>) -> Result<(), Report> {
        sqlx::query!(
            "DELETE FROM user_notification_item_unsubscribe WHERE user_id = $1 AND item_id = $2",
            user.as_ref(),
            entity.entity_id.as_ref()
        )
        .execute(&self.0)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
