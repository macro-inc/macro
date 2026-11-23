//! The HubSpot import's CRM writes, through the CRM's own record and
//! pipeline services as Macro AI acting for the importing user.

use std::sync::Arc;

use bot_id::BotId;
use crm::domain::record_import::{CrmRecordImports, ImportedDeal, ImportedOutcome};
use databases::domain::models::Viewer;
use import::domain::ports::{
    CrmImportWriter, CrmTeam, DealOutcome, NewCrmContact, NewDealEntry, WorkspaceWriter,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::tool_context::{
    ToolCrmToolContext, ToolEntityAccessService, ToolEntityCreator, ToolPipelineToolContext,
    ToolPipelineWorkflows,
};

/// [`CrmImportWriter`] over the team CRM.
pub struct HubspotCrmWriter {
    records: CrmRecordImports<
        crate::tool_context::ToolCrmService,
        ToolEntityAccessService,
        ToolPipelineWorkflows,
    >,
    /// The team roster owners are matched against.
    roster: Arc<ToolEntityCreator>,
    actor: BotId,
}

impl HubspotCrmWriter {
    /// Writes through the CRM tools' records and the pipeline tools' workflows.
    pub fn new(
        crm: &ToolCrmToolContext,
        pipelines: &ToolPipelineToolContext,
        roster: Arc<ToolEntityCreator>,
    ) -> Self {
        Self {
            records: CrmRecordImports::new(
                crm.service.clone(),
                crm.entity_access_service.clone(),
                pipelines.service.clone(),
            ),
            roster,
            actor: pipelines.actor,
        }
    }

    fn viewer(&self, user: &MacroUserIdStr<'static>) -> Viewer {
        Viewer {
            user_id: user.clone(),
            acting_bot: Some(self.actor),
        }
    }
}

#[async_trait::async_trait]
impl CrmImportWriter for HubspotCrmWriter {
    async fn crm_team(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<Option<CrmTeam>> {
        let Some(team_id) = self.records.crm_team(&self.viewer(user)).await? else {
            return Ok(None);
        };
        let member_emails = self
            .roster
            .team_members(user)
            .await?
            .into_iter()
            .map(|member| member.email.to_lowercase())
            .collect();
        Ok(Some(CrmTeam {
            team_id,
            member_emails,
        }))
    }

    fn company_domain(&self, raw: &str) -> Option<String> {
        crm::domain::record_import::company_domain(raw)
    }

    fn supports_currency(&self, code: &str) -> bool {
        crm::domain::record_import::supports_currency(code)
    }

    async fn company_by_domain(
        &self,
        user: &MacroUserIdStr<'static>,
        domain: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        Ok(self
            .records
            .company_by_domain(&self.viewer(user), domain)
            .await?)
    }

    async fn create_company(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        domain: Option<&str>,
    ) -> anyhow::Result<Uuid> {
        Ok(self
            .records
            .create_company(&self.viewer(user), name, domain)
            .await?)
    }

    async fn contact_by_email(
        &self,
        user: &MacroUserIdStr<'static>,
        email: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        Ok(self
            .records
            .contact_by_email(&self.viewer(user), email)
            .await?)
    }

    async fn create_contact(
        &self,
        user: &MacroUserIdStr<'static>,
        contact: &NewCrmContact,
    ) -> anyhow::Result<Uuid> {
        Ok(self
            .records
            .create_contact(
                &self.viewer(user),
                &contact.name,
                &contact.emails,
                contact.company,
            )
            .await?)
    }

    async fn create_deal_pipeline(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        stages: &[String],
    ) -> anyhow::Result<Uuid> {
        Ok(self
            .records
            .create_deal_pipeline(&self.viewer(user), name, stages)
            .await?)
    }

    async fn deal_links(
        &self,
        user: &MacroUserIdStr<'static>,
        pipeline: Uuid,
    ) -> anyhow::Result<std::collections::HashMap<String, Uuid>> {
        Ok(self
            .records
            .deal_links(&self.viewer(user), pipeline)
            .await?)
    }

    async fn add_deal_entry(
        &self,
        user: &MacroUserIdStr<'static>,
        pipeline: Uuid,
        deal: &NewDealEntry,
    ) -> anyhow::Result<Uuid> {
        let entry = ImportedDeal {
            company: deal.company,
            name: deal.name.clone(),
            stage: deal.stage.clone(),
            outcome: match deal.outcome {
                DealOutcome::Open => ImportedOutcome::Open,
                DealOutcome::Won => ImportedOutcome::Won,
                DealOutcome::Lost => ImportedOutcome::Lost,
            },
            amount: deal.amount.zip(deal.currency.clone()),
            close_date: deal.close_date.clone(),
            owner: deal.owner.clone(),
            link: deal.link.clone(),
        };
        Ok(self
            .records
            .add_deal_entry(&self.viewer(user), pipeline, &entry)
            .await?)
    }
}
