use super::CompaniesRepositoryImpl;
use crate::domain::{
    email_privacy::{
        EmailBlockScope, EmailContributionConsent, EmailContributionMailbox, EmailPrivacyChange,
        EmailPrivacyRepository, EmailPrivacySettings, ExcludedEmailThread, ExcludedEmailThreads,
        mailbox_domains::{self, ConnectedMailboxDomain},
    },
    model::CrmError,
};
use chrono::{DateTime, Utc};
use opentelemetry::trace::TraceContextExt as _;
use sqlx::PgConnection;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use uuid::Uuid;

pub(super) struct EligibleInteractions {
    pub(super) first_at: DateTime<Utc>,
    pub(super) last_at: DateTime<Utc>,
    pub(super) is_sent: bool,
}

struct MailboxGuardTimeouts {
    statement: String,
    lock: String,
}

impl CompaniesRepositoryImpl {
    async fn bound_mailbox_guard(
        conn: &mut PgConnection,
    ) -> Result<MailboxGuardTimeouts, CrmError> {
        let previous = sqlx::query_as!(
            MailboxGuardTimeouts,
            r#"SELECT current_setting('statement_timeout') AS "statement!",
                      current_setting('lock_timeout') AS "lock!""#
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *conn)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(conn)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(previous)
    }

