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
        let failed = |_| TokenError::Transient {
            message: "could not persist mailbox health".into(),
        };
        let mut tx = self.db.begin().await.map_err(failed)?;
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
