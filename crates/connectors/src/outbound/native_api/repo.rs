//! `api_app_connections`: one row per user and native API app, holding the
//! grant only as its envelope.

use crate::outbound::native_api::cipher::EncryptedGrant;
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::{PgPool, Postgres, Transaction};

#[cfg(test)]
mod test;

/// One stored connection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ApiAppRow {
    pub(crate) user: MacroUserIdStr<'static>,
    pub(crate) app: String,
    pub(crate) name: String,
    pub(crate) enabled: bool,
    /// The vendor refused the refresh token.
    pub(crate) needs_reauth: bool,
    pub(crate) access_expires_at: DateTime<Utc>,
    pub(crate) grant: EncryptedGrant,
}

/// What a finished sign-in stores.
pub(crate) struct NewGrant<'a> {
    pub(crate) user: &'a MacroUserIdStr<'static>,
    pub(crate) app: &'a str,
    /// The name a new row starts under; an existing row keeps its own.
    pub(crate) name: &'a str,
    pub(crate) access_expires_at: DateTime<Utc>,
    pub(crate) grant: &'a EncryptedGrant,
}

/// How long a refresh waits for another replica's refresh of the same row.
const LOCK_TIMEOUT: &str = "20s";

/// The table.
#[derive(Clone)]
pub(crate) struct ApiAppRepo {
    pool: PgPool,
}

/// A row read as the table holds it.
struct Stored {
    user_id: String,
    app: String,
    name: String,
    enabled: bool,
    needs_reauth: bool,
    access_expires_at: DateTime<Utc>,
    grant_ciphertext: Vec<u8>,
    encrypted_data_key: Vec<u8>,
    nonce: Vec<u8>,
    encryption_version: i16,
    kms_key_id: String,
}

impl Stored {
    fn row(self) -> Result<ApiAppRow, Report> {
        Ok(ApiAppRow {
            user: MacroUserIdStr::parse_from_str(&self.user_id)
                .map(|user| user.into_owned())
                .map_err(|_| rootcause::report!("an api_app_connections row names no user"))?,
            app: self.app,
            name: self.name,
            enabled: self.enabled,
            needs_reauth: self.needs_reauth,
            access_expires_at: self.access_expires_at,
            grant: EncryptedGrant {
                ciphertext: self.grant_ciphertext,
                encrypted_data_key: self.encrypted_data_key,
                nonce: self.nonce,
                encryption_version: self.encryption_version,
                kms_key_id: self.kms_key_id,
            },
        })
    }
}

impl ApiAppRepo {
    pub(crate) fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Every row the user holds, enabled or not.
    #[tracing::instrument(name = "connectors.api_app_rows", skip_all, err)]
    pub(crate) async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ApiAppRow>, Report> {
        let rows = sqlx::query_as!(
            Stored,
            r#"
            SELECT user_id, app, name, enabled, needs_reauth, access_expires_at,
                grant_ciphertext, encrypted_data_key, nonce, encryption_version, kms_key_id
            FROM api_app_connections
            WHERE user_id = $1
            ORDER BY app
            "#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Report::new)?;

        rows.into_iter().map(Stored::row).collect()
    }

    /// The user's row for `app`.
    #[tracing::instrument(name = "connectors.api_app_row", skip(self, user), err)]
    pub(crate) async fn get(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &str,
    ) -> Result<Option<ApiAppRow>, Report> {
        let row = sqlx::query_as!(
            Stored,
            r#"
            SELECT user_id, app, name, enabled, needs_reauth, access_expires_at,
                grant_ciphertext, encrypted_data_key, nonce, encryption_version, kms_key_id
            FROM api_app_connections
            WHERE user_id = $1 AND app = $2
            "#,
            user.as_ref(),
            app,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(Report::new)?;

        row.map(Stored::row).transpose()
    }

    /// Every user with an enabled row for `app`.
    #[tracing::instrument(name = "connectors.api_app_holders", skip(self), err)]
    pub(crate) async fn holders(&self, app: &str) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let users = sqlx::query_scalar!(
            r#"
            SELECT user_id
            FROM api_app_connections
            WHERE app = $1 AND enabled
            ORDER BY user_id
            "#,
            app,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Report::new)?;

        // One malformed user id must not hide every other holder.
        Ok(users
            .into_iter()
            .filter_map(|user| {
                MacroUserIdStr::parse_from_str(&user)
                    .map(|user| user.into_owned())
                    .inspect_err(|_| {
                        tracing::warn!(
                            "skipping an api_app_connections holder that is not a user id"
                        )
                    })
                    .ok()
            })
            .collect())
    }

    /// Store a finished sign-in's grant: a new row enabled under `name`, or
    /// the user's existing row turned on with the new grant, keeping its name.
    #[tracing::instrument(name = "connectors.api_app_store", skip_all, fields(app = new.app), err)]
    pub(crate) async fn store(&self, new: &NewGrant<'_>) -> Result<(), Report> {
        sqlx::query!(
            r#"
            INSERT INTO api_app_connections (
                user_id, app, name, access_expires_at,
                grant_ciphertext, encrypted_data_key, nonce, encryption_version, kms_key_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (user_id, app) DO UPDATE SET
                enabled = TRUE,
                needs_reauth = FALSE,
                access_expires_at = EXCLUDED.access_expires_at,
                grant_ciphertext = EXCLUDED.grant_ciphertext,
                encrypted_data_key = EXCLUDED.encrypted_data_key,
                nonce = EXCLUDED.nonce,
                encryption_version = EXCLUDED.encryption_version,
                kms_key_id = EXCLUDED.kms_key_id,
                updated_at = NOW()
            "#,
            new.user.as_ref(),
            new.app,
            new.name,
            new.access_expires_at,
            new.grant.ciphertext,
            new.grant.encrypted_data_key,
            new.grant.nonce,
            new.grant.encryption_version,
            new.grant.kms_key_id,
        )
        .execute(&self.pool)
        .await
        .map_err(Report::new)?;

        Ok(())
    }

    /// Turn the user's row for `app` on or off; answers whether there was one.
    #[tracing::instrument(name = "connectors.api_app_set_enabled", skip(self, user), err)]
    pub(crate) async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &str,
        enabled: bool,
    ) -> Result<bool, Report> {
        let changed = sqlx::query!(
            "UPDATE api_app_connections SET enabled = $3, updated_at = NOW() WHERE user_id = $1 AND app = $2",
            user.as_ref(),
            app,
            enabled,
        )
        .execute(&self.pool)
        .await
        .map_err(Report::new)?
        .rows_affected();

        Ok(changed > 0)
    }

    /// Rename the user's row for `app`; answers whether there was one.
    #[tracing::instrument(name = "connectors.api_app_rename", skip(self, user, name), err)]
    pub(crate) async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &str,
        name: &str,
    ) -> Result<bool, Report> {
        let changed = sqlx::query!(
            "UPDATE api_app_connections SET name = $3, updated_at = NOW() WHERE user_id = $1 AND app = $2",
            user.as_ref(),
            app,
            name,
        )
        .execute(&self.pool)
        .await
        .map_err(Report::new)?
        .rows_affected();

        Ok(changed > 0)
    }