    async fn restore_mailbox_guard_timeouts(
        conn: &mut PgConnection,
        previous: MailboxGuardTimeouts,
    ) -> Result<(), CrmError> {
        // Legacy cascades retain the caller's limits; only the new lookup is bounded.
        sqlx::query!(
            "SELECT set_config('statement_timeout', $1, true) AS statement_timeout, set_config('lock_timeout', $2, true) AS lock_timeout",
            previous.statement,
            previous.lock
        )
        .fetch_one(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }

    pub(super) async fn guard_team_domain_exclusion(
        conn: &mut PgConnection,
        team: Uuid,
        domain: &str,
    ) -> Result<(), CrmError> {
        let previous = Self::bound_mailbox_guard(conn).await?;
        let mailboxes = Self::lock_mailbox_domains(conn, team, None, EmailBlockScope::Team).await?;
        mailbox_domains::validate(domain, EmailBlockScope::Team, &mailboxes)?;
        Self::restore_mailbox_guard_timeouts(conn, previous).await
    }

    pub(super) async fn guard_company_domain_exclusion(
        conn: &mut PgConnection,
        team: Uuid,
        company: Uuid,
    ) -> Result<(), CrmError> {
        let previous = Self::bound_mailbox_guard(conn).await?;
        let mailboxes = Self::lock_mailbox_domains(conn, team, None, EmailBlockScope::Team).await?;
        // Keep stale statistics from turning a company lookup into a team scan.
        let domains = sqlx::query_scalar!(
            "SELECT domain FROM (SELECT domain, team_id FROM crm_domains WHERE company_id = $2 OFFSET 0) company_domains WHERE team_id = $1",
            team,
            company
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        for domain in domains {
            mailbox_domains::validate(&domain, EmailBlockScope::Team, &mailboxes)?;
        }
        Self::restore_mailbox_guard_timeouts(conn, previous).await
    }

    #[tracing::instrument(skip_all, fields(team_id = %team, scope = ?scope), err)]
    pub(super) async fn lock_mailbox_domains(
        conn: &mut PgConnection,
        team: Uuid,
        user: Option<&str>,
        scope: EmailBlockScope,
    ) -> Result<Vec<ConnectedMailboxDomain>, CrmError> {
        let personal = scope == EmailBlockScope::Personal;
        // Start at this team's membership index and probe only each member's
        // primary connection. Keep lifecycle locks until the caller commits,
        // before any domain/entity locks, so a checked mailbox cannot change
        // between validation and the exclusion write.
        sqlx::query_file_as!(
            ConnectedMailboxDomain,
            "src/outbound/companies_repo/email_privacy/lock_mailbox_domains.sql",
            team,
            user,
            personal
        )
        .fetch_all(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn read_mailbox_domains(
        conn: &mut PgConnection,
        team: Uuid,
        user: &str,
    ) -> Result<Vec<ConnectedMailboxDomain>, CrmError> {
        // Settings warnings must not wait for mailbox lifecycle or sync writes.
        sqlx::query_file_as!(
            ConnectedMailboxDomain,
            "src/outbound/companies_repo/email_privacy/mailbox_domains.sql",
            team,
            user
        )
        .fetch_all(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    async fn read_email_consent(
        conn: &mut PgConnection,
        team: Uuid,
        user: &str,
    ) -> Result<EmailContributionConsent, CrmError> {
        let mailbox = sqlx::query!(
            r#"SELECT l.id, l.email_address, COALESCE(c.enabled OR c.selected_enabled, FALSE) AS "enabled!"
               FROM email_links l LEFT JOIN crm_email_consent c
                 ON c.link_id = l.id AND c.user_id = $2 AND c.team_id = $1
               WHERE l.macro_id = $2 AND l.is_primary AND l.deleting_at IS NULL AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth LIMIT 1"#,
            team,
            user
        )
        .fetch_optional(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(EmailContributionConsent {
            enabled: mailbox.as_ref().is_some_and(|m| m.enabled),
            mailbox_link_id: mailbox.as_ref().map(|m| m.id),
            mailbox_email: mailbox.map(|m| m.email_address),
        })
    }

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

    /// Whether the mailbox may contribute this address at all: a live primary
    /// mailbox, current membership, consent (in a queued worker's exact
    /// generation) and an unblocked domain. It reads no message history.
    async fn admitted(
        conn: &mut PgConnection,
        team: Uuid,
        link: Uuid,
        email: &str,
        authority: Option<crate::domain::email_policy_work::EmailHistoryAuthority>,
    ) -> Result<bool, CrmError> {
        use crate::domain::email_policy_work::EmailHistoryAuthority;
        let (incarnation, version) = match authority {
            Some(EmailHistoryAuthority::Policy(generation)) => (
                Some(generation.consent_incarnation),
                Some(generation.policy_version),
            ),
            None | Some(EmailHistoryAuthority::Legacy) => (None, None),
        };
        sqlx::query_file_scalar!(
            "src/outbound/companies_repo/email_privacy/admission.sql",
            team,
            link,
            email,
            authority.is_some(),
            incarnation,
            version
        )
        .fetch_one(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    #[tracing::instrument(
        name = "crm.email_eligibility",
        skip_all,
        fields(team_id = %team, link_id = %link),
        err
    )]
    pub(super) async fn eligible_interactions_with_authority(
        &self,
        conn: &mut PgConnection,
        team: Uuid,
        link: Uuid,
        email: &str,
        authority: Option<crate::domain::email_policy_work::EmailHistoryAuthority>,
    ) -> Result<Option<EligibleInteractions>, CrmError> {
        // All callers own a transaction. Bound the address history scan on
        // both admission and the write-time recheck, including worker pools
        // that have no default statement timeout.
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *conn)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        // Reject stale work cheaply, without a mailbox row lock. Sync commits
        // need that row while this potentially long address-history scan runs.
        if !Self::admitted(conn, team, link, email, authority).await? {
            return Ok(None);
        }
        let row = sqlx::query_file!(
            "src/outbound/companies_repo/email_privacy/interactions.sql",
            team,
            link,
            email
        )
        .fetch_one(&mut *conn)
        .instrument(tracing::info_span!("crm.email_interaction_scan"))
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let (
            Some(first_at),
            Some(last_at),
            Some(is_sent),
            Some(first_message),
            Some(first_thread),
            Some(first_contact),
            Some(last_message),
            Some(last_thread),
            Some(last_contact),
            Some(last_is_sent),
        ) = (
            row.first_at,
            row.last_at,
            row.is_sent,
            row.first_message_id,
            row.first_thread_id,
            row.first_contact_id,
            row.last_message_id,
            row.last_thread_id,
            row.last_contact_id,
            row.last_is_sent,
        )
        else {
            return Ok(None);
        };

        #[cfg(test)]
        if let Some(gate) = &self.after_eligible_scan {
            gate.entered.notify_one();
            gate.resume.notified().await;
        }

        // In READ COMMITTED this recheck sees lifecycle changes committed
        // during the scan. Writers retain their privacy/contact advisory locks
        // across both phases, then keep these row locks through the CRM writes.
        if !Self::lock_population_authority(conn, team, link, email, authority).await? {
            return Ok(None);
        }
        // A provider deletion may have committed during the unlocked scan.
        // Validate only its two scalar witnesses by primary key. A changed
        // witness defers the job, so its next scan also runs without this lock.
        let witnesses_valid = sqlx::query_file_scalar!(
            "src/outbound/companies_repo/email_privacy/witnesses.sql",
            link,
            email,
            first_message,
            first_thread,
            first_at,
            is_sent,
            first_contact,
            last_message,
            last_thread,
            last_at,
            last_is_sent,
            last_contact
        )
        .fetch_one(&mut *conn)
        .instrument(tracing::info_span!("crm.email_history_witnesses"))
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if !witnesses_valid {
            return Err(CrmError::Contended);
        }
        Ok(Some(EligibleInteractions {
            first_at,
            last_at,
            is_sent,
        }))
    }

    #[tracing::instrument(
        name = "crm.email_authority_recheck",
        skip_all,
        fields(team_id = %team, link_id = %link),
        err
    )]
    async fn lock_population_authority(
        conn: &mut PgConnection,
        team: Uuid,
        link: Uuid,
        email: &str,
        authority: Option<crate::domain::email_policy_work::EmailHistoryAuthority>,
    ) -> Result<bool, CrmError> {
        // Preserve mailbox/member -> consent -> domain/entity lock order.
        // Lifecycle writers own the mailbox before revoking consent and do
        // not acquire the team privacy lock.
        let live = sqlx::query_scalar!(
            "SELECT l.id FROM email_links l JOIN team_user tu ON tu.user_id = l.macro_id AND tu.team_id = $1 WHERE l.id = $2 AND l.is_primary AND l.deleting_at IS NULL AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth FOR SHARE OF l FOR KEY SHARE OF tu",
            team, link
        ).fetch_optional(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if live.is_none() {
            return Ok(false);
        }
        // Consent can change while waiting for the mailbox guard; use a new
        // statement snapshot, including the queued worker's exact generation.
        let consented = if let Some(authority) = authority {
            use crate::domain::email_policy_work::EmailHistoryAuthority;
            let (incarnation, version) = match authority {
                EmailHistoryAuthority::Legacy => (None, None),
                EmailHistoryAuthority::Policy(g) => {
                    (Some(g.consent_incarnation), Some(g.policy_version))
                }
            };
            // Fold the retained grant into the existing consent probe. Mailbox
            // and membership were locked first; consent stays locked through
            // this transaction without an extra per-contact database round trip.
            sqlx::query_scalar!(
                r#"SELECT c.link_id FROM crm_email_consent c
                   JOIN email_links l ON l.id=c.link_id AND l.macro_id=c.user_id AND l.is_primary AND l.deleting_at IS NULL
                   JOIN team_user tu ON tu.team_id=c.team_id AND tu.user_id=c.user_id
                   WHERE c.team_id=$1 AND c.link_id=$2 AND c.consent_incarnation IS NOT DISTINCT FROM $4
                     AND (($4::uuid IS NULL AND c.mode='all' AND c.enabled)
                          OR (c.policy_version=$5 AND (c.enabled OR c.selected_enabled)))
                     AND NOT crm_email_domain_blocked($1,c.user_id,split_part($3,'@',2))
                   FOR SHARE OF c"#,
                team,link,email,incarnation,version
            ).fetch_optional(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?.is_some()
        } else {
            sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM crm_email_consent c
                JOIN email_links l ON l.id = c.link_id AND l.macro_id = c.user_id AND l.is_primary AND l.deleting_at IS NULL
                JOIN team_user tu ON tu.team_id = c.team_id AND tu.user_id = c.user_id
                WHERE c.team_id = $1 AND c.link_id = $2 AND (c.enabled OR c.selected_enabled)
                  AND NOT crm_email_domain_blocked($1, c.user_id, split_part($3, '@', 2))
            ) AS "consented!""#,
            team,
            link,
            email
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        };
        Ok(consented)
    }
}

impl EmailPrivacyRepository for CompaniesRepositoryImpl {
    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn email_consent(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<EmailContributionConsent, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let consent = Self::read_email_consent(&mut tx, team, user).await?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(consent)
    }

    #[tracing::instrument(skip_all, fields(team_id = %team, thread_id = ?thread_id), err)]
    async fn excluded_email_threads(
        &self,
        team: Uuid,
        user: &str,
        after: Option<Uuid>,
        thread_id: Option<uuid::Uuid>,
    ) -> Result<ExcludedEmailThreads, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        // An exact lookup drives the header without scanning the member's pages.
        let mut threads = if let Some(thread_id) = thread_id {
            sqlx::query_as!(
                ExcludedEmailThread,
                r#"SELECT e.thread_id, e.link_id, message.subject
                   FROM crm_email_thread_exclusions e
                   JOIN email_links l ON l.id = e.link_id AND l.macro_id = $2
                   LEFT JOIN LATERAL (
                       SELECT subject FROM email_messages WHERE thread_id = e.thread_id
                       ORDER BY internal_date_ts DESC LIMIT 1
                   ) message ON TRUE
                   WHERE e.team_id = $1 AND e.user_id = $2 AND e.thread_id = $3"#,
                team,
                user,
                thread_id
            )
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?
        } else {
            // Page the member's indexed exceptions before loading thread metadata.
            sqlx::query_as!(
                ExcludedEmailThread,
                r#"SELECT e.thread_id, e.link_id, message.subject
               FROM (
                   SELECT thread_id, link_id FROM crm_email_thread_exclusions
                   WHERE team_id = $1 AND user_id = $2
                     AND thread_id > COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)
                   ORDER BY thread_id LIMIT 51
               ) e
               JOIN email_links l ON l.id = e.link_id AND l.macro_id = $2
               LEFT JOIN LATERAL (
                   SELECT subject FROM email_messages WHERE thread_id = e.thread_id
                   ORDER BY internal_date_ts DESC LIMIT 1
               ) message ON TRUE
               ORDER BY e.thread_id"#,
                team,
                user,
                after
            )
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?
        };
        let next_cursor = if threads.len() > 50 {
            threads.truncate(50);
            threads.last().map(|thread| thread.thread_id)
        } else {
            None
        };
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(ExcludedEmailThreads {
            threads,
            next_cursor,
        })
    }

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
               WHERE c.team_id = $1 AND c.user_id = $2 AND (c.enabled OR c.selected_enabled)"#,
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
        // Admission only. The population transaction scans the address
        // history once, after skipping a job that would change nothing: one
        // job is queued per message, so most of a busy contact's jobs are
        // duplicates that need no history at all.
        let mut conn = self
            .pool
            .acquire()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::admitted(&mut conn, team, link, &email.to_ascii_lowercase(), None).await
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn email_privacy(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<EmailPrivacySettings, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let consent = Self::read_email_consent(&mut tx, team, user).await?;
        // The company team predicate lets the partial disabled-company index
        // drive this reload, including after an individual thread toggle.
        let team_domains = sqlx::query_scalar!(
            r#"SELECT domain AS "domain!" FROM crm_blocked_domains WHERE team_id = $1
               UNION SELECT lower(d.domain) FROM crm_domains d JOIN crm_companies c ON c.id = d.company_id
               WHERE d.team_id = $1 AND c.team_id = $1 AND NOT c.email_sync ORDER BY 1"#, team
        ).fetch_all(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let personal_domains = sqlx::query_scalar!(
            "SELECT domain FROM crm_personal_email_blocklist WHERE team_id = $1 AND user_id = $2 ORDER BY domain", team, user
        ).fetch_all(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let mailboxes = Self::read_mailbox_domains(&mut tx, team, user).await?;
        let team_domain_warnings =
            mailbox_domains::warnings(&team_domains, EmailBlockScope::Team, &mailboxes);
        let personal_domain_warnings =
            mailbox_domains::warnings(&personal_domains, EmailBlockScope::Personal, &mailboxes);
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(EmailPrivacySettings {
            enabled: consent.enabled,
            mailbox_link_id: consent.mailbox_link_id,
            mailbox_email: consent.mailbox_email,
            team_domains,
            personal_domains,
            team_domain_warnings,
            personal_domain_warnings,
            can_remove_team_domains: false,
        })
    }

    #[tracing::instrument(skip_all, fields(team_id = %team, thread_id = tracing::field::Empty), err)]
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
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::lock_email_privacy(&mut tx, team, true).await?;
        let mut backfill_team = false;
        let backfill_user;
        match change {
            EmailPrivacyChange::SetThreadExclusion {
                thread_id,
                excluded,
            } => {
                tracing::Span::current().record("thread_id", tracing::field::display(thread_id));
                // Even clearing an exception requires ownership. Lock the live
                // mailbox and membership before the thread, matching lifecycle
                // writers; no caller can supply another contributor's identity.
                let link = sqlx::query_scalar!(
                    r#"SELECT l.id FROM email_links l
                       JOIN team_user member ON member.user_id = l.macro_id AND member.team_id = $1
                       WHERE l.macro_id = $2 AND l.deleting_at IS NULL
                         AND l.id = (SELECT link_id FROM email_threads WHERE id = $3)
                       FOR SHARE OF l FOR KEY SHARE OF member"#,
                    team,
                    user,
                    thread_id
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?
                .ok_or_else(|| {
                    CrmError::InvalidRequest("select a thread in your own mailbox".into())
                })?;
                let owned = sqlx::query_scalar!(
                    "SELECT id FROM email_threads WHERE id = $1 AND link_id = $2 FOR KEY SHARE",
                    thread_id,
                    link
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                if owned.is_none() {
                    return Err(CrmError::InvalidRequest(
                        "select a thread in your own mailbox".into(),
                    ));
                }
                if excluded {
                    sqlx::query!(
                        "INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
                        team, user, link, thread_id
                    ).execute(&mut *tx).await
                        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                    backfill_user = false;
                } else {
                    let removed = sqlx::query!(
                        "DELETE FROM crm_email_thread_exclusions WHERE team_id = $1 AND user_id = $2 AND thread_id = $3 AND link_id = $4",
                        team, user, thread_id, link
                    ).execute(&mut *tx).await
                        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                    backfill_user = removed.rows_affected() > 0;
                }
            }
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
                let mailboxes =
                    Self::lock_mailbox_domains(&mut tx, team, Some(user), scope).await?;
                mailbox_domains::validate(&domain, scope, &mailboxes)?;
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
        Self::invalidate_email_previews(&mut tx, team).await?;
        if backfill_user || backfill_team {
            Self::schedule_contribution_history(&mut tx, team, (!backfill_team).then_some(user))
                .await?;
        }
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))
    }
}
