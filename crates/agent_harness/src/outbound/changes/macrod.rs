//! Changes of a session served by a self-hosted `macrod` daemon.
//!
//! The daemon's workspace is the only copy of the work, on a machine this
//! service cannot see, so the daemon is asked over its runtime connection to
//! diff the workspace itself. Which daemon is the bot's current binding, the
//! same fact that routes its prompts.

use agent_changes::domain::error::ExtractError;
use agent_changes::domain::model::{
    ChangesetRange, ChangesetSource, ExtractedChangeset, GitRef, RepositorySlug,
};
use agent_changes::domain::ports::ChangesetExtractor;
use agent_runtime_protocol::domain::schema::v0::{ChangesRef, CollectChangesResult};
use agent_session::domain::model::AgentSession;

use crate::domain::ports::{CollectChangesError, HarnessBindings, HarnessChanges};

#[cfg(test)]
mod test;

/// [`ChangesetExtractor`] for sessions served by registered `macrod`
/// daemons.
pub struct MacrodChangesetExtractor<Bindings, Changes> {
    bindings: Bindings,
    changes: Changes,
}

impl<Bindings, Changes> MacrodChangesetExtractor<Bindings, Changes> {
    /// Resolve the bot's daemon through `bindings` and ask it through
    /// `changes`.
    pub fn new(bindings: Bindings, changes: Changes) -> Self {
        Self { bindings, changes }
    }
}

impl<Bindings, Changes> ChangesetExtractor for MacrodChangesetExtractor<Bindings, Changes>
where
    Bindings: HarnessBindings,
    Changes: HarnessChanges,
{
    #[tracing::instrument(skip_all, err, fields(agent.session.id = %session.id))]
    async fn extract(&self, session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        let harness = self
            .bindings
            .harness_for(session.bot_id)
            .await
            .map_err(|error| ExtractError::Failed(rootcause::report!("{error}")))?
            .ok_or_else(|| {
                ExtractError::NotReady("This agent is not bound to a harness.".to_owned())
            })?;
        let result = self
            .changes
            .collect_changes(harness)
            .await
            .map_err(|error| match error {
                CollectChangesError::NotConnected => ExtractError::NotReady(
                    "The agent's harness is not connected right now. Changes are collected when it reconnects and finishes a turn."
                        .to_owned(),
                ),
                CollectChangesError::TimedOut => ExtractError::NotReady(
                    "The harness took too long to collect its changes. Try again.".to_owned(),
                ),
                CollectChangesError::Failed(message) => {
                    ExtractError::Failed(rootcause::report!("{message}"))
                }
            })?;
        match result {
            CollectChangesResult::Collected {
                patch,
                repository,
                base,
                head,
                truncated,
            } => Ok(ExtractedChangeset {
                source: ChangesetSource::MacrodGit,
                range: ChangesetRange {
                    repository: repository.map(|remote| {
                        RepositorySlug::parse(&remote)
                            .map(|slug| slug.https_url())
                            .unwrap_or(remote)
                    }),
                    base: git_ref(base),
                    head: git_ref(head),
                },
                patch,
                truncated,
            }),
            // The daemon's word is already the operator-facing one: "the
            // workspace is not a git repository", "git is not installed".
            CollectChangesResult::Error { message } => Err(ExtractError::NotReady(message)),
        }
    }
}

fn git_ref(reference: ChangesRef) -> GitRef {
    GitRef {
        name: reference.name,
        sha: reference.sha,
    }
}
