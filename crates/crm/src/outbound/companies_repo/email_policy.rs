//! Owner-bound policy transactions, history work and count-preview storage.

mod authoring;
mod envelopes;
mod history;
mod mutations;
mod population;
mod preview;
mod source_changes;
mod sources;
mod targets;

use super::CompaniesRepositoryImpl;
use crate::domain::{email_policy::*, model::CrmError};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

/// A locked consent and its metadata, committed as one unit by the use case.
pub struct PgEmailPolicyTransaction {
    tx: Transaction<'static, Postgres>,
    team: Uuid,
    user: String,
    state: EmailPolicyState,
    initialized_legacy: bool,
    original_policy_version: i64,
    authority_fingerprint: Option<String>,
}

/// A source event stays locked while a bounded page is handled.
pub struct PgEmailPolicySourceTransaction {
    tx: Transaction<'static, Postgres>,
    event: EmailPolicySourceEvent,
}

impl EmailPolicyRepository for CompaniesRepositoryImpl {
    type Transaction = PgEmailPolicyTransaction;
    type SourceTransaction = PgEmailPolicySourceTransaction;

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn open_email_policy(
        &self,
        team: Uuid,
        user: &str,
        open: OpenEmailPolicy,
    ) -> Result<Option<Self::Transaction>, CrmError> {
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

        // Read the link without locking consent first: mailbox lifecycle writers
        // hold the mailbox before consent. Recheck consent after taking that lock.
        let existing_link = sqlx::query_scalar!(
            "SELECT link_id FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
            team,
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let link = match (existing_link, open) {
            (Some(link), _) => link,
            (
                None,
                OpenEmailPolicy::Initialize {
                    primary_link_id: Some(link),
                },
            ) => link,
            _ => return Ok(None),
        };
        let absent = existing_link.is_none();
        let locked = sqlx::query_scalar!(
            r#"SELECT l.id FROM email_links l
               JOIN team_user member ON member.user_id = l.macro_id AND member.team_id = $1
               WHERE l.id = $3 AND l.macro_id = $2
                 AND (NOT $4 OR (l.is_primary AND l.deleting_at IS NULL
                      AND l.disconnect_requested_at IS NULL AND NOT l.needs_reauth))
               FOR SHARE OF l FOR KEY SHARE OF member"#,
            team,
            user,
            link,
            absent
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if locked.is_none() {
            return Ok(None);
        }

        if let OpenEmailPolicy::Initialize { .. } = open {
            Self::initialize_policy_identity(&mut tx, team, user, link).await?;
        }

        let Some(row) = sqlx::query!(
            r#"SELECT link_id, consent_incarnation, policy_version, mode, enabled,
                      selected_enabled, active_rule_revision
               FROM crm_email_consent WHERE team_id = $1 AND user_id = $2 AND link_id = $3 FOR UPDATE"#,
            team, user, link
        ).fetch_optional(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))? else {
            return Ok(None);
        };
        let Some(consent_incarnation) = row.consent_incarnation else {
            return Ok(None);
        };
        if let OpenEmailPolicy::Existing {
            consent_incarnation: expected,
        } = open
            && expected != consent_incarnation
        {
            return Ok(None);
        }
        let mode = serde_json::from_value(serde_json::Value::String(row.mode))
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(Some(PgEmailPolicyTransaction {
            tx,
            team,
            user: user.to_owned(),
            initialized_legacy: false,
            original_policy_version: row.policy_version,
            authority_fingerprint: None,
            state: EmailPolicyState {
                link_id: row.link_id,
                generation: EmailPolicyGeneration {
                    consent_incarnation,
                    policy_version: row.policy_version,
                },
                mode,
                enabled: row.enabled,
                selected_enabled: row.selected_enabled,
                active_rule_revision: row.active_rule_revision,
            },
        }))
    }

    async fn next_email_policy_source_event(
        &self,
    ) -> Result<Option<Self::SourceTransaction>, CrmError> {
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
        let Some(row) = sqlx::query!(
            r#"SELECT event_id, team_id, source_kind, source_id, after_user_id, after_revision, traceparent
               FROM crm_email_policy_source_events ORDER BY event_id
               FOR UPDATE SKIP LOCKED LIMIT 1"#
        ).fetch_optional(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))? else {
            return Ok(None);
        };
        let source_kind = serde_json::from_value(serde_json::Value::String(row.source_kind))
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(Some(PgEmailPolicySourceTransaction {
            tx,
            event: EmailPolicySourceEvent {
                event_id: row.event_id,
                team_id: row.team_id,
                source_kind,
                source_id: row.source_id,
                after: row
                    .after_user_id
                    .zip(row.after_revision)
                    .map(|(user_id, revision)| EmailPolicySourceReference { user_id, revision }),
                traceparent: row.traceparent,
            },
        }))
    }
}
