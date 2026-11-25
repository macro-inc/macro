//! Teammates' sharing rules that name a merged company, rewritten in the
//! merge's transaction. Superseded revisions are history and stay as they are.

use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;

use super::*;
use crate::domain::{
    email_rules::{EmailPolicyActorKind, EmailPolicyAuditAction, EmailRuleSet},
    record_merge::MergeError,
};
use crate::outbound::record_merge::MergeChange;

fn db(error: sqlx::Error) -> MergeError {
    MergeError::Crm(CrmError::StorageLayerError(error.into()))
}

/// A member's active rules, as a merge finds them.
#[derive(Debug, Clone)]
pub(crate) struct MemberRules {
    pub(crate) user_id: String,
    pub(crate) revision: i64,
    pub(crate) rules: EmailRuleSet,
}

impl CompaniesRepositoryImpl {
    /// Members whose active rules name one of `companies`, by user. With
    /// `lock`, their consent rows are locked until commit.
    pub(crate) async fn rules_naming_companies(
        conn: &mut PgConnection,
        team: Uuid,
        companies: &[Uuid],
        lock: bool,
    ) -> Result<Vec<MemberRules>, MergeError> {
        // Starts from the companies' references (`crm_email_rule_companies_source`),
        // so the cost follows the rules that name them.
        let rows: Vec<(String, i64, serde_json::Value)> = if lock {
            sqlx::query!(
                r#"SELECT c.user_id, c.active_rule_revision AS "revision!", r.definition
                   FROM crm_email_consent c
                   JOIN crm_email_rule_revisions r
                     ON r.team_id = c.team_id AND r.user_id = c.user_id AND r.revision = c.active_rule_revision
                   WHERE c.team_id = $1
                     AND (c.user_id, c.active_rule_revision) IN (
                         SELECT rc.user_id, rc.revision FROM crm_email_rule_companies rc
                         WHERE rc.company_id = ANY($2) AND rc.team_id = $1
                     )
                   ORDER BY c.user_id
                   FOR UPDATE OF c"#,
                team,
                companies,
            )
            .fetch_all(&mut *conn)
            .await
            .map_err(db)?
            .into_iter()
            .map(|row| (row.user_id, row.revision, row.definition))
            .collect()
        } else {
            sqlx::query!(
                r#"SELECT c.user_id, c.active_rule_revision AS "revision!", r.definition
                   FROM crm_email_consent c
                   JOIN crm_email_rule_revisions r
                     ON r.team_id = c.team_id AND r.user_id = c.user_id AND r.revision = c.active_rule_revision
                   WHERE c.team_id = $1
                     AND (c.user_id, c.active_rule_revision) IN (
                         SELECT rc.user_id, rc.revision FROM crm_email_rule_companies rc
                         WHERE rc.company_id = ANY($2) AND rc.team_id = $1
                     )
                   ORDER BY c.user_id"#,
                team,
                companies,
            )
            .fetch_all(&mut *conn)
            .await
            .map_err(db)?
            .into_iter()
            .map(|row| (row.user_id, row.revision, row.definition))
            .collect()
        };
        rows.into_iter()
            .map(|(user_id, revision, definition)| {
                Ok(MemberRules {
                    user_id,
                    revision,
                    rules: serde_json::from_value(definition)
                        .map_err(|error| CrmError::StorageLayerError(error.into()))?,
                })
            })
            .collect()
    }

