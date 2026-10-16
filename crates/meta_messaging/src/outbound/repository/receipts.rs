//! Durable inbound receipts and out-of-order status reconciliation.

use super::*;

impl PgMessagingRepository {
    pub(super) async fn accept_receipt_impl(
        &self,
        provider: Provider,
        digest: &[u8],
        payload: &serde_json::Value,
    ) -> PortResult<()> {
        sqlx::query!(r#"
            INSERT INTO meta_messaging_receipt (id, provider, body_sha256, payload, routing_keys)
            VALUES ($1, $2, $3, $4, ARRAY(
                SELECT DISTINCT $2 || ':' || (account #>> '{}')
                FROM jsonb_path_query($4, CASE WHEN $2 = 'instagram'
                    THEN '$.entry[*].id'::jsonpath
                    ELSE '$.entry[*].changes[*].value.metadata.phone_number_id'::jsonpath END) account
                WHERE jsonb_typeof(account) = 'string'
            )) ON CONFLICT (provider, body_sha256) DO NOTHING
            "#, Uuid::now_v7(), provider.as_str(), digest, payload)
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    pub(super) async fn claim_receipt_impl(&self) -> PortResult<Option<ReceiptWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        // Only the short claim transaction is serialized. The durable leases cap
        // each account at two slots across replicas; provider I/O holds no DB lock.
        sqlx::query!("SELECT pg_advisory_xact_lock(1296389185, 1)")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        sqlx::query!(
            r#"WITH expired AS (
            SELECT id FROM meta_messaging_receipt WHERE status='processing'
                AND attempts>=20 AND lease_until<=now()
                AND error_code IS DISTINCT FROM 'account_state_changed'
            ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100
        ) UPDATE meta_messaging_receipt r SET status='failed',
            error_code='interrupted_receipt_retries_exhausted',lease_id=NULL,lease_until=NULL
          FROM expired WHERE r.id=expired.id"#
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        let token = Uuid::now_v7();
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT r.id FROM meta_messaging_receipt r
                WHERE (r.attempts < 20 OR r.error_code='account_state_changed')
                  AND r.created_at > now() - interval '30 days' AND r.payload_cleared_at IS NULL
                  AND r.available_at <= now()
                  AND (r.status='pending' OR (r.status='processing' AND r.lease_until<now()))
                  AND NOT EXISTS (
                    SELECT 1 FROM unnest(COALESCE(NULLIF(r.routing_keys,'{}'), ARRAY[r.provider])) account
                    WHERE (SELECT count(*) FROM meta_messaging_receipt busy
                        WHERE busy.status='processing' AND busy.lease_until>now()
                          AND COALESCE(NULLIF(busy.routing_keys,'{}'),ARRAY[busy.provider]) @> ARRAY[account]
                    ) >= 2
                  )
                ORDER BY r.available_at,r.id FOR UPDATE SKIP LOCKED LIMIT 1
            ) UPDATE meta_messaging_receipt r SET status='processing',lease_id=$1,
                lease_until=LEAST(now()+interval '5 minutes',created_at+interval '30 days'),attempts=LEAST(20,attempts+1)
              FROM candidate c WHERE r.id=c.id
              RETURNING r.id,r.provider,r.payload,r.attempts,r.created_at
            "#, token).fetch_optional(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        row.map(|r| {
            Ok(ReceiptWork {
                received_at: r.created_at,
                lease: Lease { id: r.id, token },
                provider: decode(serde_json::Value::String(r.provider))?,
                payload: r.payload,
                attempts: r.attempts as u16,
            })
        })
        .transpose()
    }
    pub(super) async fn settle_receipt_impl(
        &self,
        lease: &Lease,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        let result=sqlx::query!("UPDATE meta_messaging_receipt SET status = CASE WHEN $4::integer IS NOT NULL AND (attempts < 20 OR $3='account_state_changed') AND created_at>now()-interval '30 days' THEN 'pending' WHEN $3::text IS NULL AND decode_failures=0 THEN 'complete' ELSE 'failed' END, completed_at=CASE WHEN $3::text IS NULL AND decode_failures=0 THEN COALESCE(completed_at,now()) ELSE completed_at END, error_code = COALESCE($3,CASE WHEN decode_failures>0 THEN 'invalid_provider_payload' END), available_at = now() + make_interval(secs => COALESCE($4, 0)), lease_id = NULL, lease_until = NULL WHERE id = $1 AND lease_id = $2 AND lease_until > now() AND status = 'processing'", lease.id, lease.token, error, retry.map(|s| s.min(3600) as i32))
            .execute(&self.pool).await.map_err(failure)?;
        if result.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
    pub(super) async fn record_status_impl(
        &self,
        connection: Uuid,
        message: &ProviderId,
        state: DeliveryState,
        at: DateTime<Utc>,
        error: Option<&str>,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        // Share ingestion's connection lock: simultaneous status updates and
        // native materialization must observe each other's committed evidence.
        sqlx::query!(
            "SELECT id FROM meta_messaging_connection WHERE id = $1 FOR UPDATE",
            connection
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!("INSERT INTO meta_messaging_status (connection_id,provider_message_id,state,occurred_at,error_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (connection_id,provider_message_id,state) DO UPDATE SET occurred_at = GREATEST(meta_messaging_status.occurred_at, EXCLUDED.occurred_at)", connection, message.as_str(), spelling(state), at, error)
            .execute(&mut *tx).await.map_err(failure)?;
        let states = sqlx::query_scalar!("SELECT state FROM meta_messaging_status WHERE connection_id = $1 AND provider_message_id = $2",connection,message.as_str()).fetch_all(&mut *tx).await.map_err(failure)?;
        let mut merged = DeliveryState::Pending;
        for state in states {
            merged = merged.reconcile(decode(serde_json::Value::String(state))?);
        }
        sqlx::query!("UPDATE meta_messaging_message SET delivery_state = $3 WHERE connection_id = $1 AND provider_message_id = $2",connection,message.as_str(),spelling(merged)).execute(&mut *tx).await.map_err(failure)?;
        let effective_error = if merged == DeliveryState::Failed {
            error
        } else {
            None
        };
        sqlx::query!("UPDATE meta_messaging_send SET state = $3, error_code = $4, updated_at = now() WHERE connection_id = $1 AND provider_message_id = $2",connection,message.as_str(),spelling(merged),effective_error).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
}
