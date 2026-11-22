//! Generation-bound folder routing configuration and observed folder metadata.
use super::PgRepository;
use crate::domain::{
    account_settings::{
        FolderPreferences, ObservedFolder, SettingsRepository, UpdateFolderSettings,
    },
    models::{Binding, Error, Folder, MAX_FOLDER_CATALOG},
};

#[async_trait::async_trait]
impl SettingsRepository for PgRepository {
    async fn credentials_for_settings(&self, b: Binding) -> Result<(String, Vec<u8>), Error> {
        let row = sqlx::query!(
            r#"
            SELECT
                a.user_id,
                a.credential_ciphertext
            FROM
                imap_accounts a
                JOIN email_links l ON l.id = a.link_id
            WHERE
                a.link_id = $1
                AND a.sync_generation = $2
                AND a.grant_generation = $3
                AND l.macro_id = a.user_id
                AND l.provider = 'IMAP'
                AND l.is_sync_active
                AND l.disconnect_requested_at IS NULL
                AND l.deleting_at IS NULL
                AND l.sync_generation = a.sync_generation
                AND l.grant_generation = a.grant_generation
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::Conflict)?;
        Ok((row.user_id, row.credential_ciphertext))
    }

    async fn preferences(&self, b: Binding) -> Result<FolderPreferences, Error> {
        let row = sqlx::query!(
            r#"
            SELECT
                folder_preferences_revision,
                folder_role_overrides,
                excluded_folder_ids,
                watched_folder_ids
            FROM
                imap_accounts
            WHERE
                link_id = $1
                AND sync_generation = $2
                AND grant_generation = $3
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::NotFound)?;
        Ok(FolderPreferences {
            revision: row.folder_preferences_revision,
            role_overrides: serde_json::from_value(row.folder_role_overrides)
                .map_err(|_| Error::ConnectionUnavailable)?,
            excluded_folder_ids: serde_json::from_value(row.excluded_folder_ids)
                .map_err(|_| Error::ConnectionUnavailable)?,
            watched_folder_ids: serde_json::from_value(row.watched_folder_ids)
                .map_err(|_| Error::ConnectionUnavailable)?,
        })
    }

    async fn folders(&self, b: Binding) -> Result<Vec<ObservedFolder>, Error> {
        let records = sqlx::query!(
            r#"
            SELECT
                jsonb_set(e.document -> 'folder', '{role}', COALESCE(NULLIF (e.document -> 'detected_role', 'null'::jsonb), e.document -> 'folder' -> 'role')) AS "folder!",
                COALESCE((e.document ->> 'monitored')::boolean, true) AS "monitored!"
            FROM
                imap_state_entries e
                JOIN imap_accounts a ON a.link_id = e.link_id
            WHERE
                a.link_id = $1
                AND a.sync_generation = $2
                AND a.grant_generation = $3
                AND e.kind = 'folder'
            ORDER BY
                e.key
            LIMIT $4
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
            MAX_FOLDER_CATALOG as i64 + 1,
        ).fetch_all(&self.pool).await.map_err(|_| Error::ConnectionUnavailable)?;
        if records.len() > MAX_FOLDER_CATALOG {
            return Err(Error::Throttled);
        }
        records
            .into_iter()
            .map(|record| {
                let folder: Folder = serde_json::from_value(record.folder)
                    .map_err(|_| Error::ConnectionUnavailable)?;
                // A Gmail physical index may still back other included labels when its own feed is off.
                let monitored = record.monitored && folder.sync_enabled;
                Ok(ObservedFolder { folder, monitored })
            })
            .collect()
    }

    async fn update(&self, b: Binding, change: &UpdateFolderSettings) -> Result<i64, Error> {
        let roles = serde_json::to_value(&change.role_overrides).map_err(|_| Error::Invalid)?;
        let exclusions =
            serde_json::to_value(&change.excluded_folder_ids).map_err(|_| Error::Invalid)?;
        let watches =
            serde_json::to_value(&change.watched_folder_ids).map_err(|_| Error::Invalid)?;
        // Fence a snapshot started under the previous preferences as well as stale settings dialogs.
        sqlx::query_scalar!(
            r#"
            WITH changed AS (
                UPDATE
                    imap_accounts
                SET
                    folder_preferences_revision = folder_preferences_revision + 1,
                    revision = revision + 1,
                    folder_role_overrides = $5,
                    excluded_folder_ids = $6,
                    watched_folder_ids = $7,
                    state = imap_accounts.state - 'sync_retry_at',
                    updated_at = now()
                FROM
                    email_links l
                WHERE
                    imap_accounts.link_id = $1
                    AND imap_accounts.sync_generation = $2
                    AND imap_accounts.grant_generation = $3
                    AND folder_preferences_revision = $4
                    AND l.id = imap_accounts.link_id
                    AND l.macro_id = imap_accounts.user_id
                    AND l.provider = 'IMAP'
                    AND l.is_sync_active
                    AND l.disconnect_requested_at IS NULL
                    AND l.deleting_at IS NULL
                    AND l.sync_generation = imap_accounts.sync_generation
                    AND l.grant_generation = imap_accounts.grant_generation
                RETURNING
                    imap_accounts.link_id,
                    folder_preferences_revision
            )
            SELECT
                c.folder_preferences_revision AS "revision!"
            FROM
                changed c
                CROSS JOIN LATERAL pg_notify('imap_config_changed', c.link_id::text)
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
            change.expected_revision,
            roles,
            exclusions,
            watches,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::Conflict)
    }
}
