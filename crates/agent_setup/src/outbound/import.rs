//! [`SetupImports`] over Macro's import service.
//!
//! The adapter is where setup's two import guarantees are enforced: every
//! gather starts with automatic import off, and nothing is ever discarded.

use std::sync::Arc;

use async_trait::async_trait;
use import::domain::{
    models::{ImportSource, ImportState},
    ports::ImportError,
    service::{ImportService, RunImportOutcome},
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::ports::{Result, SetupError, SetupImports};

/// The import service as setup uses it.
pub struct ImportServiceSetup<I> {
    service: Arc<I>,
}

impl<I> ImportServiceSetup<I> {
    /// An adapter over the import service.
    pub fn new(service: Arc<I>) -> Self {
        Self { service }
    }
}

fn setup_error(error: ImportError) -> SetupError {
    match error {
        ImportError::Admission(admission) => SetupError::Actionable(format!(
            "Macro couldn't start this right now ({admission}). Tell the person, and try again \
             later; nothing was imported."
        )),
        ImportError::UnsupportedDiscovery(source) => SetupError::Actionable(format!(
            "Looking again for more in {} isn't available yet.",
            source.as_ref()
        )),
        other => SetupError::Internal(rootcause::Report::new(other).into_dynamic()),
    }
}

#[async_trait]
impl<I: ImportService> SetupImports for ImportServiceSetup<I> {
    async fn state(&self, user: &MacroUserIdStr<'static>) -> Result<ImportState> {
        self.service.state(user.clone()).await.map_err(setup_error)
    }

    async fn start_gather(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        // Automatic import off: candidates wait for the person's approval.
        self.service
            .start_gather(user.clone(), source, false)
            .await
            .map_err(setup_error)
    }

    async fn start_discovery(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        self.service
            .start_discovery(user.clone(), source)
            .await
            .map_err(setup_error)
    }

    async fn retry_gather(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        self.service
            .retry_gather(user.clone(), source)
            .await
            .map_err(setup_error)
    }

    async fn run_import(
        &self,
        user: &MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
    ) -> Result<RunImportOutcome> {
        // Never discards: declined candidates are left out, not declined
        // permanently, so injected text can't make setup throw work away.
        self.service
            .run_import(user.clone(), import_ids, Vec::new())
            .await
            .map_err(setup_error)
    }
}
