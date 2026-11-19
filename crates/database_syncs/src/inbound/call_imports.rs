//! The call import, telling syncs when a Granola meeting arrives so its
//! synced tables run soon rather than on their schedule.

use std::sync::Arc;

use async_trait::async_trait;
use call::domain::imports::{
    CallImportService, ImportedCall, ImportedCallPreview, ImportedCallRecord,
};
use call::domain::records::{CallEntityRecord, CallProvider};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::SourceKind;
use crate::domain::ports::DatabaseSyncsService;

/// [`CallImportService`] that marks the owner's Granola syncs due after
/// each Granola import.
pub struct SyncOnCallImport<Service> {
    calls: Arc<dyn CallImportService>,
    syncs: Arc<Service>,
}

impl<Service> SyncOnCallImport<Service> {
    /// Imports through `calls`, telling `syncs`.
    pub fn new(calls: Arc<dyn CallImportService>, syncs: Arc<Service>) -> Self {
        Self { calls, syncs }
    }
}

// `CallImportService` is object safe through `async_trait`; its users hold
// it as `Arc<dyn CallImportService>`.
#[async_trait]
impl<Service: DatabaseSyncsService> CallImportService for SyncOnCallImport<Service> {
    async fn ingest(&self, call: ImportedCall) -> Result<Uuid, rootcause::Report> {
        let owner = call.source.user_id.clone();
        let provider = call.source.provider;
        let call_id = self.calls.ingest(call).await?;
        match provider {
            CallProvider::Granola => {
                // The import stands either way; a sync not marked due still
                // runs on its schedule.
                let _ = self
                    .syncs
                    .source_changed(&owner, SourceKind::GranolaMeetings)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, "granola syncs were not marked due");
                    });
            }
            CallProvider::Macro => {}
        }
        Ok(call_id)
    }

    async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report> {
        self.calls.list(user).await
    }

    async fn list_source_records(
        &self,
        user: &MacroUserIdStr<'static>,
        provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report> {
        self.calls.list_source_records(user, provider).await
    }

    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report> {
        self.calls.read(user, id).await
    }
}
