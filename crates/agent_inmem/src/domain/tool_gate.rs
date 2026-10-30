//! Whether one of Macro's own tools may run in this turn.
//!
//! The sandboxed runtimes reach Macro's tools through the egress proxy, which
//! resolves the selected actor and holds calls whose account differs from
//! the verified requester. This runtime applies that policy before each native
//! call and passes the resolved identity into dispatch. Connected apps use the proxy gate.

use std::pin::Pin;

use agent_session::domain::model::AgentSessionId;

/// What became of the question.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeToolVerdict {
    /// Run without an account override: identity-free tools and ungated test hosts.
    Run,
    /// Run with this verified user's access, preserving the session's billing identity.
    RunAs(macro_user_id::user_id::MacroUserIdStr<'static>),
    /// Do not; this is what the model is told instead.
    Refuse(String),
}

/// Resolves the account and, when needed, waits for owner approval before dispatch.
/// Object-safe so the engine holds it erased.
pub trait NativeToolGate: Send + Sync + 'static {
    /// May `session` run `tool` with `arguments` now?
    fn check<'a>(
        &'a self,
        session: AgentSessionId,
        tool: &'a str,
        arguments: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>>;
}

/// Lets every call through: tests, and tooling with no owner to ask.
#[derive(Clone, Copy, Debug, Default)]
pub struct UngatedNativeTools;

impl NativeToolGate for UngatedNativeTools {
    fn check<'a>(
        &'a self,
        _session: AgentSessionId,
        _tool: &'a str,
        _arguments: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async { NativeToolVerdict::Run })
    }
}
