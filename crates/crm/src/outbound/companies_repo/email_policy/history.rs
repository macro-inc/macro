//! Bounded history pages and their conditional durable continuation.
use super::*;
use crate::domain::{email_policy_work::*, email_privacy::EmailContributionMailbox};

impl EmailPolicyWorkRepository for CompaniesRepositoryImpl {
    type History = PgEmailPolicyTransaction;
    type Source = PgEmailPolicySourceTransaction;

    async fn open_history(
        &self,
        request: &EmailPolicyWorkRequest,
    ) -> Result<Option<Self::History>, CrmError> {
        self.open_email_policy(
            request.team_id,
            &request.user_id,
            OpenEmailPolicy::Existing {
                consent_incarnation: request.generation.consent_incarnation,
            },
        )
        .await
    }
    async fn open_source_policy(
        &self,
        team: Uuid,
        candidate: &EmailPolicySourceCandidate,
    ) -> Result<Option<Self::History>, CrmError> {
        self.open_email_policy(
            team,
            &candidate.reference.user_id,
            OpenEmailPolicy::Existing {
                consent_incarnation: candidate.generation.consent_incarnation,
            },
        )
        .await
    }
    async fn next_source_event(&self) -> Result<Option<Self::Source>, CrmError> {
        self.next_email_policy_source_event().await
    }
}

