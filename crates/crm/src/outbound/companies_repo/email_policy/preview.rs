//! Bounded preview metadata. Mail scanning lives in a separate read-only snapshot.
mod snapshot;
use super::*;
use crate::domain::{email_policy_api::*, email_policy_preview::*};
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;

struct PreviewRow {
    team_id: Uuid,
    user_id: String,
    link_id: Uuid,
    preview_id: Uuid,
    context_id: Uuid,
    definition: serde_json::Value,
    status: String,
    counts: serde_json::Value,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    as_of: Option<DateTime<Utc>>,
    scanned_threads: i64,
    observed_token: Option<serde_json::Value>,
    observed_fingerprint: Option<String>,
    request_hash: Option<Vec<u8>>,
    traceparent: Option<String>,
}
impl PreviewRow {
    fn view(&self) -> Result<EmailPreviewView, CrmError> {
        Ok(EmailPreviewView {
            preview_id: self.preview_id,
            context_id: self.context_id,
            status: serde_json::from_value(serde_json::Value::String(self.status.clone()))
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            counts: serde_json::from_value(self.counts.clone())
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            as_of: self.as_of,
            created_at: self.created_at,
            expires_at: self.expires_at,
            scanned_threads: self.scanned_threads,
        })
    }
    fn job(self) -> Result<EmailPreviewJob, CrmError> {
        Ok(EmailPreviewJob {
            view: self.view()?,
            team_id: self.team_id,
            user_id: self.user_id,
            link_id: self.link_id,
            token: serde_json::from_value(
                self.observed_token.ok_or(CrmError::EmailPolicyConflict)?,
            )
            .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            observed_fingerprint: self
                .observed_fingerprint
                .ok_or(CrmError::EmailPolicyConflict)?,
            rules: serde_json::from_value(self.definition)
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            traceparent: self.traceparent,
        })
    }
}
async fn read_preview(
    conn: &mut PgConnection,
    team: Uuid,
    user: &str,
) -> Result<Option<PreviewRow>, CrmError> {
    sqlx::query_as!(PreviewRow,
        r#"SELECT team_id,user_id,link_id,preview_id,context_id,definition,status,counts,
           created_at,expires_at,as_of,scanned_threads,observed_token,observed_fingerprint,request_hash,traceparent
           FROM crm_email_policy_previews WHERE team_id=$1 AND user_id=$2"#,team,user
    ).fetch_optional(conn).await.map_err(|e|CrmError::StorageLayerError(e.into()))
}

impl CompaniesRepositoryImpl {
    /// Invalidate count results in the matching edit's own transaction. Empty
    /// dormant metadata is one indexed team probe, without email-table work.
    pub(in crate::outbound::companies_repo) async fn invalidate_email_previews(
        conn: &mut PgConnection,
        team: Uuid,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"UPDATE crm_email_policy_previews SET status='stale'
               WHERE team_id=$1 AND request_hash IS NOT NULL AND status IN ('pending','running','complete','partial')"#,
            team
        ).execute(conn).await.map_err(|e|CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
}

impl EmailPreviewRepository for CompaniesRepositoryImpl {
    type Snapshot = snapshot::PgEmailPreviewSnapshot;

