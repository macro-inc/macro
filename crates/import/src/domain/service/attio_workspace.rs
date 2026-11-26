//! Attio CRM imports: read the workspace through the user's Attio MCP
//! connection, convert it into the shared CRM inventory, and plan and write
//! it through `crm_workspace`.

use connectors::McpConnectionsService;
use import_notion::domain::ports::NotionConnections;
use macro_user_id::user_id::MacroUserIdStr;

use super::ImportServiceImpl;
use super::crm_workspace::CrmKinds;
use super::workspace::run::JobControl;
use crate::domain::models::{CrmReport, ImportEntity, ScanCounts};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, NotionPlanRepo, NotionRunRepo,
    Result, SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};

pub(in crate::domain::service) mod plan;

#[cfg(test)]
mod test;

const NOT_AVAILABLE: ImportError = ImportError::NotReady("Attio imports are not available here.");

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// Refuse when the user has not connected Attio.
    pub(super) async fn check_attio_connected(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        let reader = self.attio.as_ref().ok_or(NOT_AVAILABLE)?;
        if !reader.connected(user).await? {
            return Err(import_attio::domain::AttioError::NotConnected.into());
        }
        Ok(())
    }

    #[tracing::instrument(name = "import.attio.plan", skip_all, fields(workspace, rows), err)]
    pub(super) async fn plan_attio(
        &self,
        user: &MacroUserIdStr<'static>,
        control: &JobControl,
    ) -> Result<()> {
        let reader = self.attio.clone().ok_or(NOT_AVAILABLE)?;
        self.plan_crm(user, control, CrmKinds::ATTIO, |counts| async move {
            let found = reader
                .inventory(user, &|read| {
                    let records = read.companies + read.people + read.deals;
                    counts.send_replace(ScanCounts {
                        pages: u32::try_from(records).unwrap_or(u32::MAX),
                        data_sources: 0,
                    });
                })
                .await;
            drop(counts);
            let found = found?;
            tracing::Span::current()
                .record("workspace", tracing::field::display(found.workspace.id));
            Ok(plan::inventory(&found))
        })
        .await
    }

    pub(super) async fn write_attio(
        &self,
        user: &MacroUserIdStr<'static>,
        review: uuid::Uuid,
        control: &JobControl,
    ) -> Result<usize> {
        self.write_crm(user, review, control, CrmKinds::ATTIO).await
    }
}

/// The review card's Attio section, from the current plan's rows.
pub(in crate::domain::service) fn report<'a>(
    review: Option<uuid::Uuid>,
    rows: impl IntoIterator<Item = &'a ImportEntity>,
) -> Option<CrmReport> {
    super::crm_workspace::report(review, rows, CrmKinds::ATTIO)
}
