use super::{CrmServiceImpl, normalize_company_domain, normalize_contact_email};
use crate::domain::{
    auth::CrmTeamReceipt,
    companies_repo::CompaniesRepository,
    company_metadata_resolver::CompanyMetadataResolver,
    email_policy::{EmailPolicyTransaction, NewEmailPolicyAudit, NewEmailPolicyIdempotency},
    email_policy_api::*,
    email_rules::*,
    generic_email_domains::is_personal_email_domain,
    model::CrmError,
};
use entity_access::domain::models::MemberTeamRole;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(super) const POLICY_EFFECT: &str = "A matching participant shares the whole thread, including other participants and eligible past and future messages. Contact and company targets follow live records. Private threads and other exclusions always win. Other members may contribute their own copies. Narrowing or withdrawing keeps CRM records and interaction dates.";

pub(super) fn canonical_rules(mut rules: EmailRuleSet) -> Result<EmailRuleSet, CrmError> {
    rules
        .validate_shape()
        .map_err(|e| CrmError::InvalidRequest(e.to_string()))?;
    for rule in &mut rules.include {
        match rule {
            EmailInclusionRule::Address { address } => {
                *address = normalize_contact_email(address)?;
            }
            EmailInclusionRule::Domain { domain } => {
                *domain = normalize_company_domain(domain)?;
                let valid_labels = domain.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                });
                let registrable = psl::domain_str(domain);
                if !valid_labels
                    || registrable.is_none()
                    || is_personal_email_domain(domain)
                    || registrable.is_some_and(is_personal_email_domain)
                {
                    return Err(CrmError::InvalidRequest(
                        "domain rules require a company domain, not a public suffix or personal provider".into(),
                    ));
                }
            }
            _ => {}
        }
    }
    rules.include.sort();
    rules.include.dedup();
    rules
        .validate_shape()
        .map_err(|e| CrmError::InvalidRequest(e.to_string()))?;
    Ok(rules)
}

pub(super) fn validate_targets(
    rules: EmailRuleSet,
    facts: EmailRuleTargetFacts,
    mailbox: &str,
) -> Result<EmailRuleValidation, CrmError> {
    facts.validate_references(&rules.include)?;
    let mut inactive_rule_indices = Vec::new();
    let mut broad_rule_indices = Vec::new();
    let mailbox = mailbox.to_ascii_lowercase();
    let mailbox_domain = mailbox.split_once('@').map(|(_, domain)| domain);
    for (index, rule) in rules.include.iter().enumerate() {
        match rule {
            EmailInclusionRule::Thread { .. } => {}
            EmailInclusionRule::Contact { contact_id } => {
                let target = facts.contacts.iter().find(|(id, _)| id == contact_id);
                if target.is_some_and(|(_, active)| !active) {
                    inactive_rule_indices.push(index);
                }
            }
            EmailInclusionRule::Company { company_id } => {
                let target = facts.companies.iter().find(|(id, _)| id == company_id);
                if target.is_some_and(|(_, active)| !active) {
                    inactive_rule_indices.push(index);
                }
            }
            EmailInclusionRule::Address { address } => {
                if address == &mailbox {
                    broad_rule_indices.push(index);
                }
            }
            EmailInclusionRule::Domain { domain } => {
                if mailbox_domain
                    .is_some_and(|own| own == domain || own.ends_with(&format!(".{domain}")))
                {
                    broad_rule_indices.push(index);
                }
            }
        };
    }
    Ok(EmailRuleValidation {
        rules,
        inactive_rule_indices,
        broad_rule_indices,
        effect: POLICY_EFFECT.into(),
    })
}