    #[tracing::instrument(skip_all,fields(team_id=%team),err)]
    async fn start_email_preview(
        &self,
        team: Uuid,
        user: &str,
        input: &EmailPreviewRequest,
    ) -> Result<EmailPreviewView, CrmError> {
        input
            .rules
            .validate_shape()
            .map_err(|e| CrmError::InvalidRequest(e.to_string()))?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::lock_email_privacy(&mut tx, team, true).await?;
        let observed = super::authoring::observe(&mut tx, team, user).await?;
        let Some(link) = observed.link_id else {
            return Err(CrmError::EmailPolicyConflict);
        };
        let locked=sqlx::query_scalar!(
            r#"SELECT l.id FROM email_links l JOIN team_user member ON member.user_id=l.macro_id AND member.team_id=$1
               WHERE l.id=$3 AND l.macro_id=$2 AND l.is_primary AND l.deleting_at IS NULL
                 AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth FOR SHARE OF l,member"#,
            team,user,link
        ).fetch_optional(&mut *tx).await.map_err(|e|CrmError::StorageLayerError(e.into()))?;
        if locked.is_none() {
            return Err(CrmError::EmailPolicyConflict);
        }
        let observed = super::authoring::observe(&mut tx, team, user).await?;
        if observed.token.as_ref() != Some(&input.if_policy) {
            return Err(CrmError::EmailPolicyConflict);
        }
        let request_hash = Sha256::digest(
            serde_json::to_vec(input).map_err(|e| CrmError::StorageLayerError(e.into()))?,
        )
        .to_vec();
        let existing = read_preview(&mut tx, team, user).await?;
        if let Some(existing) = &existing
            && existing.request_hash.as_ref() == Some(&request_hash)
        {
            let mut view = existing.view()?;
            if existing.observed_fingerprint.as_ref() != Some(&observed.fingerprint) {
                view.status = EmailPolicyPreviewStatus::Stale;
            }
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(view);
        }
        if existing.as_ref().map(|row| row.preview_id) != input.if_preview_id {
            return Err(CrmError::EmailPolicyConflict);
        }
        if existing
            .as_ref()
            .is_some_and(|row| row.created_at > Utc::now() - chrono::Duration::seconds(30))
        {
            return Err(CrmError::EmailPreviewRateLimited);
        }
        // Repeat target authorization under the same coordination as enqueue.
        // No live expansion is stored and no consent identity is initialized.
        let facts =
            super::targets::read_targets(&mut tx, team, user, link, &input.rules.include, true)
                .await?;
        facts.validate_references(&input.rules.include)?;
        let incarnation = match input.if_policy {
            EmailPolicyToken::Policy {
                consent_incarnation,
                ..
            } => Some(consent_incarnation),
            _ => None,
        };
        let definition = serde_json::to_value(&input.rules)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let token = serde_json::to_value(&input.if_policy)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let preview_id = Uuid::now_v7();
        sqlx::query!(
            r#"INSERT INTO crm_email_policy_previews
               (team_id,user_id,link_id,preview_id,context_id,consent_incarnation,policy_version,
                definition,observed_token,observed_fingerprint,request_hash,expires_at,traceparent)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '5 minutes',$12)
               ON CONFLICT(team_id,user_id) DO UPDATE SET link_id=EXCLUDED.link_id,preview_id=EXCLUDED.preview_id,
                   context_id=EXCLUDED.context_id,consent_incarnation=EXCLUDED.consent_incarnation,policy_version=EXCLUDED.policy_version,
                   definition=EXCLUDED.definition,observed_token=EXCLUDED.observed_token,observed_fingerprint=EXCLUDED.observed_fingerprint,
                   request_hash=EXCLUDED.request_hash,status='pending',counts='{}',after_thread_id=NULL,scanned_threads=0,
                   created_at=now(),expires_at=EXCLUDED.expires_at,run_after=now(),as_of=NULL,traceparent=EXCLUDED.traceparent"#,
            team,user,link,preview_id,Uuid::now_v7(),incarnation,observed.policy_version,definition,token,observed.fingerprint,request_hash,Self::current_traceparent()
        ).execute(&mut *tx).await.map_err(|e|CrmError::StorageLayerError(e.into()))?;
        let view = read_preview(&mut tx, team, user)
            .await?
            .ok_or(CrmError::EmailPolicyConflict)?
            .view()?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(view)
    }

    async fn email_preview(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<Option<EmailPreviewView>, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let observed = super::authoring::observe(&mut tx, team, user).await?;
        let row = read_preview(&mut tx, team, user).await?;
        let view = row
            .map(|row| -> Result<EmailPreviewView, CrmError> {
                let mut view = row.view()?;
                if row.observed_fingerprint.as_ref() != Some(&observed.fingerprint) {
                    view.status = EmailPolicyPreviewStatus::Stale;
                }
                Ok(view)
            })
            .transpose()?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(view)
    }

