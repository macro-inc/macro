use super::*;
use crate::domain::mailbox::reimport::{
    FolderReimportRepository, LinkReimport, PhaseProgress, ReimportPhase,
};

#[cfg(test)]
mod test;

impl FolderReimportRepository for PgMailboxSync {
    async fn outlook_links(&self) -> Result<Vec<Uuid>, MailboxError> {
        sqlx::query_scalar!(
            "SELECT id FROM email_links WHERE provider = 'OUTLOOK' ORDER BY created_at, id"
        )
        .fetch_all(&self.db)
        .await
        .map_err(db_error)
    }

    async fn link_reimport(
        &self,
        link_id: Uuid,
        revision: i16,
    ) -> Result<LinkReimport, MailboxError> {
        // A stream is due when its round started before `revision`; rounds
        // started before revisions were recorded have none.
        let Some(row) = sqlx::query!(r#"
            SELECT l.provider = 'OUTLOOK' AS "outlook!", l.is_sync_active AND NOT l.needs_reauth AS "active!",
                l.sync_generation, l.grant_generation,
                EXISTS(SELECT 1 FROM email_sync_streams s WHERE s.link_id = l.id AND s.generation = l.sync_generation
                        AND s.kind IN ('folder_catalog','mail_folder') AND NOT s.initial_complete)
                    OR EXISTS(SELECT 1 FROM email_message_reconciliation q WHERE q.link_id = l.id AND q.generation = l.sync_generation
                        AND q.is_import AND q.available_at <> 'infinity') AS "importing!",
                due.inbox_and_sent AS "inbox_and_sent!", due.other_folders AS "other_folders!",
                (SELECT sum(f.total_item_count) FROM email_mailbox_folders f WHERE f.link_id = l.id AND f.deleted_at IS NULL)::bigint AS provider_items
            FROM email_links l
            CROSS JOIN LATERAL (
                SELECT count(*) FILTER (WHERE f.role IN ('inbox','sent')) AS inbox_and_sent,
                    count(*) FILTER (WHERE f.role NOT IN ('inbox','sent')) AS other_folders
                FROM email_sync_streams s JOIN email_mailbox_folders f ON f.link_id = s.link_id AND f.provider_id = s.scope_id
                WHERE s.link_id = l.id AND s.generation = l.sync_generation AND s.kind = 'mail_folder' AND f.deleted_at IS NULL
                    AND (s.reader_revision IS NULL OR s.reader_revision < $2)
            ) due
            WHERE l.id = $1
        "#,link_id,revision).fetch_optional(&self.db).await.map_err(db_error)? else {
            return Ok(LinkReimport::NotOutlook);
        };
        Ok(if !row.outlook {
            LinkReimport::NotOutlook
        } else if !row.active {
            LinkReimport::Inactive
        } else if row.importing {
            LinkReimport::Importing
        } else if row.inbox_and_sent == 0 && row.other_folders == 0 {
            LinkReimport::Current
        } else {
            LinkReimport::Due {
                mailbox: MailboxKey {
                    link_id,
                    sync_generation: row.sync_generation,
                    grant_generation: row.grant_generation,
                },
                inbox_and_sent: row.inbox_and_sent,
                other_folders: row.other_folders,
                provider_items: row.provider_items,
            }
        })
    }

    async fn restart_folders(
        &self,
        mailbox: MailboxKey,
        phase: ReimportPhase,
        revision: i16,
        last_phase: bool,
    ) -> Result<Option<u64>, MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        // The link lock orders this after catalog commits and page commits, as
        // resync is.
        let current = sqlx::query_scalar!(r#"
            SELECT id FROM email_links WHERE id = $1 AND provider = 'OUTLOOK' AND sync_generation = $2
                AND grant_generation = $3 AND is_sync_active AND NOT needs_reauth FOR UPDATE
        "#,mailbox.link_id,mailbox.sync_generation,mailbox.grant_generation).fetch_optional(&mut *tx).await.map_err(db_error)?;
        if current.is_none() {
            return Ok(None);
        }
        let importing = sqlx::query_scalar!(r#"
            SELECT EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id = $1 AND generation = $2
                    AND kind IN ('folder_catalog','mail_folder') AND NOT initial_complete)
                OR EXISTS(SELECT 1 FROM email_message_reconciliation WHERE link_id = $1 AND generation = $2
                    AND is_import AND available_at <> 'infinity') AS "importing!"
        "#,mailbox.link_id,mailbox.sync_generation).fetch_one(&mut *tx).await.map_err(db_error)?;
        if importing {
            return Ok(None);
        }
        // Resync's reset, for this phase's due folders: the fence and cleared
        // lease make a page still in flight from the old round stale. The
        // mailbox-wide attachment recheck runs once, after the link's last phase.
        let restarted = sqlx::query_scalar!(
            r#"
            UPDATE email_sync_streams s SET position = NULL, initial_complete = false,
                attachments_rechecked = s.attachments_rechecked AND NOT $5,
                next_run_at = now(), fence = s.fence + 1, lease_id = NULL, lease_until = NULL
            FROM email_mailbox_folders f
            WHERE s.link_id = $1 AND s.generation = $2 AND s.kind = 'mail_folder'
                AND f.link_id = s.link_id AND f.provider_id = s.scope_id AND f.deleted_at IS NULL
                AND (s.reader_revision IS NULL OR s.reader_revision < $3)
                AND (f.role IN ('inbox','sent')) = $4
            RETURNING s.scope_id
        "#,
            mailbox.link_id,
            mailbox.sync_generation,
            revision,
            phase == ReimportPhase::InboxAndSent,
            last_phase
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        if restarted.is_empty() {
            return Ok(Some(0));
        }
        let opened = sqlx::query!(
            r#"
            UPDATE email_sync_streams SET import_started_at = now(), import_completed_at = NULL
            WHERE link_id = $1 AND generation = $2 AND kind = 'folder_catalog'
        "#,
            mailbox.link_id,
            mailbox.sync_generation
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        // Without a catalog stream no import run can open, so nothing would
        // ever report this phase complete.
        if opened.rows_affected() == 0 {
            return Ok(None);
        }
        // A fresh round lists only what the folder holds now, so mail deleted
        // since the old round's last poll would never be removed. As
        // `reset_stream` does, recheck the restarted folders' known messages.
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import)
            SELECT link_id,$2,provider_id,true FROM email_messages
            WHERE link_id = $1 AND provider_folder_id = ANY($3) AND provider_id IS NOT NULL
            ON CONFLICT(link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now()
        "#,mailbox.link_id,mailbox.sync_generation,&restarted).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(Some(u64::try_from(restarted.len()).unwrap_or(u64::MAX)))
    }

    async fn phase_progress(&self, mailbox: MailboxKey) -> Result<PhaseProgress, MailboxError> {
        let row = sqlx::query!(r#"
            SELECT l.is_sync_active AND NOT l.needs_reauth AND l.sync_generation = $2 AS "current!",
                EXISTS(SELECT 1 FROM email_sync_streams s WHERE s.link_id = l.id AND s.generation = $2
                    AND s.kind = 'folder_catalog' AND s.import_completed_at IS NOT NULL) AS "settled!"
            FROM email_links l WHERE l.id = $1
        "#,mailbox.link_id,mailbox.sync_generation).fetch_optional(&self.db).await.map_err(db_error)?;
        Ok(match row {
            Some(row) if row.current && row.settled => PhaseProgress::Settled,
            Some(row) if row.current => PhaseProgress::Running,
            _ => PhaseProgress::Interrupted,
        })
    }
}
