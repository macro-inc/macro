//! Publication outbox over `whatsapp_group_message` revisions.

use super::*;
use crate::domain::ports::{EffectsRepository, GroupEffect, Origin};
use async_trait::async_trait;

#[async_trait]
impl EffectsRepository for PgLinkedRepository {
    async fn pending_effects(&self, limit: i64) -> LinkedResult<Vec<GroupEffect>> {
        sqlx::query!(
            r#"SELECT b.id AS group_id, m.message_id AS "message_id!", m.effect_revision, m.published_revision, m.origin, m.content_revision, m.deleted_at, p.user_id, m.kind
            FROM whatsapp_group_message m
            JOIN whatsapp_group b ON b.id = m.binding_id
            JOIN whatsapp_external_person p ON p.id = m.person_id
            WHERE m.message_id IS NOT NULL AND m.published_revision < m.effect_revision AND m.notification_retry_at <= now()
            ORDER BY m.notification_retry_at, m.message_id LIMIT $1"#,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| {
            Ok(GroupEffect {
                group_id: row.group_id,
                message_id: row.message_id,
                revision: row.effect_revision,
                first_publication: row.published_revision == 0 && row.content_revision == 0 && row.deleted_at.is_none(),
                origin: match row.origin.as_str() {
                    "macro" => Origin::Macro,
                    "history" => Origin::History,
                    "whatsapp" => Origin::Whatsapp,
                    _ => return Err(LinkedError::Unavailable.into()),
                },
                associated_user: row.user_id,
                system: row.kind == "system",
            })
        })
        .collect()
    }

    async fn published(&self, message: Uuid, revision: i64) -> LinkedResult<()> {
        sqlx::query!(
            "UPDATE whatsapp_group_message SET published_revision = GREATEST(published_revision, $2) WHERE message_id = $1",
            message,
            revision
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }

    async fn defer_effect(&self, message: Uuid) -> LinkedResult<()> {
        sqlx::query!(
            "UPDATE whatsapp_group_message SET notification_retry_at = now() + interval '30 seconds' WHERE message_id = $1",
            message
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }
}
