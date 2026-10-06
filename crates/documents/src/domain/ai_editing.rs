//! Permission-scoped AI editing, admission, and existing per-model metering.

use super::ports::editing::{EditMode, EditResult, EditingWorkerService, EditorName};
use ai_billing::domain::admission::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// An authorized edit with its boundary-minted, narrowly scoped worker token.
pub struct AiEditRequest<'a> {
    /// Permission token for the document named by the receipt.
    pub document_token: &'a DocumentPermissionToken,
    /// Requested changes.
    pub instructions: &'a str,
    /// Worker pipeline to run.
    pub mode: EditMode,
    /// Name displayed on the editing cursor.
    pub editor: Option<EditorName>,
}

/// Admission failures never start the worker.
#[derive(Debug, thiserror::Error)]
pub enum AiEditError {
    /// Quota refusal or temporary validation failure.
    #[error("{0}")]
    Admission(#[from] AiAdmissionError),
    /// An admitted worker call failed.
    #[error(transparent)]
    Worker(#[from] anyhow::Error),
}

/// Orchestrates AI editing independently of tool or HTTP transport.
pub struct AiEditingService<W> {
    worker: Arc<W>,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
}

impl<W: EditingWorkerService> AiEditingService<W> {
    /// Compose the worker with the host's admission and existing usage recorder.
    pub fn new(
        worker: Arc<W>,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
    ) -> Self {
        Self {
            worker,
            admission,
            recorder,
        }
    }

    /// Apply an authorized edit for the trusted caller. Dropping this future
    /// cancels the worker call; completed calls retain their existing metering.
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        request: AiEditRequest<'_>,
    ) -> Result<EditResult, AiEditError> {
        self.admission.admit(caller, AiFeature::AiEditing).await?;
        let document_id = &receipt.entity().entity_id;
        let result = self
            .worker
            .edit(
                document_id,
                request.document_token,
                request.instructions,
                request.mode,
                request.editor,
            )
            .await?;
        let usage = UsageContext::new(AiFeature::AiEditing, caller.clone())
            .with_entity(macro_uuid::string_to_uuid(document_id).ok());
        for model in &result.usage {
            // The worker reports one input total per model with no cache
            // breakdown, so any cache tokens in it bill at the input rate.
            self.recorder.record(usage.clone().into_event(
                model.model.clone(),
                UsageAmount::Tokens {
                    input: u64::from(model.input_tokens),
                    output: u64::from(model.output_tokens),
                    cache_read: 0,
                    cache_write: 0,
                },
            ));
        }
        Ok(result)
    }
}
