//! [`NativeToolGate`] over the egress proxy's approvals.
//!
//! Native calls resolve their explicit account choice just like sandbox MCP
//! tool calls. A choice that differs from the verified requester waits for
//! owner approval, using the same session approval record.

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

/// Resolve native actors and hold calls that need owner approval.
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
        if prompter.is_none() {
            return Ok(NativeToolVerdict::Refuse(
                "There is no active turn authorizing this tool; nothing was done.".into(),
            ));
        }
        if tool == "ExecuteCode"
            && arguments.get("turn_id").and_then(serde_json::Value::as_str)
                != prompter
                    .as_ref()
                    .map(|turn| turn.action_id.to_string())
                    .as_deref()
        {
            return Ok(NativeToolVerdict::Refuse(
                "The original execution turn is no longer active; nothing was done.".into(),
            ));
        }
        let (actor, _) = match ai_toolset::actor::ToolActor::take(arguments) {
            Ok(selection) => selection,
            Err(error) => return Ok(NativeToolVerdict::Refuse(error.to_string())),
        };
        let user = match actor.resolve(
            &owner,
            prompter.as_ref().and_then(|turn| turn.acting_user()),
        ) {
            Ok(user) => user.clone(),
            Err(error) => return Ok(NativeToolVerdict::Refuse(error.to_string())),
        };
        tracing::info!(%session, tool, ?actor, "resolved tool actor");
        let Some(prompter) = prompter.filter(|prompter| prompter.acting_user() != Some(&user))
        else {
            return Ok(NativeToolVerdict::RunAs(user));
        };
        let original_turn = prompter.clone();
        let status = self
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
        if self.sessions.turn_prompter(session).await?.as_ref() != Some(&original_turn) {
            return Ok(NativeToolVerdict::Refuse(
                "The original turn ended; this tool did not run.".into(),
            ));
        }
        Ok(match refusal(status, owner.email_str(), tool) {
            None => NativeToolVerdict::RunAs(user),
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
