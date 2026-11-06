use super::CompaniesRepositoryImpl;
use crate::domain::{
    email_privacy::{
        EmailBlockScope, EmailContributionMailbox, EmailPrivacyChange, EmailPrivacyRepository,
        EmailPrivacySettings,
    },
    model::CrmError,
};
use chrono::{DateTime, Utc};
use opentelemetry::trace::TraceContextExt as _;
use sqlx::PgConnection;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use uuid::Uuid;

pub(super) struct EligibleInteractions {
    pub(super) first_at: DateTime<Utc>,
    pub(super) last_at: DateTime<Utc>,
    pub(super) is_sent: bool,
}

impl CompaniesRepositoryImpl {
    // Persist only W3C context, never request data, across the outbox hop.
    pub(super) fn current_traceparent() -> Option<String> {
        let context = tracing::Span::current().context();
        if !context.span().span_context().is_valid() {
            return None;
        }
        let mut carrier = std::collections::HashMap::new();
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(&context, &mut carrier);
        });
        carrier.remove("traceparent")
    }

    /// Writers take a shared lock; privacy changes take the exclusive lock.
    pub(super) async fn lock_email_privacy(
        conn: &mut PgConnection,
        team: Uuid,
        exclusive: bool,
    ) -> Result<(), CrmError> {
        let key = format!("crm-email:{team}");
        if exclusive {
            sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
                .execute(conn)
                .await
        } else {
            sqlx::query!(
                "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
                key
            )
            .execute(conn)
            .await
        }
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }

    pub(super) async fn eligible_interactions(
        conn: &mut PgConnection,
        team: Uuid,
        link: Uuid,
        email: &str,
    ) -> Result<Option<EligibleInteractions>, CrmError> {
        // Retain lifecycle and membership locks through a population transaction.
        // Pre-enrichment callers use an autocommit connection, so this is only
        // admission there; the writer repeats it inside its transaction.
        let live = sqlx::query_scalar!(
            "SELECT l.id FROM email_links l JOIN team_user tu ON tu.user_id = l.macro_id AND tu.team_id = $1 WHERE l.id = $2 AND l.is_primary AND l.deleting_at IS NULL AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth FOR SHARE OF l FOR KEY SHARE OF tu",
            team, link
        ).fetch_optional(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if live.is_none() {
            return Ok(None);
        }
        // Reject stale/unsolicited work before scanning mailbox history.
        let consented = sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM crm_email_consent c
                JOIN email_links l ON l.id = c.link_id AND l.macro_id = c.user_id AND l.is_primary AND l.deleting_at IS NULL
                JOIN team_user tu ON tu.team_id = c.team_id AND tu.user_id = c.user_id
                WHERE c.team_id = $1 AND c.link_id = $2 AND c.enabled
                  AND NOT crm_email_domain_blocked($1, c.user_id, split_part($3, '@', 2))
            ) AS "consented!""#,
            team,
            link,
            email
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if !consented {
            return Ok(None);
        }
        let row = sqlx::query_file!(
            "src/outbound/companies_repo/email_privacy/interactions.sql",
            team,
            link,
            email
        )
        .fetch_one(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(match (row.first_at, row.last_at, row.is_sent) {
            (Some(first_at), Some(last_at), Some(is_sent)) => Some(EligibleInteractions {
                first_at,
                last_at,
                is_sent,
            }),
            _ => None,
        })
    }
}

