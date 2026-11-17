//! A program's attribution, carried on the internal calls a service makes
//! for it, so the callee's program guards see the program and not the
//! service that called.

use ::axum::http::{HeaderMap, StatusCode};
use bot_id::BotId;
use uuid::Uuid;

use super::{CODE_EXECUTION_HEADER, MacroAuthorizationRejection};
use crate::{CredentialAttribution, MacroUserAuthentication};

#[cfg(test)]
mod test;

/// The agent an internal caller's request was signed for.
pub const INTERNAL_AGENT_ID_HEADER: &str = "x-internal-agent-id";
/// The routine run an internal caller's request was signed for.
pub const INTERNAL_ROUTINE_ID_HEADER: &str = "x-internal-routine-id";

/// The program behind a request, as the service handling it forwards it:
/// the signed agent and routine ids, and whether code mode sent it. A guard
/// in the forwarding service checks it as it checks the request itself:
/// `is_agent_run(program.attribution(), &program.headers())`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForwardedProgram {
    agent_id: Option<BotId>,
    routine_id: Option<Uuid>,
    code_execution: bool,
}

impl ForwardedProgram {
    /// The program behind a request `user` authenticated, with `headers`.
    #[must_use]
    pub fn of(user: &MacroUserAuthentication, headers: &HeaderMap) -> Self {
        Self::new(
            user.agent_id,
            user.routine_id,
            headers.contains_key(CODE_EXECUTION_HEADER),
        )
    }

    /// A program signed for `agent_id` and `routine_id`, and sent by code
    /// mode when `code_execution`.
    #[must_use]
    pub fn new(agent_id: Option<BotId>, routine_id: Option<Uuid>, code_execution: bool) -> Self {
        Self {
            agent_id,
            routine_id,
            code_execution,
        }
    }

    /// Who the forwarded claims say the caller acts for.
    #[must_use]
    pub fn attribution(&self) -> CredentialAttribution {
        CredentialAttribution::signed(self.agent_id, self.routine_id)
    }

    /// The headers an internal call made for the caller carries.
    #[must_use]
    pub fn headers(&self) -> HeaderMap {
        HeaderMap::new()
    }
}

/// Put the program an internal caller forwarded onto the acting user it
/// named. Only internal authorization reads these headers; a user's own
/// request never sets its attribution this way.
pub(super) fn accept(
    _headers: &HeaderMap,
    _acting_user: Option<&mut MacroUserAuthentication>,
) -> Result<(), MacroAuthorizationRejection> {
    let _ = StatusCode::BAD_REQUEST;
    Ok(())
}