    /// Delete the user's row for `app`, answering the grant it held.
    #[tracing::instrument(name = "connectors.api_app_delete", skip(self, user), err)]
    pub(crate) async fn delete(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &str,
    ) -> Result<Option<ApiAppRow>, Report> {
        let row = sqlx::query_as!(
            Stored,
            r#"
            DELETE FROM api_app_connections
            WHERE user_id = $1 AND app = $2
            RETURNING user_id, app, name, enabled, needs_reauth, access_expires_at,
                grant_ciphertext, encrypted_data_key, nonce, encryption_version, kms_key_id
            "#,
            user.as_ref(),
            app,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(Report::new)?;

        row.map(Stored::row).transpose()
    }

    /// Lock the user's row for `app` until the answer is committed or
    /// dropped, so only one replica spends its refresh token at a time.
    /// `None` when there is no row. The transaction holds a pooled
    /// connection while the caller refreshes; the source caps how many run
    /// at once.
    #[tracing::instrument(name = "connectors.api_app_lock", skip(self, user), err)]
    pub(crate) async fn lock(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &str,
    ) -> Result<Option<LockedRow>, Report> {
        let mut transaction = self.pool.begin().await.map_err(Report::new)?;
        sqlx::query!("SELECT set_config('lock_timeout', $1, true)", LOCK_TIMEOUT)
            .fetch_one(&mut *transaction)
            .await
            .map_err(Report::new)?;
        let row = sqlx::query_as!(
            Stored,
            r#"
            SELECT user_id, app, name, enabled, needs_reauth, access_expires_at,
                grant_ciphertext, encrypted_data_key, nonce, encryption_version, kms_key_id
            FROM api_app_connections
            WHERE user_id = $1 AND app = $2
            FOR UPDATE
            "#,
            user.as_ref(),
            app,
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(Report::new)?;

        Ok(match row {
            Some(row) => Some(LockedRow {
                row: row.row()?,
                transaction,
            }),
            None => None,
        })
    }
}

/// A row held under `FOR UPDATE`. Dropping it without committing leaves the
/// row as it was.
pub(crate) struct LockedRow {
    pub(crate) row: ApiAppRow,
    transaction: Transaction<'static, Postgres>,
}

impl LockedRow {
    /// Replace the grant with a refreshed one and release the row.
    #[tracing::instrument(name = "connectors.api_app_store_refreshed", skip_all, err)]
    pub(crate) async fn store(
        mut self,
        grant: &EncryptedGrant,
        access_expires_at: DateTime<Utc>,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE api_app_connections SET
                access_expires_at = $3,
                grant_ciphertext = $4,
                encrypted_data_key = $5,
                nonce = $6,
                encryption_version = $7,
                kms_key_id = $8,
                updated_at = NOW()
            WHERE user_id = $1 AND app = $2
            "#,
            self.row.user.as_ref(),
            self.row.app,
            access_expires_at,
            grant.ciphertext,
            grant.encrypted_data_key,
            grant.nonce,
            grant.encryption_version,
            grant.kms_key_id,
        )
        .execute(&mut *self.transaction)
        .await
        .map_err(Report::new)?;

        self.transaction.commit().await.map_err(Report::new)?;
        Ok(())
    }

    /// Record that the vendor refused the refresh token, and release the row.
    #[tracing::instrument(name = "connectors.api_app_mark_needs_reauth", skip_all, err)]
    pub(crate) async fn mark_needs_reauth(mut self) -> Result<(), Report> {
        sqlx::query!(
            "UPDATE api_app_connections SET needs_reauth = TRUE, updated_at = NOW() WHERE user_id = $1 AND app = $2",
            self.row.user.as_ref(),
            self.row.app,
        )
        .execute(&mut *self.transaction)
        .await
        .map_err(Report::new)?;

        self.transaction.commit().await.map_err(Report::new)?;
        Ok(())
    }
}
