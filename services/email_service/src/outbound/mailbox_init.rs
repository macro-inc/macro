//! Storage and authentication adapters for the email domain's setup policy.

use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use email::domain::mailbox::initialization::*;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Clone)]
pub struct MicrosoftGrantSource(pub AuthServiceClient);

impl CompletedMailboxGrantSource for MicrosoftGrantSource {
    async fn completed_grant(
        &self,
        attempt: Uuid,
        owner: Uuid,
    ) -> Result<VerifiedMailboxGrant, InitializationError> {
        let grant = self
            .0
            .completed_microsoft_grant(attempt, owner)
            .await
            .map_err(|error| match error {
                AuthServiceClientError::Forbidden | AuthServiceClientError::Unauthorized => {
                    InitializationError::InvalidAttempt
                }
                _ => InitializationError::Unavailable,
            })?;
        Ok(VerifiedMailboxGrant {
            scopes: grant.scopes,
            calendar_requested: grant.calendar_requested,
            id: grant.grant_id,
            generation: grant.generation,
            owner: grant.owner,
            email: grant.email,
            tenant_id: grant.tenant_id,
            mailbox_id: grant.mailbox_id,
        })
    }
}

#[derive(Clone)]
pub struct PgMailboxInitialization(pub PgPool);

/// Fence legacy Gmail initialization against concurrent connections of either provider.
/// The email domain owns the limit; storage supplies fresh facts under the same
/// actor lock used by Outlook initialization and holds it until access commits.
pub async fn lock_gmail_connection(
    conn: &mut PgConnection,
    actor: &str,
    address: &str,
) -> Result<(), InitializationError> {
    sqlx::query!(
        "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",
        format!("inbox-entitlement:{actor}")
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(unavailable)?;
    let facts=sqlx::query!(r#"SELECT
        EXISTS(SELECT 1 FROM "RolesOnUsers" ru JOIN "RolesOnPermissions" rp ON rp."roleId"=ru."roleId"
            WHERE ru."userId"=$1 AND rp."permissionId"='read:professional_features') AS "professional!",
        (SELECT count(*) FROM email_links l WHERE l.macro_id=$1 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$1)) AS "inboxes!",
        EXISTS(SELECT 1 FROM email_links l WHERE l.provider='GMAIL' AND lower(l.email_address)=lower($2)
            AND (l.macro_id=$1 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$1))) AS "reconnecting!"
    "#,actor,address).fetch_one(&mut *conn).await.map_err(unavailable)?;
    if !(email::domain::inbox_entitlement::InboxConnectionFacts {
        professional: facts.professional,
        accessible_inboxes: facts.inboxes,
        reconnecting: facts.reconnecting,
    })
    .permits_connection()
    {
        return Err(InitializationError::PaymentRequired);
    }
    Ok(())
}

fn unavailable<E: std::fmt::Debug>(error: E) -> InitializationError {
    tracing::error!(?error, "mailbox initialization persistence failed");
    InitializationError::Unavailable
}

