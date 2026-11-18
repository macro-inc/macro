use super::{CompaniesRepositoryImpl, PgEmailPolicySourceTransaction};
use crate::domain::{email_policy::*, model::CrmError};
use sqlx::PgConnection;

impl CompaniesRepositoryImpl {
    /// Record one source event inside the source edit's existing transaction,
    /// after its exclusive team privacy lock. Recording an event never scans
    /// its references; ordinary edits use the indexed conditional helpers.
    #[tracing::instrument(skip_all, fields(team_id = %event.team_id, event_id = %event.event_id), err)]
    pub async fn record_email_policy_source_event(
        connection: &mut PgConnection,
        event: &EmailPolicySourceEvent,
    ) -> Result<bool, CrmError> {
        let kind = match event.source_kind {
            EmailPolicySourceKind::Contact => "contact",
            EmailPolicySourceKind::Company => "company",
            EmailPolicySourceKind::Team => "team",
        };
        Ok(sqlx::query!(
            r#"INSERT INTO crm_email_policy_source_events
               (event_id, team_id, source_kind, source_id, traceparent)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING"#,
            event.event_id,
            event.team_id,
            kind,
            event.source_id,
            event.traceparent
        )
        .execute(connection)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .rows_affected()
            > 0)
    }
}

impl EmailPolicySourceTransaction for PgEmailPolicySourceTransaction {
    fn event(&self) -> &EmailPolicySourceEvent {
        &self.event
    }

    #[tracing::instrument(skip_all, fields(event_id = %self.event.event_id), err)]
    async fn references(&mut self) -> Result<Vec<EmailPolicySourceReference>, CrmError> {
        let user = self
            .event
            .after
            .as_ref()
            .map(|c| c.user_id.as_str())
            .unwrap_or("");
        let revision = self.event.after.as_ref().map(|c| c.revision).unwrap_or(0);
        // Page raw references, then let the worker check active consent. Filtering
        // out historical revisions before LIMIT would make misses unbounded.
        match self.event.source_kind {
            EmailPolicySourceKind::Contact => sqlx::query_as!(
                EmailPolicySourceReference,
                r#"SELECT user_id, revision FROM crm_email_rule_contacts
                   WHERE team_id = $1 AND contact_id = $2 AND (user_id, revision) > ($3, $4)
                   ORDER BY user_id, revision LIMIT 100"#,
                self.event.team_id,
                self.event.source_id,
                user,
                revision
            )
            .fetch_all(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into())),
            // Raw consent owners bound work even when most of the team has no
            // active selected policy. Revision 1 is only a cursor placeholder
            // for legacy rows; source_candidates rechecks the stored revision.
            EmailPolicySourceKind::Team => sqlx::query_as!(
                EmailPolicySourceReference,
                r#"SELECT user_id, COALESCE(active_rule_revision, 1) AS "revision!"
                   FROM crm_email_consent WHERE team_id = $1 AND user_id > $2
                   ORDER BY user_id LIMIT 100"#,
                self.event.team_id,
                user
            )
            .fetch_all(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into())),
            EmailPolicySourceKind::Company => sqlx::query_as!(
                EmailPolicySourceReference,
                r#"SELECT user_id, revision FROM crm_email_rule_companies
                   WHERE team_id = $1 AND company_id = $2 AND (user_id, revision) > ($3, $4)
                   ORDER BY user_id, revision LIMIT 100"#,
                self.event.team_id,
                self.event.source_id,
                user,
                revision
            )
            .fetch_all(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into())),
        }
    }

    #[tracing::instrument(skip_all, fields(event_id = %self.event.event_id), err)]
    async fn advance(
        &mut self,
        after: Option<&EmailPolicySourceReference>,
    ) -> Result<(), CrmError> {
        if let Some(after) = after {
            let changed = sqlx::query!(
                r#"UPDATE crm_email_policy_source_events SET after_user_id = $2, after_revision = $3
                   WHERE event_id = $1 AND (COALESCE(after_user_id, ''), COALESCE(after_revision, 0)) < ($2, $3)"#,
                self.event.event_id, after.user_id, after.revision
            ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
            if changed.rows_affected() > 0 {
                self.event.after = Some(after.clone());
            }
        } else {
            sqlx::query!(
                "DELETE FROM crm_email_policy_source_events WHERE event_id = $1",
                self.event.event_id
            )
            .execute(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }
        Ok(())
    }

    async fn commit(self) -> Result<(), CrmError> {
        self.tx
            .commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))
    }
}
