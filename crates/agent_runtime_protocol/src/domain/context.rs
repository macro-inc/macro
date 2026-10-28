//! The log frame an agent leaves when it summarizes its own context.

use agent_client_protocol::JsonRpcNotification;
use agent_client_protocol::schema::v1::{RequestId, SessionId};
use serde::{Deserialize, Serialize};

/// The log's record of a summary landing: from here on, the model reads
/// `text` in place of the turn `through` names and everything before it.
///
/// An extension notification, not a `session/update`: a summary is about the
/// agent's own context, not the conversation, and can land between turns,
/// where an update would read as the agent speaking. The fold shows it as a
/// compaction; the agent's replay reads it back.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
#[notification(method = "_macro/context_summary")]
#[serde(rename_all = "camelCase")]
pub struct ContextSummaryNotification {
    /// The ACP session whose context it summarizes.
    pub session_id: SessionId,
    /// The summary.
    pub text: String,
    /// The `session/prompt` request whose turn is the last it covers. A
    /// replay of the log knows each turn by the same id the live agent
    /// does, while their entries can differ: a prompt stopped before it ran
    /// is in the log but never entered the live history. `None` in logs
    /// written before summaries named it.
    #[serde(default)]
    pub through: Option<RequestId>,
    /// How many entries, from the start of the live history, it stands in
    /// for: all a log written before `through` says.
    pub replaces: usize,
}
