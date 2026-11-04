//! ExportPipelineCsv: a pipeline's entries saved as a CSV file.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{CrmTransferToolContext, transfer_error};
use crate::domain::{crm_transfer::CrmTransferService, pipeline_workflows::MAX_SCANNED_ROWS};

/// Export a pipeline to a CSV file.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ExportPipelineCsv",
    description = "Export a CRM pipeline's deals (entries) to a CSV file saved in the user's Macro files: Company and Domain (or Contact and Email), then one column per field, with people as emails. Use it to back up a pipeline, move it to another team (ImportPipelineCsv reads the same file), or share it as a spreadsheet; to answer questions about deals, use FindPipelineEntries instead. Returns the file's documentId and how many entries it holds."
)]
pub struct ExportPipelineCsv {
    /// The pipeline.
    #[schemars(description = "The pipeline's id from ListPipelines.")]
    pub pipeline_id: Uuid,
}

/// The saved file.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportPipelineCsvResponse {
    /// The CSV file in Macro.
    pub document_id: Uuid,
    /// The file's name.
    pub file_name: String,
    /// Entries written.
    pub rows: usize,
    /// Whether every entry was written.
    pub complete: bool,
    /// What happened.
    pub summary: String,
}

impl ToolAnnotated for ExportPipelineCsv {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Export pipeline");
}

#[async_trait]
impl<Transfer: CrmTransferService> AsyncTool<CrmTransferToolContext<Transfer>>
    for ExportPipelineCsv
{
    type Output = ExportPipelineCsvResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id, pipeline = %self.pipeline_id), err)]
    async fn call(
        &self,
        context: ServiceContext<CrmTransferToolContext<Transfer>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let viewer = context.viewer(request_context.user_id);
        let export = context
            .service
            .export_pipeline(&viewer, self.pipeline_id)
            .await
            .map_err(transfer_error)?;
        let mut summary = format!(
            "Saved {} entries to the CSV file \"{}\".",
            export.rows, export.file_name
        );
        if !export.complete {
            summary.push_str(&format!(
                " The pipeline has more than {MAX_SCANNED_ROWS} entries; only the first \
                 {MAX_SCANNED_ROWS} were written."
            ));
        }
        Ok(ExportPipelineCsvResponse {
            document_id: export.document_id,
            file_name: export.file_name,
            rows: export.rows,
            complete: export.complete,
            summary,
        })
    }
}
