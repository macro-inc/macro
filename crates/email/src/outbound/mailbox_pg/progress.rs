use super::*;
use crate::domain::mailbox::progress::*;
use std::collections::HashMap;

#[cfg(test)]
mod test;

impl MailboxProgressRepository for PgMailboxSync {
    async fn record_imports(
        &self,
        imports: &HashMap<Uuid, MailboxImports>,
    ) -> Result<(), MailboxError> {
        let mut links = Vec::with_capacity(imports.len());
        let mut imported = Vec::with_capacity(imports.len());
        let mut last_imported = Vec::with_capacity(imports.len());
        for (link_id, entry) in imports {
            links.push(*link_id);
            imported.push(i32::try_from(entry.imported).unwrap_or(i32::MAX));
            last_imported.push(entry.last_imported_at);
        }
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_import_minutes (link_id, minute, imported, last_imported_at)
            SELECT link_id, date_trunc('minute', now()), imported, last_imported_at
            FROM unnest($1::uuid[], $2::int[], $3::timestamptz[]) AS flushed(link_id, imported, last_imported_at)
            ON CONFLICT (link_id, minute) DO UPDATE SET
                imported = email_mailbox_import_minutes.imported + EXCLUDED.imported,
                last_imported_at = GREATEST(email_mailbox_import_minutes.last_imported_at, EXCLUDED.last_imported_at)
        "#,
            &links,
            &imported,
            &last_imported
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?;
        Ok(())
    }

    async fn backlogs(&self) -> Result<Vec<MailboxBacklog>, MailboxError> {
        sqlx::query!(
            "DELETE FROM email_mailbox_import_minutes WHERE minute < now() - interval '1 day'"
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?;
        // Each subquery reads only the current generation's queue and streams
        // through their primary-key and unique prefixes; no message table scan.
        let rows = sqlx::query!(
            r#"
            WITH mailboxes AS (
                SELECT l.id, l.sync_generation, l.is_sync_active, l.needs_reauth
                FROM email_links l
                WHERE l.provider = 'OUTLOOK' AND (l.is_sync_active OR EXISTS (
                    SELECT 1 FROM email_message_reconciliation q
                    WHERE q.link_id = l.id AND q.generation = l.sync_generation
                ))
            ),
            queue AS (
                SELECT q.link_id,
                    count(*) AS queued,
                    count(*) FILTER (WHERE q.available_at > now()) AS parked,
                    count(*) FILTER (WHERE q.lease_until > now()) AS leased,
                    min(q.available_at) FILTER (
                        WHERE q.available_at <= now() AND (q.lease_until IS NULL OR q.lease_until <= now())
                    ) AS oldest_due,
                    max(q.available_at) FILTER (WHERE q.available_at > now()) AS parked_until
                FROM mailboxes m
                JOIN email_message_reconciliation q ON q.link_id = m.id AND q.generation = m.sync_generation
                GROUP BY q.link_id
            ),
            streams AS (
                SELECT s.link_id, count(*) AS incomplete
                FROM mailboxes m
                JOIN email_sync_streams s ON s.link_id = m.id AND s.generation = m.sync_generation
                WHERE s.kind IN ('folder_catalog', 'mail_folder') AND NOT s.initial_complete
                GROUP BY s.link_id
            ),
            imports AS (
                SELECT i.link_id,
                    sum(i.imported) FILTER (WHERE i.minute > now() - interval '5 minutes') AS imported_5m,
                    max(i.last_imported_at) AS last_imported_at
                FROM mailboxes m
                JOIN email_mailbox_import_minutes i ON i.link_id = m.id
                GROUP BY i.link_id
            )
            SELECT m.id AS "link_id!",
                m.sync_generation AS "sync_generation!",
                m.is_sync_active AS "sync_active!",
                m.needs_reauth AS "needs_reauth!",
                COALESCE(q.queued, 0) AS "queued!",
                COALESCE(q.parked, 0) AS "parked!",
                COALESCE(q.leased, 0) AS "leased!",
                COALESCE(floor(EXTRACT(EPOCH FROM now() - q.oldest_due)), 0)::bigint AS "oldest_waiting_seconds!",
                COALESCE(ceil(EXTRACT(EPOCH FROM q.parked_until - now())), 0)::bigint AS "parked_until_max_seconds!",
                COALESCE(s.incomplete, 0) AS "streams_incomplete!",
                COALESCE(i.imported_5m, 0)::bigint AS "imported_5m!",
                floor(EXTRACT(EPOCH FROM now() - i.last_imported_at))::bigint AS seconds_since_last_import
            FROM mailboxes m
            LEFT JOIN queue q ON q.link_id = m.id
            LEFT JOIN streams s ON s.link_id = m.id
            LEFT JOIN imports i ON i.link_id = m.id
            ORDER BY m.id
        "#
        )
        .fetch_all(&self.db)
        .await
        .map_err(db_error)?;
        Ok(rows
            .into_iter()
            .map(|row| MailboxBacklog {
                link_id: row.link_id,
                sync_generation: row.sync_generation,
                queued: row.queued,
                parked: row.parked,
                leased: row.leased,
                oldest_waiting_seconds: row.oldest_waiting_seconds,
                parked_until_max_seconds: row.parked_until_max_seconds,
                streams_incomplete: row.streams_incomplete,
                imported_5m: row.imported_5m,
                seconds_since_last_import: row.seconds_since_last_import,
                sync_active: row.sync_active,
                needs_reauth: row.needs_reauth,
            })
            .collect())
    }
}
