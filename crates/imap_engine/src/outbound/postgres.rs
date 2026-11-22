//! Compile-time checked, fenced persistence for the IMAP engine's own tables.
mod acquisition;
mod reads;
mod settings;
use crate::domain::{models::*, ports::*};
use sqlx::PgPool;
use uuid::Uuid;

/// Postgres storage. Every lookup includes the link or owner binding.
pub struct PgRepository {
    pool: PgPool,
    loading_capacity: tokio::sync::Semaphore,
}
impl PgRepository {
    /// Use the composition root's shared pool.
    pub fn new(pool: PgPool) -> Self {
        // Leave two production pool connections for ownership heartbeats and
        // cleanup while bounded command-state loads hold their transactions.
        let loading_slots = pool
            .options()
            .get_max_connections()
            .saturating_sub(2)
            .max(1);
        Self {
            pool,
            loading_capacity: tokio::sync::Semaphore::new(loading_slots as usize),
        }
    }
}
#[async_trait::async_trait]
impl Repository for PgRepository {
    async fn idle_state(
        &self,
        host_hash: &str,
    ) -> Result<Option<crate::domain::adaptive_idle::IdleState>, Error> {
        let state = sqlx::query_scalar!(
            r#"
            SELECT
                state
            FROM
                imap_idle_hosts
            WHERE
                host_hash = $1
            "#,
            host_hash,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        state
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| Error::ConnectionUnavailable)
    }
    async fn save_idle_state(
        &self,
        host_hash: &str,
        state: &crate::domain::adaptive_idle::IdleState,
    ) -> Result<(), Error> {
        let state = serde_json::to_value(state).map_err(|_| Error::Invalid)?;
        sqlx::query!(
            r#"
            INSERT INTO imap_idle_hosts (host_hash, state)
                VALUES ($1, $2)
            ON CONFLICT (host_hash)
                DO UPDATE SET
                    state = EXCLUDED.state,
                    updated_at = now()
            "#,
            host_hash,
            state,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        sqlx::query!(
            r#"
            DELETE FROM imap_idle_hosts
            WHERE host_hash IN (
                    SELECT
                        host_hash
                    FROM
                        imap_idle_hosts
                    WHERE
                        updated_at < now() - interval '30 days'
                    ORDER BY
                        updated_at
                    LIMIT 100)
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(())
    }

    async fn claim_owner(&self, b: Binding, owner: Uuid) -> Result<bool, Error> {
        let row=sqlx::query!(
            r#"
            INSERT INTO imap_account_owners (link_id, owner_id, sync_generation, grant_generation, lease_until)
            SELECT
                a.link_id,
                $4,
                a.sync_generation,
                a.grant_generation,
                now() + interval '360 seconds'
            FROM
                imap_accounts a
                JOIN email_links l ON l.id = a.link_id
            WHERE
                a.link_id = $1
                AND a.sync_generation = $2
                AND a.grant_generation = $3
                AND l.provider = 'IMAP'
                AND l.is_sync_active
                AND NOT l.needs_reauth
                AND l.sync_generation = a.sync_generation
                AND l.grant_generation = a.grant_generation
            ON CONFLICT (link_id)
                DO UPDATE SET
                    owner_id = EXCLUDED.owner_id,
                    sync_generation = EXCLUDED.sync_generation,
                    grant_generation = EXCLUDED.grant_generation,
                    lease_until = EXCLUDED.lease_until
                WHERE
                    imap_account_owners.owner_id = $4
                    OR imap_account_owners.lease_until < now()
                RETURNING
                    link_id
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
            owner,
        ).fetch_optional(&self.pool).await.map_err(|_|Error::ConnectionUnavailable)?;
        Ok(row.is_some())
    }
    async fn release_owner(&self, b: Binding, owner: Uuid) -> Result<(), Error> {
        sqlx::query!(
            r#"
            DELETE FROM imap_account_owners
            WHERE link_id = $1
                AND owner_id = $2
            "#,
            b.link_id,
            owner,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(())
    }
    async fn admit_verification(&self, scopes: &[(String, i32)]) -> Result<(), Error> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        for (scope, limit) in scopes {
            let admitted = sqlx::query!(
                r#"
                INSERT INTO imap_verification_limits (scope_hash, window_start, attempts)
                    VALUES ($1, date_bin ('15 minutes', now(), '2000-01-01'::timestamptz), 1)
                ON CONFLICT (scope_hash, window_start)
                    DO UPDATE SET
                        attempts = imap_verification_limits.attempts + 1
                    WHERE
                        imap_verification_limits.attempts < $2
                    RETURNING
                        attempts
                "#,
                scope,
                limit,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
            if admitted.is_none() {
                return Err(Error::Throttled);
            }
        }
        sqlx::query!(
            r#"
            DELETE FROM imap_verification_limits
            WHERE (scope_hash, window_start) IN (
                    SELECT
                        scope_hash,
                        window_start
                    FROM
                        imap_verification_limits
                    WHERE
                        window_start < now() - interval '1 day'
                    ORDER BY
                        window_start
                    LIMIT 500)
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        tx.commit().await.map_err(|_| Error::ConnectionUnavailable)
    }
    async fn put_verification(&self, v: VerifiedAccount) -> Result<(), Error> {
        sqlx::query!(
            r#"
            INSERT INTO imap_verifications (id, user_id, credential_ciphertext, expires_at)
                VALUES ($1, $2, $3, $4)
            "#,
            v.verification.id,
            v.user_id,
            v.ciphertext,
            v.verification.expires_at,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        sqlx::query!(
            r#"
            DELETE FROM imap_verifications
            WHERE id IN (
                    SELECT
                        id
                    FROM
                        imap_verifications
                    WHERE
                        expires_at < now()
                        AND consumed_by IS NULL
                    ORDER BY
                        expires_at
                    LIMIT 500)
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(())
    }
    async fn verification(&self, id: Uuid) -> Result<VerifiedAccount, Error> {
        let v = sqlx::query!(
            r#"
            SELECT
                id,
                user_id,
                credential_ciphertext,
                expires_at,
                consumed_by
            FROM
                imap_verifications
            WHERE
                id = $1
                AND (expires_at > now()
                    OR consumed_by IS NOT NULL)
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::NotFound)?;
        Ok(VerifiedAccount {
            verification: Verification {
                id: v.id,
                expires_at: v.expires_at,
            },
            user_id: v.user_id,
            ciphertext: v.credential_ciphertext,
            consumed_by: v.consumed_by,
        })
    }
    async fn connect(
        &self,
        b: Binding,
        owner: &str,
        ciphertext: Vec<u8>,
        verification: Uuid,
    ) -> Result<(), Error> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let v = sqlx::query!(
            r#"
            SELECT
                consumed_by
            FROM
                imap_verifications
            WHERE
                id = $1
                AND user_id = $2
                AND (expires_at > now()
                    OR consumed_by = $3)
            FOR UPDATE
            "#,
            verification,
            owner,
            b.link_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::Forbidden)?;
        if v.consumed_by.is_some_and(|link| link != b.link_id) {
            return Err(Error::Forbidden);
        }
        if v.consumed_by == Some(b.link_id) {
            let current = sqlx::query_scalar!(
                r#"
                SELECT
                    link_id
                FROM
                    imap_accounts
                WHERE
                    link_id = $1
                    AND user_id = $2
                    AND sync_generation = $3
                    AND grant_generation = $4
                "#,
                b.link_id,
                owner,
                b.sync_generation,
                b.grant_generation,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
            if current.is_none() {
                return Err(Error::Conflict);
            }
            tx.commit()
                .await
                .map_err(|_| Error::ConnectionUnavailable)?;
            return Ok(());
        }
        let state = serde_json::to_value(AccountState::default()).map_err(|_| Error::Invalid)?;
        let changed=sqlx::query!(
            r#"
            INSERT INTO imap_accounts (link_id, user_id, sync_generation, grant_generation, credential_ciphertext, state)
            SELECT
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
            WHERE
                EXISTS (
                    SELECT
                        1
                    FROM
                        email_links
                    WHERE
                        id = $1
                        AND macro_id = $2
                        AND provider = 'IMAP')
            ON CONFLICT (link_id)
                DO UPDATE SET
                    sync_generation = EXCLUDED.sync_generation,
                    grant_generation = EXCLUDED.grant_generation,
                    credential_ciphertext = EXCLUDED.credential_ciphertext,
                    state = jsonb_set(imap_accounts.state, '{needs_reauth}', 'false'::jsonb),
                    lease_id = NULL,
                    lease_until = NULL,
                    revision = imap_accounts.revision + 1,
                    folder_preferences_revision = imap_accounts.folder_preferences_revision + 1
                WHERE
                    imap_accounts.user_id = EXCLUDED.user_id
                    AND imap_accounts.sync_generation <= EXCLUDED.sync_generation
                    AND imap_accounts.grant_generation <= EXCLUDED.grant_generation
                    AND (imap_accounts.sync_generation < EXCLUDED.sync_generation
                        OR imap_accounts.grant_generation < EXCLUDED.grant_generation)
            "#,
            b.link_id,
            owner,
            b.sync_generation,
            b.grant_generation,
            ciphertext,
            state,
        ).execute(&mut *tx).await.map_err(|_|Error::ConnectionUnavailable)?.rows_affected();
        if changed != 1 {
            return Err(Error::Conflict);
        }
        sqlx::query!(
            r#"
            UPDATE
                imap_verifications
            SET
                consumed_by = $2,
                credential_ciphertext = decode('', 'hex')
            WHERE
                id = $1
            "#,
            verification,
            b.link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        tx.commit().await.map_err(|_| Error::ConnectionUnavailable)
    }
    async fn credentials(&self, b: Binding) -> Result<(String, Vec<u8>), Error> {
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
                AND NOT l.needs_reauth
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
    async fn acquire(&self, b: Binding) -> Result<Account, Error> {
        self.acquire_scoped(b, StateSelection::Sync).await
    }
    async fn acquire_scoped(
        &self,
        b: Binding,
        selection: StateSelection,
    ) -> Result<Account, Error> {
        let _loading = self
            .loading_capacity
            .acquire()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        // Claim and hydrate in one transaction. A loading timeout rolls back
        // the uncommitted lease instead of stranding it for five minutes.
        let (mut tx, mut account) = self.begin_acquisition(b).await?;
        self.hydrate(&mut tx, &mut account, selection).await?;
        tx.commit()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(account)
    }
    async fn read_scoped(
        &self,
        binding: Binding,
        selection: StateSelection,
    ) -> Result<Account, Error> {
        if matches!(selection, StateSelection::Sync) {
            return Err(Error::Invalid);
        }
        let _loading = self
            .loading_capacity
            .acquire()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let (mut tx, mut account) = self.begin_read(binding).await?;
        self.hydrate(&mut tx, &mut account, selection).await?;
        tx.commit()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(account)
    }
    async fn validate_read(&self, account: &Account) -> Result<(), Error> {
        let _loading = self
            .loading_capacity
            .acquire()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let mut connection = self
            .pool
            .acquire()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let current = Self::read_account(&mut connection, account.binding).await?;
        if current.user_id != account.user_id {
            return Err(Error::Conflict);
        }
        if current.state.needs_reauth {
            return Err(Error::CredentialsRejected);
        }
        Ok(())
    }
    async fn save(&self, a: &mut Account) -> Result<(), Error> {
        self.save_entries(a).await
    }
    async fn save_health(&self, a: &mut Account) -> Result<(), Error> {
        self.save_small_state(a).await
    }
    async fn renew(&self, a: &Account) -> Result<(), Error> {
        let lease = a.lease_id.ok_or(Error::Conflict)?;
        let renewed = sqlx::query!(
            r#"
            UPDATE
                imap_accounts a
            SET
                lease_until = now() + interval '5 minutes'
            FROM
                email_links l
            WHERE
                a.link_id = $1
                AND a.sync_generation = $2
                AND a.grant_generation = $3
                AND a.lease_id = $4
                AND a.revision = $5
                AND a.lease_until > now()
                AND l.id = a.link_id
                AND l.macro_id = a.user_id
                AND l.provider = 'IMAP'
                AND l.is_sync_active
                AND NOT l.needs_reauth
                AND l.sync_generation = a.sync_generation
                AND l.grant_generation = a.grant_generation
            "#,
            a.binding.link_id,
            a.binding.sync_generation,
            a.binding.grant_generation,
            lease,
            a.revision,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .rows_affected();
        if renewed != 1 {
            return Err(Error::Conflict);
        }
        Ok(())
    }
    async fn release(&self, a: &Account) -> Result<(), Error> {
        let lease = a.lease_id.ok_or(Error::Conflict)?;
        sqlx::query!(
            r#"
            UPDATE
                imap_accounts
            SET
                lease_id = NULL,
                lease_until = NULL
            WHERE
                link_id = $1
                AND lease_id = $2
            "#,
            a.binding.link_id,
            lease,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(())
    }
    async fn delete(&self, b: Binding) -> Result<(), Error> {
        sqlx::query!(
            r#"
            DELETE FROM imap_accounts
            WHERE link_id = $1
                AND sync_generation = $2
                AND grant_generation = $3
            "#,
            b.link_id,
            b.sync_generation,
            b.grant_generation,
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(())
    }
    async fn bindings(&self, limit: i64, retained_links: &[Uuid]) -> Result<Vec<Binding>, Error> {
        let limit = limit.clamp(0, 2000);
        let rows = sqlx::query!(
            r#"
            WITH retained AS MATERIALIZED (
                SELECT
                    a.link_id,
                    a.sync_generation,
                    a.grant_generation,
                    a.updated_at
                FROM
                    imap_accounts a
                    JOIN email_links l ON l.id = a.link_id
                WHERE
                    a.link_id = ANY (
                        $2
            )
                    AND l.macro_id = a.user_id
                    AND l.provider = 'IMAP'
                    AND l.is_sync_active
                    AND NOT l.needs_reauth
                    AND (
                        a.state ->> 'needs_reauth'
            ) IS DISTINCT FROM 'true'
                    AND a.sync_generation = l.sync_generation
                    AND a.grant_generation = l.grant_generation
                ORDER BY
                    a.updated_at,
                    a.link_id
                LIMIT $1
            ),
            candidates AS (
                SELECT
                    a.link_id,
                    a.sync_generation,
                    a.grant_generation,
                    a.updated_at
                FROM
                    imap_accounts a
                    JOIN email_links l ON l.id = a.link_id
                WHERE
                    NOT (a.link_id = ANY ($2))
                    AND l.macro_id = a.user_id
                    AND l.provider = 'IMAP'
                    AND l.is_sync_active
                    AND NOT l.needs_reauth
                    AND (a.state ->> 'needs_reauth') IS DISTINCT FROM 'true'
                    AND a.sync_generation = l.sync_generation
                    AND a.grant_generation = l.grant_generation
                    AND NOT EXISTS (
                        SELECT
                            1
                        FROM
                            imap_account_owners o
                        WHERE
                            o.link_id = a.link_id
                            AND o.lease_until > now())
                ORDER BY
                    a.updated_at,
                    a.link_id
                LIMIT greatest ($1 - (
                        SELECT
                            count(*)
                        FROM retained), 0)
            )
            SELECT
                link_id AS "link_id!",
                sync_generation AS "sync_generation!",
                grant_generation AS "grant_generation!"
            FROM (
                SELECT
                    retained.*,
                    0 AS priority
                FROM
                    retained
                UNION ALL
                SELECT
                    candidates.*,
                    1 AS priority
                FROM
                    candidates) batch
            ORDER BY
                priority,
                updated_at,
                link_id
            "#,
            limit,
            retained_links,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(rows
            .into_iter()
            .map(|r| Binding {
                link_id: r.link_id,
                sync_generation: r.sync_generation,
                grant_generation: r.grant_generation,
            })
            .collect())
    }
}

#[cfg(test)]
mod test;

mod storage;
