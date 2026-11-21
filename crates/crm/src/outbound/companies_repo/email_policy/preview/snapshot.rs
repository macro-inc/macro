use super::*;
use sqlx::{PgPool, Postgres, Transaction};

/// One bounded count traversal retains a stable, read-only database snapshot.
pub struct PgEmailPreviewSnapshot {
    tx: Transaction<'static, Postgres>,
    team: Uuid,
    user: String,
    link: Uuid,
    definition: serde_json::Value,
    as_of: DateTime<Utc>,
    after: Option<(DateTime<Utc>, Uuid)>,
}
impl PgEmailPreviewSnapshot {
    pub(super) async fn open(
        pool: &PgPool,
        job: &EmailPreviewJob,
    ) -> Result<Option<Self>, CrmError> {
        let mut tx = pool
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
        let observed =
            match super::super::authoring::observe(&mut tx, job.team_id, &job.user_id).await {
                Ok(observed) => observed,
                Err(CrmError::AccessDenied) => return Ok(None),
                Err(error) => return Err(error),
            };
        if observed.fingerprint != job.observed_fingerprint || observed.link_id != Some(job.link_id)
        {
            return Ok(None);
        }
        let as_of = sqlx::query_scalar!(r#"SELECT transaction_timestamp() AS "as_of!""#)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(Some(Self {
            tx,
            team: job.team_id,
            user: job.user_id.clone(),
            link: job.link_id,
            as_of,
            after: None,
            definition: serde_json::to_value(&job.rules)
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
        }))
    }
}
impl EmailPreviewSnapshot for PgEmailPreviewSnapshot {
    fn as_of(&self) -> DateTime<Utc> {
        self.as_of
    }
    #[tracing::instrument(name="crm.email_policy.preview_page",skip_all,fields(team_id=%self.team),err)]
    async fn next_page(&mut self, timeout_ms: u32) -> Result<EmailPreviewPage, CrmError> {
        let timeout = format!("{}ms", timeout_ms.clamp(1, 15_000));
        sqlx::query!("SELECT set_config('statement_timeout',$1,TRUE)", timeout)
            .fetch_one(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let rows = sqlx::query_file!(
            "src/outbound/companies_repo/email_policy/preview/page.sql",
            self.team,
            self.user,
            self.link,
            self.after.map(|c| c.0),
            self.after.map(|c| c.1),
            self.definition
        )
        .fetch_all(&mut *self.tx)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref()
                == Some("57014")
            {
                CrmError::EmailPreviewBudgetExhausted
            } else {
                CrmError::StorageLayerError(error.into())
            }
        })?;
        let mut page = EmailPreviewPage {
            scanned_threads: i64::try_from(rows.len())
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            ..Default::default()
        };
        for row in &rows {
            page.counts.current += u64::from(row.current);
            page.counts.proposed += u64::from(row.proposed);
            page.counts.added += u64::from(row.proposed && !row.current);
            page.counts.removed += u64::from(row.current && !row.proposed);
            page.counts.retained += u64::from(row.current && row.proposed);
            page.counts.denied += u64::from(row.denied);
        }
        if let Some(last) = rows.last() {
            self.after = Some((last.sort_ts, last.id));
        }
        Ok(page)
    }
}
