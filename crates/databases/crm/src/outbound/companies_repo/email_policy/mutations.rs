use super::*;
use crate::domain::{email_policy_api::*, email_rules::*};

#[cfg(test)]
mod test;

impl EmailPolicyAuthoringTransaction for PgEmailPolicyTransaction {
    fn initialized_legacy(&self) -> bool {
        self.initialized_legacy
    }
    fn original_policy_version(&self) -> i64 {
        self.original_policy_version
    }
    fn authority_fingerprint(&self) -> Option<&str> {
        self.authority_fingerprint.as_deref()
    }

    async fn authoring_mailbox(&mut self) -> Result<Option<String>, CrmError> {
        sqlx::query_scalar!(
            r#"SELECT email_address FROM email_links WHERE id=$1 AND macro_id=$2 AND is_primary
               AND deleting_at IS NULL AND disconnect_requested_at IS NULL AND NOT needs_reauth"#,
            self.state.link_id,
            self.user
        )
        .fetch_optional(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn lock_rule_targets(
        &mut self,
        rules: &[EmailInclusionRule],
    ) -> Result<EmailRuleTargetFacts, CrmError> {
        super::targets::read_targets(
            &mut self.tx,
            self.team,
            &self.user,
            self.state.link_id,
            rules,
            true,
        )
        .await
    }

    async fn admit_rule_resources(&mut self, rules: &[EmailInclusionRule]) -> Result<(), CrmError> {
        super::authoring::admit_resources(
            &mut self.tx,
            self.team,
            &self.user,
            self.state.link_id,
            rules,
        )
        .await?;
        // Discovery uses a shrinking ten-second budget. Later revision, grant
        // and audit writes retain the authoring transaction's existing timeout.
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *self.tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn save_rule_revision(&mut self, rules: &EmailRuleSet) -> Result<i64, CrmError> {
        rules
            .validate_shape()
            .map_err(|e| CrmError::InvalidRequest(e.to_string()))?;
        let revision = sqlx::query_scalar!(
            r#"SELECT COALESCE((SELECT revision+1 FROM crm_email_rule_revisions
                 WHERE team_id=$1 AND user_id=$2 ORDER BY revision DESC LIMIT 1),1) AS "revision!""#,
            self.team,self.user
        ).fetch_one(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let definition =
            serde_json::to_value(rules).map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!(
            "INSERT INTO crm_email_rule_revisions(team_id,user_id,revision,link_id,schema_version,definition) VALUES($1,$2,$3,$4,$5,$6)",
            self.team,self.user,revision,self.state.link_id,i16::try_from(rules.schema_version).map_err(|_|CrmError::InvalidRequest("unsupported schema version".into()))?,definition
        ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let mut threads = Vec::new();
        let mut addresses = Vec::new();
        let mut contacts = Vec::new();
        let mut domains = Vec::new();
        let mut companies = Vec::new();
        for rule in &rules.include {
            match rule {
                EmailInclusionRule::Thread { thread_id } => threads.push(*thread_id),
                EmailInclusionRule::Address { address } => addresses.push(address.clone()),
                EmailInclusionRule::Contact { contact_id } => contacts.push(*contact_id),
                EmailInclusionRule::Domain { domain } => domains.push(domain.clone()),
                EmailInclusionRule::Company { company_id } => companies.push(*company_id),
            }
        }
        sqlx::query!("INSERT INTO crm_email_rule_threads(team_id,user_id,revision,thread_id) SELECT $1,$2,$3,unnest($4::uuid[])",self.team,self.user,revision,&threads).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("INSERT INTO crm_email_rule_addresses(team_id,user_id,revision,address) SELECT $1,$2,$3,unnest($4::text[])",self.team,self.user,revision,&addresses).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("INSERT INTO crm_email_rule_contacts(team_id,user_id,revision,contact_id) SELECT $1,$2,$3,unnest($4::uuid[])",self.team,self.user,revision,&contacts).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("INSERT INTO crm_email_rule_domains(team_id,user_id,revision,domain) SELECT $1,$2,$3,unnest($4::text[])",self.team,self.user,revision,&domains).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("INSERT INTO crm_email_rule_companies(team_id,user_id,revision,company_id) SELECT $1,$2,$3,unnest($4::uuid[])",self.team,self.user,revision,&companies).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(revision)
    }

    #[tracing::instrument(skip_all, fields(team_id = %self.team), err)]
    async fn set_policy(
        &mut self,
        change: &EmailPolicyChange,
        revision: Option<i64>,
    ) -> Result<(), CrmError> {
        match change {
            EmailPolicyChange::ReplaceRules { .. } => {
                // The legacy enabled-column trigger must still withdraw every
                // selected grant when old clients write false. Clear all-mail
                // first, then use the modern-only columns to activate selected.
                sqlx::query!(
                    "UPDATE crm_email_consent SET enabled=FALSE WHERE team_id=$1 AND user_id=$2 AND enabled",
                    self.team,self.user
                ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
                sqlx::query!(
                    "UPDATE crm_email_consent SET mode='selected',selected_enabled=TRUE,active_rule_revision=$3 WHERE team_id=$1 AND user_id=$2",
                    self.team,self.user,revision
                ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
            }
            EmailPolicyChange::EnableAll {} => {
                sqlx::query!(
                    "UPDATE crm_email_consent SET mode='all',enabled=TRUE,selected_enabled=FALSE,active_rule_revision=NULL WHERE team_id=$1 AND user_id=$2",
                    self.team,self.user
                ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
            }
            EmailPolicyChange::Withdraw {} => {
                sqlx::query!(
                    "UPDATE crm_email_consent SET enabled=FALSE,selected_enabled=FALSE WHERE team_id=$1 AND user_id=$2",
                    self.team,self.user
                ).execute(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
            }
        }
        CompaniesRepositoryImpl::invalidate_email_previews(&mut self.tx, self.team).await?;
        let row = sqlx::query!(
            "SELECT mode,enabled,selected_enabled,active_rule_revision,policy_version FROM crm_email_consent WHERE team_id=$1 AND user_id=$2 AND consent_incarnation=$3",
            self.team,self.user,self.state.generation.consent_incarnation
        ).fetch_one(&mut *self.tx).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        self.state.mode = serde_json::from_value(serde_json::Value::String(row.mode))
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        self.state.enabled = row.enabled;
        self.state.selected_enabled = row.selected_enabled;
        self.state.active_rule_revision = row.active_rule_revision;
        self.state.generation.policy_version = row.policy_version;
        Ok(())
    }

    async fn cancel_history(&mut self) -> Result<(), CrmError> {
        sqlx::query!(
            "DELETE FROM crm_email_backfill_outbox WHERE team_id=$1 AND user_id=$2",
            self.team,
            self.user
        )
        .execute(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!(
            "DELETE FROM crm_email_policy_work WHERE team_id=$1 AND user_id=$2",
            self.team,
            self.user
        )
        .execute(&mut *self.tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
}
