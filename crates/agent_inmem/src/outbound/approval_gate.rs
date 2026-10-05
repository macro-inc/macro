//! [`NativeToolGate`] over the egress proxy's approvals.
//!
//! The same rule and the same record as a sandbox's MCP calls: a turn
//! somebody other than the owner prompted waits on the owner for each of
//! Macro's own tools, and the hold shows in the session like any other.

use std::pin::Pin;
use std::sync::Arc;

use agent_egress::domain::approval::{
    InProcessCall, MACRO_SERVER_SLUG, ToolApprovalService, refusal, spends_owner_access,
};
use agent_egress::domain::ports::{ToolApprovalAnnouncer, ToolApprovalSignals, ToolApprovalStore};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentSessionRepo;

use crate::domain::tool_gate::{NativeToolGate, NativeToolVerdict};

#[cfg(test)]
mod test;

/// What the model hears when the gate itself could not decide.
const UNDECIDED: &str = "This tool did not run: whether it may run in this turn could not be \
    checked. Tell the person who asked, and do not try to do the same thing another way.";

/// Holds native tool calls for the owner in turns somebody else prompted.
pub struct OwnerApprovalGate<Sessions, Store, Signals, Announcer> {
    sessions: Sessions,
    approvals: Arc<ToolApprovalService<Store, Signals, Announcer>>,
}

impl<Sessions, Store, Signals, Announcer> OwnerApprovalGate<Sessions, Store, Signals, Announcer> {
    /// Gate over `sessions`' rows and `approvals`.
    pub fn new(
        sessions: Sessions,
        approvals: Arc<ToolApprovalService<Store, Signals, Announcer>>,
    ) -> Self {
        Self {
            sessions,
            approvals,
        }
    }
}

impl<Sessions, Store, Signals, Announcer> OwnerApprovalGate<Sessions, Store, Signals, Announcer>
where
    Sessions: AgentSessionRepo,
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    async fn decide(
        &self,
        session: AgentSessionId,
        tool: &str,
        arguments: &serde_json::Value,
    ) -> anyhow::Result<NativeToolVerdict> {
        if !spends_owner_access(MACRO_SERVER_SLUG, tool) {
            return Ok(NativeToolVerdict::Run);
        }
        let row = self.sessions.get(session).await?;
        let Some(owner) = row.owner_id.as_user().cloned() else {
            return Ok(NativeToolVerdict::Refuse(UNDECIDED.to_owned()));
        };
        let prompter = self.sessions.turn_prompter(session).await?;
        let Some(prompter) = prompter.filter(|prompter| prompter.user.as_ref() != Some(&owner))
        else {
            return Ok(NativeToolVerdict::Run);
        };
        let resolved = self
            .approvals
            .hold_in_process(InProcessCall {
                session,
                owner: owner.clone(),
                prompter,
                server_slug: MACRO_SERVER_SLUG.to_owned(),
                server_name: "Macro".to_owned(),
                tool_name: tool.to_owned(),
                arguments: arguments.clone(),
            })
            .await?;
        Ok(match refusal(resolved.status, owner.email_str(), tool) {
            None => NativeToolVerdict::Run,
            Some(text) => NativeToolVerdict::Refuse(text),
        })
    }
}

impl<Sessions, Store, Signals, Announcer> NativeToolGate
    for OwnerApprovalGate<Sessions, Store, Signals, Announcer>
where
    Sessions: AgentSessionRepo,
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    fn check<'a>(
        &'a self,
        session: AgentSessionId,
        tool: &'a str,
        arguments: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async move {
            self.decide(session, tool, arguments)
                .await
                .unwrap_or_else(|error| {
                    tracing::error!(error = ?error, %session, tool, "could not gate a native tool call");
                    NativeToolVerdict::Refuse(UNDECIDED.to_owned())
                })
        })
    }
}
