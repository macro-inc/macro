use super::*;
use crate::domain::mailbox::{credentials::*, projection::ProjectionEvent};
use email_api_client::domain::models::{MailboxAccess, TokenError};

#[cfg(test)]
mod test;

impl MailboxCredentialHealthRepository for PgMailboxSync {
    async fn record(
        &self,
        mailbox: MailboxAccess,
        health: CredentialHealth,
    ) -> Result<(), TokenError> {
        let failed = |error: sqlx::Error| TokenError::Transient {
            message: format!(
                "could not persist mailbox health: {}",
                DatabaseFailure::from(&error)
            ),
        };
        // Nearly every token fetch reports the health already stored. Reading
        // it without the link lock keeps those fetches, and the Graph calls
        // behind them, from timing out behind a CRM population's share lock;
        // only a change takes the lock and writes.
        let scopes: &[String] = match &health {
            CredentialHealth::Available(scopes) => scopes,
            CredentialHealth::ReauthorizationRequired => &[],
        };
        let stored = sqlx::query!(r#"SELECT l.needs_reauth,
            EXISTS(SELECT 1 FROM email_link_microsoft_scopes s WHERE s.link_id = l.id AND s.grant_generation = $2
                AND s.granted_scopes IS NOT DISTINCT FROM $4) AS "scopes_stored!",
            NOT EXISTS(SELECT 1 FROM email_mailbox_custodians c WHERE c.link_id = l.id AND c.grant_id = l.grant_id
                AND c.grant_generation = $2 AND c.granted_scopes IS DISTINCT FROM $4) AS "custodians_stored!"
            FROM email_links l WHERE l.id = $1 AND l.grant_generation = $2 AND l.is_sync_active AND l.provider = 'OUTLOOK' AND l.sync_generation = $3"#,
            mailbox.link_id,mailbox.grant_generation,mailbox.sync_generation,scopes)
            .fetch_optional(&self.db).await.map_err(failed)?.ok_or(TokenError::ReauthRequired)?;
        let unchanged = match &health {
            CredentialHealth::Available(_) => {
                !stored.needs_reauth && stored.scopes_stored && stored.custodians_stored
            }
            CredentialHealth::ReauthorizationRequired => stored.needs_reauth,
        };
        if unchanged {
            return Ok(());
        }
        let mut tx = self.begin().await.map_err(failed)?;
        let current = sqlx::query!("SELECT sync_generation,needs_reauth FROM email_links WHERE id = $1 AND grant_generation = $2 AND is_sync_active AND provider = 'OUTLOOK' AND sync_generation = $3 FOR UPDATE",mailbox.link_id,mailbox.grant_generation,mailbox.sync_generation)
            .fetch_optional(&mut *tx).await.map_err(failed)?.ok_or(TokenError::ReauthRequired)?;
        let reauth = matches!(health, CredentialHealth::ReauthorizationRequired);
        if let CredentialHealth::Available(scopes) = &health {
            let changed = sqlx::query!(r#"INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES ($1,$2,$3)
                ON CONFLICT(link_id) DO UPDATE SET grant_generation = EXCLUDED.grant_generation,granted_scopes = EXCLUDED.granted_scopes,updated_at = now()
                WHERE email_link_microsoft_scopes.grant_generation <> EXCLUDED.grant_generation OR email_link_microsoft_scopes.granted_scopes IS DISTINCT FROM EXCLUDED.granted_scopes"#,
                mailbox.link_id,mailbox.grant_generation,scopes).execute(&mut *tx).await.map_err(failed)?;
            sqlx::query!(r#"UPDATE email_mailbox_custodians c SET granted_scopes = $3 FROM email_links l
                WHERE l.id = $1 AND c.link_id = l.id AND c.grant_id = l.grant_id AND c.grant_generation = $2 AND c.granted_scopes IS DISTINCT FROM $3"#,
                mailbox.link_id,mailbox.grant_generation,scopes).execute(&mut *tx).await.map_err(failed)?;
            if changed.rows_affected() > 0 {
                let event = serde_json::to_value(ProjectionEvent::LinkChanged).map_err(|_| {
                    TokenError::Transient {
                        message: "could not serialize mailbox capabilities".into(),
                    }
                })?;
                sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),mailbox.link_id,current.sync_generation,event)
                    .execute(&mut *tx).await.map_err(failed)?;
            }
        }
        if reauth != current.needs_reauth {
            sqlx::query!("UPDATE email_links SET needs_reauth = $2,last_sync_error_at = CASE WHEN $2 THEN now() ELSE NULL END,updated_at = now() WHERE id = $1",mailbox.link_id,reauth)
                .execute(&mut *tx).await.map_err(failed)?;
            if reauth {
                let event = serde_json::to_value(ProjectionEvent::ReauthorizationRequired)
                    .map_err(|_| TokenError::Transient {
                        message: "could not serialize mailbox health".into(),
                    })?;
                sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),mailbox.link_id,current.sync_generation,event)
                    .execute(&mut *tx).await.map_err(failed)?;
            }
        }
        tx.commit().await.map_err(failed)
    }
}
