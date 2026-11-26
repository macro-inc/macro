//! Indexed move candidates, fenced to the original leased synchronization pass.
use super::*;
use crate::domain::fingerprint::FINGERPRINT_LOOKUP_BATCH;
impl PgRepository {
    pub(super) async fn lookup_fingerprints(
        &self,
        account: &Account,
        fingerprints: &[MessageFingerprint],
    ) -> Result<Vec<Location>, Error> {
        let lease = account.lease_id.ok_or(Error::Conflict)?;
        if fingerprints.len() > FINGERPRINT_LOOKUP_BATCH {
            return Err(Error::Invalid);
        }
        if fingerprints.is_empty() {
            return Ok(Vec::new());
        }
        let _capacity = self
            .loading_capacity
            .acquire()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query!("SET LOCAL lock_timeout = '1s'")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query!("SET LOCAL idle_in_transaction_session_timeout = '10s'")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        let valid = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM imap_accounts a
                JOIN imap_current_links l ON l.id = a.link_id
                WHERE a.link_id = $1
                    AND a.sync_generation = $2
                    AND a.grant_generation = $3
                    AND a.lease_id = $4
                    AND a.lease_until > now()
                    AND a.revision = $5
                    AND l.macro_id = a.user_id
                    AND NOT l.needs_reauth
                    AND l.sync_generation = a.sync_generation
                    AND l.grant_generation = a.grant_generation
            ) AS "valid!"
            "#,
            account.binding.link_id,
            account.binding.sync_generation,
            account.binding.grant_generation,
            lease,
            account.revision,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        if !valid {
            return Err(Error::Conflict);
        }
        let digests = fingerprints
            .iter()
            .map(|value| value.as_bytes().to_vec())
            .collect::<Vec<_>>();
        let rows = sqlx::query_file!(
            "src/outbound/postgres/location_fingerprints.sql",
            account.binding.link_id,
            &digests
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        let mut locations = Vec::with_capacity(rows.len());
        for row in rows {
            let fingerprint = MessageFingerprint::from_bytes(
                row.fingerprint
                    .as_deref()
                    .ok_or(Error::ConnectionUnavailable)?,
            )?;
            let location = storage::decode_location(row.document, fingerprint)?;
            if location.storage_key() != row.key {
                return Err(Error::ConnectionUnavailable);
            }
            locations.push(location);
        }
        tx.commit().await.map_err(db_error)?;
        Ok(locations)
    }
}
