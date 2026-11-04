//! A running execution's route to the session agent's connected apps.
//!
//! A program reaches the same apps and custom MCP servers the session's
//! agent was given, through the harness's credential-stamping egress: the
//! sandbox never sees a token. The program spends the one account its
//! execution was approved for, and only while that execution runs in the
//! turn it was started for.

use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use super::{CodeModeError, ExecutionId, ExecutionStatus, ExecutionStore, ExecutionTurns};

#[cfg(test)]
mod test;

/// Which store a connected app comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectedAppKind {
    /// An app connected through Macro Connect or Pipedream, keyed by its slug.
    App,
    /// A custom MCP server the owner added by URL, keyed by a digest of the URL.
    Custom,
}

/// Names one connected app: the key is its slug or its URL digest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAppRef {
    /// Which store the app comes from.
    pub kind: ConnectedAppKind,
    /// The app's slug, or its custom server key.
    pub key: String,
}

/// A connected app the session's agent may use.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedApp {
    /// Which store the app comes from.
    pub kind: ConnectedAppKind,
    /// The app's slug, or its custom server key.
    pub key: String,
    /// Display name, e.g. `Slack` or the owner's name for a custom server.
    pub name: String,
}

/// One tool a connected app serves.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedTool {
    /// The tool's name on its server.
    pub name: String,
    /// What the server says the tool does.
    pub description: Option<String>,
    /// JSON Schema for the tool's arguments.
    #[schema(value_type = Object)]
    pub input_schema: serde_json::Value,
}

/// Call one tool of a connected app.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CallConnectedTool {
    /// The tool's name on its server.
    pub tool: String,
    /// The tool's arguments, matching its input schema.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
}

/// A connected tool's answer: MCP's `CallToolResult`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedToolResult {
    /// The tool failed, or could not run; `content` says why.
    pub is_error: bool,
    /// MCP content blocks, e.g. `{type: "text", text}`.
    #[schema(value_type = Vec<Object>)]
    pub content: Vec<serde_json::Value>,
    /// Structured output, for tools that declare an output schema.
    #[schema(value_type = Option<Object>)]
    pub structured_content: Option<serde_json::Value>,
}

/// The accounts a session's turn can act as.
#[derive(Clone, Debug)]
pub struct SessionAccounts {
    /// The session owner.
    pub owner: MacroUserIdStr<'static>,
    /// The person behind the running turn; `None` for a system turn.
    pub requester: Option<MacroUserIdStr<'static>>,
}

/// A running execution's admitted use: the account its calls spend.
#[derive(Clone, Debug)]
pub struct ConnectedAppUse {
    /// The execution's session.
    pub session: AgentSessionId,
    /// The account the execution was approved to act as.
    pub user: MacroUserIdStr<'static>,
}

/// The session agent's connected apps, reached through the harness egress.
#[async_trait]
pub trait ConnectedAppTools: Send + Sync + 'static {
    /// The accounts the session's current turn can act as.
    async fn accounts(&self, session: AgentSessionId) -> Result<SessionAccounts, CodeModeError>;
    /// The apps the session's agent was given, without contacting any of them.
    async fn apps(&self, usage: &ConnectedAppUse) -> Result<Vec<ConnectedApp>, CodeModeError>;
    /// The tools `app` serves.
    async fn tools(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError>;
    /// Call one of `app`'s tools as the execution's account.
    async fn call(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
        call: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError>;
}

/// Admits a running execution's connected-app requests.
#[derive(Clone)]
pub struct ConnectedAppService {
    store: Arc<dyn ExecutionStore>,
    turns: Arc<dyn ExecutionTurns>,
    tools: Arc<dyn ConnectedAppTools>,
}

impl ConnectedAppService {
    /// Bind the execution records, shared turn state and the egress adapter.
    pub fn new(
        store: Arc<dyn ExecutionStore>,
        turns: Arc<dyn ExecutionTurns>,
        tools: Arc<dyn ConnectedAppTools>,
    ) -> Self {
        Self {
            store,
            turns,
            tools,
        }
    }

    /// Admit only a running execution of the session's current turn, so a
    /// finished program, a replayed one or another turn cannot spend it, and
    /// only a caller holding the account that execution was approved to act
    /// as: its credential names that account, and nobody else's may spend it.
    async fn admit(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
    ) -> Result<ConnectedAppUse, CodeModeError> {
        let session =
            super::reviews::session_id(access.entity().entity_type, &access.entity().entity_id)?;
        if access.acting_user_id() != Some(caller) {
            return Err(CodeModeError::Forbidden);
        }
        let record = self.store.get(session, execution).await?;
        let active = self.turns.active(session).await?;
        let (Some(acting_as), Some(turn)) = (record.acting_as, record.turn_id) else {
            return Err(CodeModeError::Forbidden);
        };
        if record.status != ExecutionStatus::Running || active != Some(turn) {
            return Err(CodeModeError::Forbidden);
        }

        let accounts = self.tools.accounts(session).await?;
        let user = acting_as
            .resolve(&accounts.owner, accounts.requester.as_ref())
            .map_err(|_| CodeModeError::Forbidden)?;
        if user != caller {
            return Err(CodeModeError::Forbidden);
        }
        Ok(ConnectedAppUse {
            session,
            user: caller.clone(),
        })
    }

    /// The apps the session's agent was given.
    pub async fn apps(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
    ) -> Result<Vec<ConnectedApp>, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.apps(&usage).await
    }

    /// The tools one of those apps serves.
    pub async fn tools(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        app: ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.tools(&usage, &app).await
    }

    /// Call one of an app's tools.
    pub async fn call(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
        app: ConnectedAppRef,
        call: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError> {
        let usage = self.admit(access, caller, execution).await?;
        self.tools.call(&usage, &app, call).await
    }
}
