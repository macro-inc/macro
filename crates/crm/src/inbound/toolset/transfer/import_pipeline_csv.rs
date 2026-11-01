//! ImportPipelineCsv: a CSV's rows into a pipeline as entries.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    CrmTransferToolContext, ToolPipelineImport, csv_input, pipeline_summary, transfer_error,
};
use crate::domain::crm_transfer::CrmTransferService;

/// Import a CSV into a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportPipelineCsv",
    description = "Import a CSV into a CRM pipeline as new deals (entries), such as a pipeline export or a sheet of deals. In a company pipeline each row needs a domain (Domain, Domains or Website column) and may name the company (Company); in a contact pipeline each row needs an Email and may name the contact (Contact). Missing companies and contacts are created. Other columns fill the pipeline fields with the same name (Stage, Owner as an email, Revenue, custom fields); stage labels the pipeline lacks are added. Records already in the pipeline are not added again, so retrying an interrupted import adds only what is missing; several rows for one new record become separate deals. Give the CSV as text in csv, or as documentId for a CSV file in Macro. Returns counts and the rows that could not be added."
)]
pub struct ImportPipelineCsv {
    /// The pipeline.
    #[schemars(description = "The pipeline's id from ListPipelines.")]
    pub pipeline_id: Uuid,
    /// The CSV text.
    #[schemars(description = "The CSV text with a header row. Give this or documentId, not both.")]
    #[serde(default)]
    pub csv: Option<String>,
    /// A CSV file in Macro.
    #[schemars(
        description = "The id of a CSV file in Macro the user can open, e.g. one they uploaded or an ExportPipelineCsv result. Give this or csv, not both."
    )]
    #[serde(default)]
    pub document_id: Option<Uuid>,
}

/// What the import did.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportPipelineCsvResponse {
    /// The entries added and the rows left out.
    #[serde(flatten)]
    pub import: ToolPipelineImport,
    /// What happened.
    pub summary: String,
}

impl ToolAnnotated for ImportPipelineCsv {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Import into pipeline");
}

#[async_trait]
impl<Transfer: CrmTransferService> AsyncTool<CrmTransferToolContext<Transfer>>
    for ImportPipelineCsv
{
    type Output = ImportPipelineCsvResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id, pipeline = %self.pipeline_id), err)]
    async fn call(
        &self,
        context: ServiceContext<CrmTransferToolContext<Transfer>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let csv = csv_input(&self.csv, self.document_id)?;
        let viewer = context.viewer(request_context.user_id);
        let outcome = context
            .service
            .import_to_pipeline(&viewer, self.pipeline_id, csv)
            .await
            .map_err(transfer_error)?;
        let mut summary = pipeline_summary(&outcome);
        if outcome.skipped_rows > 0 {
            summary.push_str(&format!(
                " {} rows named no company by domain or contact by email.",
                outcome.skipped_rows
            ));
        }
        Ok(ImportPipelineCsvResponse {
            import: ToolPipelineImport::from(&outcome),
            summary,
        })
    }
}
