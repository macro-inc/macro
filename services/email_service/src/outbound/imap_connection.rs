//! PostgreSQL reservations and internal engine calls for verified-address linking.

use email::domain::inbox_entitlement::InboxConnectionFacts;
use email::domain::mailbox::imap_connection::*;
use imap_service_client::{
    Binding, ConnectRequest, Discovery, ImapServiceClient, Verification, VerifyRequest,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_user_id::{
    cowlike::ArcCowStr,
    email::{Email, EmailStr},
};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct PgImapConnections(pub PgPool);

pub(super) fn failure(error: sqlx::Error) -> ImapConnectionError {
    tracing::error!(error=?email::domain::mailbox::DatabaseFailure::from(&error),"IMAP connection persistence failed");
    ImapConnectionError::Unavailable
}

impl ImapConnectionRepository for PgImapConnections {
    async fn attempt(
        &self,
        actor: &MacroUserIdStr<'_>,
        request: Uuid,
    ) -> Result<Option<ImapConnectionAttempt>, ImapConnectionError> {
        let row = sqlx::query!(
            r#"
            SELECT
                id,
                user_id,
                credential_owner,
                email,
                link_id,
                verification_id,
                sync_generation,
                grant_generation,
                expected_generation,
                completed
            FROM
                email_imap_connection_attempts
            WHERE
                id = $1
                AND user_id = $2
            "#,
            request,
            actor.as_ref(),
        )
        .fetch_optional(&self.0)
        .await
        .map_err(failure)?;
        if row.as_ref().is_some_and(|row| row.completed) {
            let current = sqlx::query_scalar!(
                r#"
                SELECT
                    EXISTS (
                        SELECT
                            1
                        FROM
                            email_links l
                            JOIN email_imap_connection_attempts a ON a.link_id = l.id
                        WHERE
                            a.id = $1
                            AND l.macro_id = $2
                            AND l.is_sync_active
                            AND l.sync_generation = a.sync_generation
                            AND l.grant_generation = a.grant_generation) AS "current!"
                "#,
                request,
                actor.as_ref(),
            )
            .fetch_one(&self.0)
            .await
            .map_err(failure)?;
            if !current {
                return Err(ImapConnectionError::Changed);
            }
        }
        row.map(|row| {
            Ok(ImapConnectionAttempt {
                id: row.id,
                owner: MacroUserIdStr::try_from(row.user_id)
                    .map_err(|_| ImapConnectionError::Unavailable)?,
                credential_owner: row.credential_owner,
                email: EmailStr::try_from(row.email)
                    .map_err(|_| ImapConnectionError::Unavailable)?,
                verification_id: row.verification_id,
                binding: Binding {
                    link_id: row.link_id,
                    sync_generation: row.sync_generation,
                    grant_generation: row.grant_generation,
                },
                expected_generation: row.expected_generation,
                completed: row.completed,
            })
        })
        .transpose()
    }

    async fn reserve(
        &self,
        actor: &MacroUserIdStr<'_>,
        credential_owner: &str,
        input: &ImapConnectRequest,
        verification: &Verification,
    ) -> Result<ImapConnectionAttempt, ImapConnectionError> {
        let mut tx = self.0.begin().await.map_err(failure)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '15s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"
            SELECT
                1 AS locked
            FROM
                pg_advisory_xact_lock(hashtextextended($1, 0))
            "#,
            format!("inbox-entitlement:{actor}"),
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        // Gmail and Outlook initialization use this same address lock.
        sqlx::query!(
            r#"
            SELECT
                1 AS locked
            FROM
                pg_advisory_xact_lock(hashtextextended($1, 0))
            "#,
            actor.email_str().to_ascii_lowercase(),
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        let existing = sqlx::query!(
            r#"
            SELECT
                id,
                macro_id,
                provider::text AS provider,
                sync_generation,
                grant_generation,
                disconnect_requested_at,
                deleting_at
            FROM
                email_links
            WHERE
                lower(email_address) = lower($1)
            ORDER BY
                created_at,
                id
            LIMIT 1
            FOR UPDATE
            "#,
            actor.email_str(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        let (link, expected, sync, grant) = if let Some(existing) = existing {
            if existing.provider.as_deref() != Some("IMAP") || existing.macro_id != actor.as_ref() {
                return Err(ImapConnectionError::ProviderConflict);
            }
            if existing.disconnect_requested_at.is_some()
                || existing.deleting_at.is_some()
                || input.link_id.is_some_and(|id| id != existing.id)
            {
                return Err(ImapConnectionError::Changed);
            }
            (
                existing.id,
                Some(existing.sync_generation),
                existing.sync_generation + 1,
                existing.grant_generation + 1,
            )
        } else {
            if input.link_id.is_some() {
                return Err(ImapConnectionError::Changed);
            }
            (macro_uuid::generate_uuid_v7(), None, 1, 1)
        };
        let facts = sqlx::query!(
            r#"
            SELECT
                EXISTS (
                    SELECT
                        1
                    FROM
                        "RolesOnUsers" ru
                        JOIN "RolesOnPermissions" rp ON rp."roleId" = ru."roleId"
                    WHERE
                        ru."userId" = $1
                        AND rp."permissionId" = 'read:professional_features') AS "professional!",
                (
                    SELECT
                        count(*)
                    FROM
                        email_links l
                    WHERE
                        l.macro_id = $1
                        OR EXISTS (
                            SELECT
                                1
                            FROM
                                macro_user_links u
                            WHERE
                                u.link_id = l.id
                                AND u.primary_macro_id = $1)) AS "inboxes!"
            "#,
            actor.as_ref(),
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if !(InboxConnectionFacts {
            professional: facts.professional,
            accessible_inboxes: facts.inboxes,
            reconnecting: expected.is_some(),
        })
        .permits_connection()
        {
            return Err(ImapConnectionError::PaymentRequired);
        }
        if expected.is_none() {
            // A provisional link is inactive and always has a durable attempt.
            // It is promoted by recovery if the caller loses the HTTP response.
            sqlx::query!(
                r#"
                INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, sync_generation, grant_generation)
                    VALUES ($1, $2, $3, $4, 'IMAP', false, $5, $6)
                "#,
                link,
                actor.as_ref(),
                credential_owner,
                actor.email_str(),
                sync,
                grant,
            ).execute(&mut *tx).await.map_err(failure)?;
            sqlx::query!(
                r#"
                INSERT INTO email_settings (link_id)
                    VALUES ($1)
                ON CONFLICT (link_id)
                    DO NOTHING
                "#,
                link,
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        let pending = sqlx::query_scalar!(
            r#"
            SELECT
                id
            FROM
                email_imap_connection_attempts
            WHERE
                link_id = $1
                AND NOT completed
            "#,
            link,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        if pending.is_some_and(|id| id != input.request_id) {
            return Err(ImapConnectionError::Changed);
        }
        sqlx::query!(
            r#"
            INSERT INTO email_imap_connection_attempts (id, user_id, credential_owner, email, link_id, verification_id, expected_generation, sync_generation, grant_generation)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id)
                DO NOTHING
            "#,
            input.request_id,
            actor.as_ref(),
            credential_owner,
            actor.email_str(),
            link,
            verification.id,
            expected,
            sync,
            grant,
        ).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        self.attempt(actor, input.request_id)
            .await?
            .ok_or(ImapConnectionError::Changed)
    }

    #[tracing::instrument(skip_all, name = "email.imap.connection.activate", fields(
        mailbox.link_id = %attempt.binding.link_id,
        sync.provider_retry_at = tracing::field::Empty,
    ))]
    async fn activate(&self, attempt: &ImapConnectionAttempt) -> Result<Uuid, ImapConnectionError> {
        let mut tx = self.0.begin().await.map_err(failure)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '15s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"
            SELECT
                1 AS locked
            FROM
                pg_advisory_xact_lock(hashtextextended($1, 0))
            "#,
            format!("inbox-entitlement:{}", attempt.owner),
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"
            SELECT
                1 AS locked
            FROM
                pg_advisory_xact_lock(hashtextextended($1, 0))
            "#,
            attempt.email.0.as_ref().to_ascii_lowercase(),
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        let receipt = sqlx::query!(
            r#"
            SELECT
                completed
            FROM
                email_imap_connection_attempts
            WHERE
                id = $1
                AND user_id = $2
                AND link_id = $3
            FOR UPDATE
            "#,
            attempt.id,
            attempt.owner.as_ref(),
            attempt.binding.link_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ImapConnectionError::Changed)?;
        if receipt.completed {
            return Ok(attempt.binding.link_id);
        }
        let current = sqlx::query!(
            r#"
            SELECT
                id,
                macro_id,
                provider::text AS provider,
                sync_generation
            FROM
                email_links
            WHERE
                lower(email_address) = lower($1)
            ORDER BY created_at, id
            LIMIT 1
            FOR UPDATE
            "#,
            attempt.email.0.as_ref(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        let Some(current) = current else {
            return Err(ImapConnectionError::Changed);
        };
        let expected = attempt
            .expected_generation
            .unwrap_or(attempt.binding.sync_generation);
        if current.id != attempt.binding.link_id
            || current.macro_id != attempt.owner.as_ref()
            || current.provider.as_deref() != Some("IMAP")
            || current.sync_generation != expected
        {
            return Err(ImapConnectionError::Changed);
        }
        // A changed password does not cancel an already persisted provider wait.
        let provider_retry_at = sqlx::query_scalar!(
            r#"
            SELECT
                max(provider_retry_at)
            FROM
                email_sync_streams
            WHERE
                link_id = $1
                AND generation = $2
                AND provider = 'IMAP'
                AND provider_retry_at > now()
            "#,
            attempt.binding.link_id,
            expected,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if let Some(until) = provider_retry_at {
            tracing::Span::current().record("sync.provider_retry_at", until.timestamp_millis());
        }
        sqlx::query!(
            r#"
            UPDATE
                email_links
            SET
                is_sync_active = true,
                needs_reauth = false,
                sync_generation = $2,
                grant_generation = $3,
                last_sync_error_at = NULL,
                mailbox_issue = NULL,
                mailbox_retry_at = NULL,
                updated_at = now()
            WHERE
                id = $1
            "#,
            attempt.binding.link_id,
            attempt.binding.sync_generation,
            attempt.binding.grant_generation,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        email::outbound::mailbox_pg::parked_work_recovery::unpark_link_page(
            &mut tx,
            attempt.binding.link_id,
            64,
        )
        .await
        .map_err(failure)?;
        // Rebind unfinished organization/draft intents to the fresh credentials.
        sqlx::query!(
            r#"
            UPDATE
                email_mailbox_commands
            SET
                generation = $2,
                status = 'pending',
                lease_id = NULL,
                lease_until = NULL
            WHERE
                link_id = $1
                AND generation = $3
                AND status IN ('pending', 'running', 'confirming')
            "#,
            attempt.binding.link_id,
            attempt.binding.sync_generation,
            attempt
                .expected_generation
                .unwrap_or(attempt.binding.sync_generation),
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"
            UPDATE
                email_mailbox_drafts
            SET
                generation = $2,
                lease_id = NULL,
                lease_until = NULL
            WHERE
                link_id = $1
                AND state NOT IN ('sent', 'deleted')
            "#,
            attempt.binding.link_id,
            attempt.binding.sync_generation,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"
            INSERT INTO email_sync_streams (
                id, link_id, generation, kind, scope_id, provider_retry_at, next_run_at
            )
            VALUES ($1, $2, $3, 'folder_catalog', 'mail', $4, GREATEST(now(), $4))
            ON CONFLICT
                DO NOTHING
            "#,
            macro_uuid::generate_uuid_v7(),
            attempt.binding.link_id,
            attempt.binding.sync_generation,
            provider_retry_at,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"
            UPDATE
                email_imap_connection_attempts
            SET
                completed = true,
                updated_at = now()
            WHERE
                id = $1
            "#,
            attempt.id,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        email::outbound::mailbox_pg::parked_work_recovery::resume_link(
            &self.0,
            attempt.binding.link_id,
        )
        .await;
        Ok(attempt.binding.link_id)
    }

    async fn abandon(&self, attempt: &ImapConnectionAttempt) -> Result<(), ImapConnectionError> {
        let mut tx = self.0.begin().await.map_err(failure)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '15s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        if attempt.expected_generation.is_none() {
            sqlx::query!(
                r#"
                DELETE FROM email_links
                WHERE id = $1
                    AND macro_id = $2
                    AND NOT is_sync_active
                    AND sync_generation = $3
                    AND disconnect_requested_at IS NULL
                "#,
                attempt.binding.link_id,
                attempt.owner.as_ref(),
                attempt.binding.sync_generation,
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        sqlx::query!(
            r#"
            DELETE FROM email_imap_connection_attempts
            WHERE id = $1
                AND user_id = $2
                AND NOT completed
            "#,
            attempt.id,
            attempt.owner.as_ref(),
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }

    async fn pending(&self) -> Result<Vec<ImapConnectionAttempt>, ImapConnectionError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                id,
                user_id
            FROM
                email_imap_connection_attempts
            WHERE
                NOT completed
            ORDER BY
                created_at,
                id
            LIMIT 100
            "#,
        )
        .fetch_all(&self.0)
        .await
        .map_err(failure)?;
        let mut attempts = Vec::new();
        for row in rows {
            let actor = MacroUserIdStr::try_from(row.user_id)
                .map_err(|_| ImapConnectionError::Unavailable)?;
            if let Some(attempt) = self.attempt(&actor, row.id).await? {
                attempts.push(attempt)
            }
        }
        Ok(attempts)
    }
    async fn owned_address_is_connected(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<bool, ImapConnectionError> {
        sqlx::query_scalar!(
            r#"
            SELECT
                EXISTS (
                    SELECT
                        1
                    FROM
                        email_links l
                    WHERE
                        lower(email_address) = lower($2)
                        AND (l.macro_id = $1
                            OR EXISTS (
                                SELECT
                                    1
                                FROM
                                    macro_user_links u
                                WHERE
                                    u.link_id = l.id
                                    AND u.primary_macro_id = $1))) AS "connected!"
            "#,
            actor.as_ref(),
            actor.email_str(),
        )
        .fetch_one(&self.0)
        .await
        .map_err(failure)
    }
}
#[derive(Clone)]
pub struct ImapConnectionClient {
    pub(super) client: ImapServiceClient,
    hints: std::sync::Arc<imap_engine::outbound::provider_hint::ProviderHints>,
}
impl ImapConnectionClient {
    pub fn new(client: ImapServiceClient) -> Self {
        Self {
            client,
            hints: Default::default(),
        }
    }
}
impl ImapConnectionGateway for ImapConnectionClient {
    async fn provider_hint(
        &self,
        email: &Email<ArcCowStr<'_>>,
    ) -> Result<Discovery, ImapConnectionError> {
        Ok(self.hints.lookup(email).await?)
    }
    async fn discover(
        &self,
        email: &Email<ArcCowStr<'_>>,
    ) -> Result<Discovery, ImapConnectionError> {
        Ok(self.client.discover(email).await?)
    }
    async fn verify(&self, input: &VerifyRequest) -> Result<Verification, ImapConnectionError> {
        Ok(self.client.verify(input).await?)
    }
    async fn connect(
        &self,
        link: Uuid,
        input: &ConnectRequest,
    ) -> Result<Binding, ImapConnectionError> {
        Ok(self.client.connect(link, input).await?)
    }
}

#[derive(Clone)]
pub struct ImapEnrollment(pub Option<feature_flags::outbound::posthog::PostHogFeatureFlags>);
impl ImapConnectionEnrollment for ImapEnrollment {
    async fn enabled(&self, actor: &MacroUserIdStr<'_>) -> bool {
        use feature_flags::FeatureFlags;
        let Some(flags) = &self.0 else { return false };
        flags
            .load(actor)
            .await
            .inspect_err(|_| {
                tracing::warn!(
                    feature_flag = models_email::service::link::IMAP_CONNECTIONS_FLAG,
                    "IMAP enrollment flag unavailable; new connections remain disabled"
                );
            })
            .map(|snapshot| snapshot.is_enabled(models_email::service::link::IMAP_CONNECTIONS_FLAG))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test;
