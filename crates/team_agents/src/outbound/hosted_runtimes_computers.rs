//! TODO(agent-brains): Macro computers through `crates/hosted_runtimes`
//! (PR A, `wolf/macro-computers`).
//!
//! PR A's `ComputerService` (purchase, quote, status, release_now) has no
//! adapters in this branch yet. Until it does, every call fails with
//! [`TeamAgentError::ComputerUnavailable`], so creating an agent stops before
//! any charge and undoes what it made. The [`Computers`] port mirrors
//! `ComputerService` field for field, so the real adapter is a thin
//! in-process call in `authentication_service`; `release` passes the
//! computer's own name as `release_now`'s confirmation.

use uuid::Uuid;

use crate::domain::models::{
    ComputerPurchase, ComputerQuote, ComputerSize, ComputerStatus, TeamAgentError,
};
use crate::domain::ports::Computers;

const NOT_WIRED: &str = "Macro computers are not available yet";

/// Placeholder until `crates/hosted_runtimes` exposes purchases.
#[derive(Debug, Clone, Default)]
pub struct HostedRuntimesComputers;

impl Computers for HostedRuntimesComputers {
    async fn quote(
        &self,
        _team_id: Uuid,
        _size: ComputerSize,
    ) -> Result<ComputerQuote, TeamAgentError> {
        Err(TeamAgentError::ComputerUnavailable(NOT_WIRED.to_string()))
    }

    async fn purchase(&self, _purchase: ComputerPurchase) -> Result<Uuid, TeamAgentError> {
        Err(TeamAgentError::ComputerUnavailable(NOT_WIRED.to_string()))
    }

    async fn status(
        &self,
        _team_id: Uuid,
        _computer_id: Uuid,
    ) -> Result<ComputerStatus, TeamAgentError> {
        Err(TeamAgentError::ComputerUnavailable(NOT_WIRED.to_string()))
    }

    async fn release(&self, _team_id: Uuid, _computer_id: Uuid) -> Result<(), TeamAgentError> {
        Err(TeamAgentError::ComputerUnavailable(NOT_WIRED.to_string()))
    }
}
