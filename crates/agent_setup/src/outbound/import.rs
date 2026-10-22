//! [`SetupImports`] over Macro's import service.
//!
//! The adapter is where setup's import guarantee is enforced: nothing is ever
//! discarded, so declined items are only left out.

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use import::domain::{
    models::{ImportSource, ImportState, NotionImportReport, NotionSharing, NotionWriteChoices},
    ports::ImportError,
    service::{ImportService, NotionWorkspaceImporter, RunImportOutcome},
};
use import_notion::domain::model::ImportScope;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::ports::{Result, SetupError, SetupImports};

/// How long starting a Notion plan waits for planning before answering.
/// Setup waits for the plan itself in `SetupDiscover`.
const NOTION_PLAN_WAIT: Duration = Duration::from_secs(2);

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
            "Looking through {} isn't available yet.",
            source.as_ref()
        )),
        ImportError::NotionNotConnected => SetupError::Actionable(
            "Notion is not connected. Call SetupConnect(apps: [\"notion\"]) and show the person \
             the link."
                .to_owned(),
        ),
        ImportError::NotReady(reason) => SetupError::Actionable(reason.to_owned()),
        other => SetupError::Internal(rootcause::Report::new(other).into_dynamic()),
    }
}

#[async_trait]
impl<I: ImportService + NotionWorkspaceImporter> SetupImports for ImportServiceSetup<I> {
    async fn state(&self, user: &MacroUserIdStr<'static>) -> Result<ImportState> {
        self.service.state(user.clone()).await.map_err(setup_error)
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

    async fn plan_notion(
        &self,
        user: &MacroUserIdStr<'static>,
        sharing: Option<NotionSharing>,
    ) -> Result<NotionImportReport> {
        self.service
            .prepare_notion_import(user, ImportScope::Everything, sharing, NOTION_PLAN_WAIT)
            .await
            .map_err(setup_error)
    }

    async fn notion_report(&self, user: &MacroUserIdStr<'static>) -> Result<NotionImportReport> {
        self.service
            .notion_import_report(user)
            .await
            .map_err(setup_error)
    }

    async fn attach_notion_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
    ) -> Result<()> {
        // The person approved the plan in their agent, not on a review card,
        // so no agent session hears about it.
        self.service
            .attach_notion_review(user, review_id, None)
            .await
            .map(|_| ())
            .map_err(setup_error)
    }

    async fn write_notion(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        self.service
            .start_notion_write(user, review_id, choices)
            .await
            .map_err(setup_error)
    }
}
