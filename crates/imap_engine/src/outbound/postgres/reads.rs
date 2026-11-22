//! Consistent operation-scoped reads, independent from synchronization leases.
use super::*;
impl PgRepository {
    pub(super) async fn begin_read(
        &self,
        binding: Binding,
    ) -> Result<(sqlx::Transaction<'_, sqlx::Postgres>, Account), Error> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        sqlx::query!("SET LOCAL statement_timeout = '30s'")
            .execute(&mut *tx)
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        sqlx::query!("SET LOCAL idle_in_transaction_session_timeout = '10s'")
            .execute(&mut *tx)
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let account = Self::read_account(&mut tx, binding).await?;
        Ok((tx, account))
    }
    pub(super) async fn read_account(
        connection: &mut sqlx::PgConnection,
        binding: Binding,
    ) -> Result<Account, Error> {
        let row = sqlx::query!(
            r#"
            SELECT
                a.user_id,
                a.credential_ciphertext,
                a.state,
                a.revision
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
            binding.link_id,
            binding.sync_generation,
            binding.grant_generation,
        )
        .fetch_optional(&mut *connection)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::Conflict)?;
        Ok(Account {
            binding,
            user_id: row.user_id,
            ciphertext: row.credential_ciphertext,
            state: serde_json::from_value(row.state).map_err(|_| Error::ConnectionUnavailable)?,
            checkpoint: Default::default(),
            revision: row.revision,
            lease_id: None,
        })
    }
}