impl<CR: CompaniesRepository, R: CompanyMetadataResolver> CrmServiceImpl<CR, R> {
    pub(super) async fn selective_email_available(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> bool {
        match &self.selective_email_gate {
            Some(gate) => gate.enabled_for(user).await,
            None => false,
        }
    }
}

impl<CR, R> EmailPolicyService for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository + EmailPolicyAuthoringRepository,
    R: CompanyMetadataResolver,
{
    #[tracing::instrument(skip_all, fields(team_id = %access.team_id()), err)]
    async fn email_policy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<EmailPolicyView, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        let available = self.selective_email_available(user.clone()).await;
        let observed = self
            .companies_repository
            .inspect_email_policy(access.team_id(), user.as_ref())
            .await?;
        let token = match observed.token {
            Some(EmailPolicyToken::Legacy { .. }) if !available => None,
            token => token,
        };
        Ok(EmailPolicyView {
            authoring_available: available,
            link_id: observed.link_id,
            mailbox_email: observed.mailbox_email,
            mode: observed.mode,
            enabled: observed.enabled,
            token,
            revision: observed.revision,
            rules: observed.rules,
            effect: POLICY_EFFECT.into(),
        })
    }

    #[tracing::instrument(skip_all, fields(team_id = %access.team_id()), err)]
    async fn validate_email_rules(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        rules: EmailRuleSet,
    ) -> Result<EmailRuleValidation, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        if !self.selective_email_available(user.clone()).await {
            return Err(CrmError::SelectiveEmailUnavailable);
        }
        let rules = canonical_rules(rules)?;
        let observed = self
            .companies_repository
            .inspect_email_policy(access.team_id(), user.as_ref())
            .await?;
        let (Some(link), Some(mailbox)) = (observed.link_id, observed.mailbox_email) else {
            return Err(CrmError::InvalidRequest(
                "connect a primary mailbox before defining email rules".into(),
            ));
        };
        let facts = self
            .companies_repository
            .email_rule_targets(access.team_id(), user.as_ref(), link, &rules.include)
            .await?;
        let validated = validate_targets(rules, facts, &mailbox)?;
        self.companies_repository
            .admit_email_rule_resources(
                access.team_id(),
                user.as_ref(),
                link,
                &validated.rules.include,
            )
            .await?;
        Ok(validated)
    }

    #[tracing::instrument(skip_all, fields(team_id = %access.team_id(), request_id = %command.request_id), err)]
    async fn change_email_policy(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        actor: EmailPolicyActor,
        mut command: EmailPolicyCommand,
    ) -> Result<EmailPolicyOutcome, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        let available = self.selective_email_available(user.clone()).await;
        let withdraw = matches!(command.change, EmailPolicyChange::Withdraw {});
        if let EmailPolicyChange::ReplaceRules { rules } = &mut command.change {
            *rules = canonical_rules(rules.clone())?;
        }
        let request_hash = Sha256::digest(
            serde_json::to_vec(&command).map_err(|e| CrmError::StorageLayerError(e.into()))?,
        )
        .to_vec();
        let Some(mut tx) = self
            .companies_repository
            .open_email_policy_authoring(
                access.team_id(),
                user.as_ref(),
                &command.if_policy,
                available || withdraw,
            )
            .await?
        else {
            return Err(if available || withdraw {
                CrmError::EmailPolicyConflict
            } else {
                CrmError::SelectiveEmailUnavailable
            });
        };
        if let Some(previous) = tx.idempotency(command.request_id).await? {
            if previous.request_hash != request_hash {
                return Err(CrmError::EmailPolicyConflict);
            }
            let mut outcome: EmailPolicyOutcome = serde_json::from_value(previous.outcome)
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            outcome.replayed = true;
            tx.commit().await?;
            return Ok(outcome);
        }
        let expected_version = match &command.if_policy {
            EmailPolicyToken::Policy {
                consent_incarnation,
                policy_version,
                authority_fingerprint,
            } if *consent_incarnation == tx.state().generation.consent_incarnation
                && *policy_version == tx.state().generation.policy_version
                && tx.authority_fingerprint() == Some(authority_fingerprint.as_str()) =>
            {
                *policy_version
            }
            EmailPolicyToken::Legacy { .. } if tx.initialized_legacy() => {
                tx.original_policy_version()
            }
            _ => return Err(CrmError::EmailPolicyConflict),
        };
        if !withdraw {
            if !available {
                return Err(CrmError::SelectiveEmailUnavailable);
            }
            if !actor.may_share {
                return Err(CrmError::EmailPolicySharingRefused);
            }
        }
        let previous_revision = tx.state().active_rule_revision;
        let revision = if let EmailPolicyChange::ReplaceRules { rules } = &command.change {
            let mailbox = tx.authoring_mailbox().await?.ok_or_else(|| {
                CrmError::InvalidRequest(
                    "the consent mailbox is not the connected primary mailbox".into(),
                )
            })?;
            let facts = tx.lock_rule_targets(&rules.include).await?;
            let validated = validate_targets(rules.clone(), facts, &mailbox)?;
            tx.admit_rule_resources(&validated.rules.include).await?;
            Some(tx.save_rule_revision(&validated.rules).await?)
        } else {
            if !withdraw && tx.authoring_mailbox().await?.is_none() {
                return Err(CrmError::InvalidRequest(
                    "the consent mailbox is not the connected primary mailbox".into(),
                ));
            }
            None
        };
        tx.set_policy(&command.change, revision).await?;
        if withdraw {
            tx.cancel_history().await?;
        } else {
            // Restart the complete history on every explicit grant. This also
            // transfers already-published legacy work on the first modern write;
            // looking only for an outbox row would miss an in-flight old page.
            tx.request_work(Uuid::now_v7(), None).await?;
        }
        let event_id = Uuid::now_v7();
        let state = tx.state().clone();
        let action = match &command.change {
            EmailPolicyChange::ReplaceRules { .. } => EmailPolicyAuditAction::RulesActivated,
            EmailPolicyChange::EnableAll {} => EmailPolicyAuditAction::AllMailEnabled,
            EmailPolicyChange::Withdraw {} => EmailPolicyAuditAction::Withdrawn,
        };
        tx.record_audit(&NewEmailPolicyAudit {
            event_id, action, actor_kind: actor.kind, agent_id: actor.agent_id,
            agent_session_id: actor.session_id, previous_revision,
            next_revision: state.active_rule_revision,
            details: serde_json::json!({"mode": state.mode, "enabled": state.enabled || state.selected_enabled, "consent_wording_version": 1}),
        }).await?;
        let outcome = EmailPolicyOutcome {
            token: EmailPolicyToken::Policy {
                consent_incarnation: state.generation.consent_incarnation,
                policy_version: state.generation.policy_version,
                authority_fingerprint: tx
                    .authority_fingerprint()
                    .ok_or(CrmError::EmailPolicyConflict)?
                    .to_owned(),
            },
            mode: state.mode,
            enabled: state.enabled || state.selected_enabled,
            revision: state.active_rule_revision,
            audit_event_id: event_id,
            replayed: false,
            effect: POLICY_EFFECT.into(),
        };
        tx.record_idempotency(&NewEmailPolicyIdempotency {
            request_id: command.request_id,
            expected_policy_version: expected_version,
            request_hash,
            outcome: serde_json::to_value(&outcome)
                .map_err(|e| CrmError::StorageLayerError(e.into()))?,
        })
        .await?;
        tx.commit().await?;
        Ok(outcome)
    }

    #[tracing::instrument(skip_all,fields(team_id=%access.team_id(),revision),err)]
    async fn email_policy_revision(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        revision: i64,
    ) -> Result<Option<EmailPolicyRevision>, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        self.companies_repository
            .email_rule_revision(access.team_id(), user.as_ref(), revision)
            .await
    }

    #[tracing::instrument(skip_all, fields(team_id = %access.team_id()), err)]
    async fn email_policy_history(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        before: Option<Uuid>,
    ) -> Result<EmailPolicyHistory, CrmError> {
        let user = access
            .receipt()
            .get_authenticated_user()
            .map_err(|_| CrmError::AccessDenied)?;
        let events = self
            .companies_repository
            .email_policy_audit(access.team_id(), user.as_ref(), before)
            .await?;
        let next_cursor = (events.len() == 50)
            .then(|| events.last().map(|event| event.entry.event_id))
            .flatten();
        Ok(EmailPolicyHistory {
            events,
            next_cursor,
        })
    }
}
