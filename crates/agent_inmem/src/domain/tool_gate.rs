//! Whether one of Macro's own tools may run in this turn.
//!
//! The sandboxed runtimes reach Macro's tools through the egress proxy, which
//! holds a turn's calls for the owner when somebody else prompted it. This
//! runtime runs those tools in-process, so it asks the same question here,
//! before each call. Connected apps still go through the proxy and are not
//! asked twice.

use std::pin::Pin;

use agent_session::domain::model::AgentSessionId;

/// What became of the question.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeToolVerdict {
    /// Run the tool.
    Run,
    /// Do not; this is what the model is told instead.
    Refuse(String),
}

/// Decides, and when need be waits for the owner, before a native tool runs.
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
