//! Owner observation and first-write initialization. No inspection writes.
use super::*;
use crate::domain::{email_policy_api::*, email_rules::*};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;

pub(super) async fn observe(
    conn: &mut PgConnection,
    team: Uuid,
    user: &str,
) -> Result<EmailPolicyObservation, CrmError> {
    let row = sqlx::query!(
        r#"WITH member AS MATERIALIZED (
               SELECT team_role::text AS role,crm_access FROM team_user WHERE team_id=$1 AND user_id=$2
           ), consent AS MATERIALIZED (
               SELECT link_id,enabled,selected_enabled,mode,active_rule_revision,policy_version,
                      consent_incarnation,xmin::text AS identity
               FROM crm_email_consent WHERE team_id=$1 AND user_id=$2
           ), mailbox AS MATERIALIZED (
               SELECT id,email_address,macro_id,is_primary,deleting_at,disconnect_requested_at,needs_reauth,grant_id,grant_generation,fusionauth_user_id,provider::text AS provider FROM email_links
               WHERE id=(SELECT link_id FROM consent) AND macro_id=$2
               UNION ALL
               SELECT id,email_address,macro_id,is_primary,deleting_at,disconnect_requested_at,needs_reauth,grant_id,grant_generation,fusionauth_user_id,provider::text AS provider FROM email_links
               WHERE NOT EXISTS(SELECT 1 FROM consent) AND macro_id=$2 AND is_primary
                   AND deleting_at IS NULL AND disconnect_requested_at IS NULL AND NOT needs_reauth
           )
           SELECT member.role,member.crm_access,consent.identity AS consent_identity,
                  consent.consent_incarnation,consent.policy_version,
                  consent.enabled,consent.selected_enabled,consent.mode,consent.active_rule_revision,
                  mailbox.id AS link_id,mailbox.email_address,mailbox.macro_id,mailbox.is_primary,
                  mailbox.deleting_at,mailbox.disconnect_requested_at,mailbox.needs_reauth,
                  mailbox.grant_id,mailbox.grant_generation,mailbox.fusionauth_user_id,mailbox.provider,
                  revision.definition
           FROM member LEFT JOIN consent ON TRUE LEFT JOIN mailbox ON TRUE
           LEFT JOIN LATERAL (
               SELECT definition,link_id FROM crm_email_rule_revisions
               WHERE consent.active_rule_revision IS NOT NULL
                   AND (team_id,user_id,revision) BETWEEN
                       ($1,$2,consent.active_rule_revision)
                       AND ($1,$2,consent.active_rule_revision)
               ORDER BY team_id,user_id,revision LIMIT 1 OFFSET 0
           ) revision ON revision.link_id=mailbox.id"#,
        team,user
    ).fetch_optional(conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?
        .ok_or(CrmError::AccessDenied)?;
    let mode: EmailContributionMode = serde_json::from_value(serde_json::Value::String(
        row.mode.clone().unwrap_or_else(|| "all".into()),
    ))
    .map_err(|e| CrmError::StorageLayerError(e.into()))?;
    let enabled = row.enabled.unwrap_or(false) || row.selected_enabled.unwrap_or(false);
    // Only authority fields participate. Sync activity, billing-plan updates,
    // history cursors and timestamps must not invalidate a pending command.
    let authority = serde_json::json!({
        "team":team,"user":user,"role":row.role,"crm_access":row.crm_access,
        "link":row.link_id,"owner":row.macro_id,"email":row.email_address,
        "primary":row.is_primary,"deleting":row.deleting_at,
        "disconnect":row.disconnect_requested_at,"needs_reauth":row.needs_reauth,
        "grant":row.grant_id,"grant_generation":row.grant_generation,
        "credential_owner":row.fusionauth_user_id,"provider":row.provider,
    });
    let authority_fingerprint = format!("{:x}", Sha256::digest(authority.to_string().as_bytes()));
    // Only legacy consent lacks a durable incarnation. Its row identity fences
    // deletion/recreation; consent is not written by mailbox sync or plan edits.
    let legacy_identity = row
        .consent_incarnation
        .is_none()
        .then_some(row.consent_identity);
    let observed = serde_json::json!({
        "authority":authority_fingerprint,"legacy_consent":legacy_identity,
        "version":row.policy_version,"incarnation":row.consent_incarnation,
        "mode":row.mode,"revision":row.active_rule_revision,
        "enabled":row.enabled,"selected_enabled":row.selected_enabled,
    });
    let fingerprint = format!("{:x}", Sha256::digest(observed.to_string().as_bytes()));
    let token = row.link_id.map(|_| {
        if let Some(consent_incarnation) = row.consent_incarnation {
            EmailPolicyToken::Policy {
                consent_incarnation,
                policy_version: row.policy_version.unwrap_or(0),
                authority_fingerprint: authority_fingerprint.clone(),
            }
        } else {
            EmailPolicyToken::Legacy {
                fingerprint: fingerprint.clone(),
            }
        }
    });
    Ok(EmailPolicyObservation {
        link_id: row.link_id,
        mailbox_email: row.email_address,
        mode,
        enabled,
        token,
        revision: row.active_rule_revision,
        policy_version: row.policy_version.unwrap_or(0),
        fingerprint,
        authority_fingerprint,
        rules: row
            .definition
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| CrmError::StorageLayerError(e.into()))?,
    })
}

