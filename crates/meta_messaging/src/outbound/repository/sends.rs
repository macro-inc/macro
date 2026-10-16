//! Outbound intents are idempotent locally. An expired network attempt becomes
//! Unknown, since neither an HTTP timeout nor process death proves non-delivery.

use super::*;

impl PgMessagingRepository {
    pub(super) async fn enqueue_send_impl(
        &self,
        connection: Uuid,
        channel: Uuid,
        user: &str,
        request: &SendReply,
        digest: &[u8],
    ) -> PortResult<SendProgress> {
        let payload = serde_json::to_value(request).map_err(failure)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        // Serialize enqueue commits for an account and assign DB time after the
        // lock. A later committed intent cannot precede an invisible older insert.
        sqlx::query!(
            "SELECT id FROM meta_messaging_connection WHERE id=$1 FOR UPDATE",
            connection
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!("INSERT INTO meta_messaging_send (id,connection_id,channel_id,user_id,idempotency_key,request_sha256,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) ON CONFLICT (channel_id,user_id,idempotency_key) DO NOTHING",Uuid::now_v7(),connection,channel,user,request.idempotency_key,digest,payload).execute(&mut *tx).await.map_err(failure)?;
        let row = sqlx::query!("SELECT to_jsonb(s) AS \"data!\", request_sha256 FROM meta_messaging_send s WHERE channel_id = $1 AND user_id = $2 AND idempotency_key = $3 FOR UPDATE",channel,user,request.idempotency_key).fetch_one(&mut *tx).await.map_err(failure)?;
        if row.request_sha256 != digest {
            return Err(MessagingError::Conflict.into());
        }
        let progress = decode(row.data)?;
        tx.commit().await.map_err(failure)?;
        Ok(progress)
    }
    pub(super) async fn sends_impl(&self, channel: Uuid) -> PortResult<Vec<SendProgress>> {
        sqlx::query!("SELECT to_jsonb(s) AS \"data!\" FROM meta_messaging_send s WHERE channel_id = $1 ORDER BY id DESC LIMIT 100",channel).fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|decode(r.data)).collect()
    }
    pub(super) async fn sends_for_messages_impl(
        &self,
        channel: Uuid,
        messages: &[Uuid],
    ) -> PortResult<Vec<SendProgress>> {
        sqlx::query!("SELECT to_jsonb(s) AS \"data!\" FROM meta_messaging_message m JOIN meta_messaging_send s ON s.connection_id = m.connection_id AND s.provider_message_id = m.provider_message_id AND s.message_id = m.message_id WHERE s.channel_id = $1 AND m.message_id = ANY($2)", channel, messages).fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|row| decode(row.data)).collect()
    }
    pub(super) async fn claim_send_impl(&self) -> PortResult<Option<SendWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!("SELECT pg_advisory_xact_lock(1296389185, 2)")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        // Uncertainty is terminal for dispatch. After a bounded lease it releases
        // the conversation; delivered/read receipts are never needed to proceed.
        sqlx::query!(r#"WITH expired AS (
            SELECT id FROM meta_messaging_send WHERE state='sending' AND (lease_until<=now() OR lease_until IS NULL)
            ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100
        ) UPDATE meta_messaging_send s SET
            state=CASE WHEN tracked_lease_id=lease_id AND dispatch_started_at IS NULL THEN 'pending' ELSE 'unknown' END,
            error_code=CASE WHEN tracked_lease_id=lease_id AND dispatch_started_at IS NULL THEN 'preparation_interrupted' ELSE 'interrupted_send_check_provider' END,
            lease_id=NULL,lease_until=NULL,available_at=now(),updated_at=now() FROM expired WHERE s.id=expired.id"#)
            .execute(&mut *tx).await.map_err(failure)?;
        // Only current, explicitly tracked claims prove they are unattempted.
        // Old workers leave a different tracked_lease_id and settle as Unknown.
        sqlx::query!(r#"WITH expired AS (
            SELECT id FROM meta_messaging_send WHERE created_at<=clock_timestamp()-make_interval(secs=>$1::integer)
              AND provider_message_id IS NULL
              AND (state='pending' OR (state='sending' AND tracked_lease_id=lease_id AND dispatch_started_at IS NULL))
            ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 100
        ) UPDATE meta_messaging_send s SET state='failed',error_code='send_expired',lease_id=NULL,lease_until=NULL,
            updated_at=clock_timestamp() FROM expired WHERE s.id=expired.id"#,crate::domain::policy::SEND_EXPIRY_SECONDS)
            .execute(&mut *tx).await.map_err(failure)?;
        let token = Uuid::now_v7();
        let row = sqlx::query!(
            r#"WITH candidate AS (
            SELECT s.id FROM meta_messaging_send s
            WHERE s.state='pending' AND s.available_at<=now() AND s.attempts<20
              AND NOT EXISTS (SELECT 1 FROM meta_messaging_send earlier
                  WHERE earlier.connection_id=s.connection_id AND earlier.channel_id=s.channel_id
                    AND earlier.state IN ('pending','sending')
                    AND (earlier.created_at,earlier.id)<(s.created_at,s.id))
              AND (SELECT count(*) FROM meta_messaging_send busy
                  WHERE busy.connection_id=s.connection_id AND busy.state='sending'
                    AND busy.lease_until>now()) < 2
            ORDER BY s.created_at,s.id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE meta_messaging_send s SET state='sending',lease_id=$1,tracked_lease_id=$1,dispatch_started_at=NULL,
            lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
          FROM candidate c WHERE s.id=c.id
          RETURNING s.id,s.connection_id,s.channel_id,s.user_id,s.created_at,s.payload,s.attempts
        "#,
            token
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        row.map(|r| {
            Ok(SendWork {
                lease: Lease { id: r.id, token },
                connection_id: r.connection_id,
                channel_id: r.channel_id,
                user_id: r.user_id,
                created_at: r.created_at,
                rendered_text: r
                    .payload
                    .get("rendered_text")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                request: decode(r.payload)?,
                attempts: r.attempts as u16,
            })
        })
        .transpose()
    }
    pub(super) async fn settle_send_impl(
        &self,
        lease: &Lease,
        state: DeliveryState,
        provider: Option<&ProviderId>,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        let state = if retry.is_some() {
            DeliveryState::Pending
        } else {
            state
        };
        let result = sqlx::query!("UPDATE meta_messaging_send SET state = $3, dispatch_started_at=CASE WHEN $3='pending' THEN NULL ELSE dispatch_started_at END, provider_message_id = COALESCE($4,provider_message_id), error_code = $5, available_at = now() + make_interval(secs => COALESCE($6,0)), lease_id = NULL, lease_until = NULL, updated_at = now() WHERE id = $1 AND lease_id = $2 AND lease_until > now() AND state = 'sending'",lease.id,lease.token,spelling(state),provider.map(ProviderId::as_str),error,retry.map(|s|s.min(3600) as i32))
            .execute(&self.pool).await.map_err(failure)?;
        if result.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
    pub(super) async fn defer_accepted_send_impl(
        &self,
        work: &SendWork,
        provider_id: &ProviderId,
    ) -> PortResult<()> {
        sqlx::query!("UPDATE meta_messaging_send SET native_retry_at=now()+interval '30 seconds' WHERE id=$1 AND connection_id=$2 AND channel_id=$3 AND provider_message_id=$4 AND state IN ('accepted','sent','delivered','read','failed') AND (message_id IS NULL OR EXISTS (SELECT 1 FROM meta_messaging_message m WHERE m.message_id=meta_messaging_send.message_id AND m.media_state='pending'))",work.lease.id,work.connection_id,work.channel_id,provider_id.as_str())
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    pub(super) async fn accepted_sends_impl(&self) -> PortResult<Vec<(SendWork, ProviderId)>> {
        // Retire finished acceptances so this once-a-second scan stays proportional
        // to recovery work rather than to every reply ever sent.
        sqlx::query!("UPDATE meta_messaging_send SET native_retry_at='infinity' WHERE native_retry_at<=now() AND provider_message_id IS NOT NULL AND message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meta_messaging_message m WHERE m.message_id=meta_messaging_send.message_id AND m.media_state='pending') AND state IN ('accepted','sent','delivered','read','failed')")
            .execute(&self.pool).await.map_err(failure)?;
        let rows=sqlx::query!("SELECT id, connection_id, channel_id, user_id, created_at, payload, provider_message_id, attempts FROM meta_messaging_send WHERE native_retry_at<=now() AND provider_message_id IS NOT NULL AND (message_id IS NULL OR EXISTS (SELECT 1 FROM meta_messaging_message m WHERE m.message_id=meta_messaging_send.message_id AND m.media_state='pending')) AND state IN ('accepted','sent','delivered','read','failed') ORDER BY native_retry_at,id LIMIT 50")
            .fetch_all(&self.pool).await.map_err(failure)?;
        rows.into_iter()
            .map(|r| {
                Ok((
                    SendWork {
                        lease: Lease {
                            id: r.id,
                            token: Uuid::nil(),
                        },
                        connection_id: r.connection_id,
                        channel_id: r.channel_id,
                        user_id: r.user_id,
                        created_at: r.created_at,
                        rendered_text: r
                            .payload
                            .get("rendered_text")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned),
                        request: decode(r.payload)?,
                        attempts: r.attempts as u16,
                    },
                    r.provider_message_id
                        .ok_or(MessagingError::Unavailable)?
                        .try_into()?,
                ))
            })
            .collect()
    }
}
