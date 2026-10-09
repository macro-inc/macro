use super::*;
use email_api_client::domain::models::FolderRole;

impl PgMailboxSync {
    pub(super) async fn claim_catalog_lease(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<CatalogLease>, MailboxError> {
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT s.id FROM email_sync_streams s JOIN email_links l ON l.id = s.link_id
                WHERE l.is_sync_active AND l.provider = 'OUTLOOK' AND s.generation = l.sync_generation
                    AND s.kind = 'folder_catalog' AND s.next_run_at <= now()
                    AND (s.lease_until IS NULL OR s.lease_until < now())
                ORDER BY s.next_run_at, s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED
            )
            UPDATE email_sync_streams s SET lease_id = $1, lease_until = now() + interval '3 minutes', lease_started_at = clock_timestamp(), fence = fence + 1
            FROM candidate c, email_links l WHERE s.id = c.id AND l.id = s.link_id
            RETURNING s.id,s.link_id,s.generation,l.grant_generation,s.fence
        "#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        Ok(row.map(|row| CatalogLease {
            id: row.id,
            mailbox: MailboxKey {
                link_id: row.link_id,
                sync_generation: row.generation,
                grant_generation: row.grant_generation,
            },
            lease_id,
            fence: row.fence,
        }))
    }

    pub(super) async fn commit_catalog_lease(
        &self,
        lease: &CatalogLease,
        folders: &[MailFolder],
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        // Serialize against disconnect/reconnect before touching the shared catalog.
        let current = sqlx::query!(
            r#"
            SELECT id FROM email_links WHERE id = $1 AND sync_generation = $2
                AND grant_generation = $3 AND is_sync_active FOR UPDATE
        "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            lease.mailbox.grant_generation
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        if current.is_none() {
            return Err(MailboxError::Stale);
        }
        let advanced = sqlx::query!(
            r#"
            UPDATE email_sync_streams s SET initial_complete = true,last_completed_at = now(),
                next_run_at = CASE WHEN notified_at > lease_started_at THEN now() ELSE now() + interval '5 minutes' END,lease_id = NULL,lease_until = NULL
            FROM email_links l WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND l.id = s.link_id AND s.generation = l.sync_generation
                AND l.is_sync_active AND l.grant_generation = $4
        "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            lease.mailbox.grant_generation
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if advanced.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        let old_trash = sqlx::query_scalar!(r#"
            WITH RECURSIVE trash(provider_id) AS (
                SELECT provider_id FROM email_mailbox_folders WHERE link_id=$1 AND role='trash' AND deleted_at IS NULL
                UNION
                SELECT f.provider_id FROM email_mailbox_folders f JOIN trash t ON f.parent_id=t.provider_id
                WHERE f.link_id=$1 AND f.deleted_at IS NULL
            ) SELECT provider_id AS "provider_id!" FROM trash
        "#,lease.mailbox.link_id).fetch_all(&mut *tx).await.map_err(db_error)?;
        let mut trash_changes = old_trash
            .iter()
            .cloned()
            .collect::<std::collections::HashSet<_>>();
        for folder in folders {
            if MailFolder::effective_role(folders, Some(&folder.id)) == FolderRole::Trash
                && !trash_changes.remove(folder.id.as_str())
            {
                trash_changes.insert(folder.id.as_str().to_owned());
            }
        }
        let trash_changes = trash_changes.into_iter().collect::<Vec<_>>();
        // Fences restart when a link creates a new sync generation. Clear scan
        // membership under the lock so an old equal fence cannot hide a removal.
        sqlx::query!(
            "UPDATE email_mailbox_folders SET catalog_generation = 0 WHERE link_id = $1",
            lease.mailbox.link_id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        for folder in folders {
            sqlx::query!(r#"
                INSERT INTO email_mailbox_folders (link_id,provider_id,parent_id,display_name,role,catalog_generation)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (link_id,provider_id) DO UPDATE SET parent_id = EXCLUDED.parent_id,
                    display_name = EXCLUDED.display_name,role = EXCLUDED.role,catalog_generation = EXCLUDED.catalog_generation,deleted_at = NULL
            "#,lease.mailbox.link_id,folder.id.as_str(),folder.parent_id.as_ref().map(ProviderId::as_str),folder.name,role_name(folder.role),lease.fence)
                .execute(&mut *tx).await.map_err(db_error)?;
            sqlx::query!(
                r#"
                INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id)
                VALUES ($1,$2,$3,'mail_folder',$4)
                ON CONFLICT (link_id,generation,kind,scope_id) DO NOTHING
            "#,
                macro_uuid::generate_uuid_v7(),
                lease.mailbox.link_id,
                lease.mailbox.sync_generation,
                folder.id.as_str()
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        sqlx::query!(
            r#"
            UPDATE email_mailbox_folders SET deleted_at = now()
            WHERE link_id = $1 AND catalog_generation <> $2 AND deleted_at IS NULL
        "#,
            lease.mailbox.link_id,
            lease.fence
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import)
            SELECT m.link_id,$2,m.provider_id,false FROM email_messages m
            JOIN email_mailbox_folders f ON f.link_id = m.link_id AND f.provider_id = m.provider_folder_id
            WHERE m.link_id = $1 AND (f.deleted_at IS NOT NULL OR f.provider_id=ANY($3)) AND m.provider_id IS NOT NULL
            ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now()
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,&trash_changes).execute(&mut *tx).await.map_err(db_error)?;
        // Stop polling folders that no longer exist; retained messages are handled
        // by mailbox-wide reconciliation above, not cascaded from folder deletion.
        sqlx::query!(r#"
            DELETE FROM email_sync_streams s USING email_mailbox_folders f
            WHERE s.link_id = $1 AND s.generation = $2 AND s.kind = 'mail_folder'
                AND f.link_id = s.link_id AND f.provider_id = s.scope_id AND f.deleted_at IS NOT NULL
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation).execute(&mut *tx).await.map_err(db_error)?;
        Self::queue_attachment_recheck(&mut tx, lease.mailbox).await?;
        tx.commit().await.map_err(db_error)
    }

    pub(super) async fn release_catalog_lease(
        &self,
        lease: &CatalogLease,
        delay: u32,
    ) -> Result<(), MailboxError> {
        sqlx::query!(r#"
            UPDATE email_sync_streams SET lease_id = NULL,lease_until = NULL,next_run_at = now() + make_interval(secs => $4)
            WHERE id = $1 AND lease_id = $2 AND fence = $3
        "#,lease.id,lease.lease_id,lease.fence,f64::from(delay)).execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }
}

fn role_name(role: FolderRole) -> &'static str {
    match role {
        FolderRole::Inbox => "inbox",
        FolderRole::Sent => "sent",
        FolderRole::Drafts => "drafts",
        FolderRole::Archive => "archive",
        FolderRole::Trash => "trash",
        FolderRole::Junk => "junk",
        FolderRole::Other => "other",
    }
}
