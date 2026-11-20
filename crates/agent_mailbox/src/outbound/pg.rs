//! Postgres storage for agent mailboxes and their send ledger.

#[cfg(test)]
mod test;

use chrono::{DateTime, Duration, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AgentMailbox, AgentMailboxId, EncryptedMailboxKey, LocalPart, MailboxProvider, MailboxState,
    ProviderGrantId, ProviderMailboxId, ProviderMessageId, ProvisionRequest, ProvisionedMailbox,
    ProvisioningFailure, Reservation, SendKind, SendLimits, SendReservation, SentMessage,
    StoredGrant,
};
use crate::domain::ports::{AgentDirectory, AgentMailboxRepository};

/// A storage failure.
#[derive(Debug, thiserror::Error)]
pub enum PgAgentMailboxError {
    /// The database failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A stored value no longer parses; the row was written by other code.
    #[error("agent mailbox row has an unreadable {0}")]
    Corrupt(&'static str),
}

/// Agent mailboxes in MacroDB.
#[derive(Clone)]
pub struct PgAgentMailboxRepository {
    pool: PgPool,
}

impl PgAgentMailboxRepository {
    /// Use this pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct MailboxRow {
    id: Uuid,
    request_id: Uuid,
    user_id: String,
    provider: String,
    requested_local_part: Option<String>,
    display_name: Option<String>,
    provider_mailbox_id: Option<String>,
    address: Option<String>,
    grant_id: Option<String>,
    grant_key_ciphertext: Option<Vec<u8>>,
    grant_kms_key_id: Option<String>,
    grant_encryption_version: Option<i16>,
    state: String,
    last_error: Option<String>,
    paused_at: Option<DateTime<Utc>>,
}

impl TryFrom<MailboxRow> for AgentMailbox {
    type Error = PgAgentMailboxError;

    fn try_from(row: MailboxRow) -> Result<Self, Self::Error> {
        let agent = MacroUserIdStr::parse_from_str(&row.user_id)
            .map_err(|_| PgAgentMailboxError::Corrupt("user_id"))?
            .into_owned();
        let provider: MailboxProvider = row
            .provider
            .parse()
            .map_err(|_| PgAgentMailboxError::Corrupt("provider"))?;
        let state: MailboxState = row
            .state
            .parse()
            .map_err(|_| PgAgentMailboxError::Corrupt("state"))?;
        let last_error = row
            .last_error
            .map(|value| value.parse::<ProvisioningFailure>())
            .transpose()
            .map_err(|_| PgAgentMailboxError::Corrupt("last_error"))?;
        let requested_local_part = row
            .requested_local_part
            .map(|value| LocalPart::parse(&value))
            .transpose()
            .map_err(|_| PgAgentMailboxError::Corrupt("requested_local_part"))?;

        // The table's check constraint keeps the four grant columns together.
        let grant = match (
            row.grant_id,
            row.grant_key_ciphertext,
            row.grant_kms_key_id,
            row.grant_encryption_version,
        ) {
            (Some(id), Some(ciphertext), Some(kms_key_id), Some(encryption_version)) => {
                Some(StoredGrant {
                    id: ProviderGrantId(id),
                    key: EncryptedMailboxKey {
                        ciphertext,
                        kms_key_id,
                        encryption_version,
                    },
                })
            }
            (None, None, None, None) => None,
            _ => return Err(PgAgentMailboxError::Corrupt("grant")),
        };

        Ok(AgentMailbox {
            id: AgentMailboxId(row.id),
            request_id: row.request_id,
            agent,
            provider,
            requested_local_part,
            display_name: row.display_name,
            provider_mailbox_id: row.provider_mailbox_id.map(ProviderMailboxId),
            address: row.address,
            grant,
            state,
            last_error,
            paused_at: row.paused_at,
        })
    }
}

impl PgAgentMailboxRepository {
    async fn by_request(
        &self,
        request_id: Uuid,
    ) -> Result<Option<AgentMailbox>, PgAgentMailboxError> {
        let row = sqlx::query_as!(
            MailboxRow,
            r#"
            SELECT id, request_id, user_id, provider, requested_local_part, display_name,
                   provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                   grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            FROM agent_mailboxes
            WHERE request_id = $1
            "#,
            request_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(AgentMailbox::try_from).transpose()
    }
}

impl AgentMailboxRepository for PgAgentMailboxRepository {
    type Err = PgAgentMailboxError;

