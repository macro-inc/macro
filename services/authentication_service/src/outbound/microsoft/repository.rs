use crate::domain::microsoft::{token::EncryptedMicrosoftToken, *};
use sqlx::PgPool;
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(test)]
mod test;

pub struct PgMicrosoftGrants {
    db: PgPool,
}

impl PgMicrosoftGrants {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

fn database_error(_: sqlx::Error) -> MicrosoftAuthError {
    MicrosoftAuthError::Unavailable
}

#[async_trait::async_trait]
impl MicrosoftGrantRepository for PgMicrosoftGrants {
    async fn collect_expired_grants(
        &self,
        older_than: chrono::DateTime<chrono::Utc>,
        limit: i64,
    ) -> Result<u64, MicrosoftAuthError> {
        let mut tx = self.db.begin().await.map_err(database_error)?;
        // Initialization consumes this same row before adopting its grant.
        // Skip a row locked by that transaction and preserve its referenced grant.
        sqlx::query!(
            r#"DELETE FROM in_progress_user_link WHERE id IN (
            SELECT id FROM in_progress_user_link
            WHERE email_provider='OUTLOOK' AND created_at <= $1::timestamptz
            ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        "#,
            older_than,
            limit
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        let removed = sqlx::query!(
            r#"DELETE FROM microsoft_oauth_grant_versions WHERE grant_id IN (
            SELECT g.grant_id FROM microsoft_oauth_grant_versions g
            WHERE g.created_at <= $1
                AND NOT EXISTS(SELECT 1 FROM email_links l WHERE l.grant_id=g.grant_id)
                AND NOT EXISTS(SELECT 1 FROM email_mailbox_custodians c WHERE c.grant_id=g.grant_id)
                AND NOT EXISTS(SELECT 1 FROM microsoft_link_attempts a WHERE a.grant_id=g.grant_id)
            ORDER BY g.created_at LIMIT $2 FOR UPDATE OF g SKIP LOCKED)
        "#,
            older_than,
            limit
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?
        .rows_affected();
        tx.commit().await.map_err(database_error)?;
        Ok(removed)
    }

    async fn connection_facts(
        &self,
        owner: Uuid,
        reconnect: Option<Uuid>,
    ) -> Result<email::domain::inbox_entitlement::InboxConnectionFacts, MicrosoftAuthError> {
        let facts=sqlx::query!(r#"SELECT
            EXISTS(SELECT 1 FROM "RolesOnUsers" ru JOIN "RolesOnPermissions" rp ON rp."roleId"=ru."roleId" WHERE ru."userId"=u.id AND rp."permissionId"='read:professional_features') AS "professional!",
            (SELECT count(*) FROM email_links l WHERE l.macro_id=u.id OR EXISTS(SELECT 1 FROM macro_user_links a WHERE a.link_id=l.id AND a.primary_macro_id=u.id)) AS "inboxes!",
            EXISTS(SELECT 1 FROM email_links l WHERE l.id=$2 AND l.provider='OUTLOOK' AND (l.macro_id=u.id OR EXISTS(SELECT 1 FROM macro_user_links a WHERE a.link_id=l.id AND a.primary_macro_id=u.id))) AS "reconnecting!"
            FROM "User" u WHERE u.macro_user_id=$1 LIMIT 1"#,owner,reconnect)
            .fetch_optional(&self.db).await.map_err(|_|MicrosoftAuthError::Unavailable)?.ok_or(MicrosoftAuthError::InvalidIdentity)?;
        Ok(email::domain::inbox_entitlement::InboxConnectionFacts {
            professional: facts.professional,
            accessible_inboxes: facts.inboxes,
            reconnecting: facts.reconnecting,
        })
    }

    async fn revoke_released_grant(
        &self,
        id: Uuid,
        generation: i64,
        owner: &str,
    ) -> Result<(), MicrosoftAuthError> {
        sqlx::query!(r#"DELETE FROM microsoft_oauth_grant_versions g WHERE g.grant_id = $1 AND g.generation = $2 AND g.fusionauth_user_id = $3
            AND NOT EXISTS(SELECT 1 FROM email_links l WHERE l.grant_id = g.grant_id AND l.grant_generation = g.generation AND l.is_sync_active)
            AND NOT EXISTS(SELECT 1 FROM email_mailbox_custodians c WHERE c.grant_id=g.grant_id AND c.grant_generation=g.generation)"#,id,generation,owner)
            .execute(&self.db).await.map_err(database_error)?;
        Ok(())
    }
    async fn begin_link(&self, attempt: &LinkAttempt) -> Result<(), MicrosoftAuthError> {
        let mut tx = self.db.begin().await.map_err(database_error)?;
        // Serialize the cap check for this principal, including concurrent starts.
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))",
            attempt.owner.to_string()
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(database_error)?;
        let result = sqlx::query!(
            r#"
            INSERT INTO in_progress_user_link (id, macro_user_id, email_provider)
            SELECT $1, $2, 'OUTLOOK'
            WHERE (SELECT count(*) FROM in_progress_user_link
                WHERE macro_user_id = $2 AND created_at > now() - interval '24 hours') < 5
        "#,
            attempt.id,
            attempt.owner
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        if result.rows_affected() != 1 {
            return Err(MicrosoftAuthError::TooManyAttempts);
        }
        sqlx::query!(r#"
            INSERT INTO microsoft_link_attempts
                (id, identity_provider_id, redirect_uri, return_uri, pkce_verifier, oidc_nonce, expires_at, calendar_requested)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        "#, attempt.id, attempt.identity_provider_id, attempt.redirect_uri, attempt.return_uri,
            attempt.verifier.as_str(), attempt.nonce, attempt.expires_at, attempt.calendar_requested)
            .execute(&mut *tx).await.map_err(database_error)?;
        tx.commit().await.map_err(database_error)
    }

    async fn claim_link(&self, id: Uuid) -> Result<LinkAttempt, MicrosoftAuthError> {
        let row = sqlx::query!(
            r#"
            UPDATE microsoft_link_attempts a SET claimed_at = now()
            FROM in_progress_user_link p
            WHERE a.id = $1 AND a.id = p.id AND p.email_provider = 'OUTLOOK'
                AND a.claimed_at IS NULL AND a.completed_at IS NULL AND a.expires_at > now()
            RETURNING a.id, p.macro_user_id, a.identity_provider_id, a.redirect_uri,
                a.return_uri, a.pkce_verifier, a.oidc_nonce, a.expires_at, a.calendar_requested
        "#,
            id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(database_error)?
        .ok_or(MicrosoftAuthError::InvalidAttempt)?;
        Ok(LinkAttempt {
            id: row.id,
            owner: row.macro_user_id,
            identity_provider_id: row.identity_provider_id,
            redirect_uri: row.redirect_uri,
            return_uri: row.return_uri,
            verifier: Zeroizing::new(row.pkce_verifier),
            nonce: row.oidc_nonce,
            calendar_requested: row.calendar_requested,
            expires_at: row.expires_at,
        })
    }

    async fn abandon_link(&self, id: Uuid) -> Result<(), MicrosoftAuthError> {
        sqlx::query!(
            "DELETE FROM in_progress_user_link WHERE id = $1 AND email_provider = 'OUTLOOK'",
            id
        )
        .execute(&self.db)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    async fn complete_link(
        &self,
        attempt: &LinkAttempt,
        identity: &VerifiedGrant,
        envelope: &EncryptedMicrosoftToken,
        grant_id: Uuid,
    ) -> Result<(), MicrosoftAuthError> {
        let mut tx = self.db.begin().await.map_err(database_error)?;
        let owner = attempt.owner.to_string();
        // Serialize reconnects for this verified address. Connecting a grant is
        // separate from the email domain's explicit mailbox-sharing decision.
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))",
            identity.email
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(database_error)?;
        let saved = sqlx::query!(r#"
            INSERT INTO microsoft_oauth_grant_versions
                (fusionauth_user_id,email_address,grant_id,tenant_id,subject_id,mailbox_id,scopes,
                 refresh_token_ciphertext,encrypted_data_key,nonce,encryption_version,kms_key_id,generation)
            SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                COALESCE((SELECT max(g.generation) FROM microsoft_oauth_grant_versions g
                    WHERE g.fusionauth_user_id=$1 AND g.email_address=$2),0)+1
            WHERE NOT EXISTS(SELECT 1 FROM microsoft_oauth_grant_versions g
                WHERE g.fusionauth_user_id=$1 AND g.email_address=$2 AND g.mailbox_id IS NOT NULL
                    AND (g.mailbox_id IS DISTINCT FROM $6 OR g.tenant_id IS DISTINCT FROM $4 OR g.subject_id IS DISTINCT FROM $5))
        "#, owner, identity.email, grant_id, identity.tenant_id, identity.subject_id,
            identity.mailbox_id, &identity.scopes, envelope.refresh_token_ciphertext,
            envelope.encrypted_data_key, envelope.nonce, i32::from(envelope.encryption_version), envelope.kms_key_id)
            .execute(&mut *tx).await.map_err(database_error)?;
        if saved.rows_affected() != 1 {
            return Err(MicrosoftAuthError::OwnershipConflict);
        }
        let marked = sqlx::query!(r#"
            UPDATE microsoft_link_attempts a SET completed_at=now(),pkce_verifier='',oidc_nonce='',grant_id=$3
            FROM in_progress_user_link p
            WHERE a.id=$1 AND p.id=a.id AND p.macro_user_id=$2
                AND p.email_provider='OUTLOOK' AND a.claimed_at IS NOT NULL
                AND a.completed_at IS NULL AND a.expires_at > now()
        "#,attempt.id,attempt.owner,grant_id).execute(&mut *tx).await.map_err(database_error)?;
        if marked.rows_affected() != 1 {
            return Err(MicrosoftAuthError::InvalidAttempt);
        }
        sqlx::query!(
            "UPDATE in_progress_user_link SET linked_email = $2 WHERE id = $1",
            attempt.id,
            identity.email
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        tx.commit().await.map_err(database_error)
    }

    async fn completed_grant(
        &self,
        attempt: Uuid,
        owner: Uuid,
    ) -> Result<CompletedMicrosoftGrant, MicrosoftAuthError> {
        let row = sqlx::query!(
            r#"
            SELECT g.grant_id AS "grant_id!",g.generation,g.email_address,
                g.tenant_id AS "tenant_id!",g.mailbox_id AS "mailbox_id!",g.scopes,a.calendar_requested
            FROM in_progress_user_link p
            JOIN microsoft_link_attempts a ON a.id = p.id AND a.completed_at IS NOT NULL
            JOIN microsoft_oauth_grant_versions g ON g.grant_id=a.grant_id AND g.fusionauth_user_id = p.macro_user_id::text
                AND g.email_address = p.linked_email
            WHERE p.id = $1 AND p.macro_user_id = $2 AND p.email_provider = 'OUTLOOK'
                AND p.created_at > now() - interval '24 hours' AND g.revoked_at IS NULL
                AND g.grant_id IS NOT NULL AND g.tenant_id IS NOT NULL AND g.mailbox_id IS NOT NULL
        "#,
            attempt,
            owner
        )
        .fetch_optional(&self.db)
        .await
        .map_err(database_error)?
        .ok_or(MicrosoftAuthError::InvalidAttempt)?;
        Ok(CompletedMicrosoftGrant {
            calendar_requested: row.calendar_requested,
            grant_id: row.grant_id,
            generation: row.generation,
            owner,
            email: row.email_address,
            tenant_id: row.tenant_id,
            mailbox_id: row.mailbox_id,
            scopes: row.scopes,
        })
    }

    async fn active_grant(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<StoredGrant, MicrosoftAuthError> {
        let row = sqlx::query!(r#"
            SELECT g.grant_id AS "grant_id!", g.generation, g.revision, g.fusionauth_user_id, g.email_address,
                g.refresh_token_ciphertext, g.encrypted_data_key, g.nonce, g.encryption_version, g.kms_key_id,g.scopes
            FROM microsoft_oauth_grant_versions g JOIN email_links l ON l.grant_id = g.grant_id
                AND l.grant_generation = g.generation AND l.fusionauth_user_id = g.fusionauth_user_id
                AND lower(l.email_address) = g.email_address
            WHERE l.id = $1 AND g.generation = $2 AND l.provider = 'OUTLOOK'
                AND l.is_sync_active AND l.sync_generation = $3 AND g.revoked_at IS NULL
        "#, link_id, generation, sync_generation).fetch_optional(&self.db).await.map_err(database_error)?
            .ok_or(MicrosoftAuthError::ReauthorizationRequired)?;
        Ok(StoredGrant {
            scopes: row.scopes,
            id: row.grant_id,
            generation: row.generation,
            revision: row.revision,
            owner: row.fusionauth_user_id,
            email: row.email_address,
            envelope: EncryptedMicrosoftToken {
                refresh_token_ciphertext: row.refresh_token_ciphertext,
                encrypted_data_key: row.encrypted_data_key,
                nonce: row.nonce,
                encryption_version: row
                    .encryption_version
                    .try_into()
                    .map_err(|_| MicrosoftAuthError::Unavailable)?,
                kms_key_id: row.kms_key_id,
            },
        })
    }

    async fn disconnecting_grant(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<StoredGrant, MicrosoftAuthError> {
        let row = sqlx::query!(r#"
            SELECT g.grant_id AS "grant_id!", g.generation, g.revision, g.fusionauth_user_id, g.email_address,
                g.refresh_token_ciphertext, g.encrypted_data_key, g.nonce, g.encryption_version, g.kms_key_id,g.scopes
            FROM microsoft_oauth_grant_versions g JOIN email_links l ON l.grant_id = g.grant_id
                AND l.grant_generation = g.generation AND l.fusionauth_user_id = g.fusionauth_user_id
                AND lower(l.email_address) = g.email_address
            WHERE l.id = $1 AND g.generation = $2 AND l.provider = 'OUTLOOK'
                AND NOT l.is_sync_active AND l.disconnect_requested_at IS NOT NULL
                AND l.sync_generation = $3 AND g.revoked_at IS NULL
        "#, link_id, generation, sync_generation).fetch_optional(&self.db).await.map_err(database_error)?
            .ok_or(MicrosoftAuthError::ReauthorizationRequired)?;
        Ok(StoredGrant {
            scopes: row.scopes,
            id: row.grant_id,
            generation: row.generation,
            revision: row.revision,
            owner: row.fusionauth_user_id,
            email: row.email_address,
            envelope: EncryptedMicrosoftToken {
                refresh_token_ciphertext: row.refresh_token_ciphertext,
                encrypted_data_key: row.encrypted_data_key,
                nonce: row.nonce,
                encryption_version: row
                    .encryption_version
                    .try_into()
                    .map_err(|_| MicrosoftAuthError::Unavailable)?,
                kms_key_id: row.kms_key_id,
            },
        })
    }

    async fn acquire_refresh(
        &self,
        grant: &StoredGrant,
        lease: Uuid,
    ) -> Result<bool, MicrosoftAuthError> {
        let result = sqlx::query!(r#"
            UPDATE microsoft_oauth_grant_versions g SET refresh_lease_id = $4, refresh_lease_until = now() + interval '3 minutes'
            WHERE grant_id = $1 AND generation = $2 AND revision = $3 AND revoked_at IS NULL
                AND (refresh_lease_until IS NULL OR refresh_lease_until < now())
                AND EXISTS(SELECT 1 FROM email_links l WHERE l.grant_id=g.grant_id AND l.grant_generation=g.generation
                    AND l.fusionauth_user_id=g.fusionauth_user_id AND lower(l.email_address)=g.email_address
                    AND l.provider='OUTLOOK' AND (l.is_sync_active OR l.disconnect_requested_at IS NOT NULL))
        "#, grant.id, grant.generation, grant.revision, lease).execute(&self.db).await.map_err(database_error)?;
        Ok(result.rows_affected() == 1)
    }

    async fn finish_refresh(
        &self,
        grant: &StoredGrant,
        lease: Uuid,
        envelope: &EncryptedMicrosoftToken,
        scopes: &[String],
    ) -> Result<bool, MicrosoftAuthError> {
        let result = sqlx::query!(r#"
            UPDATE microsoft_oauth_grant_versions g SET refresh_token_ciphertext = $5, encrypted_data_key = $6,
                nonce = $7, encryption_version = $8, kms_key_id = $9, scopes = $10,
                revision = revision + 1, refresh_lease_id = NULL, refresh_lease_until = NULL,
                updated_at = now(), last_refreshed_at = now()
            WHERE grant_id = $1 AND generation = $2 AND revision = $3 AND refresh_lease_id = $4
                AND revoked_at IS NULL AND refresh_lease_until > now()
                AND EXISTS(SELECT 1 FROM email_links l WHERE l.grant_id=g.grant_id AND l.grant_generation=g.generation
                    AND l.fusionauth_user_id=g.fusionauth_user_id AND lower(l.email_address)=g.email_address
                    AND l.provider='OUTLOOK' AND (l.is_sync_active OR l.disconnect_requested_at IS NOT NULL))
        "#, grant.id, grant.generation, grant.revision, lease, envelope.refresh_token_ciphertext,
            envelope.encrypted_data_key, envelope.nonce, i32::from(envelope.encryption_version), envelope.kms_key_id, scopes)
            .execute(&self.db).await.map_err(database_error)?;
        Ok(result.rows_affected() == 1)
    }

    async fn release_refresh(
        &self,
        grant: &StoredGrant,
        lease: Uuid,
        revoke: bool,
    ) -> Result<(), MicrosoftAuthError> {
        sqlx::query!(
            r#"
            UPDATE microsoft_oauth_grant_versions SET refresh_lease_id = NULL, refresh_lease_until = NULL,
                revoked_at = CASE WHEN $5 THEN now() ELSE revoked_at END
            WHERE grant_id = $1 AND generation = $2 AND revision = $3 AND refresh_lease_id = $4
        "#,
            grant.id,
            grant.generation,
            grant.revision,
            lease,
            revoke
        )
        .execute(&self.db)
        .await
        .map_err(database_error)?;
        Ok(())
    }
}