    /// Members whose active rules name one of `contacts`, by user. With
    /// `lock`, their consent rows are locked until commit.
    pub(crate) async fn rules_naming_contacts(
        conn: &mut PgConnection,
        team: Uuid,
        contacts: &[Uuid],
        lock: bool,
    ) -> Result<Vec<MemberRules>, MergeError> {
        // Starts from the contacts' references (`crm_email_rule_contacts_source`),
        // so the cost follows the rules that name them.
        let rows: Vec<(String, i64, serde_json::Value)> = if lock {
            sqlx::query!(
                r#"SELECT c.user_id, c.active_rule_revision AS "revision!", r.definition
                   FROM crm_email_consent c
                   JOIN crm_email_rule_revisions r
                     ON r.team_id = c.team_id AND r.user_id = c.user_id AND r.revision = c.active_rule_revision
                   WHERE c.team_id = $1
                     AND (c.user_id, c.active_rule_revision) IN (
                         SELECT rc.user_id, rc.revision FROM crm_email_rule_contacts rc
                         WHERE rc.contact_id = ANY($2) AND rc.team_id = $1
                     )
                   ORDER BY c.user_id
                   FOR UPDATE OF c"#,
                team,
                contacts,
            )
            .fetch_all(&mut *conn)
            .await
            .map_err(db)?
            .into_iter()
            .map(|row| (row.user_id, row.revision, row.definition))
            .collect()
        } else {
            sqlx::query!(
                r#"SELECT c.user_id, c.active_rule_revision AS "revision!", r.definition
                   FROM crm_email_consent c
                   JOIN crm_email_rule_revisions r
                     ON r.team_id = c.team_id AND r.user_id = c.user_id AND r.revision = c.active_rule_revision
                   WHERE c.team_id = $1
                     AND (c.user_id, c.active_rule_revision) IN (
                         SELECT rc.user_id, rc.revision FROM crm_email_rule_contacts rc
                         WHERE rc.contact_id = ANY($2) AND rc.team_id = $1
                     )
                   ORDER BY c.user_id"#,
                team,
                contacts,
            )
            .fetch_all(&mut *conn)
            .await
            .map_err(db)?
            .into_iter()
            .map(|row| (row.user_id, row.revision, row.definition))
            .collect()
        };
        rows.into_iter()
            .map(|(user_id, revision, definition)| {
                Ok(MemberRules {
                    user_id,
                    revision,
                    rules: serde_json::from_value(definition)
                        .map_err(|error| CrmError::StorageLayerError(error.into()))?,
                })
            })
            .collect()
    }

    /// Activate each member's rewritten rules as their next revision and
    /// record the merge in their sharing history. Their sharing stays on or
    /// off as it was. The consent rows must be locked by
    /// [`Self::rules_naming_companies`] in the same transaction.
    #[tracing::instrument(name = "crm.merge.rewrite_rules", skip_all, fields(team_id = %team, %merge_id, members = rewrites.len()), err)]
    pub(crate) async fn rewrite_merged_rules(
        conn: &mut PgConnection,
        team: Uuid,
        merge_id: Uuid,
        rewrites: &[(MemberRules, EmailRuleSet)],
        details: &serde_json::Value,
    ) -> Result<Vec<MergeChange>, MergeError> {
        let mut changes = Vec::with_capacity(rewrites.len());
        for (member, rules) in rewrites {
            let link = sqlx::query_scalar!(
                "SELECT link_id FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
                team,
                member.user_id,
            )
            .fetch_one(&mut *conn)
            .await
            .map_err(db)?;
            let revision =
                Self::insert_rule_revision(&mut *conn, team, &member.user_id, link, rules).await?;
            let consent = sqlx::query!(
                r#"UPDATE crm_email_consent SET active_rule_revision = $3, updated_at = NOW()
                   WHERE team_id = $1 AND user_id = $2 AND active_rule_revision = $4
                   RETURNING link_id, consent_incarnation, policy_version"#,
                team,
                member.user_id,
                revision,
                member.revision,
            )
            .fetch_one(&mut *conn)
            .await
            .map_err(db)?;
            let action = serde_json::to_value(EmailPolicyAuditAction::RecordsMerged)
                .map_err(|error| CrmError::StorageLayerError(error.into()))?;
            let actor = serde_json::to_value(EmailPolicyActorKind::System)
                .map_err(|error| CrmError::StorageLayerError(error.into()))?;
            sqlx::query!(
                r#"INSERT INTO crm_email_policy_audit
                   (team_id, user_id, event_id, link_id, consent_incarnation, policy_version,
                    action, actor_kind, previous_revision, next_revision, details)
                   VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb #>> '{}', $8::jsonb #>> '{}', $9, $10, $11)"#,
                team,
                member.user_id,
                Uuid::now_v7(),
                consent.link_id,
                consent.consent_incarnation,
                consent.policy_version,
                action,
                actor,
                member.revision,
                revision,
                details,
            )
            .execute(&mut *conn)
            .await
            .map_err(db)?;
            changes.push(MergeChange::new(
                "crm",
                "crm_email_consent",
                json!({ "team_id": team, "user_id": member.user_id }),
                json!({ "active_rule_revision": member.revision }),
            ));
        }
        if !rewrites.is_empty() {
            Self::invalidate_email_previews(&mut *conn, team).await?;
        }
        Ok(changes)
    }
}
