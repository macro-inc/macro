//! Shared reviewed workspace lifecycle. Sources implement only planning and
//! writing; leases, adoption, reviews, reporting and notifications are shared.

use agent_session::domain::model::AgentSessionId;
use import_notion::domain::{model::ImportScope, ports::NotionConnections};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use std::time::Duration;
use uuid::Uuid;

use super::{ImportServiceImpl, NotionWorkspaceImporter};
use crate::domain::models::{ImportSource, NotionImportReport, NotionSharing, NotionWriteChoices};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, NotionPlanRepo, NotionRunRepo,
    Result, SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};

mod events;
pub(super) mod run;
pub(super) mod scan;

/// Source-independent entry points for reviewed Notion, Linear and Jira imports.
pub trait WorkspaceImporter: NotionWorkspaceImporter {
    /// Read a connected workspace and stage a plan. No Macro entities are
    /// created until the owner approves the resulting review.
    fn prepare_workspace_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        sharing: Option<NotionSharing>,
        wait: Duration,
    ) -> impl Future<Output = Result<NotionImportReport>> + Send;
    /// Read the current plan and resume an abandoned lease when needed.
    fn workspace_import_report(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<NotionImportReport>> + Send;
    /// Tie the selected source's plan and future progress to its review.
    fn attach_workspace_review(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        review: Uuid,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<u64>> + Send;
    /// Start writing precisely the review the owner approved.
    fn start_workspace_write(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        review: Uuid,
        choices: NotionWriteChoices,
    ) -> impl Future<Output = Result<NotionImportReport>> + Send;
    /// Cancel this source only; imported entities remain.
    fn cancel_workspace_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// The two source-specific phases hosted by the durable engine. The scope is
/// provider-specific; tracker plans cover every object visible to the grant.
pub(super) trait Importer {
    type Scope;
    fn plan(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: Self::Scope,
        sharing: NotionSharing,
        control: &run::JobControl,
    ) -> impl Future<Output = Result<()>> + Send;
    fn write(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        control: &run::JobControl,
    ) -> impl Future<Output = Result<usize>> + Send;
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: NotionRunRepo + Clone,
    W: SlackWorkspaceSource,
{
    /// A source-scoped service shares the host's jobs, connections and
    /// notifier, but every lease, team claim and root folder is isolated.
    pub(super) fn scoped(&self, source: ImportSource) -> Self {
        Self {
            repo: self.repo.for_source(source),
            workspace_source: source,
            ..self.clone()
        }
    }
}

fn workspace_source(source: ImportSource) -> Result<()> {
    match source {
        ImportSource::Notion | ImportSource::Linear | ImportSource::Jira => Ok(()),
        ImportSource::Slack => Err(ImportError::NotReady(
            "Slack uses channel discovery, not workspace plans.",
        )),
    }
}

impl<R, S, C, W, N> WorkspaceImporter for ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    async fn prepare_workspace_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        sharing: Option<NotionSharing>,
        wait: Duration,
    ) -> Result<NotionImportReport> {
        workspace_source(source)?;
        self.scoped(source)
            .prepare_notion_import(user, ImportScope::Everything, sharing, wait)
            .await
    }
    async fn workspace_import_report(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<NotionImportReport> {
        workspace_source(source)?;
        self.scoped(source).notion_import_report(user).await
    }
    async fn attach_workspace_review(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        review: Uuid,
        session: AgentSessionId,
    ) -> Result<u64> {
        workspace_source(source)?;
        self.scoped(source)
            .attach_notion_review(user, review, session)
            .await
    }
    async fn start_workspace_write(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        review: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        workspace_source(source)?;
        self.scoped(source)
            .start_notion_write(user, review, choices)
            .await
    }
    async fn cancel_workspace_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        workspace_source(source)?;
        self.scoped(source).cancel_notion_import(user).await
    }
}

impl<R, S, C, W, N> Importer for ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    type Scope = ImportScope;
    async fn plan(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: ImportScope,
        sharing: NotionSharing,
        control: &run::JobControl,
    ) -> Result<()> {
        match self.workspace_source {
            ImportSource::Notion => self.try_plan_workspace(user, scope, sharing, control).await,
            ImportSource::Linear | ImportSource::Jira => {
                self.plan_tracker(user, sharing, control).await
            }
            ImportSource::Slack => workspace_source(self.workspace_source),
        }
    }
    async fn write(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        control: &run::JobControl,
    ) -> Result<usize> {
        match self.workspace_source {
            ImportSource::Notion => {
                self.try_write_plan(user, &self.resumable_write(user, review).await?, control)
                    .await
            }
            ImportSource::Linear | ImportSource::Jira => {
                self.write_tracker(user, review, control).await
            }
            ImportSource::Slack => Err(ImportError::NotReady("Slack uses channel discovery.")),
        }
    }
}