    #[tracing::instrument(skip_all, fields(agent_mailbox.request_id = %request.request_id), err)]
    async fn reserve(
        &self,
        request: &ProvisionRequest,
        id: AgentMailboxId,
    ) -> Result<Reservation, Self::Err> {
        // Both unique indexes (request id, one live mailbox per user) settle
        // races: a losing insert does nothing, and the reads below say why.
        let inserted = sqlx::query_as!(
            MailboxRow,
            r#"
            INSERT INTO agent_mailboxes (id, request_id, user_id, provider, requested_local_part, display_name, state)
            VALUES ($1, $2, $3, $4, $5, $6, 'provisioning')
            ON CONFLICT DO NOTHING
            RETURNING id, request_id, user_id, provider, requested_local_part, display_name,
                      provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                      grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            "#,
            id.0,
            request.request_id,
            request.agent.as_ref(),
            MailboxProvider::DeadSimple.as_ref(),
            request.requested_local_part.as_ref().map(LocalPart::as_str),
            request.display_name.as_deref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        if let Some(row) = inserted {
            return Ok(Reservation::New(row.try_into()?));
        }

        if let Some(existing) = self.by_request(request.request_id).await? {
            return Ok(Reservation::Existing(existing));
        }
        match self.live_mailbox(&request.agent).await? {
            Some(other) => Ok(Reservation::AgentHasMailbox(other)),
            // The conflicting row was released between the insert and the reads.
            None => Err(PgAgentMailboxError::Database(sqlx::Error::RowNotFound)),
        }
    }

    async fn live_mailbox(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<AgentMailbox>, Self::Err> {
        let row = sqlx::query_as!(
            MailboxRow,
            r#"
            SELECT id, request_id, user_id, provider, requested_local_part, display_name,
                   provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                   grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            FROM agent_mailboxes
            WHERE user_id = $1 AND state <> 'released'
            "#,
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(AgentMailbox::try_from).transpose()
    }

    async fn record_created(
        &self,
        id: AgentMailboxId,
        mailbox: &ProvisionedMailbox,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET provider_mailbox_id = $2, address = $3, updated_at = now()
            WHERE id = $1
            "#,
            id.0,
            mailbox.id.0,
            mailbox.address,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn activate(&self, id: AgentMailboxId, grant: &StoredGrant) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET grant_id = $2,
                grant_key_ciphertext = $3,
                grant_kms_key_id = $4,
                grant_encryption_version = $5,
                state = 'active',
                last_error = NULL,
                updated_at = now()
            WHERE id = $1 AND state IN ('provisioning', 'failed')
            "#,
            id.0,
            grant.id.0,
            grant.key.ciphertext,
            grant.key.kms_key_id,
            grant.key.encryption_version,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn record_failure(
        &self,
        id: AgentMailboxId,
        state: MailboxState,
        failure: ProvisioningFailure,
    ) -> Result<(), Self::Err> {
        // Only a mailbox still being provisioned records a provisioning
        // failure; a pause or release that won the race stays.
        sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET state = $2, last_error = $3, updated_at = now()
            WHERE id = $1 AND state IN ('provisioning', 'failed')
            "#,
            id.0,
            state.as_ref(),
            failure.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn transition(
        &self,
        id: AgentMailboxId,
        from: &[MailboxState],
        to: MailboxState,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let from: Vec<String> = from.iter().map(ToString::to_string).collect();
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET state = $3::text,
                paused_at = CASE WHEN $3::text = 'paused' THEN $4::timestamptz ELSE NULL END,
                updated_at = $4::timestamptz
            WHERE id = $1 AND state = ANY($2)
            "#,
            id.0,
            &from,
            to.as_ref(),
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn clear_grant(&self, id: AgentMailboxId) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET grant_id = NULL,
                grant_key_ciphertext = NULL,
                grant_kms_key_id = NULL,
                grant_encryption_version = NULL,
                updated_at = now()
            WHERE id = $1 AND state <> 'active'
            "#,
            id.0,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn due_for_sweep(
        &self,
        stalled_before: DateTime<Utc>,
        paused_before: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<AgentMailbox>, Self::Err> {
        let rows = sqlx::query_as!(
            MailboxRow,
            r#"
            SELECT id, request_id, user_id, provider, requested_local_part, display_name,
                   provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                   grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            FROM agent_mailboxes
            WHERE (state = 'provisioning' AND updated_at < $1)
               OR state = 'releasing'
               OR (state = 'paused' AND paused_at < $2)
            ORDER BY updated_at
            LIMIT $3
            "#,
            stalled_before,
            paused_before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(AgentMailbox::try_from).collect()
    }

    #[tracing::instrument(skip_all, fields(agent_mailbox.id = %mailbox), err)]
    async fn reserve_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
        kind: SendKind,
        limits: SendLimits,
        now: DateTime<Utc>,
    ) -> Result<SendReservation, Self::Err> {
        let mut transaction = self.pool.begin().await?;

        // One send decision at a time per mailbox, so two concurrent sends
        // cannot both take the last slot.
        sqlx::query!(
            "SELECT id FROM agent_mailboxes WHERE id = $1 FOR UPDATE",
            mailbox.0
        )
        .fetch_one(&mut *transaction)
        .await?;

        let existing = sqlx::query!(
            r#"
            SELECT provider_message_id, provider_thread_id
            FROM agent_mailbox_sends
            WHERE mailbox_id = $1 AND idempotency_key = $2
            "#,
            mailbox.0,
            idempotency_key,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing) = existing {
            transaction.commit().await?;
            return Ok(match existing.provider_message_id {
                Some(id) => SendReservation::AlreadySent(SentMessage {
                    id: ProviderMessageId(id),
                    thread_id: existing.provider_thread_id,
                }),
                None => SendReservation::Proceed,
            });
        }

        let hour_start = now - Duration::hours(1);
        let day_start = now - Duration::days(1);
        let window = sqlx::query!(
            r#"
            SELECT count(*) FILTER (WHERE created_at > $2) AS "hour_count!",
                   min(created_at) FILTER (WHERE created_at > $2) AS hour_oldest,
                   count(*) AS "day_count!",
                   min(created_at) AS day_oldest
            FROM agent_mailbox_sends
            WHERE mailbox_id = $1 AND created_at > $3
            "#,
            mailbox.0,
            hour_start,
            day_start,
        )
        .fetch_one(&mut *transaction)
        .await?;

        let hour_full = window.hour_count >= i64::from(limits.per_hour);
        let day_full = window.day_count >= i64::from(limits.per_day);
        let retry_at = if hour_full {
            window.hour_oldest.map(|oldest| oldest + Duration::hours(1))
        } else if day_full {
            window.day_oldest.map(|oldest| oldest + Duration::days(1))
        } else {
            None
        };
        if let Some(retry_at) = retry_at {
            transaction.commit().await?;
            return Ok(SendReservation::LimitReached { retry_at });
        }

        sqlx::query!(
            r#"
            INSERT INTO agent_mailbox_sends (mailbox_id, idempotency_key, kind, created_at)
            VALUES ($1, $2, $3, $4)
            "#,
            mailbox.0,
            idempotency_key,
            kind.as_ref(),
            now,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(SendReservation::Proceed)
    }

    async fn complete_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
        sent: &SentMessage,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE agent_mailbox_sends
            SET provider_message_id = $3, provider_thread_id = $4
            WHERE mailbox_id = $1 AND idempotency_key = $2
            "#,
            mailbox.0,
            idempotency_key,
            sent.id.0,
            sent.thread_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn cancel_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM agent_mailbox_sends
            WHERE mailbox_id = $1 AND idempotency_key = $2 AND provider_message_id IS NULL
            "#,
            mailbox.0,
            idempotency_key,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn prune_sends(&self, before: DateTime<Utc>) -> Result<u64, Self::Err> {
        let result = sqlx::query!(
            "DELETE FROM agent_mailbox_sends WHERE created_at < $1",
            before
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }
}

/// Reads whether an account is an agent's from `"User"`.
#[derive(Clone)]
pub struct PgAgentDirectory {
    pool: PgPool,
}

impl PgAgentDirectory {
    /// Use this pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentDirectory for PgAgentDirectory {
    type Err = sqlx::Error;

    async fn is_agent(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Self::Err> {
        let is_agent = sqlx::query_scalar!(
            r#"SELECT "isAgent" FROM "User" WHERE id = $1"#,
            user.as_ref()
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(is_agent.unwrap_or(false))
    }
}
