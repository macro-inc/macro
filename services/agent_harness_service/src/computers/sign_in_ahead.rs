//! Starting a computer's Claude sign-in before anyone opens it, so the link
//! is ready the moment the guided setup asks for it. macrod hands the waiting
//! URL to the first Start; choosing Macro credits signs out, which closes it.

use std::sync::Arc;

use super::Operator;
use super::control::ComputerControl;
use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use harness_id::HarnessId;
use harnesses::domain::models::{ClaudeAccount, ClaudeMode};
use harnesses::domain::ports::HarnessRepo;

#[cfg(test)]
mod test;

/// Whether a computer that just connected should start a Claude sign-in.
///
/// Only while nobody chose yet (setup unfinished) or while the team's own
/// account needs signing in again. Once the team chose Macro credits at
/// setup, never: no one will use it. An account macrod has not reported
/// yet counts as signed out only before setup finishes.
pub(crate) fn wants_sign_in(
    mode: ClaudeMode,
    account: Option<&ClaudeAccount>,
    setup_completed: bool,
) -> bool {
    let signed_in = matches!(account, Some(ClaudeAccount::SignedIn { .. }));
    if signed_in {
        return false;
    }
    match mode {
        ClaudeMode::OwnAccount => matches!(account, Some(ClaudeAccount::SignedOut)),
        ClaudeMode::MacroCredits => !setup_completed,
    }
}

/// What starting a sign-in ahead needs; built after the command bus.
pub struct SignInAhead<Repo> {
    pub control: ComputerControl,
    pub harnesses: Repo,
    pub operator: Arc<Operator>,
}

impl<Repo: HarnessRepo> SignInAhead<Repo> {
    /// Start the sign-in on `harness` when [`wants_sign_in`] says so.
    #[tracing::instrument(name = "computer.claude.sign_in_ahead", skip(self))]
    pub async fn on_connected(&self, harness: HarnessId) {
        let setup_completed = match self.operator.setup_completed(harness).await {
            Ok(Some(completed)) => completed,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the computer's setup");
                return;
            }
        };
        let record = match self.harnesses.get_harness(harness).await {
            Ok(Some(record)) => record,
            Ok(None) => return,
            Err(error) => {
                let error: anyhow::Error = error.into();
                tracing::warn!(error = ?error, "could not read the computer's harness");
                return;
            }
        };
        if !wants_sign_in(
            record.claude_mode,
            record.capabilities.claude.as_ref(),
            setup_completed,
        ) {
            return;
        }
        match self
            .control
            .send(harness, ComputerCommand::ClaudeSignInStart)
            .await
        {
            Ok(ComputerControlResult::SignInStarted { .. }) => {
                tracing::info!("Claude sign-in ready ahead of time");
            }
            Ok(other) => tracing::warn!(?other, "the computer did not start a sign-in"),
            Err(error) => tracing::warn!(error = ?error, "could not start a sign-in ahead"),
        }
    }
}
