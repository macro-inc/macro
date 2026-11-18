use super::PgEmailPolicyTransaction;
use crate::domain::{email_policy::*, email_rules::EmailRuleSet, model::CrmError};
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use uuid::Uuid;

impl PgEmailPolicyTransaction {
    // A slot remembers only its current occupant; retaining the start outcome
    // also prevents an older request from resurrecting after replacement or
    // completion. The hash includes the operation kind to keep this shared
    // incarnation-scoped idempotency keyspace unambiguous.
    async fn record_job_start(
        &mut self,
        job_id: Uuid,
        kind: &str,
        input: serde_json::Value,
    ) -> Result<bool, CrmError> {
        let command = serde_json::json!({
            "kind": kind, "generation": self.state.generation,
            "link_id": self.state.link_id, "input": input,
        });
        let encoded =
            serde_json::to_vec(&command).map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let hash = Sha256::digest(encoded).to_vec();
        if let Some(previous) = self.idempotency(job_id).await? {
            if previous.request_hash != hash {
                return Err(CrmError::InvalidRequest(
                    "job id already belongs to another request".into(),
                ));
            }
            return Ok(false);
        }
        self.record_idempotency(&NewEmailPolicyIdempotency {
            request_id: job_id,
            expected_policy_version: self.state.generation.policy_version,
            request_hash: hash,
            outcome: serde_json::json!({"kind": kind, "job_id": job_id}),
        })
        .await
    }
}

