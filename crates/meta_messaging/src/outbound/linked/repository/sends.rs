use super::*;

impl PgLinkedRepository {
    /// Current consent and posting facts, rechecked after preparation.
    pub async fn eligible(&self, a: &AccountScope, c: &Conversation) -> PortResult<bool> {
        if !self.sending {
            return Ok(false);
        }
        let Some(p) = &a.personal else {
            return Ok(false);
        };
        sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_group_binding b
          JOIN whatsapp_group_membership m ON m.binding_id=b.id
          JOIN whatsapp_linked_account a ON a.id=m.account_id
          JOIN whatsapp_session_owner o ON o.account_id=a.id
          JOIN whatsapp_group_audience v ON v.binding_id=b.id AND v.user_id=a.user_id
          JOIN comms_channel_participants cp ON cp.channel_id=b.channel_id AND cp.user_id=a.user_id AND cp.left_at IS NULL
          JOIN team_user tu ON tu.team_id=b.team_id AND tu.user_id=a.user_id
          WHERE b.id=$1 AND b.channel_id=$2 AND b.state='active' AND b.ownership_state='active'
          AND a.id=$3 AND a.user_id=$4 AND a.state='connected' AND a.authorization_generation=$5
          AND o.epoch=$6 AND o.state='running' AND o.lease_until>clock_timestamp()
          AND m.authorization_generation=a.authorization_generation AND m.consent_ended_at IS NULL
          AND m.remote_member AND m.can_post AND m.reconciled AND m.observed_at>clock_timestamp()-interval '2 minutes'
          AND v.remote_member AND v.reconciled AND v.revoked_at IS NULL) AS "eligible!""#,
          c.connection_id,c.channel_id,a.id,p.user_id,p.authorization_generation,p.owner_epoch)
          .fetch_one(&self.pool).await.map_err(failure)
    }
    pub(super) async fn enqueue(
        &self,
        account: Uuid,
        channel: Uuid,
        user: &str,
        request: &SendReply,
        digest: &[u8],
    ) -> PortResult<SendProgress> {
        let c = self
            .conversation(channel)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let scope = self.account_for_sender(&c, user).await?;
        if scope.id != account || !self.eligible(&scope, &c).await? {
            return Err(MessagingError::Forbidden.into());
        }
        let p = scope.personal.ok_or(MessagingError::Forbidden)?;
        let payload = serde_json::to_value(request).map_err(failure)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        // Across all seven accounts, commit order and DB-time expiry start here.
        let sequence=sqlx::query_scalar!("UPDATE whatsapp_group_binding SET next_sequence=next_sequence+1 WHERE id=$1 AND channel_id=$2 AND state='active' RETURNING next_sequence",c.connection_id,channel).fetch_one(&mut *tx).await.map_err(failure)?;
        sqlx::query!("INSERT INTO meta_messaging_send(id,linked_account_id,linked_binding_id,channel_id,user_id,idempotency_key,request_sha256,payload,authorization_generation,owner_epoch,group_sequence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()) ON CONFLICT(channel_id,user_id,idempotency_key) DO NOTHING",Uuid::now_v7(),account,c.connection_id,channel,user,request.idempotency_key,digest,payload,p.authorization_generation,p.owner_epoch,sequence).execute(&mut *tx).await.map_err(failure)?;
        let row=sqlx::query!(r#"SELECT to_jsonb(s) AS "data!",request_sha256,linked_account_id,authorization_generation FROM meta_messaging_send s WHERE channel_id=$1 AND user_id=$2 AND idempotency_key=$3 FOR UPDATE"#,channel,user,request.idempotency_key).fetch_one(&mut *tx).await.map_err(failure)?;
        if row.request_sha256 != digest
            || row.linked_account_id != Some(account)
            || row.authorization_generation != Some(p.authorization_generation)
        {
            return Err(MessagingError::Conflict.into());
        }
        let result = decode(row.data)?;
        tx.commit().await.map_err(failure)?;
        self.queue.work_ready.sends.notify_one();
        Ok(result)
    }
    pub(super) async fn fence(
        &self,
        lease: &Lease,
        a: &AccountScope,
        c: &Conversation,
        text: &str,
    ) -> PortResult<()> {
        if !self.eligible(a, c).await? {
            return Err(MessagingError::Forbidden.into());
        }
        let p = a.personal.as_ref().ok_or(MessagingError::Forbidden)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT id FROM whatsapp_group_binding WHERE id=$1 FOR UPDATE",
            c.connection_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        let expired=sqlx::query!("UPDATE meta_messaging_send SET state='failed',error_code='send_expired',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2 AND dispatch_started_at IS NULL AND created_at<=clock_timestamp()-interval '10 minutes'",lease.id,lease.token).execute(&mut *tx).await.map_err(failure)?;
        if expired.rows_affected() == 1 {
            tx.commit().await.map_err(failure)?;
            return Err(MessagingError::SendExpired.into());
        }
        let changed=sqlx::query!(r#"UPDATE meta_messaging_send s SET dispatch_started_at=clock_timestamp(),payload=jsonb_set(payload,'{rendered_text}',to_jsonb($7::text))
          FROM whatsapp_linked_account a,whatsapp_session_owner o,whatsapp_group_membership m
          WHERE s.id=$1 AND s.lease_id=$2 AND s.lease_until>clock_timestamp() AND s.state='sending' AND s.dispatch_started_at IS NULL
          AND s.linked_account_id=$3 AND s.linked_binding_id=$4 AND s.authorization_generation=$5 AND s.owner_epoch=$6
          AND s.allocated_source_id IS NOT NULL AND a.id=$3 AND a.user_id=s.user_id AND a.authorization_generation=$5 AND a.state='connected'
          AND o.account_id=$3 AND o.epoch=$6 AND o.state='running' AND o.lease_until>clock_timestamp()
          AND m.binding_id=$4 AND m.account_id=$3 AND m.authorization_generation=$5 AND m.consent_ended_at IS NULL
          AND m.reconciled AND m.remote_member AND m.can_post AND m.observed_at>clock_timestamp()-interval '2 minutes'
          AND whatsapp_linked_can_view(s.channel_id,s.user_id)
          AND EXISTS(SELECT 1 FROM whatsapp_group_binding b WHERE b.id=s.linked_binding_id AND b.state='active' AND b.ownership_state='active')"#,
          lease.id,lease.token,a.id,c.connection_id,p.authorization_generation,p.owner_epoch,text).execute(&mut *tx).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        tx.commit().await.map_err(failure)
    }
}
