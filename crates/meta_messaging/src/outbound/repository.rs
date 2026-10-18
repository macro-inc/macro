//! Meta-owned PostgreSQL state. Canonical messages and channels are written by
//! their own domains in the hosting composition root's transaction.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{
    connection::*,
    groups::{ConversationKind, GroupStatus},
    history::*,
    models::*,
    ports::*,
};

pub mod groups;
mod history;
pub mod identity;
pub mod media;
pub mod native;
mod receipts;
mod retention;
pub mod revisions;
mod sends;
mod subscription;
#[cfg(test)]
mod test;

/// Local wakeups after successful durable writes. Other replicas and lost wakeups
/// are covered by the worker's bounded sweep; these signals contain no work.
#[derive(Clone, Default)]
pub struct WorkReady {
    /// Newly committed webhook receipt or saved group request correlation.
    pub receipts: std::sync::Arc<tokio::sync::Notify>,
    /// Newly committed outbound intent.
    pub sends: std::sync::Arc<tokio::sync::Notify>,
    /// Explicitly requested history import.
    pub history: std::sync::Arc<tokio::sync::Notify>,
    /// Accepted replies and native effects awaiting recovery.
    pub recovery: std::sync::Arc<tokio::sync::Notify>,
}

/// PostgreSQL-backed messaging lifecycle and durable work queues.
#[derive(Clone)]
pub struct PgMessagingRepository {
    /// Shared MacroDB pool for cross-domain composition transactions.
    pub pool: PgPool,
    /// Local optimizations only; durable due-time claims remain authoritative.
    pub work_ready: WorkReady,
    subscription_slots: std::sync::Arc<tokio::sync::Semaphore>,
}

impl PgMessagingRepository {
    /// Use the same database as native channels and messages.
    pub fn new(pool: PgPool) -> Self {
        // A lifecycle guard holds a DB connection during bounded provider I/O.
        // Keep room for the guarded operation's ordinary queries, even under contention.
        let slots = (pool.options().get_max_connections() / 2).min(4) as usize;
        Self {
            pool,
            work_ready: WorkReady::default(),
            subscription_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(slots)),
        }
    }
}

pub(super) fn failure(
    error: impl std::error::Error + Send + Sync + 'static,
) -> rootcause::Report<MessagingError> {
    rootcause::Report::new(error).context(MessagingError::Unavailable)
}
pub(super) fn decode<T: DeserializeOwned>(value: serde_json::Value) -> PortResult<T> {
    serde_json::from_value(value).map_err(failure)
}
pub(super) fn spelling(value: impl serde::Serialize) -> String {
    serde_json::to_value(value)
        .expect("enum serialization")
        .as_str()
        .expect("string enum")
        .to_owned()
}

#[async_trait]
impl MessagingRepository for PgMessagingRepository {
    async fn update_identity(
        &self,
        c: &Connection,
        update: &crate::domain::events::IdentityUpdate,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        PgMessagingRepository::update_identity_in(&mut tx, c, update).await?;
        tx.commit().await.map_err(failure)
    }
    async fn observe_identity(
        &self,
        c: &Connection,
        customer: &ProviderId,
        phone: Option<&ProviderId>,
        at: chrono::DateTime<Utc>,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        PgMessagingRepository::observe_identity_in(&mut tx, c, customer, phone, at).await?;
        tx.commit().await.map_err(failure)
    }

    async fn lock_subscription(
        &self,
        c: &Connection,
    ) -> PortResult<Option<Box<dyn SubscriptionGuard>>> {
        self.lock_subscription_impl(c).await
    }
    async fn subscription_in_use(&self, c: &Connection) -> PortResult<bool> {
        self.subscription_in_use_impl(c).await
    }

