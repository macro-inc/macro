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
        // One aggregate per Outlook link, each read through the
        // (link_id, generation, ...) key prefixes of the current generation's
        // queue and streams and the link's newest minute counts. Old
        // generations and the message table are never read.
        let rows = sqlx::query!(
            r#"
            SELECT l.id AS "link_id!",
                l.sync_generation AS "sync_generation!",
                l.is_sync_active AS "sync_active!",
                l.needs_reauth AS "needs_reauth!",
                q.queued AS "queued!",
                q.parked AS "parked!",
                q.leased AS "leased!",
                COALESCE(floor(EXTRACT(EPOCH FROM now() - q.oldest_due)), 0)::bigint AS "oldest_waiting_seconds!",
                COALESCE(ceil(EXTRACT(EPOCH FROM q.parked_until - now())), 0)::bigint AS "parked_until_max_seconds!",
                s.incomplete AS "streams_incomplete!",
                COALESCE(recent.imported_5m, 0)::bigint AS "imported_5m!",
                floor(EXTRACT(EPOCH FROM now() - latest.last_imported_at))::bigint AS seconds_since_last_import
            FROM email_links l
            CROSS JOIN LATERAL (
                SELECT count(*) AS queued,
                    count(*) FILTER (WHERE available_at > now()) AS parked,
                    count(*) FILTER (WHERE lease_until > now()) AS leased,
                    min(available_at) FILTER (
                        WHERE available_at <= now() AND (lease_until IS NULL OR lease_until <= now())
                    ) AS oldest_due,
                    max(available_at) FILTER (WHERE available_at > now()) AS parked_until
                FROM email_message_reconciliation
                WHERE link_id = l.id AND generation = l.sync_generation
            ) q
            CROSS JOIN LATERAL (
                SELECT count(*) AS incomplete
                FROM email_sync_streams
                WHERE link_id = l.id AND generation = l.sync_generation
                    AND kind IN ('folder_catalog', 'mail_folder') AND NOT initial_complete
            ) s
            CROSS JOIN LATERAL (
                SELECT sum(imported) AS imported_5m
                FROM email_mailbox_import_minutes
                WHERE link_id = l.id AND minute > now() - interval '5 minutes'
            ) recent
            -- A flush carries imports from at most the minute before it, so
            -- the latest import is in one of the two newest minutes.
            CROSS JOIN LATERAL (
                SELECT max(last_imported_at) AS last_imported_at
                FROM (
                    SELECT last_imported_at FROM email_mailbox_import_minutes
                    WHERE link_id = l.id ORDER BY minute DESC LIMIT 2
                ) newest
            ) latest
            WHERE l.provider = 'OUTLOOK' AND (l.is_sync_active OR q.queued > 0)
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
