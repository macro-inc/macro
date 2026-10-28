//! ImportCompaniesCsv: a companies list into the team CRM, with its Stage,
//! Owner and Revenue on pipeline entries.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    CrmTransferToolContext, ToolPipelineImport, ToolSkippedRecord, csv_input, listed,
    pipeline_summary, transfer_error,
};
use crate::domain::{
    crm_transfer::{CrmTransferService, PipelineDestination},
    pipelines::PipelineSharing,
};

/// Import companies from a CSV.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportCompaniesCsv",
    description = "Import companies into the team CRM from a CSV, such as a Macro companies export or a list from another CRM. Each row needs a domain (a Domain, Domains or Website column) and may name the company (Company or Name); a row takes its first valid domain, and companies the team already has are left as they are. Stage, Owner and Revenue live on pipeline entries rather than companies: when the CSV has them, they go on entries of pipelineId, or of a new pipeline (private unless shareNewPipeline) named after the file. Give the CSV as text in csv, or as documentId for a CSV file in Macro. Returns counts and the rows that could not be imported. To add rows to a pipeline without this, use ImportPipelineCsv."
)]
pub struct ImportCompaniesCsv {
    /// The CSV text.
    #[schemars(description = "The CSV text with a header row. Give this or documentId, not both.")]
    #[serde(default)]
    pub csv: Option<String>,
    /// A CSV file in Macro.
    #[schemars(
        description = "The id of a CSV file in Macro the user can open, e.g. one they uploaded. Give this or csv, not both."
    )]
    #[serde(default)]
    pub document_id: Option<Uuid>,
    /// An existing company pipeline for Stage, Owner and Revenue.
    #[schemars(
        description = "A company pipeline (id from ListPipelines) to put the CSV's Stage, Owner and Revenue on. Omit to create a new pipeline when the CSV has them."
    )]
    #[serde(default)]
    pub pipeline_id: Option<Uuid>,
    /// The new pipeline's name.
    #[schemars(
        description = "The name of the new pipeline, when one is created. Defaults to the file's name."
    )]
    #[serde(default)]
    pub new_pipeline_name: Option<String>,
    /// Whether the new pipeline is the team's.
    #[schemars(
        description = "Share the new pipeline with the team instead of keeping it private to the user. Defaults to false."
    )]
    #[serde(default)]
    pub share_new_pipeline: Option<bool>,
}

/// What the import did.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportCompaniesCsvResponse {
    /// Companies created.
    pub created: usize,
    /// Companies the team already had.
    pub existing: usize,
    /// Rows without a domain like acme.com.
    pub skipped_rows: usize,
    /// How many companies could not be created.
    pub failed_count: usize,
    /// The first of them, with why.
    pub failed: Vec<ToolSkippedRecord>,
    /// The pipeline entries made from Stage, Owner and Revenue.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline: Option<ToolPipelineImport>,
    /// What happened.
    pub summary: String,
}

impl ToolAnnotated for ImportCompaniesCsv {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Import companies");
}

#[async_trait]
impl<Transfer: CrmTransferService> AsyncTool<CrmTransferToolContext<Transfer>>
    for ImportCompaniesCsv
{
    type Output = ImportCompaniesCsvResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        context: ServiceContext<CrmTransferToolContext<Transfer>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let csv = csv_input(&self.csv, self.document_id)?;
        let destination = match self.pipeline_id {
            Some(id) => PipelineDestination::Existing(id),
            None => PipelineDestination::New {
                name: self.new_pipeline_name.clone(),
                sharing: if self.share_new_pipeline.unwrap_or(false) {
                    PipelineSharing::Team
                } else {
                    PipelineSharing::Private
                },
            },
        };
        let viewer = context.viewer(request_context.user_id);
        let outcome = context
            .service
            .import_companies(&viewer, csv, Some(destination))
            .await
            .map_err(transfer_error)?;
        let mut summary = format!(
            "Created {} companies; {} were already in the CRM.",
            outcome.created, outcome.existing
        );
        if !outcome.failed.is_empty() {
            summary.push_str(&format!(" {} could not be created.", outcome.failed.len()));
        }
        if outcome.skipped_rows > 0 {
            summary.push_str(&format!(
                " {} rows had no domain like acme.com.",
                outcome.skipped_rows
            ));
        }
        if let Some(pipeline) = &outcome.pipeline {
            summary.push(' ');
            summary.push_str(&pipeline_summary(pipeline));
        }
        Ok(ImportCompaniesCsvResponse {
            created: outcome.created,
            existing: outcome.existing,
            skipped_rows: outcome.skipped_rows,
            failed_count: outcome.failed.len(),
            failed: listed(&outcome.failed),
            pipeline: outcome.pipeline.as_ref().map(ToolPipelineImport::from),
            summary,
        })
    }
}
