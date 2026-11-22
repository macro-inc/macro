use super::*;
use email_api_client::domain::models::FolderRole;

impl PgMailboxSync {
    pub(super) async fn claim_catalog_lease(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<CatalogLease>, MailboxError> {
        let mut tx = self.begin_claim().await?;
        let row = sqlx::query!(
            r#"
            WITH candidate AS (
                SELECT
                    s.id
                FROM
                    email_sync_streams s
                    JOIN email_links l ON l.id = s.link_id
                WHERE
                    l.is_sync_active
                    AND NOT l.needs_reauth
                    AND l.provider = $2::text::email_user_provider_enum
                    AND s.provider = $2::text::email_user_provider_enum
                    AND s.generation = l.sync_generation
                    AND s.kind = 'folder_catalog'
                    AND s.next_run_at <= now()
                    AND (s.provider_retry_at IS NULL OR s.provider_retry_at <= now())
                    AND (s.next_run_at,
                        s.id) >= (
                        SELECT
                            COALESCE(h.due, raw.due),
                            COALESCE(h.id, raw.id)
                        FROM (
                            SELECT
                                r.next_run_at AS due,
                                r.id,
                                r.link_id,
                                r.generation,
                                r.lease_until
                            FROM
                                email_sync_streams r
                            WHERE
                                r.provider = $2::text::email_user_provider_enum
                                AND r.kind = 'folder_catalog'
                                AND r.next_run_at <= now()
                                AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                            ORDER BY
                                r.next_run_at,
                                r.id
                            LIMIT 1) raw
                    LEFT JOIN email_links ok ON ok.id = raw.link_id
                        AND ok.sync_generation = raw.generation
                        AND ok.provider = $2::text::email_user_provider_enum
                        AND ok.is_sync_active
                        AND NOT ok.needs_reauth
                        AND (raw.lease_until IS NULL
                            OR raw.lease_until < now())
                    LEFT JOIN LATERAL (
                        SELECT
                            first.due,
                            first.id
                        FROM
                            email_links l
                            CROSS JOIN LATERAL (
                                SELECT
                                    scoped.due,
                                    scoped.id
                                FROM (
                                    SELECT
                                        r.next_run_at AS due,
                                        r.id
                                    FROM
                                        email_sync_streams r
                                    WHERE
                                        r.link_id = l.id
                                        AND r.generation = l.sync_generation
                                        AND r.kind = 'folder_catalog'
                                        AND r.next_run_at <= now()
                                        AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                        AND (r.lease_until IS NULL
                                            OR r.lease_until < now())
                                        OFFSET 0) scoped
                                ORDER BY
                                    scoped.due,
                                    scoped.id
                                LIMIT 1)
                            first
                        WHERE
                            ok.id IS NULL
                            AND l.provider = $2::text::email_user_provider_enum
                            AND l.is_sync_active
                            AND NOT l.needs_reauth
                        ORDER BY
                            first.due,
                            first.id
                        LIMIT 1) h ON true
                WHERE
                    ok.id IS NOT NULL
                    OR h.id IS NOT NULL)
                AND (s.lease_until IS NULL
                    OR s.lease_until < now())
            ORDER BY
                s.next_run_at,
                s.id
            LIMIT 1
            FOR UPDATE
                OF s SKIP LOCKED
            )
            UPDATE
                email_sync_streams s
            SET
                lease_id = $1,
                lease_until = now() + interval '3 minutes',
                lease_started_at = clock_timestamp(),
                leased_notification_revision = s.notification_revision,
                provider_retry_at = NULL,
                fence = fence + 1
            FROM
                candidate c,
                email_links l
            WHERE
                s.id = c.id
                AND l.id = s.link_id
            RETURNING
                s.id,
                s.link_id,
                s.generation,
                l.grant_generation,
                s.fence
            "#,
            lease_id,
            self.provider.as_str(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
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
    ) -> Result<Option<ImportCompleted>, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
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
            UPDATE
                email_sync_streams s
            SET
                initial_complete = true,
                last_completed_at = now(),
                next_run_at = CASE
                    WHEN s.provider = 'IMAP' THEN CASE
                        WHEN s.notification_revision > s.leased_notification_revision THEN now()
                        ELSE now() + interval '5 minutes'
                    END
                    WHEN notified_at > lease_started_at THEN now()
                    ELSE now() + interval '5 minutes'
                END,
                lease_id = NULL,
                lease_until = NULL
            FROM
                email_links l
            WHERE
                s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND l.id = s.link_id AND s.generation = l.sync_generation
                AND l.is_sync_active AND l.grant_generation = $4
        "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            lease.mailbox.grant_generation,
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
            sqlx::query!(
                r#"
                INSERT INTO email_mailbox_folders (link_id, provider_id, parent_id, display_name, role, catalog_generation, total_item_count, sync_enabled)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (link_id, provider_id)
                    DO UPDATE SET
                        parent_id = EXCLUDED.parent_id,
                        display_name = EXCLUDED.display_name,
                        role = EXCLUDED.role,
                        catalog_generation = EXCLUDED.catalog_generation,
                        deleted_at = NULL,
                        total_item_count = EXCLUDED.total_item_count,
                        sync_enabled = EXCLUDED.sync_enabled
                "#,
                lease.mailbox.link_id,
                folder.id.as_str(),
                folder.parent_id.as_ref().map(ProviderId::as_str),
                folder.name,
                role_name(folder.role),
                lease.fence,
                folder.total_items.map(i64::from),
                folder.sync_enabled,
            )
                .execute(&mut *tx).await.map_err(db_error)?;
            if folder.sync_enabled {
                sqlx::query!(
                    r#"
                    INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id)
                        VALUES ($1, $2, $3, 'mail_folder', $4)
                    ON CONFLICT (link_id, generation, kind, scope_id)
                        DO NOTHING
                    "#,
                    macro_uuid::generate_uuid_v7(),
                    lease.mailbox.link_id,
                    lease.mailbox.sync_generation,
                    folder.id.as_str(),
                )
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            }
        }
        let deleted = sqlx::query_scalar!(
            r#"
            UPDATE email_mailbox_folders SET deleted_at = now()
            WHERE link_id = $1 AND catalog_generation <> $2 AND deleted_at IS NULL
            RETURNING provider_id
        "#,
            lease.mailbox.link_id,
            lease.fence
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        // Only the discovery that sees a folder leave, or move in or out of
        // Deleted Items, rechecks its stored mail. Rechecking a deleted
        // folder's mail at every discovery would read what Graph already
        // answered every five minutes and revive mail it gave up on.
        let rechecked: Vec<String> = trash_changes.into_iter().chain(deleted).collect();
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import)
            SELECT link_id,$2,provider_id,false FROM email_messages
            WHERE link_id = $1 AND provider_folder_id = ANY($3) AND provider_id IS NOT NULL
            ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now(),is_import = false
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,&rechecked).execute(&mut *tx).await.map_err(db_error)?;
        // Stop polling missing or explicitly paused folders, and their live passes;
        // retained messages are handled by mailbox-wide reconciliation above,
        // not cascaded from folder deletion.
        sqlx::query!(
            r#"
            DELETE FROM email_sync_streams s USING email_mailbox_folders f
            WHERE s.link_id = $1
                AND s.generation = $2
                AND s.kind IN ('mail_folder', 'mail_folder_live')
                AND f.link_id = s.link_id
                AND f.provider_id = s.scope_id
                AND (f.deleted_at IS NOT NULL
                    OR NOT f.sync_enabled)
            "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        // A link marked as having no mailbox has one again: the work its
        // claims skipped meanwhile is due at once.
        let found_mailbox = sqlx::query!(
            "UPDATE email_links SET mailbox_unavailable_at = NULL,updated_at = now() WHERE id = $1 AND mailbox_unavailable_at IS NOT NULL",
            lease.mailbox.link_id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?
        .rows_affected()
            == 1;
        if found_mailbox {
            sqlx::query!(
                r#"
                UPDATE
                    email_sync_streams
                SET
                    next_run_at = GREATEST(now(), provider_retry_at)
                WHERE
                    link_id = $1 AND generation = $2 AND kind <> 'folder_catalog' AND next_run_at > now()
                "#,
                lease.mailbox.link_id,
                lease.mailbox.sync_generation,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            sqlx::query!(
                "UPDATE email_mailbox_watch_work SET next_run_at = now(),revision = revision + 1,failures = 0 WHERE link_id = $1",
                lease.mailbox.link_id
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            sqlx::query!(
                "UPDATE email_mailbox_settings_work SET next_run_at = now() WHERE link_id = $1",
                lease.mailbox.link_id
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        let import_completed = Self::settle_import(&mut tx, lease.mailbox).await?;
        tx.commit().await.map_err(db_error)?;
        Ok(import_completed)
    }

    pub(super) async fn mark_catalog_without_mailbox(
        &self,
        lease: &CatalogLease,
    ) -> Result<u32, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        let marked_seconds = sqlx::query_scalar!(
            r#"
            UPDATE email_links l SET mailbox_unavailable_at = COALESCE(l.mailbox_unavailable_at, now()),
                updated_at = CASE WHEN l.mailbox_unavailable_at IS NULL THEN now() ELSE l.updated_at END
            FROM email_sync_streams s
            WHERE s.id = $4 AND s.lease_id = $5 AND s.fence = $6 AND s.lease_until > now()
                AND l.id = s.link_id AND s.generation = l.sync_generation
                AND l.id = $1 AND l.sync_generation = $2 AND l.grant_generation = $3 AND l.is_sync_active
            RETURNING floor(EXTRACT(EPOCH FROM now() - l.mailbox_unavailable_at))::bigint AS "marked_seconds!"
        "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            lease.mailbox.grant_generation,
            lease.id,
            lease.lease_id,
            lease.fence
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        .ok_or(MailboxError::Stale)?;
        tx.commit().await.map_err(db_error)?;
        Ok(u32::try_from(marked_seconds.max(0)).unwrap_or(u32::MAX))
    }

    pub(super) async fn release_catalog_lease(
        &self,
        lease: &CatalogLease,
        retry: SyncRetry,
    ) -> Result<(), MailboxError> {
        sqlx::query!(
            r#"
            UPDATE
                email_sync_streams
            SET
                lease_id = NULL,
                lease_until = NULL,
                provider_retry_at = CASE
                    WHEN provider = 'IMAP' AND $5 THEN GREATEST(provider_retry_at, now() + make_interval(secs => $4))
                    ELSE provider_retry_at
                END,
                next_run_at = CASE
                    WHEN provider = 'IMAP' THEN GREATEST(
                        CASE
                            WHEN NOT $5 AND notification_revision > leased_notification_revision THEN clock_timestamp()
                            ELSE now() + make_interval(secs => $4)
                        END,
                        provider_retry_at
                    )
                    ELSE now() + make_interval(secs => $4)
                END
            WHERE
                id = $1
                AND lease_id = $2
                AND fence = $3
            "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            f64::from(retry.seconds()),
            retry.is_provider(),
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?;
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
