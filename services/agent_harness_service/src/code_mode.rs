//! Bind code-mode dispatch to the same owner approvals as native session tools.

use std::sync::Arc;

use agent_code_mode::domain::{CodeModeTools, ExecutionIdentity, ToolDocumentation};
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use async_trait::async_trait;
use code_execution::domain::HostResult;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

pub struct ApprovedCodeTools {
    tools: Arc<dyn CodeModeTools>,
    gate: Arc<dyn NativeToolGate>,
}

impl ApprovedCodeTools {
    pub fn new(tools: Arc<dyn CodeModeTools>, gate: Arc<dyn NativeToolGate>) -> Self {
        Self { tools, gate }
    }
}

#[async_trait]
impl CodeModeTools for ApprovedCodeTools {
    fn catalog(&self) -> Vec<ToolDocumentation> {
        self.tools.catalog()
    }

    async fn call(
        &self,
        identity: &ExecutionIdentity,
        name: &str,
        args: &Value,
        cancel: CancellationToken,
    ) -> HostResult {
        let verdict = tokio::select! {
            biased;
            _ = cancel.cancelled() => return HostResult::Error { message: "Execution cancelled.".into() },
            verdict = self.gate.check(identity.session, name, args) => verdict,
        };
        match verdict {
            NativeToolVerdict::Run => self.tools.call(identity, name, args, cancel).await,
            NativeToolVerdict::Refuse(message) => HostResult::Error { message },
        }
    }
}

#[cfg(test)]
mod test;