    async fn registration_state(
        &self,
        c: &Connection,
        status: RegistrationStatus,
        error: Option<&str>,
    ) -> PortResult<()> {
        let changed=sqlx::query!(r#"UPDATE meta_messaging_connection SET registration_status=$3,
            registration_attempted_at=CASE WHEN $3 IN ('unconfirmed','rate_limited') THEN CASE WHEN registration_status IS DISTINCT FROM $3 THEN now() ELSE COALESCE(registration_attempted_at,now()) END ELSE NULL END,
            status=CASE WHEN $3='registered' THEN status ELSE 'connecting' END,
            health_error=$4,checked_at=now(),updated_at=now()
            WHERE id=$1 AND connected_at=$2 AND status NOT IN ('disconnected','revoked')"#,c.id,c.connected_at,spelling(status),error)
            .execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
    async fn history_import(&self, c: &Connection) -> PortResult<Option<HistoryImport>> {
        self.history_import_impl(c).await
    }
    async fn request_history_import(&self, c: &Connection, user: &str) -> PortResult<()> {
        self.request_history_import_impl(c, user).await?;
        self.work_ready.history.notify_one();
        Ok(())
    }
    async fn claim_history_import(&self) -> PortResult<Option<HistoryWork>> {
        self.claim_history_import_impl().await
    }
    async fn heartbeat_history_import(&self, lease: &Lease) -> PortResult<bool> {
        self.heartbeat_history_import_impl(lease).await
    }
    async fn checkpoint_history_import(
        &self,
        w: &HistoryWork,
        step: HistoryStep,
        cursor: Option<&str>,
    ) -> PortResult<()> {
        self.checkpoint_history_import_impl(w, step, cursor).await
    }
    async fn settle_history_import(
        &self,
        w: &HistoryWork,
        status: HistoryStatus,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        self.settle_history_import_impl(w, status, error, retry)
            .await
    }
    async fn history_message_identity(
        &self,
        connection: Uuid,
        message: &ProviderId,
    ) -> PortResult<Option<(ProviderId, crate::domain::events::Direction)>> {
        sqlx::query!("SELECT customer_id,direction FROM meta_messaging_message WHERE connection_id=$1 AND provider_message_id=$2",connection,message.as_str())
            .fetch_optional(&self.pool).await.map_err(failure)?.map(|r|Ok((r.customer_id.try_into()?,decode(serde_json::Value::String(r.direction))?))).transpose()
    }
    async fn history_consent_user(
        &self,
        c: &Connection,
        at: DateTime<Utc>,
        waiting: bool,
    ) -> PortResult<Option<String>> {
        self.history_consent_user_impl(c, at, waiting).await
    }
    async fn revoke_history_consent(&self, c: &Connection) -> PortResult<()> {
        self.revoke_history_consent_impl(c).await
    }
    async fn history_import_progress(
        &self,
        c: &Connection,
        progress: Option<u8>,
        declined: bool,
    ) -> PortResult<()> {
        self.history_import_progress_impl(c, progress, declined)
            .await
    }
    async fn history_media_unavailable(&self, c: &Connection) -> PortResult<()> {
        self.history_media_unavailable_impl(c).await
    }

    async fn connections(&self, team: Uuid) -> PortResult<Vec<Connection>> {
        sqlx::query!("SELECT to_jsonb(c) - 'credential' AS \"data!\" FROM meta_messaging_connection c WHERE team_id = $1 ORDER BY id DESC LIMIT 100", team)
            .fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r| decode(r.data)).collect()
    }
    async fn begin_authorization(&self, a: &OAuthAttempt) -> PortResult<()> {
        sqlx::query!("INSERT INTO meta_messaging_oauth (state_sha256, team_id, user_id, provider, reconnect_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (state_sha256) DO NOTHING",
            a.state_sha256, a.team_id, a.user_id, a.provider.as_str(), a.reconnect_id, a.expires_at)
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    async fn consume_authorization(
        &self,
        digest: &[u8],
        team: Uuid,
        user: &str,
    ) -> PortResult<OAuthAttempt> {
        let row = sqlx::query!("UPDATE meta_messaging_oauth SET consumed_at = now() WHERE state_sha256 = $1 AND team_id = $2 AND user_id = $3 AND expires_at > now() AND consumed_at IS NULL RETURNING provider, reconnect_id, expires_at", digest, team, user)
            .fetch_optional(&self.pool).await.map_err(failure)?.ok_or(MessagingError::Forbidden)?;
        Ok(OAuthAttempt {
            state_sha256: digest.to_vec(),
            team_id: team,
            user_id: user.to_owned(),
            provider: decode(serde_json::Value::String(row.provider))?,
            reconnect_id: row.reconnect_id,
            expires_at: row.expires_at,
        })
    }
    async fn connect(
        &self,
        connection: &Connection,
        encrypted: &[u8],
        reconnect: Option<Uuid>,
    ) -> PortResult<Connection> {
        let (_slot, mut tx) = self.connect_transaction(connection).await?;
        let existing = sqlx::query!("SELECT id, team_id, connected_at FROM meta_messaging_connection WHERE provider = $1 AND account_id = $2 FOR UPDATE", connection.provider.as_str(), connection.account_id.as_str())
            .fetch_optional(&mut *tx).await.map_err(failure)?;
        match existing {
            Some(ref row)
                if row.team_id == connection.team_id
                    && reconnect == Some(row.id)
                    && row.id == connection.id
                    && row.connected_at == connection.connected_at => {}
            Some(_) => return Err(MessagingError::Conflict.into()),
            None if reconnect.is_some() => return Err(MessagingError::Conflict.into()),
            None => {}
        }
        sqlx::query!(
            r#"INSERT INTO meta_messaging_connection (id,team_id,user_id,provider,account_id,business_account_id,display_name,credential,credential_expires_at,status,connected_at,developer_account,human_agent_approved,whatsapp_mode,registration_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'connecting',now(),$10,$11,$12,$13)
               ON CONFLICT (id) DO UPDATE SET credential = EXCLUDED.credential, credential_expires_at = EXCLUDED.credential_expires_at,
                   user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name, status = 'connecting',
                   human_agent_approved = EXCLUDED.human_agent_approved, whatsapp_mode=EXCLUDED.whatsapp_mode,
                   registration_status=CASE WHEN EXCLUDED.registration_status='registered' THEN 'registered'
                       WHEN meta_messaging_connection.registration_status IN ('unconfirmed','rate_limited') THEN meta_messaging_connection.registration_status ELSE EXCLUDED.registration_status END,
                   connected_at = now(), health_error = NULL, checked_at = NULL, updated_at = now()"#,
            connection.id, connection.team_id, connection.user_id, connection.provider.as_str(), connection.account_id.as_str(),
            connection.business_account_id.as_ref().map(ProviderId::as_str), connection.display_name, encrypted, connection.credential_expires_at, connection.developer_account, connection.human_agent_approved, connection.whatsapp_mode.map(spelling),connection.registration_status.map(spelling),
        ).execute(&mut *tx).await.map_err(failure)?;
        // Retry this account's failed inbound work after authorization is renewed.
        // Message identities deduplicate replay; outbound intents are never reset.
        sqlx::query!(r#"UPDATE meta_messaging_receipt SET status='pending',attempts=0,available_at=now(),error_code=NULL,lease_id=NULL,lease_until=NULL
            WHERE provider=$1 AND status='failed' AND error_code NOT IN ('invalid_provider_payload','identity_conflict') AND created_at>now()-interval '30 days' AND payload_cleared_at IS NULL AND
            (payload @> jsonb_build_object('entry',jsonb_build_array(jsonb_build_object('id',$2::text))) OR
             payload @> jsonb_build_object('entry',jsonb_build_array(jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('value',jsonb_build_object('metadata',jsonb_build_object('phone_number_id',$2::text))))))))"#,
            connection.provider.as_str(),connection.account_id.as_str()).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        self.connection(connection.id)
            .await?
            .ok_or_else(|| MessagingError::NotFound.into())
    }
    async fn connection(&self, id: Uuid) -> PortResult<Option<Connection>> {
        sqlx::query!("SELECT to_jsonb(c) - 'credential' AS \"data!\" FROM meta_messaging_connection c WHERE id = $1", id)
            .fetch_optional(&self.pool).await.map_err(failure)?.map(|r| decode(r.data)).transpose()
    }
    async fn account(&self, provider: Provider, id: &ProviderId) -> PortResult<Option<Connection>> {
        sqlx::query!("SELECT to_jsonb(c) - 'credential' AS \"data!\" FROM meta_messaging_connection c WHERE provider = $1 AND account_id = $2", provider.as_str(), id.as_str())
            .fetch_optional(&self.pool).await.map_err(failure)?.map(|r| decode(r.data)).transpose()
    }
    async fn credential(&self, id: Uuid) -> PortResult<Vec<u8>> {
        sqlx::query_scalar!("SELECT credential FROM meta_messaging_connection WHERE id = $1 AND status IN ('connected','connecting','error')", id)
            .fetch_optional(&self.pool).await.map_err(failure)?.flatten().ok_or_else(|| MessagingError::Disconnected.into())
    }
    async fn business_accounts(&self, id: &ProviderId) -> PortResult<Vec<Connection>> {
        sqlx::query!("SELECT to_jsonb(c) - 'credential' AS \"data!\" FROM meta_messaging_connection c WHERE provider = 'whatsapp' AND business_account_id = $1 LIMIT 100", id.as_str())
            .fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|decode(r.data)).collect()
    }
    async fn disconnect(&self, team: Uuid, id: Uuid) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let changed = sqlx::query!("UPDATE meta_messaging_connection SET status = 'disconnected', credential = NULL, credential_expires_at = NULL, updated_at = now() WHERE id = $1 AND team_id = $2", id, team)
            .execute(&mut *tx).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::NotFound.into());
        }
        sqlx::query!("UPDATE meta_messaging_send SET state = 'failed', error_code = 'account_disconnected', updated_at = now() WHERE connection_id = $1 AND state = 'pending'", id)
            .execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
    async fn disconnect_received(
        &self,
        c: &Connection,
        received_at: DateTime<Utc>,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let changed = sqlx::query!("UPDATE meta_messaging_connection SET status='disconnected',credential=NULL,credential_expires_at=NULL,updated_at=now() WHERE id=$1 AND team_id=$2 AND connected_at=$3 AND connected_at<=$4",c.id,c.team_id,c.connected_at,received_at)
            .execute(&mut *tx).await.map_err(failure)?;
        if changed.rows_affected() == 1 {
            sqlx::query!("UPDATE meta_messaging_send SET state = 'failed', error_code = 'account_disconnected', updated_at = now() WHERE connection_id = $1 AND state = 'pending'", c.id)
                .execute(&mut *tx).await.map_err(failure)?;
        }
        tx.commit().await.map_err(failure)
    }
    async fn health(
        &self,
        connection: &Connection,
        status: ConnectionStatus,
        error: Option<&str>,
    ) -> PortResult<()> {
        let changed=sqlx::query!("UPDATE meta_messaging_connection SET status = $2, health_error = $3, checked_at = now(), updated_at = now() WHERE id = $1 AND connected_at IS NOT DISTINCT FROM $4 AND status <> 'disconnected'", connection.id, spelling(status), error, connection.connected_at)
            .execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
    async fn refresh_credential(
        &self,
        connection: &Connection,
        encrypted: &[u8],
        expires: DateTime<Utc>,
    ) -> PortResult<()> {
        let changed=sqlx::query!("UPDATE meta_messaging_connection SET credential = $2, credential_expires_at = $3, checked_at = now(), updated_at = now() WHERE id = $1 AND connected_at IS NOT DISTINCT FROM $4 AND status = 'connected' AND credential IS NOT NULL", connection.id, encrypted, expires, connection.connected_at)
            .execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
    async fn maintenance_connections(&self) -> PortResult<Vec<Connection>> {
        // Transient check failures retry within minutes rather than the hourly cadence.
        sqlx::query!("SELECT to_jsonb(c) - 'credential' AS \"data!\" FROM meta_messaging_connection c WHERE status IN ('connecting','connected','error') AND (checked_at IS NULL OR checked_at < now() - interval '1 hour' OR (health_error = $1 AND checked_at < now() - interval '5 minutes')) ORDER BY checked_at NULLS FIRST LIMIT 10", crate::domain::health::ConnectionFailure::Temporary.code())
            .fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r| decode(r.data)).collect()
    }
    async fn accept_receipt(
        &self,
        provider: Provider,
        digest: &[u8],
        payload: &serde_json::Value,
    ) -> PortResult<()> {
        self.accept_receipt_impl(provider, digest, payload).await?;
        self.work_ready.receipts.notify_one();
        Ok(())
    }
    async fn claim_receipt(&self) -> PortResult<Option<ReceiptWork>> {
        self.claim_receipt_impl().await
    }
    async fn heartbeat_receipt(&self, lease: &Lease) -> PortResult<bool> {
        Ok(sqlx::query!("UPDATE meta_messaging_receipt SET lease_until = LEAST(now() + interval '5 minutes',created_at+interval '30 days') WHERE id = $1 AND lease_id = $2 AND lease_until > now() AND created_at>now()-interval '30 days' AND status = 'processing'",lease.id,lease.token).execute(&self.pool).await.map_err(failure)?.rows_affected()==1)
    }
    async fn cleanup_receipts(&self) -> PortResult<crate::domain::retention::ReceiptCleanup> {
        self.cleanup_receipts_impl().await
    }
    async fn record_receipt_decode_failures(&self, lease: &Lease, failures: u32) -> PortResult<()> {
        let changed=sqlx::query!("UPDATE meta_messaging_receipt SET decode_failures=GREATEST(decode_failures,$3) WHERE id=$1 AND lease_id=$2 AND lease_until>now() AND status='processing'",lease.id,lease.token,failures.min(i32::MAX as u32) as i32)
            .execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
    async fn settle_receipt(
        &self,
        lease: &Lease,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        self.settle_receipt_impl(lease, error, retry).await?;
        self.work_ready.recovery.notify_one();
        Ok(())
    }
    async fn record_status(
        &self,
        connection: Uuid,
        message: &ProviderId,
        state: DeliveryState,
        error: Option<&str>,
    ) -> PortResult<()> {
        self.record_status_impl(connection, message, state, error)
            .await
    }
    async fn customer_profile(
        &self,
        connection: Uuid,
        customer: &ProviderId,
    ) -> PortResult<Option<CustomerProfile>> {
        Ok(sqlx::query!("SELECT customer_display_name,customer_handle FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='direct' AND customer_id=$2",connection,customer.as_str()).fetch_optional(&self.pool).await.map_err(failure)?.map(|r|CustomerProfile{name:r.customer_display_name,handle:r.customer_handle}))
    }
    async fn media_stored(&self, connection: Uuid, message: &ProviderId) -> PortResult<bool> {
        Ok(sqlx::query_scalar!("SELECT media_state='stored' AS \"stored!\" FROM meta_messaging_message WHERE connection_id=$1 AND provider_message_id=$2",connection,message.as_str()).fetch_optional(&self.pool).await.map_err(failure)?.unwrap_or(false))
    }
}

#[async_trait]
impl ConversationRepository for PgMessagingRepository {
    async fn account_scope(
        &self,
        id: Uuid,
    ) -> PortResult<Option<crate::domain::replies::AccountScope>> {
        Ok(self.connection(id).await?.as_ref().map(Into::into))
    }
    async fn conversation(&self, channel: Uuid) -> PortResult<Option<Conversation>> {
        sqlx::query!("SELECT to_jsonb(c) AS \"data!\" FROM meta_messaging_conversation c WHERE channel_id = $1",channel)
            .fetch_optional(&self.pool).await.map_err(failure)?.map(|r| decode(r.data)).transpose()
    }
    async fn has_message(
        &self,
        conversation: &Conversation,
        message: &ProviderId,
    ) -> PortResult<bool> {
        sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM meta_messaging_message WHERE connection_id=$1 AND customer_id=$2 AND provider_message_id=$3 AND conversation_kind=$4) AS \"exists!\"",conversation.connection_id,conversation.customer_id.as_str(),message.as_str(),conversation.kind.as_ref()).fetch_one(&self.pool).await.map_err(failure)
    }
    async fn enqueue_send(
        &self,
        connection: Uuid,
        channel: Uuid,
        user: &str,
        request: &SendReply,
        digest: &[u8],
    ) -> PortResult<SendProgress> {
        let send = self
            .enqueue_send_impl(connection, channel, user, request, digest)
            .await?;
        self.work_ready.sends.notify_one();
        Ok(send)
    }
    async fn sends(&self, channel: Uuid) -> PortResult<Vec<SendProgress>> {
        self.sends_impl(channel).await
    }
    async fn sends_for_messages(
        &self,
        channel: Uuid,
        messages: &[Uuid],
    ) -> PortResult<Vec<SendProgress>> {
        self.sends_for_messages_impl(channel, messages).await
    }
    async fn claim_send(&self) -> PortResult<Option<SendWork>> {
        self.claim_send_impl().await
    }
    async fn accepted_sends(&self) -> PortResult<Vec<(SendWork, ProviderId)>> {
        self.accepted_sends_impl().await
    }
    async fn defer_accepted_send(
        &self,
        work: &SendWork,
        provider_id: &ProviderId,
    ) -> PortResult<()> {
        self.defer_accepted_send_impl(work, provider_id).await
    }
    async fn prepare_send(
        &self,
        lease: &Lease,
        c: &crate::domain::replies::AccountScope,
        conversation: &Conversation,
        rendered_text: &str,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        // Share the connection row lock with lifecycle changes. This commit is
        // the dispatch boundary, so a prior disconnect/reconnect wins atomically.
        let active = sqlx::query_scalar!("SELECT id FROM meta_messaging_connection WHERE id=$1 AND team_id=$2 AND connected_at=$3 AND status='connected' AND (whatsapp_mode IS DISTINCT FROM 'platform' OR registration_status='registered') FOR UPDATE",c.id,c.team_id,c.generation)
            .fetch_optional(&mut *tx).await.map_err(failure)?;
        if active.is_none() {
            return Err(MessagingError::Disconnected.into());
        }
        let invalid_route = conversation.kind==crate::domain::groups::ConversationKind::Direct && sqlx::query_scalar!(r#"SELECT
            EXISTS(SELECT 1 FROM meta_messaging_customer_alias WHERE connection_id=$1 AND identifier=$2 AND customer_id<>$2)
            OR EXISTS(SELECT 1 FROM meta_messaging_conversation v JOIN meta_messaging_connection c ON c.id=v.connection_id
                WHERE v.connection_id=$1 AND v.customer_id=$2 AND $3 AND c.provider='whatsapp'
                AND v.customer_phone_at IS NOT NULL AND v.customer_phone IS DISTINCT FROM v.customer_id) AS "invalid_route!""#,
            c.id,conversation.customer_id.as_str(),!conversation.customer_id.is_whatsapp_bsuid())
            .fetch_one(&mut *tx).await.map_err(failure)?;
        if invalid_route {
            return Err(MessagingError::IdentityConflict.into());
        }
        let routing=sqlx::query!("SELECT customer_id,customer_phone,kind AS \"kind: ConversationKind\",group_status AS \"group_status: GroupStatus\" FROM meta_messaging_conversation WHERE connection_id=$1 AND channel_id=$2",c.id,conversation.channel_id)
            .fetch_optional(&mut *tx).await.map_err(failure)?.ok_or(MessagingError::NotFound)?;
        if routing.kind == ConversationKind::Group
            && routing.group_status != Some(GroupStatus::Active)
        {
            return Err(MessagingError::GroupReadOnly.into());
        }
        if routing.kind != conversation.kind
            || routing.customer_id != conversation.customer_id.as_str()
            || routing.customer_phone != conversation.customer_phone
        {
            return Err(MessagingError::Unavailable.into());
        }
        let expired = sqlx::query_scalar!(r#"
            WITH fence AS MATERIALIZED (SELECT clock_timestamp() AS at),
            deadline AS (SELECT at, at - make_interval(secs => $5::integer) AS oldest FROM fence)
            UPDATE meta_messaging_send s SET
                state=CASE WHEN s.created_at<=f.oldest THEN 'failed' ELSE 'sending' END,
                error_code=CASE WHEN s.created_at<=f.oldest THEN 'send_expired' ELSE NULL END,
                payload=CASE WHEN s.created_at<=f.oldest THEN s.payload ELSE jsonb_set(s.payload,'{rendered_text}',to_jsonb($3::text)) END,
                dispatch_started_at=CASE WHEN s.created_at<=f.oldest THEN NULL ELSE f.at END,
                lease_id=CASE WHEN s.created_at<=f.oldest THEN NULL ELSE s.lease_id END,
                lease_until=CASE WHEN s.created_at<=f.oldest THEN NULL ELSE f.at+interval '5 minutes' END,
                updated_at=f.at
            FROM deadline f WHERE s.id=$1 AND s.lease_id=$2 AND s.lease_until>f.at
              AND s.dispatch_started_at IS NULL
              AND s.provider_message_id IS NULL AND s.state='sending' AND s.connection_id=$4
            RETURNING s.state='failed' AS "expired!"
            "#,lease.id,lease.token,rendered_text,c.id,crate::domain::policy::SEND_EXPIRY_SECONDS)
            .fetch_optional(&mut *tx).await.map_err(failure)?.ok_or(MessagingError::Conflict)?;
        tx.commit().await.map_err(failure)?;
        if expired {
            Err(MessagingError::SendExpired.into())
        } else {
            Ok(())
        }
    }
    async fn settle_send(
        &self,
        lease: &Lease,
        state: DeliveryState,
        provider_id: Option<&ProviderId>,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        self.settle_send_impl(lease, state, provider_id, error, retry)
            .await?;
        self.work_ready.recovery.notify_one();
        Ok(())
    }
}
