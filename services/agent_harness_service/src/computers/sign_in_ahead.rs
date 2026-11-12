//! Starting a computer's Claude sign-in before anyone opens it, so the link
//! is ready the moment the guided setup asks for it. harnessd hands the
//! waiting URL to the first Start; choosing Macro credits signs out, which
//! closes it.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use harnessd_protocol::{AgentProvider, ClaudeAccount, Request, Response};
use harnesses::domain::ports::HarnessService;

use super::Operator;
use super::harnessd::Harnessd;

#[cfg(test)]
mod test;

/// Whether a computer whose harnessd reported `status` should start a
/// Claude sign-in now.
///
/// While nobody chose yet (setup unfinished) and nothing is signed in, or
/// once the computer's own credential has expired. After the team chose
/// Macro credits at setup, never: no one will use it. A sign-in already
/// waiting needs nothing.
pub(crate) fn wants_sign_in(status: &Response, setup_completed: bool, now: DateTime<Utc>) -> bool {
    match status {
        Response::SignedOut { .. } => !setup_completed,
        Response::SignedIn {
            claude: Some(ClaudeAccount { expires_at, .. }),
            ..
        } => expires_at.is_some_and(|expires_at| expires_at <= now),
        Response::SignedIn { claude: None, .. }
        | Response::Pending { .. }
        | Response::SignInStarted { .. }
        | Response::Error { .. } => false,
    }
}

/// What starting a sign-in ahead needs.
pub struct SignInAhead<Harnesses> {
    pub harnessd: Harnessd<Harnesses>,
    pub operator: Arc<Operator>,
}

impl<Harnesses: HarnessService> SignInAhead<Harnesses> {
    /// Record `harness`'s sign-in state, then start a sign-in when
    /// [`wants_sign_in`] says so.
    #[tracing::instrument(name = "computer.claude.sign_in_ahead", skip(self))]
    pub async fn on_connected(&self, harness: HarnessId) {
        let computer_id = match self.harnessd.harnesses().harness_computer(harness).await {
            Ok(Some(computer_id)) => computer_id,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the harness's computer");
                return;
            }
        };
        let setup_completed = match self.operator.setup_completed(harness).await {
            Ok(Some(completed)) => completed,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the computer's setup");
                return;
            }
        };
        let status = match self
            .harnessd
            .refresh(harness, computer_id, AgentProvider::Claude)
            .await
        {
            Ok(status) => status,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the computer's Claude sign-in");
                return;
            }
        };
        if !wants_sign_in(&status, setup_completed, Utc::now()) {
            return;
        }
        let start = Request::SignInStart {
            agent: AgentProvider::Claude,
        };
        match self.harnessd.run(harness, computer_id, start, None).await {
            Ok(Response::SignInStarted { .. }) => {
                tracing::info!("Claude sign-in ready ahead of time");
            }
            Ok(other) => tracing::warn!(?other, "the computer did not start a sign-in"),
            Err(error) => tracing::warn!(error = ?error, "could not start a sign-in ahead"),
        }
    }
}