impl CompaniesRepositoryImpl {
    /// Called inside a privacy edit's transaction after its exclusive team lock.
    pub(in crate::outbound::companies_repo) async fn schedule_contribution_history(
        conn: &mut sqlx::PgConnection,
        team: Uuid,
        user: Option<&str>,
    ) -> Result<(), CrmError> {
        sqlx::query_file!(
            "src/outbound/companies_repo/email_policy/schedule.sql",
            team,
            user,
            Self::current_traceparent(),
            Uuid::now_v7()
        )
        .execute(conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
}

impl PgEmailPolicyTransaction {
    pub(super) async fn publish_history_work(
        &mut self,
        work_id: Uuid,
        traceparent: Option<&str>,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"INSERT INTO crm_email_backfill_outbox
               (team_id, user_id, link_id, consent_incarnation, policy_version, work_id, traceparent)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (team_id, user_id) DO UPDATE SET link_id = EXCLUDED.link_id,
                   consent_incarnation = EXCLUDED.consent_incarnation, policy_version = EXCLUDED.policy_version,
                   work_id = EXCLUDED.work_id, traceparent = EXCLUDED.traceparent, requested_at = now()"#,
            self.team, self.user, self.state.link_id, self.state.generation.consent_incarnation,
            self.state.generation.policy_version, work_id, traceparent
        ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
}

impl EmailPolicyHistoryTransaction for PgEmailPolicyTransaction {
    async fn history_mailbox(&mut self) -> Result<Option<EmailContributionMailbox>, CrmError> {
        sqlx::query_as!(
            EmailContributionMailbox,
            r#"SELECT id AS link_id, email_address FROM email_links
               WHERE id = $1 AND macro_id = $2 AND is_primary AND deleting_at IS NULL
                 AND disconnect_requested_at IS NULL AND NOT needs_reauth"#,
            self.state.link_id,
            self.user
        )
        .fetch_optional(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    async fn history_work(&mut self) -> Result<Option<EmailPolicyHistoryWork>, CrmError> {
        let Some(row) = sqlx::query!(
            r#"SELECT work_id, link_id, consent_incarnation, policy_version, after_contact_address, received_pass
               FROM crm_email_policy_work WHERE team_id = $1 AND user_id = $2"#,
            self.team, self.user
        ).fetch_optional(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))? else { return Ok(None) };
        Ok(Some(EmailPolicyHistoryWork {
            request: EmailPolicyWorkRequest {
                team_id: self.team,
                user_id: self.user.clone(),
                link_id: row.link_id,
                work_id: row.work_id,
                generation: EmailPolicyGeneration {
                    consent_incarnation: row.consent_incarnation,
                    policy_version: row.policy_version,
                },
            },
            cursor: EmailPolicyHistoryCursor {
                after_contact_address: row.after_contact_address,
                received_pass: row.received_pass,
            },
        }))
    }

    async fn history_contacts(
        &mut self,
        after: Option<&str>,
    ) -> Result<Vec<EmailPolicyHistoryContact>, CrmError> {
        // No normalization or eligibility predicate before LIMIT: misses also
        // advance, and the existing unique mailbox/address index bounds work.
        sqlx::query_as!(
            EmailPolicyHistoryContact,
            r#"SELECT email_address AS address, name FROM email_contacts
               WHERE link_id = $1 AND email_address > COALESCE($2, '')
               ORDER BY email_address LIMIT 100"#,
            self.state.link_id,
            after
        )
        .fetch_all(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    async fn finish_history_page(
        &mut self,
        request: &EmailPolicyWorkRequest,
        expected: &EmailPolicyHistoryCursor,
        next: Option<&EmailPolicyHistoryCursor>,
    ) -> Result<bool, CrmError> {
        if request.generation.consent_incarnation != self.state.generation.consent_incarnation
            || request.link_id != self.state.link_id
            || request.team_id != self.team
            || request.user_id != self.user
        {
            return Ok(false);
        }
        if let Some(next) = next {
            if request.generation != self.state.generation
                || (expected.received_pass && !next.received_pass)
            {
                return Ok(false);
            }
            let changed = sqlx::query!(
                r#"UPDATE crm_email_policy_work SET after_contact_address = $8, received_pass = $9
                   WHERE team_id = $1 AND user_id = $2 AND work_id = $3
                     AND consent_incarnation = $4 AND policy_version = $5
                     AND after_contact_address IS NOT DISTINCT FROM $6 AND received_pass = $7
                     AND (($9 AND NOT $7) OR ($9 = $7 AND $8::text > COALESCE(after_contact_address, '')))"#,
                self.team,
                self.user,
                request.work_id,
                request.generation.consent_incarnation,
                request.generation.policy_version,
                expected.after_contact_address,
                expected.received_pass,
                next.after_contact_address,
                next.received_pass
            )
            .execute(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?
            .rows_affected();
            if changed == 0 {
                return Ok(false);
            }
            let traceparent = CompaniesRepositoryImpl::current_traceparent();
            self.publish_history_work(request.work_id, traceparent.as_deref())
                .await?;
        } else {
            let changed = sqlx::query!(
                r#"DELETE FROM crm_email_policy_work WHERE team_id = $1 AND user_id = $2
                   AND work_id = $3 AND consent_incarnation = $4 AND policy_version = $5
                   AND after_contact_address IS NOT DISTINCT FROM $6 AND received_pass = $7"#,
                self.team,
                self.user,
                request.work_id,
                request.generation.consent_incarnation,
                request.generation.policy_version,
                expected.after_contact_address,
                expected.received_pass
            )
            .execute(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?
            .rows_affected();
            if changed == 0 {
                return Ok(false);
            }
            sqlx::query!(
                r#"DELETE FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2
                   AND work_id = $3 AND consent_incarnation = $4 AND policy_version = $5"#,
                self.team,
                self.user,
                request.work_id,
                request.generation.consent_incarnation,
                request.generation.policy_version
            )
            .execute(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }
        Ok(true)
    }
}

impl EmailPolicySourceWorkerTransaction for PgEmailPolicySourceTransaction {
    fn adopt_trace(&self, span: &tracing::Span) {
        use tracing_opentelemetry::OpenTelemetrySpanExt;
        if let Some(parent) = &self.event.traceparent {
            let carrier =
                std::collections::HashMap::from([("traceparent".to_string(), parent.clone())]);
            let context = opentelemetry::global::get_text_map_propagator(|p| p.extract(&carrier));
            let _ = span.set_parent(context);
        }
    }

    async fn source_candidates(
        &mut self,
        references: &[EmailPolicySourceReference],
    ) -> Result<Vec<EmailPolicySourceCandidate>, CrmError> {
        if references.len() > 100 {
            return Err(CrmError::InvalidRequest(
                "source page exceeds its bound".into(),
            ));
        }
        let users: Vec<_> = references.iter().map(|r| r.user_id.clone()).collect();
        let revisions: Vec<_> = references.iter().map(|r| r.revision).collect();
        let rows = sqlx::query!(
            r#"SELECT r.user_id AS "user_id!", r.revision AS "revision!", c.consent_incarnation AS "consent_incarnation!", c.policy_version
               FROM unnest($2::text[], $3::bigint[]) r(user_id, revision)
               CROSS JOIN LATERAL (
                   SELECT consent_incarnation, policy_version FROM crm_email_consent
                   WHERE team_id = $1 AND user_id = r.user_id AND active_rule_revision = r.revision
                     AND mode = 'selected' AND selected_enabled AND consent_incarnation IS NOT NULL
                   OFFSET 0
               ) c"#,
            self.event.team_id, &users, &revisions
        ).fetch_all(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(rows
            .into_iter()
            .map(|r| EmailPolicySourceCandidate {
                reference: EmailPolicySourceReference {
                    user_id: r.user_id,
                    revision: r.revision,
                },
                generation: EmailPolicyGeneration {
                    consent_incarnation: r.consent_incarnation,
                    policy_version: r.policy_version,
                },
            })
            .collect())
    }
}
