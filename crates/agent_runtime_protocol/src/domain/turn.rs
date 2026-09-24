//! Optional agent-neutral lifecycle facts for reconstructed conversation turns.
use agent_client_protocol::JsonRpcNotification;
use agent_client_protocol::schema::v1::SessionId;
use serde::{Deserialize, Serialize};

/// A turn failure the person who prompted can act on, in their terms.
///
/// A runtime attaches this to the `session/prompt` error as its `data`; the
/// fold reads it back onto the failed turn's stop reason. It exists so a
/// billing wall or a disconnected integration renders as an instruction with
/// somewhere to go, not as the runtime's error text - and so the runtime's
/// error text, which for a report includes source locations, never has to
/// double as the thing a person reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FailureNotice {
    /// Which class of failure, for readers that treat one specially.
    pub kind: FailureNoticeKind,
    /// One short line naming what happened.
    pub title: String,
    /// What it means and what to do, in plain language.
    pub body: String,
    /// Where acting on it happens, when that is somewhere else.
    #[serde(default)]
    pub link: Option<FailureLink>,
}

impl FailureNotice {
    /// The notice a prompt error's `data` carries, if it carries one.
    ///
    /// Anything else in `data` - another runtime's debugging payload, a bare
    /// string - is not a notice and reads as `None`, so an unclassified
    /// failure is never dressed up as an actionable one.
    #[must_use]
    pub fn from_error_data(data: Option<&serde_json::Value>) -> Option<Self> {
        data.and_then(|data| serde_json::from_value(data.clone()).ok())
    }
}

/// The classes of actionable failure a runtime can report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum FailureNoticeKind {
    /// The person's own account with the provider has no budget left for
    /// this work; the fix is on the provider's billing page.
    ProviderUsageLimit,
}

/// An external page where the person can act on a [`FailureNotice`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FailureLink {
    /// The link's text, e.g. `Manage Cursor usage`.
    pub label: String,
    /// The page, absolute.
    pub url: String,
}

/// Completes the currently projected turn without inventing a prompt response.
/// This optional extension conveys history facts; it does not certify a load,
/// change load success semantics, or imply completion when absent.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
#[notification(method = "_session/turn_complete")]
#[serde(rename_all = "camelCase")]
pub struct TurnCompleteNotification {
    /// ACP session whose current projected turn ended.
    pub session_id: SessionId,
    /// The recorded terminal outcome.
    pub outcome: TurnOutcome,
}

/// Recorded terminal outcome of a reconstructed turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnOutcome {
    /// The agent completed its work.
    Finished,
    /// The turn was cancelled.
    Cancelled,
    /// The turn failed.
    Failed {
        /// Failure description supplied by the adapter.
        message: String,
    },
}