async fn snapshot(
    conn: &mut PgConnection,
    request: &InitializeMailbox,
    grant: &VerifiedMailboxGrant,
) -> Result<InitializationSnapshot, InitializationError> {
    let existing = sqlx::query!(r#"
        SELECT l.id,l.macro_id,l.grant_id,l.grant_generation,l.sync_generation,
            l.provider_tenant_id,l.provider_mailbox_id,l.disconnect_requested_at,
            EXISTS(SELECT 1 FROM macro_user_links e WHERE e.link_id = l.id
                AND e.primary_macro_id = $4 AND e.child_macro_id = l.macro_id) AS "actor_has_access!"
        FROM email_links l WHERE l.provider = 'OUTLOOK'
            AND ((l.provider_tenant_id = $1 AND l.provider_mailbox_id = $2) OR lower(l.email_address) = lower($3))
        ORDER BY (l.provider_tenant_id = $1 AND l.provider_mailbox_id = $2) DESC NULLS LAST,l.id
        LIMIT 1 FOR UPDATE OF l
    "#,grant.tenant_id,grant.mailbox_id,grant.email,request.actor.as_ref())
        .fetch_optional(&mut *conn).await.map_err(unavailable)?;
    let existing = existing
        .map(|row| {
            if row.disconnect_requested_at.is_some() {
                return Err(InitializationError::Changed);
            }
            Ok::<_, InitializationError>(ExistingMailbox {
                id: row.id,
                owner: MacroUserIdStr::try_from(row.macro_id).map_err(unavailable)?,
                grant_id: row.grant_id,
                grant_generation: row.grant_generation,
                sync_generation: row.sync_generation,
                tenant_id: row.provider_tenant_id,
                mailbox_id: row.provider_mailbox_id,
                actor_has_access: row.actor_has_access,
            })
        })
        .transpose()?;
    let account_for_email = sqlx::query_scalar!(
        r#"SELECT id FROM "User" WHERE lower(email) = lower($1)"#,
        grant.email
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(unavailable)?
    .map(MacroUserIdStr::try_from)
    .transpose()
    .map_err(unavailable)?;
    let facts=sqlx::query!(r#"SELECT
        EXISTS(SELECT 1 FROM "RolesOnUsers" ru JOIN "RolesOnPermissions" rp ON rp."roleId"=ru."roleId"
            WHERE ru."userId"=$1 AND rp."permissionId"='read:professional_features') AS "professional!",
        (SELECT count(*) FROM email_links l WHERE l.macro_id=$1 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$1)) AS "inboxes!"
        "#,request.actor.as_ref()).fetch_one(&mut *conn).await.map_err(unavailable)?;
    let entitlement = email::domain::inbox_entitlement::InboxConnectionFacts {
        professional: facts.professional,
        accessible_inboxes: facts.inboxes,
        reconnecting: existing
            .as_ref()
            .is_some_and(|existing| existing.owner == request.actor || existing.actor_has_access),
    };
    Ok(InitializationSnapshot {
        entitlement,
        existing,
        account_for_email,
    })
}

impl MailboxInitializationRepository for PgMailboxInitialization {
    async fn recognizes(&self, request: &InitializeMailbox) -> Result<bool, InitializationError> {
        sqlx::query_scalar!(r#"
            SELECT (EXISTS(SELECT 1 FROM in_progress_user_link WHERE id = $1
                AND macro_user_id = $2 AND email_provider = 'OUTLOOK') OR
                EXISTS(SELECT 1 FROM email_link_initializations WHERE attempt_id = $1 AND actor_id = $3)) AS "recognized!"
        "#,request.attempt,request.actor_fusion_id,request.actor.as_ref())
            .fetch_one(&self.0).await.map_err(unavailable)
    }
    async fn completed(
        &self,
        request: &InitializeMailbox,
    ) -> Result<Option<Uuid>, InitializationError> {
        sqlx::query_scalar!(r#"
            SELECT r.link_id FROM email_link_initializations r JOIN email_links l ON l.id = r.link_id
            WHERE r.attempt_id = $1 AND r.actor_id = $2 AND (l.macro_id = $2 OR EXISTS (
                SELECT 1 FROM macro_user_links e WHERE e.link_id = l.id
                    AND e.primary_macro_id = $2 AND e.child_macro_id = l.macro_id))
        "#,request.attempt,request.actor.as_ref()).fetch_optional(&self.0).await.map_err(unavailable)
    }

    async fn inspect(
        &self,
        request: &InitializeMailbox,
        grant: &VerifiedMailboxGrant,
    ) -> Result<InitializationSnapshot, InitializationError> {
        snapshot(
            &mut *self.0.acquire().await.map_err(unavailable)?,
            request,
            grant,
        )
        .await
    }

    async fn commit(
        &self,
        request: &InitializeMailbox,
        grant: &VerifiedMailboxGrant,
        expected: &InitializationSnapshot,
        decision: InitializationDecision,
    ) -> Result<Uuid, InitializationError> {
        let mut tx = self.0.begin().await.map_err(unavailable)?;
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",
            format!("inbox-entitlement:{}", request.actor)
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        // Serialize address collisions and identity-stable alias changes. Lock
        // identity first everywhere to keep concurrent reconnects deterministic.
        let identity_lock = format!("outlook:{}:{}", grant.tenant_id, grant.mailbox_id);
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",
            identity_lock
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",
            grant.email
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        let current = snapshot(&mut tx, request, grant).await?;
        if current.entitlement != expected.entitlement
            || current.existing != expected.existing
            || current.account_for_email != expected.account_for_email
        {
            return Err(InitializationError::Changed);
        }
        let consumed = sqlx::query!(
            r#"
            DELETE FROM in_progress_user_link WHERE id = $1 AND macro_user_id = $2
                AND email_provider = 'OUTLOOK' AND linked_email = $3
                AND created_at > now() - interval '24 hours'
        "#,
            request.attempt,
            request.actor_fusion_id,
            grant.email
        )
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
        if consumed.rows_affected() != 1 {
            return Err(InitializationError::Changed);
        }

        let (link_id, owner, restart) = match (decision, &current.existing) {
            (InitializationDecision::Create { owner }, None) => {
                let id = macro_uuid::generate_uuid_v7();
                sqlx::query!(r#"
                    INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,
                        grant_id,grant_generation,provider_tenant_id,provider_mailbox_id,is_sync_active)
                    VALUES ($1,$2,$3,$4,'OUTLOOK',$5,$6,$7,$8,true)
                "#,id,owner.as_ref(),grant.owner.to_string(),grant.email,grant.id,grant.generation,grant.tenant_id,grant.mailbox_id)
                    .execute(&mut *tx).await.map_err(unavailable)?;
                (id, owner, true)
            }
            (InitializationDecision::Promote, Some(existing)) => {
                let organization = sqlx::query_scalar!(
                    r#"SELECT "organizationId" FROM "User" WHERE id = $1"#,
                    existing.owner.as_ref()
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
                let promoted = macro_db_client::shared_inbox::promote_link_to_shared(
                    &mut tx,
                    existing.id,
                    existing.owner.as_ref(),
                    request.actor.as_ref(),
                    &grant.email,
                    organization,
                )
                .await
                .map_err(unavailable)?;
                (
                    existing.id,
                    MacroUserIdStr::try_from(promoted.mailbox_macro_id).map_err(unavailable)?,
                    true,
                )
            }
            (
                InitializationDecision::Reconnect | InitializationDecision::Delegate,
                Some(existing),
            ) => (
                existing.id,
                existing.owner.clone(),
                existing.grant_id != Some(grant.id)
                    || existing.grant_generation != grant.generation,
            ),
            _ => return Err(InitializationError::Changed),
        };
        // The grant's encryption owner remains its consenting principal. Macro
        // inbox ownership is independent and access is always scoped to this link.
        // An explicit, identity-checked reconnect can replace the custodian.
        let link = sqlx::query!(r#"
            UPDATE email_links SET grant_id = $2,grant_generation = $3,
                fusionauth_user_id = $4,email_address = $5,is_sync_active = true,needs_reauth = false,
                last_sync_error_at = NULL,updated_at = now(),
                sync_generation = sync_generation + CASE WHEN $6 AND $7 THEN 1 ELSE 0 END
            WHERE id = $1 RETURNING sync_generation
        "#,link_id,grant.id,grant.generation,grant.owner.to_string(),grant.email,restart,current.existing.is_some())
            .fetch_one(&mut *tx).await.map_err(unavailable)?;
        sqlx::query!(r#"INSERT INTO email_mailbox_custodians(link_id,actor_id,fusionauth_user_id,grant_id,grant_generation,granted_scopes)
            VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(link_id,actor_id) DO UPDATE SET fusionauth_user_id = EXCLUDED.fusionauth_user_id,
                grant_id = EXCLUDED.grant_id,grant_generation = EXCLUDED.grant_generation,granted_scopes = EXCLUDED.granted_scopes,verified_at = now()"#,
            link_id,request.actor.as_ref(),grant.owner.to_string(),grant.id,grant.generation,&grant.scopes).execute(&mut *tx).await.map_err(unavailable)?;
        sqlx::query!(r#"INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES ($1,$2,$3)
            ON CONFLICT(link_id) DO UPDATE SET grant_generation = EXCLUDED.grant_generation,granted_scopes = EXCLUDED.granted_scopes,
                calendar_disabled_at = CASE WHEN $4 THEN NULL ELSE email_link_microsoft_scopes.calendar_disabled_at END,updated_at = now()"#,
            link_id,grant.generation,&grant.scopes,grant.calendar_requested).execute(&mut *tx).await.map_err(unavailable)?;
        if owner != request.actor {
            macro_db_client::macro_user_links::insert_edge(
                &mut *tx,
                request.actor.as_ref(),
                owner.as_ref(),
                link_id,
            )
            .await
            .map_err(unavailable)?;
        }
        sqlx::query!(
            "INSERT INTO email_settings (link_id) VALUES ($1) ON CONFLICT DO NOTHING",
            link_id
        )
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
        if restart {
            // Resume the exact recorded phase under the verified replacement
            // grant. Submitting/confirming phases perform reads only, never sends.
            sqlx::query!(
                r#"
                UPDATE email_mailbox_drafts SET generation = $2,lease_id = NULL,lease_until = NULL,
                    state = CASE WHEN state = 'running' THEN 'pending' ELSE state END,
                    available_at = now(),updated_at = now()
                WHERE link_id = $1 AND generation <> $2
            "#,
                link_id,
                link.sync_generation
            )
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
            sqlx::query!(
                r#"
                INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id)
                VALUES ($1,$2,$3,'folder_catalog','mail') ON CONFLICT DO NOTHING
            "#,
                macro_uuid::generate_uuid_v7(),
                link_id,
                link.sync_generation
            )
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
            sqlx::query!("INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key) VALUES($1,$2,'catalog','') ON CONFLICT(link_id,kind,resource_key) DO UPDATE SET next_run_at=now()", macro_uuid::generate_uuid_v7(), link_id)
                .execute(&mut *tx).await.map_err(unavailable)?;
            sqlx::query!("INSERT INTO email_mailbox_watch_work(link_id) VALUES($1) ON CONFLICT(link_id) DO UPDATE SET next_run_at=now(),revision=email_mailbox_watch_work.revision+1",link_id)
                .execute(&mut *tx).await.map_err(unavailable)?;
            for kind in ["contacts_catalog", "contacts_profile"] {
                sqlx::query!(
                    "INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id) VALUES ($1,$2,$3,$4,'address_book') ON CONFLICT DO NOTHING",
                    macro_uuid::generate_uuid_v7(),link_id,link.sync_generation,kind
                ).execute(&mut *tx).await.map_err(unavailable)?;
            }
            // Old leases cannot write into this generation. Keep uncertain sends
            // for reconciliation rather than treating a reconnect as permission to resend.
            sqlx::query!(r#"
                UPDATE email_mailbox_commands SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE 'unknown' END,
                    lease_id = NULL,lease_until = NULL,updated_at = now()
                WHERE link_id = $1 AND generation <> $2 AND status IN ('pending','running','confirming')
            "#,link_id,link.sync_generation).execute(&mut *tx).await.map_err(unavailable)?;
            let affected = sqlx::query!(r#"
                DELETE FROM email_pending_mailbox_state p USING email_mailbox_commands c
                WHERE p.command_id = c.id AND c.link_id = $1 AND c.generation <> $2 RETURNING p.message_id
            "#,link_id,link.sync_generation).fetch_all(&mut *tx).await.map_err(unavailable)?;
            for pending in affected {
                let thread = sqlx::query_scalar!(r#"
                    UPDATE email_messages SET is_read = COALESCE((mailbox_state->>'is_read')::boolean,is_read),
                        is_starred = COALESCE((mailbox_state->>'is_flagged')::boolean,is_starred)
                    WHERE id = $1 RETURNING thread_id
                "#,pending.message_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
                if let Some(thread) = thread {
                    email_db_client::threads::update::recompute_thread_metadata(
                        &mut tx, thread, link_id,
                    )
                    .await
                    .map_err(unavailable)?;
                }
            }
        }
        sqlx::query!("INSERT INTO email_link_initializations (attempt_id,actor_id,link_id) VALUES ($1,$2,$3)",request.attempt,request.actor.as_ref(),link_id)
            .execute(&mut *tx).await.map_err(unavailable)?;
        let event = serde_json::json!({"kind":"link_connected","actor_id":request.actor.as_ref(),"is_new":current.existing.is_none()});
        sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),link_id,link.sync_generation,event)
            .execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(link_id)
    }
}