impl EmailPolicyTransaction for PgEmailPolicyTransaction {
    fn state(&self) -> &EmailPolicyState {
        &self.state
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn idempotency(
        &mut self,
        request_id: Uuid,
    ) -> Result<Option<EmailPolicyIdempotency>, CrmError> {
        sqlx::query_as!(
            EmailPolicyIdempotency,
            r#"SELECT request_id, expected_policy_version, policy_version, request_hash, outcome
               FROM crm_email_policy_idempotency
               WHERE team_id = $1 AND user_id = $2 AND consent_incarnation = $3 AND request_id = $4"#,
            self.team, self.user, self.state.generation.consent_incarnation, request_id
        ).fetch_optional(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn record_idempotency(
        &mut self,
        result: &NewEmailPolicyIdempotency,
    ) -> Result<bool, CrmError> {
        // The committed version comes from the locked consent, never a payload.
        Ok(sqlx::query!(
            r#"INSERT INTO crm_email_policy_idempotency
               (team_id, user_id, consent_incarnation, request_id, link_id,
                expected_policy_version, policy_version, request_hash, outcome)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (team_id, user_id, consent_incarnation, request_id) DO NOTHING"#,
            self.team,
            self.user,
            self.state.generation.consent_incarnation,
            result.request_id,
            self.state.link_id,
            result.expected_policy_version,
            self.state.generation.policy_version,
            result.request_hash,
            result.outcome
        )
        .execute(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .rows_affected()
            > 0)
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, event_id = %entry.event_id), err)]
    async fn record_audit(&mut self, entry: &NewEmailPolicyAudit) -> Result<bool, CrmError> {
        let action = serde_json::to_value(entry.action)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let actor = serde_json::to_value(entry.actor_kind)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(sqlx::query!(
            r#"INSERT INTO crm_email_policy_audit
               (team_id, user_id, event_id, link_id, consent_incarnation, policy_version,
                action, actor_kind, agent_id, agent_session_id, previous_revision, next_revision, details)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb #>> '{}', $8::jsonb #>> '{}', $9, $10, $11, $12, $13)
               ON CONFLICT (team_id, user_id, event_id) DO NOTHING"#,
            self.team, self.user, entry.event_id, self.state.link_id,
            self.state.generation.consent_incarnation, self.state.generation.policy_version,
            action, actor, entry.agent_id, entry.agent_session_id,
            entry.previous_revision, entry.next_revision, entry.details
        ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?.rows_affected() > 0)
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn audit_page(
        &mut self,
        before: Option<Uuid>,
    ) -> Result<Vec<EmailPolicyAudit>, CrmError> {
        let rows = sqlx::query!(
            r#"SELECT event_id, link_id, consent_incarnation, policy_version, action, actor_kind,
                      agent_id, agent_session_id, previous_revision, next_revision, details, created_at
               FROM crm_email_policy_audit WHERE team_id = $1 AND user_id = $2
                 AND event_id < COALESCE($3, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
               ORDER BY event_id DESC LIMIT 50"#,
            self.team, self.user, before
        ).fetch_all(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        rows.into_iter()
            .map(|row| {
                Ok(EmailPolicyAudit {
                    entry: NewEmailPolicyAudit {
                        event_id: row.event_id,
                        action: serde_json::from_value(serde_json::Value::String(row.action))
                            .map_err(|e| CrmError::StorageLayerError(e.into()))?,
                        actor_kind: serde_json::from_value(serde_json::Value::String(
                            row.actor_kind,
                        ))
                        .map_err(|e| CrmError::StorageLayerError(e.into()))?,
                        agent_id: row.agent_id,
                        agent_session_id: row.agent_session_id,
                        previous_revision: row.previous_revision,
                        next_revision: row.next_revision,
                        details: row.details,
                    },
                    link_id: row.link_id,
                    consent_incarnation: row.consent_incarnation,
                    policy_version: row.policy_version,
                    created_at: row.created_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, preview_id = %preview_id), err)]
    async fn start_preview(
        &mut self,
        preview_id: Uuid,
        context_id: Uuid,
        definition: &EmailRuleSet,
        expires_at: DateTime<Utc>,
    ) -> Result<(), CrmError> {
        if !self
            .record_job_start(
                preview_id,
                "preview",
                serde_json::json!({
                    "context_id": context_id, "definition": definition,
                    "expires_at_micros": expires_at.timestamp_micros(),
                }),
            )
            .await?
        {
            return Ok(());
        }
        let definition =
            serde_json::to_value(definition).map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let counts = serde_json::to_value(EmailPolicyPreviewCounts::default())
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!(
            r#"INSERT INTO crm_email_policy_previews
               (team_id, user_id, preview_id, link_id, consent_incarnation, policy_version,
                context_id, definition, counts, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (team_id, user_id) DO UPDATE
               SET preview_id = EXCLUDED.preview_id, link_id = EXCLUDED.link_id,
                   consent_incarnation = EXCLUDED.consent_incarnation, policy_version = EXCLUDED.policy_version,
                   context_id = EXCLUDED.context_id, definition = EXCLUDED.definition,
                   status = 'pending', counts = EXCLUDED.counts, after_thread_id = NULL,
                   scanned_threads = 0, created_at = now(), expires_at = EXCLUDED.expires_at
"#,
            self.team, self.user, preview_id, self.state.link_id, self.state.generation.consent_incarnation,
            self.state.generation.policy_version, context_id, definition, counts, expires_at
        ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, preview_id = %preview_id), err)]
    async fn preview(&mut self, preview_id: Uuid) -> Result<Option<EmailPolicyPreview>, CrmError> {
        let Some(row) = sqlx::query!(
            r#"SELECT preview_id, consent_incarnation, policy_version, context_id, definition,
                      status, counts, after_thread_id, scanned_threads, created_at, expires_at
               FROM crm_email_policy_previews WHERE team_id = $1 AND user_id = $2
                 AND preview_id = $3 AND consent_incarnation = $4 AND policy_version = $5"#,
            self.team,
            self.user,
            preview_id,
            self.state.generation.consent_incarnation,
            self.state.generation.policy_version
        )
        .fetch_optional(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        else {
            return Ok(None);
        };
        Ok(Some(EmailPolicyPreview {
            preview_id: row.preview_id,
            generation: EmailPolicyGeneration {
                consent_incarnation: row
                    .consent_incarnation
                    .ok_or(CrmError::EmailPolicyConflict)?,
                policy_version: row.policy_version,
            },
            context_id: row.context_id,
            definition: serde_json::from_value(row.definition)
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            status: serde_json::from_value(serde_json::Value::String(row.status))
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            counts: serde_json::from_value(row.counts)
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            after_thread_id: row.after_thread_id,
            scanned_threads: row.scanned_threads,
            created_at: row.created_at,
            expires_at: row.expires_at,
        }))
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, preview_id = %preview_id), err)]
    async fn checkpoint_preview(
        &mut self,
        preview_id: Uuid,
        generation: EmailPolicyGeneration,
        context_id: Uuid,
        progress: &EmailPolicyPreviewProgress,
    ) -> Result<bool, CrmError> {
        if generation != self.state.generation {
            return Ok(false);
        }
        if progress.status == EmailPolicyPreviewStatus::Pending {
            return Err(CrmError::InvalidRequest(
                "a preview checkpoint cannot return to pending".into(),
            ));
        }
        let status = serde_json::to_value(progress.status)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let counts = serde_json::to_value(&progress.counts)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(sqlx::query!(
            r#"UPDATE crm_email_policy_previews
               SET status = $7::jsonb #>> '{}', counts = $8, after_thread_id = $9, scanned_threads = $10
               WHERE team_id = $1 AND user_id = $2 AND preview_id = $3
                 AND consent_incarnation = $4 AND policy_version = $5 AND context_id = $6
                 AND status IN ('pending', 'running') AND expires_at > clock_timestamp()
                 AND scanned_threads <= $10
                 AND (after_thread_id IS NULL OR after_thread_id <= $9)"#,
            self.team, self.user, preview_id, self.state.generation.consent_incarnation,
            self.state.generation.policy_version, context_id, status, counts,
            progress.after_thread_id, progress.scanned_threads
        ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?.rows_affected() > 0)
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, work_id = %work_id), err)]
    async fn request_work(
        &mut self,
        work_id: Uuid,
        traceparent: Option<&str>,
    ) -> Result<(), CrmError> {
        if !self
            .record_job_start(work_id, "history", serde_json::json!({}))
            .await?
        {
            return Ok(());
        }
        let current_trace = super::CompaniesRepositoryImpl::current_traceparent();
        let traceparent = traceparent.or(current_trace.as_deref());
        sqlx::query!(
            r#"INSERT INTO crm_email_policy_work
               (team_id, user_id, work_id, link_id, consent_incarnation, policy_version, traceparent)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (team_id, user_id) DO UPDATE SET work_id = EXCLUDED.work_id,
                   link_id = EXCLUDED.link_id, consent_incarnation = EXCLUDED.consent_incarnation,
                   policy_version = EXCLUDED.policy_version, after_thread_id = NULL, after_contact_address = NULL, received_pass = FALSE,
                   requested_at = now(), traceparent = EXCLUDED.traceparent
               WHERE (crm_email_policy_work.work_id, crm_email_policy_work.consent_incarnation,
                      crm_email_policy_work.policy_version)
                   IS DISTINCT FROM (EXCLUDED.work_id, EXCLUDED.consent_incarnation, EXCLUDED.policy_version)"#,
            self.team, self.user, work_id, self.state.link_id, self.state.generation.consent_incarnation,
            self.state.generation.policy_version, traceparent
        ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        self.publish_history_work(work_id, traceparent).await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn work(&mut self) -> Result<Option<EmailPolicyWork>, CrmError> {
        let Some(row) = sqlx::query!(
            r#"SELECT work_id, consent_incarnation, policy_version, after_thread_id, requested_at, traceparent
               FROM crm_email_policy_work WHERE team_id = $1 AND user_id = $2
                 AND consent_incarnation = $3 AND policy_version = $4"#,
            self.team, self.user, self.state.generation.consent_incarnation, self.state.generation.policy_version
        ).fetch_optional(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))? else {
            return Ok(None);
        };
        Ok(Some(EmailPolicyWork {
            work_id: row.work_id,
            generation: EmailPolicyGeneration {
                consent_incarnation: row.consent_incarnation,
                policy_version: row.policy_version,
            },
            after_thread_id: row.after_thread_id,
            requested_at: row.requested_at,
            traceparent: row.traceparent,
        }))
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, work_id = %work_id), err)]
    async fn checkpoint_work(
        &mut self,
        work_id: Uuid,
        generation: EmailPolicyGeneration,
        after_thread_id: Uuid,
    ) -> Result<bool, CrmError> {
        if generation != self.state.generation {
            return Ok(false);
        }
        Ok(sqlx::query!(
            r#"UPDATE crm_email_policy_work SET after_thread_id = $6
               WHERE team_id = $1 AND user_id = $2 AND work_id = $3
                 AND consent_incarnation = $4 AND policy_version = $5
                 AND (after_thread_id IS NULL OR after_thread_id <= $6)"#,
            self.team,
            self.user,
            work_id,
            self.state.generation.consent_incarnation,
            self.state.generation.policy_version,
            after_thread_id
        )
        .execute(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .rows_affected()
            > 0)
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team, work_id = %work_id), err)]
    async fn complete_work(
        &mut self,
        work_id: Uuid,
        generation: EmailPolicyGeneration,
    ) -> Result<bool, CrmError> {
        if generation != self.state.generation {
            return Ok(false);
        }
        Ok(sqlx::query!(
            r#"DELETE FROM crm_email_policy_work WHERE team_id = $1 AND user_id = $2
               AND work_id = $3 AND consent_incarnation = $4 AND policy_version = $5"#,
            self.team,
            self.user,
            work_id,
            self.state.generation.consent_incarnation,
            self.state.generation.policy_version
        )
        .execute(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .rows_affected()
            > 0)
    }

    async fn commit(self) -> Result<(), CrmError> {
        self.tx
            .commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))
    }
}