impl EmailPrivacyRepository for CompaniesRepositoryImpl {
    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn contribution_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        sqlx::query_as!(
            EmailContributionMailbox,
            r#"SELECT l.id AS link_id, l.email_address FROM crm_email_consent c
               JOIN email_links l ON l.id = c.link_id AND l.macro_id = c.user_id AND l.is_primary AND l.deleting_at IS NULL
               JOIN team_user tu ON tu.team_id = c.team_id AND tu.user_id = c.user_id
               WHERE c.team_id = $1 AND c.user_id = $2 AND c.enabled"#,
            team,
            user
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn may_contribute_contact(
        &self,
        team: Uuid,
        link: Uuid,
        email: &str,
    ) -> Result<bool, CrmError> {
        let mut conn = self
            .pool
            .acquire()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(
            Self::eligible_interactions(&mut conn, team, link, &email.to_ascii_lowercase())
                .await?
                .is_some(),
        )
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn email_privacy(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<EmailPrivacySettings, CrmError> {
        let mailbox = sqlx::query!(
            r#"SELECT l.id, l.email_address, COALESCE(c.enabled, FALSE) AS "enabled!"
               FROM email_links l LEFT JOIN crm_email_consent c
                 ON c.link_id = l.id AND c.user_id = $2 AND c.team_id = $1
               WHERE l.macro_id = $2 AND l.is_primary AND l.deleting_at IS NULL AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth LIMIT 1"#,
            team,
            user
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let team_domains = sqlx::query_scalar!(
            r#"SELECT domain AS "domain!" FROM crm_blocked_domains WHERE team_id = $1
               UNION SELECT lower(d.domain) FROM crm_domains d JOIN crm_companies c ON c.id = d.company_id
               WHERE d.team_id = $1 AND NOT c.email_sync ORDER BY 1"#, team
        ).fetch_all(&self.pool).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let personal_domains = sqlx::query_scalar!(
            "SELECT domain FROM crm_personal_email_blocklist WHERE team_id = $1 AND user_id = $2 ORDER BY domain", team, user
        ).fetch_all(&self.pool).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(EmailPrivacySettings {
            enabled: mailbox.as_ref().is_some_and(|m| m.enabled),
            mailbox_link_id: mailbox.as_ref().map(|m| m.id),
            mailbox_email: mailbox.map(|m| m.email_address),
            team_domains,
            personal_domains,
            can_remove_team_domains: false,
        })
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn change_email_privacy(
        &self,
        team: Uuid,
        user: &str,
        change: EmailPrivacyChange,
    ) -> Result<(), CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::lock_email_privacy(&mut tx, team, true).await?;
        let mut backfill_team = false;
        let backfill_user;
        match change {
            EmailPrivacyChange::SetConsent { enabled: false, .. } => {
                // Withdrawal is independent of the current connection state.
                sqlx::query!("UPDATE crm_email_consent SET enabled = FALSE, updated_at = now() WHERE team_id = $1 AND user_id = $2", team, user)
                    .execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                // Do not wait for an outbox publisher holding its row lock
                // through a network request. It and its consumer recheck consent.
                backfill_user = false;
            }
            EmailPrivacyChange::SetConsent { enabled, link_id } => {
                let link_id = link_id.ok_or_else(|| {
                    CrmError::InvalidRequest("select the primary mailbox to contribute".into())
                })?;
                if !Self::team_exists(&mut tx, &team).await? {
                    return Err(CrmError::CrmDisabledForTeam);
                }
                // Serialize admission with mailbox lifecycle changes. Those
                // writers hold the mailbox row before revoking consent; do not
                // acquire this lock after touching the consent row.
                let current = sqlx::query_scalar!(
                    "SELECT l.id FROM email_links l JOIN team_user tu ON tu.user_id = l.macro_id AND tu.team_id = $3 WHERE l.id = $1 AND l.macro_id = $2 AND l.is_primary AND l.deleting_at IS NULL AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth FOR SHARE OF l FOR KEY SHARE OF tu",
                    link_id, user, team
                ).fetch_optional(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                if current.is_none() {
                    return Err(CrmError::InvalidRequest(
                        "review your connected primary mailbox before contributing to CRM".into(),
                    ));
                }
                let changed = sqlx::query!(
                    r#"INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled)
                       SELECT $1, $2, l.id, $3 FROM email_links l WHERE l.macro_id = $2 AND l.is_primary AND l.deleting_at IS NULL AND l.id = $4
                       ON CONFLICT (team_id, user_id) DO UPDATE SET link_id = EXCLUDED.link_id,
                         enabled = EXCLUDED.enabled, updated_at = now()"#, team, user, enabled, link_id
                ).execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                if enabled && changed.rows_affected() == 0 {
                    return Err(CrmError::InvalidRequest(
                        "connect your email before contributing to CRM".into(),
                    ));
                }
                backfill_user = enabled;
            }
            EmailPrivacyChange::AddDomain { scope, domain } => {
                match scope {
                    EmailBlockScope::Team => {
                        sqlx::query!("INSERT INTO crm_blocked_domains (team_id, domain) VALUES ($1, $2) ON CONFLICT DO NOTHING", team, domain)
                            .execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                    }
                    EmailBlockScope::Personal => {
                        sqlx::query!("INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", team, user, domain)
                            .execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                    }
                }
                backfill_user = false;
            }
            EmailPrivacyChange::RemoveDomain { scope, domain } => {
                match scope {
                    EmailBlockScope::Team => {
                        let hidden = sqlx::query_scalar!(
                            r#"SELECT EXISTS (SELECT 1 FROM crm_domains d JOIN crm_companies c ON c.id = d.company_id
                               WHERE d.team_id = $1 AND lower(d.domain) = $2 AND c.hidden) AS "hidden!""#, team, domain
                        ).fetch_one(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                        if hidden {
                            return Err(CrmError::CompanyHidden);
                        }
                        // Preserve other domains of a legacy company exclusion
                        // while allowing this exact entry to be removed.
                        sqlx::query!(
                            r#"INSERT INTO crm_blocked_domains (team_id, domain)
                               SELECT $1, lower(d.domain) FROM crm_domains d JOIN crm_companies c ON c.id = d.company_id
                               WHERE c.team_id = $1 AND NOT c.email_sync AND lower(d.domain) <> $2
                                 AND EXISTS (SELECT 1 FROM crm_domains target WHERE target.company_id = c.id AND lower(target.domain) = $2)
                               ON CONFLICT DO NOTHING"#, team, domain
                        ).execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                        sqlx::query!(
                            r#"UPDATE crm_companies c SET email_sync = TRUE WHERE c.team_id = $1 AND NOT c.hidden
                               AND EXISTS (SELECT 1 FROM crm_domains d WHERE d.company_id = c.id AND lower(d.domain) = $2)"#, team, domain
                        ).execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                        sqlx::query!(
                            "DELETE FROM crm_blocked_domains WHERE team_id = $1 AND domain = $2",
                            team,
                            domain
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                        backfill_team = true;
                    }
                    EmailBlockScope::Personal => {
                        sqlx::query!("DELETE FROM crm_personal_email_blocklist WHERE team_id = $1 AND user_id = $2 AND domain = $3", team, user, domain)
                            .execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                    }
                }
                backfill_user = true;
            }
        }
        if backfill_user || backfill_team {
            sqlx::query!(
                r#"INSERT INTO crm_email_backfill_outbox (team_id, user_id, traceparent)
                   SELECT team_id, user_id, $4 FROM crm_email_consent WHERE team_id = $1 AND enabled AND ($3 OR user_id = $2)
                   ON CONFLICT (team_id, user_id) DO UPDATE SET requested_at = now(), traceparent = EXCLUDED.traceparent"#, team, user, backfill_team, Self::current_traceparent()
            ).execute(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))
    }
}
