use super::*;
use crate::domain::{email_policy_work::*, email_privacy::EmailContributionMailbox};
impl EmailHistoryPopulationRepository for CompaniesRepositoryImpl {
    async fn legacy_history_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        // Scope before grant filters: a mostly-disabled population must not
        // choose an unscoped walk of the enabled-link partial index.
        sqlx::query_as!(EmailContributionMailbox,
            r#"SELECT l.id AS link_id, l.email_address FROM (
                   SELECT team_id,user_id,link_id,enabled,mode,consent_incarnation
                   FROM crm_email_consent WHERE team_id=$1 AND user_id=$2 OFFSET 0
               ) c
               JOIN email_links l ON l.id = c.link_id AND l.macro_id = c.user_id AND l.is_primary AND l.deleting_at IS NULL
               JOIN team_user tu ON tu.team_id = c.team_id AND tu.user_id = c.user_id
               WHERE c.enabled AND c.mode = 'all' AND c.consent_incarnation IS NULL"#,
            team, user
        ).fetch_optional(&self.pool).await.map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    async fn history_interactions(
        &self,
        team: Uuid,
        link: Uuid,
        email: &str,
        authority: EmailHistoryAuthority,
    ) -> Result<Option<EmailPolicyInteraction>, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let Some(interaction) = self
            .eligible_interactions_with_authority(&mut tx, team, link, email, Some(authority))
            .await?
        else {
            return Ok(None);
        };
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(Some(EmailPolicyInteraction {
            first_at: interaction.first_at,
            last_at: interaction.last_at,
            is_sent: interaction.is_sent,
        }))
    }

    async fn populate_history_contact(
        &self,
        team: Uuid,
        link: Uuid,
        domain: &str,
        email: &str,
        name: Option<&str>,
        personal: bool,
        authority: EmailHistoryAuthority,
        interaction: &EmailPolicyInteraction,
    ) -> Result<(), CrmError> {
        // Retain the existing no-change optimization after pre-enrichment admission.
        if !personal
            && self
                .populate_changes_nothing(
                    &team,
                    &link,
                    domain,
                    email,
                    name,
                    interaction.first_at,
                    interaction.last_at,
                    interaction.is_sent,
                )
                .await?
        {
            return Ok(());
        }
        let result = if personal {
            self.populate_personal_contact(&team, &link, domain, email, name, Some(authority))
                .await
        } else {
            self.populate_company_contact(&team, &link, domain, email, name, Some(authority))
                .await
        };
        result.map_err(super::super::lock_timeout_as_contended)
    }
}