    async fn cancel_email_preview(
        &self,
        team: Uuid,
        user: &str,
        preview_id: Uuid,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"UPDATE crm_email_policy_previews SET status='cancelled'
               WHERE team_id=$1 AND user_id=$2 AND preview_id=$3
                 AND EXISTS(SELECT 1 FROM team_user WHERE team_id=$1 AND user_id=$2)"#,
            team,
            user,
            preview_id
        )
        .execute(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }

    async fn claim_email_preview(&self) -> Result<Option<EmailPreviewJob>, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let row=sqlx::query_as!(PreviewRow,
            r#"WITH claimed AS MATERIALIZED (
                 SELECT team_id,user_id FROM crm_email_policy_previews
                 WHERE request_hash IS NOT NULL AND status IN ('pending','running') AND run_after<=now()
                 ORDER BY run_after,team_id,user_id FOR UPDATE SKIP LOCKED LIMIT 1
               )
               UPDATE crm_email_policy_previews p SET status='running',context_id=$1,
                   run_after=now()+interval '6 minutes',counts='{}',scanned_threads=0,after_thread_id=NULL,as_of=NULL
               FROM claimed c WHERE p.team_id=c.team_id AND p.user_id=c.user_id
               RETURNING p.team_id,p.user_id,p.link_id,p.preview_id,p.context_id,p.definition,p.status,p.counts,
                   p.created_at,p.expires_at,p.as_of,p.scanned_threads,p.observed_token,p.observed_fingerprint,p.request_hash,p.traceparent"#,
            Uuid::now_v7()
        ).fetch_optional(&mut *tx).await.map_err(|e|CrmError::StorageLayerError(e.into()))?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        row.map(PreviewRow::job).transpose()
    }

    async fn open_email_preview(
        &self,
        job: &EmailPreviewJob,
    ) -> Result<Option<Self::Snapshot>, CrmError> {
        snapshot::PgEmailPreviewSnapshot::open(&self.pool, job).await
    }

    async fn finish_email_preview(
        &self,
        job: &EmailPreviewJob,
        view: &EmailPreviewView,
    ) -> Result<bool, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::lock_email_privacy(&mut tx, job.team_id, false).await?;
        let observed = match super::authoring::observe(&mut tx, job.team_id, &job.user_id).await {
            Ok(observed) => observed,
            Err(CrmError::AccessDenied) => return Ok(false),
            Err(error) => return Err(error),
        };
        let status = if observed.fingerprint == job.observed_fingerprint {
            view.status
        } else {
            EmailPolicyPreviewStatus::Stale
        };
        let status =
            serde_json::to_value(status).map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let counts = serde_json::to_value(&view.counts)
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let changed=sqlx::query!(
            r#"UPDATE crm_email_policy_previews SET status=$5::jsonb #>> '{}',counts=$6,scanned_threads=$7,as_of=$8
               WHERE team_id=$1 AND user_id=$2 AND preview_id=$3 AND context_id=$4
                 AND status IN ('pending','running')"#,
            job.team_id,job.user_id,job.view.preview_id,job.view.context_id,status,counts,view.scanned_threads,view.as_of
        ).execute(&mut *tx).await.map_err(|e|CrmError::StorageLayerError(e.into()))?.rows_affected()>0;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(changed && observed.fingerprint == job.observed_fingerprint)
    }

    fn adopt_preview_trace(&self, job: &EmailPreviewJob, span: &tracing::Span) {
        use tracing_opentelemetry::OpenTelemetrySpanExt;
        if let Some(parent) = &job.traceparent {
            let carrier =
                std::collections::HashMap::from([("traceparent".to_owned(), parent.clone())]);
            let context = opentelemetry::global::get_text_map_propagator(|propagator| {
                propagator.extract(&carrier)
            });
            let _ = span.set_parent(context);
        }
    }
}
