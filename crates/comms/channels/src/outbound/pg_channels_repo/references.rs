//! Reference edges for associated-item queries: documents and undeleted
//! messages that mention or attach a target entity.

use std::collections::HashSet;

use crate::domain::models::{MessageParent, ReferenceSource, ReferenceTarget, ReferencingMessage};

use super::PgChannelsRepo;

#[cfg(test)]
mod test;

impl PgChannelsRepo {
    pub(super) async fn query_reference_sources(
        &self,
        targets: &[ReferenceTarget],
    ) -> Result<Vec<ReferenceSource>, rootcause::Report> {
        if targets.is_empty() {
            return Ok(Vec::new());
        }
        let (entity_types, entity_ids): (Vec<String>, Vec<String>) = targets
            .iter()
            .map(|target| (target.entity_type.clone(), target.entity_id.clone()))
            .unzip();
        // Message sources resolve to their live message so deleted messages
        // stop matching; the CASE keeps document ids out of the uuid cast.
        let rows = sqlx::query!(
            r#"
            WITH targets AS (
                SELECT * FROM UNNEST($1::text[], $2::text[]) AS t(entity_type, entity_id)
            ),
            edges AS (
                SELECT em.source_entity_type::text AS source_type,
                       em.source_entity_id AS source_id
                FROM comms_entity_mentions em
                JOIN targets t
                    ON em.entity_type = t.entity_type AND em.entity_id = t.entity_id
                WHERE em.source_entity_type IN ('document', 'message')
                UNION
                SELECT 'message', a.message_id::text
                FROM comms_attachments a
                JOIN targets t
                    ON a.entity_type = t.entity_type AND a.entity_id = t.entity_id
            )
            SELECT
                e.source_type AS "source_type!",
                e.source_id AS "source_id!",
                m.id AS "message_id?",
                m.thread_id AS "thread_id?",
                m.parent_entity_type AS "parent_entity_type?",
                m.parent_entity_id AS "parent_entity_id?"
            FROM edges e
            LEFT JOIN comms_messages m
                ON m.id = CASE WHEN e.source_type = 'message' THEN e.source_id::uuid END
               AND m.deleted_at IS NULL
            WHERE e.source_type = 'document' OR m.id IS NOT NULL
            "#,
            &entity_types,
            &entity_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut seen = HashSet::new();
        let mut sources = Vec::with_capacity(rows.len());
        for row in rows {
            let source = match (
                row.source_type.as_str(),
                row.message_id,
                row.parent_entity_type.as_deref(),
                row.parent_entity_id.as_deref(),
            ) {
                ("document", ..) => ReferenceSource::Document(row.source_id),
                ("message", Some(message_id), Some(parent_type), Some(parent_id)) => {
                    let Some(parent) = MessageParent::from_stored(parent_type, parent_id) else {
                        tracing::warn!(
                            parent_type,
                            "referencing message has an unknown parent; skipping"
                        );
                        continue;
                    };
                    ReferenceSource::Message(ReferencingMessage {
                        message_id,
                        thread_id: row.thread_id,
                        parent,
                    })
                }
                _ => continue,
            };
            if seen.insert(source.clone()) {
                sources.push(source);
            }
        }
        Ok(sources)
    }
}
