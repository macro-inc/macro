//! Linear discovery: list a person's open issues and stage them for a plan.
//! No model reads Linear here; the issues come straight from Linear's API.

use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;

use super::{ImportServiceImpl, ImportStager, StageOutcome};
use crate::domain::models::{ImportSource, Initiator, RunStatus};
use crate::domain::ports::{CanonicalImportRepo, EntityCreator, ImportRepo, SlackWorkspaceSource};

#[cfg(test)]
mod test;

/// The most issues one discovery stages.
const MAX_ISSUES: usize = 250;

/// How long a Linear discovery may run before it is failed.
const LINEAR_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(120);

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    /// Lists the person's open Linear issues in the background and settles
    /// the run: `ready` with what was staged, or `failed` with why.
    pub(super) fn spawn_linear_discovery(&self, user: MacroUserIdStr<'static>) {
        let service = self.clone();
        tokio::spawn(async move {
            let outcome =
                tokio::time::timeout(LINEAR_DISCOVERY_TIMEOUT, service.discover_linear(&user))
                    .await
                    .unwrap_or_else(|_| Err("Linear discovery timed out".to_owned()));
            let finished = match outcome {
                Ok(staged) => {
                    tracing::info!(staged, "Linear discovery finished");
                    service
                        .repo
                        .finish_run(&user, ImportSource::Linear, RunStatus::Ready, None)
                        .await
                }
                Err(reason) => {
                    tracing::warn!(reason, "Linear discovery failed");
                    service
                        .repo
                        .finish_run(
                            &user,
                            ImportSource::Linear,
                            RunStatus::Failed,
                            Some(&reason),
                        )
                        .await
                }
            };
            let _ = finished.inspect_err(|error| {
                tracing::error!(error = ?error, "failed to persist Linear discovery outcome");
            });
            service.notify(&user).await;
        });
    }

    /// Stages each open issue (refreshing one already waiting); ones already
    /// imported, declined or importing are left as they are. Returns how many
    /// are waiting for a plan.
    #[tracing::instrument(skip_all, err)]
    async fn discover_linear(&self, user: &MacroUserIdStr<'static>) -> Result<usize, String> {
        let source = self
            .linear_source
            .as_ref()
            .ok_or_else(|| "Linear isn't available here".to_owned())?;
        let issues = source
            .open_issues(user, MAX_ISSUES)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Linear is not connected".to_owned())?;
        let mut staged = 0;
        for issue in issues {
            let Some(identifier) = issue.identifier.clone() else {
                continue;
            };
            let metadata = serde_json::to_value(&issue).map_err(|error| error.to_string())?;
            match self
                .stage(
                    user,
                    Initiator::Chat,
                    ImportSource::Linear,
                    &identifier,
                    metadata,
                )
                .await
                .map_err(|error| error.to_string())?
            {
                StageOutcome::Staged(_) => staged += 1,
                StageOutcome::AlreadyImported { .. }
                | StageOutcome::PreviouslyDiscarded(_)
                | StageOutcome::ImportInProgress(_) => {}
            }
        }
        Ok(staged)
    }
}
