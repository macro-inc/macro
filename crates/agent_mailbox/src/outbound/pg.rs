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
    ProvisioningFailure, Reservation, SendAttempt, SendLimits, SendReservation, SentMessage,
    StoredGrant, TeamId,
};
use crate::domain::ports::{AgentDirectory, AgentMailboxRepository, LeaseToken};

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
    team_id: Uuid,
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
            team: TeamId(row.team_id),
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
            SELECT id, request_id, user_id, team_id, provider, requested_local_part, display_name,
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
        team: TeamId,
        team_mailbox_limit: u32,
    ) -> Result<Reservation, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        // One provisioning decision at a time per team, so two agents can't
        // both take the team's last mailbox.
        lock_team(&mut transaction, team).await?;

        if let Some(existing) = self.by_request(request.request_id).await? {
            transaction.commit().await?;
            return Ok(Reservation::Existing(existing));
        }
        if let Some(other) = self.live_mailbox(&request.agent).await? {
            transaction.commit().await?;
            return Ok(Reservation::AgentHasMailbox(other));
        }
        let live = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM agent_mailboxes WHERE team_id = $1 AND state <> 'released'"#,
            team.0,
        )
        .fetch_one(&mut *transaction)
        .await?;
        if live >= i64::from(team_mailbox_limit) {
            transaction.commit().await?;
            return Ok(Reservation::TeamFull);
        }

        // Both unique indexes (request id, one live mailbox per user) still
        // settle a race with a request outside this team's lock.
        let inserted = sqlx::query_as!(
            MailboxRow,
            r#"
            INSERT INTO agent_mailboxes (id, request_id, user_id, team_id, provider, requested_local_part, display_name, state)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'provisioning')
            ON CONFLICT DO NOTHING
            RETURNING id, request_id, user_id, team_id, provider, requested_local_part, display_name,
                      provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                      grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            "#,
            id.0,
            request.request_id,
            request.agent.as_ref(),
            team.0,
            MailboxProvider::DeadSimple.as_ref(),
            request.requested_local_part.as_ref().map(LocalPart::as_str),
            request.display_name.as_deref(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        transaction.commit().await?;
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

    async fn mailbox(&self, id: AgentMailboxId) -> Result<Option<AgentMailbox>, Self::Err> {
        let row = sqlx::query_as!(
            MailboxRow,
            r#"
            SELECT id, request_id, user_id, team_id, provider, requested_local_part, display_name,
                   provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                   grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            FROM agent_mailboxes
            WHERE id = $1
            "#,
            id.0,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(AgentMailbox::try_from).transpose()
    }

    async fn live_mailbox(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<AgentMailbox>, Self::Err> {
        let row = sqlx::query_as!(
            MailboxRow,
            r#"
            SELECT id, request_id, user_id, team_id, provider, requested_local_part, display_name,
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

    async fn claim(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        now: DateTime<Utc>,
        ttl: Duration,
    ) -> Result<Option<AgentMailbox>, Self::Err> {
        let row = sqlx::query_as!(
            MailboxRow,
            r#"
            UPDATE agent_mailboxes
            SET lease_token = $2, lease_expires_at = $4
            WHERE id = $1
              AND state <> 'released'
              AND (lease_token IS NULL OR lease_expires_at < $3)
            RETURNING id, request_id, user_id, team_id, provider, requested_local_part, display_name,
                      provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                      grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            "#,
            id.0,
            token.0,
            now,
            now + ttl,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(AgentMailbox::try_from).transpose()
    }

    async fn unclaim(&self, id: AgentMailboxId, token: LeaseToken) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET lease_token = NULL, lease_expires_at = NULL
            WHERE id = $1 AND lease_token = $2
            "#,
            id.0,
            token.0,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn record_created(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        mailbox: &ProvisionedMailbox,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET provider_mailbox_id = $3, address = $4, updated_at = now()
            WHERE id = $1 AND lease_token = $2 AND state <> 'released'
            "#,
            id.0,
            token.0,
            mailbox.id.0,
            mailbox.address,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn record_grant(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        grant: &StoredGrant,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET grant_id = $3,
                grant_key_ciphertext = $4,
                grant_kms_key_id = $5,
                grant_encryption_version = $6,
                updated_at = now()
            WHERE id = $1 AND lease_token = $2 AND state <> 'released'
            "#,
            id.0,
            token.0,
            grant.id.0,
            grant.key.ciphertext,
            grant.key.kms_key_id,
            grant.key.encryption_version,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn activate(&self, id: AgentMailboxId, token: LeaseToken) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET state = 'active', last_error = NULL, updated_at = now()
            WHERE id = $1
              AND lease_token = $2
              AND state IN ('provisioning', 'failed')
              AND grant_id IS NOT NULL
            "#,
            id.0,
            token.0,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn record_failure(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        state: MailboxState,
        failure: ProvisioningFailure,
    ) -> Result<(), Self::Err> {
        // Only a mailbox still being provisioned records a provisioning
        // failure; a pause or release that won the race stays.
        sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET state = $3, last_error = $4, updated_at = now()
            WHERE id = $1 AND lease_token = $2 AND state IN ('provisioning', 'failed')
            "#,
            id.0,
            token.0,
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
                next_sweep_at = NULL,
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

    async fn release_if_paused_before(
        &self,
        id: AgentMailboxId,
        paused_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET state = 'releasing', paused_at = NULL, updated_at = $3
            WHERE id = $1 AND state = 'paused' AND paused_at < $2
            "#,
            id.0,
            paused_before,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn clear_grant(&self, id: AgentMailboxId, token: LeaseToken) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET grant_id = NULL,
                grant_key_ciphertext = NULL,
                grant_kms_key_id = NULL,
                grant_encryption_version = NULL,
                updated_at = now()
            WHERE id = $1 AND lease_token = $2 AND state = 'releasing'
            "#,
            id.0,
            token.0,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn finish_release(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_mailboxes
            SET state = 'released', updated_at = $3
            WHERE id = $1 AND lease_token = $2 AND state = 'releasing'
            "#,
            id.0,
            token.0,
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn due_for_sweep(
        &self,
        now: DateTime<Utc>,
        stalled_before: DateTime<Utc>,
        paused_before: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<AgentMailbox>, Self::Err> {
        let rows = sqlx::query_as!(
            MailboxRow,
            r#"
            SELECT id, request_id, user_id, team_id, provider, requested_local_part, display_name,
                      provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                      grant_kms_key_id, grant_encryption_version, state, last_error, paused_at
            FROM agent_mailboxes
            WHERE ((state = 'provisioning' AND updated_at < $2)
                   OR state = 'releasing'
                   OR (state = 'paused' AND paused_at < $3))
              AND (next_sweep_at IS NULL OR next_sweep_at <= $1)
            ORDER BY updated_at
            LIMIT $4
            "#,
            now,
            stalled_before,
            paused_before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(AgentMailbox::try_from).collect()
    }

    async fn defer_sweep(&self, id: AgentMailboxId, until: DateTime<Utc>) -> Result<(), Self::Err> {
        sqlx::query!(
            "UPDATE agent_mailboxes SET next_sweep_at = $2 WHERE id = $1",
            id.0,
            until,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(agent_mailbox.id = %mailbox.id, agent_mailbox.team_id = %mailbox.team), err)]
    async fn reserve_send(
        &self,
        mailbox: &AgentMailbox,
        attempt: &SendAttempt,
        limits: SendLimits,
        now: DateTime<Utc>,
        replayable_since: DateTime<Utc>,
    ) -> Result<SendReservation, Self::Err> {
        let mut transaction = self.pool.begin().await?;

        // One send decision at a time per team and per mailbox, so two
        // concurrent sends cannot both take the last slot. Always the team
        // first, then the mailbox.
        lock_team(&mut transaction, mailbox.team).await?;
        sqlx::query!(
            "SELECT id FROM agent_mailboxes WHERE id = $1 FOR UPDATE",
            mailbox.id.0
        )
        .fetch_one(&mut *transaction)
        .await?;

        // The audit record outlives the ledger, so a key stays bound to its
        // message even after a refusal freed the ledger row.
        let audited = sqlx::query_scalar!(
            r#"
            SELECT fingerprint FROM agent_mailbox_send_audit
            WHERE mailbox_id = $1 AND idempotency_key = $2
            "#,
            mailbox.id.0,
            attempt.idempotency_key,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if audited.is_some_and(|fingerprint| fingerprint != attempt.fingerprint) {
            transaction.commit().await?;
            return Ok(SendReservation::KeyReused);
        }

        let existing = sqlx::query!(
            r#"
            SELECT provider_message_id, provider_thread_id, created_at
            FROM agent_mailbox_sends
            WHERE mailbox_id = $1 AND idempotency_key = $2
            "#,
            mailbox.id.0,
            attempt.idempotency_key,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing) = existing {
            let reservation = match existing.provider_message_id {
                Some(id) => SendReservation::AlreadySent(SentMessage {
                    id: ProviderMessageId(id),
                    thread_id: existing.provider_thread_id,
                }),
                None if existing.created_at >= replayable_since => {
                    sqlx::query!(
                        r#"
                        UPDATE agent_mailbox_send_audit
                        SET attempts = attempts + 1, updated_at = $3
                        WHERE mailbox_id = $1 AND idempotency_key = $2
                        "#,
                        mailbox.id.0,
                        attempt.idempotency_key,
                        now,
                    )
                    .execute(&mut *transaction)
                    .await?;
                    SendReservation::Proceed { fresh: false }
                }
                None => SendReservation::OutcomeUnknown,
            };
            transaction.commit().await?;
            return Ok(reservation);
        }

        let hour_start = now - Duration::hours(1);
        let day_start = now - Duration::days(1);
        let window = sqlx::query!(
            r#"
            SELECT count(*) FILTER (WHERE created_at > $2) AS "hour_count!",
                   min(created_at) FILTER (WHERE created_at > $2) AS hour_oldest,
                   count(*) AS "day_count!",
                   coalesce(sum(recipient_count), 0) AS "day_recipients!",
                   min(created_at) AS day_oldest
            FROM agent_mailbox_sends
            WHERE mailbox_id = $1 AND created_at > $3
            "#,
            mailbox.id.0,
            hour_start,
            day_start,
        )
        .fetch_one(&mut *transaction)
        .await?;
        let team_window = sqlx::query!(
            r#"
            SELECT coalesce(sum(recipient_count), 0) AS "recipients!",
                   min(created_at) AS oldest
            FROM agent_mailbox_sends
            WHERE team_id = $1 AND created_at > $2
            "#,
            mailbox.team.0,
            day_start,
        )
        .fetch_one(&mut *transaction)
        .await?;

        let recipients = i64::from(attempt.recipient_count);
        let mut retry_at = None;
        if window.hour_count >= i64::from(limits.per_hour) {
            retry_at = retry_at.max(window.hour_oldest.map(|oldest| oldest + Duration::hours(1)));
        }
        if window.day_count >= i64::from(limits.per_day)
            || window.day_recipients + recipients > i64::from(limits.recipients_per_day)
        {
            retry_at = retry_at.max(window.day_oldest.map(|oldest| oldest + Duration::days(1)));
        }
        if team_window.recipients + recipients > i64::from(limits.team_recipients_per_day) {
            retry_at = retry_at.max(team_window.oldest.map(|oldest| oldest + Duration::days(1)));
        }
        if let Some(retry_at) = retry_at {
            transaction.commit().await?;
            return Ok(SendReservation::LimitReached { retry_at });
        }

        let recipient_count = i32::try_from(attempt.recipient_count).unwrap_or(i32::MAX);
        sqlx::query!(
            r#"
            INSERT INTO agent_mailbox_sends
                (mailbox_id, idempotency_key, team_id, kind, recipient_count, fingerprint, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            mailbox.id.0,
            attempt.idempotency_key,
            mailbox.team.0,
            attempt.kind.as_ref(),
            recipient_count,
            &attempt.fingerprint[..],
            now,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO agent_mailbox_send_audit
                (mailbox_id, idempotency_key, team_id, kind, recipient_count, fingerprint,
                 outcome, approved_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $7)
            ON CONFLICT (mailbox_id, idempotency_key) DO UPDATE
            SET outcome = 'pending', attempts = agent_mailbox_send_audit.attempts + 1,
                approved_at = $7, updated_at = $7
            "#,
            mailbox.id.0,
            attempt.idempotency_key,
            mailbox.team.0,
            attempt.kind.as_ref(),
            recipient_count,
            &attempt.fingerprint[..],
            now,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(SendReservation::Proceed { fresh: true })
    }

    async fn complete_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
        sent: &SentMessage,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
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
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            UPDATE agent_mailbox_send_audit
            SET outcome = 'sent', provider_message_id = $3, updated_at = now()
            WHERE mailbox_id = $1 AND idempotency_key = $2
            "#,
            mailbox.0,
            idempotency_key,
            sent.id.0,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn cancel_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let deleted = sqlx::query!(
            r#"
            DELETE FROM agent_mailbox_sends
            WHERE mailbox_id = $1 AND idempotency_key = $2 AND provider_message_id IS NULL
            "#,
            mailbox.0,
            idempotency_key,
        )
        .execute(&mut *transaction)
        .await?;
        if deleted.rows_affected() == 1 {
            sqlx::query!(
                r#"
                UPDATE agent_mailbox_send_audit
                SET outcome = 'refused', updated_at = now()
                WHERE mailbox_id = $1 AND idempotency_key = $2 AND outcome = 'pending'
                "#,
                mailbox.0,
                idempotency_key,
            )
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn prune_sends(&self, before: DateTime<Utc>) -> Result<u64, Self::Err> {
        // At most PRUNE_BATCH rows a round, oldest first, so a backlog after
        // downtime drains over several rounds. The limit is a literal so a
        // generic plan still probes the primary key per expired row instead
        // of scanning the ledger.
        let result = sqlx::query!(
            r#"
            DELETE FROM agent_mailbox_sends AS sends
            USING (
                SELECT mailbox_id, idempotency_key
                FROM agent_mailbox_sends
                WHERE created_at < $1
                ORDER BY created_at
                LIMIT 1000
            ) AS expired
            WHERE sends.mailbox_id = expired.mailbox_id
              AND sends.idempotency_key = expired.idempotency_key
            "#,
            before,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    async fn prune_send_audit(&self, before: DateTime<Utc>) -> Result<u64, Self::Err> {
        // Bounded like prune_sends: a literal limit, oldest first.
        let result = sqlx::query!(
            r#"
            DELETE FROM agent_mailbox_send_audit AS audit
            USING (
                SELECT mailbox_id, idempotency_key
                FROM agent_mailbox_send_audit
                WHERE approved_at < $1
                ORDER BY approved_at
                LIMIT 1000
            ) AS expired
            WHERE audit.mailbox_id = expired.mailbox_id
              AND audit.idempotency_key = expired.idempotency_key
            "#,
            before,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    async fn orphaned(
        &self,
        paused_before: DateTime<Utc>,
        after: Option<AgentMailboxId>,
        page: u16,
    ) -> Result<(Vec<AgentMailbox>, Option<AgentMailboxId>), Self::Err> {
        // One page of live mailboxes by id, then two point probes each
        // ("User" by id, team_user by its key), so the check never scans the
        // account tables. team_user rows go with their user or team (ON DELETE
        // CASCADE), so one probe covers a deleted account and a deleted team.
        let rows = sqlx::query!(
            r#"
            SELECT id, request_id, user_id, team_id, provider, requested_local_part, display_name,
                   provider_mailbox_id, address, grant_id, grant_key_ciphertext,
                   grant_kms_key_id, grant_encryption_version, state, last_error, paused_at,
                   (state <> 'paused' OR paused_at < $1)
                   AND NOT EXISTS (
                       SELECT 1
                       FROM "User" AS account
                       JOIN team_user ON team_user.user_id = account.id
                                     AND team_user.team_id = mailbox.team_id
                       WHERE account.id = mailbox.user_id AND account."isAgent"
                   ) AS "orphan!"
            FROM agent_mailboxes AS mailbox
            WHERE state IN ('provisioning', 'active', 'failed', 'paused')
              -- A plain key bound (nil for the first page), so a generic
              -- plan seeks the primary key instead of filtering from its start.
              AND id > $2
            ORDER BY id
            LIMIT $3
            "#,
            paused_before,
            after.map_or(Uuid::nil(), |id| id.0),
            i64::from(page),
        )
        .fetch_all(&self.pool)
        .await?;

        let last = (rows.len() == usize::from(page))
            .then(|| rows.last().map(|row| AgentMailboxId(row.id)))
            .flatten();
        let orphans = rows
            .into_iter()
            .filter(|row| row.orphan)
            .map(|row| {
                AgentMailbox::try_from(MailboxRow {
                    id: row.id,
                    request_id: row.request_id,
                    user_id: row.user_id,
                    team_id: row.team_id,
                    provider: row.provider,
                    requested_local_part: row.requested_local_part,
                    display_name: row.display_name,
                    provider_mailbox_id: row.provider_mailbox_id,
                    address: row.address,
                    grant_id: row.grant_id,
                    grant_key_ciphertext: row.grant_key_ciphertext,
                    grant_kms_key_id: row.grant_kms_key_id,
                    grant_encryption_version: row.grant_encryption_version,
                    state: row.state,
                    last_error: row.last_error,
                    paused_at: row.paused_at,
                })
            })
            .collect::<Result<_, _>>()?;
        Ok((orphans, last))
    }
}

/// Take the team's send and provisioning lock for this transaction.
async fn lock_team(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    team: TeamId,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('agent_mailbox_team:' || $1::text, 0))",
        team.0.to_string(),
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// Reads an agent account's team from `"User"` and `team_user`.
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

    async fn agent_team(&self, user: &MacroUserIdStr<'_>) -> Result<Option<TeamId>, Self::Err> {
        let team = sqlx::query_scalar!(
            r#"
            SELECT team_user.team_id
            FROM "User" AS account
            JOIN team_user ON team_user.user_id = account.id
            WHERE account.id = $1 AND account."isAgent"
            "#,
            user.as_ref()
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(team.map(TeamId))
    }
}