impl CompaniesRepositoryImpl {
    pub(super) async fn initialize_policy_identity(
        conn: &mut PgConnection,
        team: Uuid,
        user: &str,
        link: Uuid,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"INSERT INTO crm_email_consent(team_id,user_id,link_id,consent_incarnation)
               VALUES($1,$2,$3,$4) ON CONFLICT(team_id,user_id) DO NOTHING"#,
            team,
            user,
            link,
            Uuid::now_v7()
        )
        .execute(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!(
            "UPDATE crm_email_consent SET consent_incarnation=$3 WHERE team_id=$1 AND user_id=$2 AND consent_incarnation IS NULL",
            team,user,Uuid::now_v7()
        ).execute(conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
}

impl EmailPolicyAuthoringRepository for CompaniesRepositoryImpl {
    type Authoring = PgEmailPolicyTransaction;

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn inspect_email_policy(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<EmailPolicyObservation, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET TRANSACTION READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let observed = observe(&mut tx, team, user).await?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(observed)
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn open_email_policy_authoring(
        &self,
        team: Uuid,
        user: &str,
        token: &EmailPolicyToken,
        initialize_legacy: bool,
    ) -> Result<Option<Self::Authoring>, CrmError> {
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
        let observed = observe(&mut tx, team, user).await?;
        let Some(link) = observed.link_id else {
            return Ok(None);
        };
        // Keep the lifecycle order: mailbox and member before consent. SHARE
        // also stabilizes the role used when authorizing live CRM references.
        let locked = sqlx::query_scalar!(
            r#"SELECT l.id FROM email_links l JOIN team_user member
                   ON member.user_id=l.macro_id AND member.team_id=$1
               WHERE l.id=$3 AND l.macro_id=$2 FOR SHARE OF l,member"#,
            team,
            user,
            link
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if locked.is_none() {
            return Ok(None);
        }
        let current = observe(&mut tx, team, user).await?;
        if current.link_id != Some(link) {
            return Ok(None);
        }
        let initialized_legacy = match (&current.token, token) {
            (Some(EmailPolicyToken::Legacy { .. }), EmailPolicyToken::Legacy { .. })
                if initialize_legacy && current.token.as_ref() == Some(token) =>
            {
                true
            }
            (
                Some(EmailPolicyToken::Policy {
                    consent_incarnation: current,
                    ..
                }),
                EmailPolicyToken::Policy {
                    consent_incarnation: expected,
                    ..
                },
            ) if current == expected => false,
            // Only a matching recorded command may replay a legacy request in
            // this current incarnation. The service refuses every new command.
            (Some(EmailPolicyToken::Policy { .. }), EmailPolicyToken::Legacy { .. }) => false,
            _ => return Ok(None),
        };
        if initialized_legacy {
            Self::initialize_policy_identity(&mut tx, team, user, link).await?;
        }
        let row = sqlx::query!(
            r#"SELECT link_id,consent_incarnation,policy_version,mode,enabled,selected_enabled,active_rule_revision
               FROM crm_email_consent WHERE team_id=$1 AND user_id=$2 FOR UPDATE"#,
            team,user
        ).fetch_one(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let Some(consent_incarnation) = row.consent_incarnation else {
            return Ok(None);
        };
        Ok(Some(PgEmailPolicyTransaction {
            tx,
            team,
            user: user.into(),
            initialized_legacy,
            original_policy_version: row.policy_version,
            authority_fingerprint: Some(current.authority_fingerprint),
            state: EmailPolicyState {
                link_id: row.link_id,
                generation: EmailPolicyGeneration {
                    consent_incarnation,
                    policy_version: row.policy_version,
                },
                mode: serde_json::from_value(serde_json::Value::String(row.mode))
                    .map_err(|e| CrmError::StorageLayerError(e.into()))?,
                enabled: row.enabled,
                selected_enabled: row.selected_enabled,
                active_rule_revision: row.active_rule_revision,
            },
        }))
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn email_rule_targets(
        &self,
        team: Uuid,
        user: &str,
        link: Uuid,
        rules: &[EmailInclusionRule],
    ) -> Result<EmailRuleTargetFacts, CrmError> {
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
        let facts = super::targets::read_targets(&mut tx, team, user, link, rules, false).await?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(facts)
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn admit_email_rule_resources(
        &self,
        team: Uuid,
        user: &str,
        link: Uuid,
        rules: &[EmailInclusionRule],
    ) -> Result<(), CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        admit_resources(&mut tx, team, user, link, rules).await?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(skip_all,fields(team_id=%team,revision),err)]
    async fn email_rule_revision(
        &self,
        team: Uuid,
        user: &str,
        revision: i64,
    ) -> Result<Option<EmailPolicyRevision>, CrmError> {
        let row = sqlx::query!(
            r#"SELECT revision,link_id,definition,created_at FROM crm_email_rule_revisions
               WHERE team_id=$1 AND user_id=$2 AND revision=$3
                 AND EXISTS(SELECT 1 FROM team_user WHERE team_id=$1 AND user_id=$2)"#,
            team,
            user,
            revision
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        row.map(|row| {
            Ok(EmailPolicyRevision {
                revision: row.revision,
                link_id: row.link_id,
                created_at: row.created_at,
                rules: serde_json::from_value(row.definition)
                    .map_err(|e| CrmError::StorageLayerError(e.into()))?,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip_all, fields(team_id = %team), err)]
    async fn email_policy_audit(
        &self,
        team: Uuid,
        user: &str,
        before: Option<Uuid>,
    ) -> Result<Vec<EmailPolicyAudit>, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET TRANSACTION READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let rows = sqlx::query!(
            r#"SELECT event_id,link_id,consent_incarnation,policy_version,action,actor_kind,agent_id,agent_session_id,
                      previous_revision,next_revision,details,created_at
               FROM crm_email_policy_audit WHERE team_id=$1 AND user_id=$2
                 AND event_id < COALESCE($3,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
                 AND EXISTS(SELECT 1 FROM team_user WHERE team_id=$1 AND user_id=$2)
               ORDER BY event_id DESC LIMIT 50"#,
            team,user,before
        ).fetch_all(&mut *tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let events = rows
            .into_iter()
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
            .collect::<Result<Vec<_>, CrmError>>()?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(events)
    }
}

/// Both validation and mutation execute the owning domain's same checker. This
/// helper owns no transaction: the caller chooses read-only snapshot or locked
/// mutation, and a failed mutation rolls back every first-write side effect.
pub(super) async fn admit_resources(
    connection: &mut PgConnection,
    team: Uuid,
    user: &str,
    link: Uuid,
    rules: &[EmailInclusionRule],
) -> Result<(), CrmError> {
    use crate::domain::email_rule_discovery::{
        EmailRuleDiscoveryRequest, EmailRuleDiscoveryService, ProposedEmailRules,
    };
    crate::outbound::email_rule_discovery::PgEmailRuleDiscovery
        .discover(
            connection,
            EmailRuleDiscoveryRequest {
                team_id: team,
                links: None,
                proposed: Some(ProposedEmailRules {
                    user_id: user.to_owned(),
                    link_id: link,
                    rules: rules.to_vec(),
                }),
            },
            std::time::Instant::now() + std::time::Duration::from_secs(10),
        )
        .await?;
    Ok(())
}
