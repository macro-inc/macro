//! A program's attribution, carried on the internal calls a service makes
//! for it, so the callee's program guards see the program and not the
//! service that called.

use ::axum::http::{HeaderMap, HeaderValue, StatusCode};
use bot_id::BotId;
use uuid::Uuid;

use super::{CODE_EXECUTION_HEADER, MacroAuthorizationRejection, status_rejection};
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
        let mut headers = HeaderMap::new();
        if let Some(agent_id) = self.agent_id {
            headers.insert(INTERNAL_AGENT_ID_HEADER, id_value(agent_id));
        }
        if let Some(routine_id) = self.routine_id {
            headers.insert(INTERNAL_ROUTINE_ID_HEADER, id_value(routine_id));
        }
        if self.code_execution {
            headers.insert(CODE_EXECUTION_HEADER, HeaderValue::from_static("1"));
        }
        headers
    }
}

/// An id's header value: its hyphenated UUID, always visible ASCII.
fn id_value(id: impl std::fmt::Display) -> HeaderValue {
    HeaderValue::try_from(id.to_string()).expect("a UUID is a valid header value")
}

/// Put the program an internal caller forwarded onto the acting user it
/// named. Only internal authorization reads these headers; a user's own
/// request never sets its attribution this way. A forwarded id that doesn't
/// parse, or one with nobody to act for, refuses the call: a call that
/// should carry a program never reaches a guard as a person.
pub(super) fn accept(
    headers: &HeaderMap,
    acting_user: Option<&mut MacroUserAuthentication>,
) -> Result<(), MacroAuthorizationRejection> {
    let agent_id = forwarded::<BotId>(headers, INTERNAL_AGENT_ID_HEADER)?;
    let routine_id = forwarded::<Uuid>(headers, INTERNAL_ROUTINE_ID_HEADER)?;
    if agent_id.is_none() && routine_id.is_none() {
        return Ok(());
    }
    let Some(user) = acting_user else {
        tracing::warn!("internal call forwarded a program with no acting user");
        return Err(invalid());
    };
    user.agent_id = agent_id;
    user.routine_id = routine_id;
    Ok(())
}

/// The one value of `name`, parsed; `None` when the call carries none.
fn forwarded<Id: std::str::FromStr>(
    headers: &HeaderMap,
    name: &'static str,
) -> Result<Option<Id>, MacroAuthorizationRejection> {
    let mut values = headers.get_all(name).iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        tracing::warn!(header = name, "internal call forwarded a program twice");
        return Err(invalid());
    }
    value
        .to_str()
        .ok()
        .and_then(|value| value.parse().ok())
        .map(Some)
        .ok_or_else(|| {
            tracing::warn!(
                header = name,
                "internal call forwarded an unreadable program"
            );
            invalid()
        })
}

fn invalid() -> MacroAuthorizationRejection {
    status_rejection(StatusCode::BAD_REQUEST, "invalid forwarded program")
}
