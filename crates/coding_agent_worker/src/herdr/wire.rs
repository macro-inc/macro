//! The local protocol between macrod and a `macrod herdr-pane` window:
//! newline-delimited JSON over a Unix socket only this user can open.

use serde::{Deserialize, Serialize};

/// Where an ACP session's turn stands, as herdr understands agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentState {
    /// Waiting for a prompt.
    Idle,
    /// Running a turn.
    Working,
    /// Waiting on a permission answer.
    Blocked,
}

impl AgentState {
    /// The `--state` value `herdr pane report-agent` takes.
    pub(crate) fn as_herdr(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Working => "working",
            Self::Blocked => "blocked",
        }
    }
}

/// One answer an agent offered to a permission request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionChoice {
    /// The id the answer must name.
    pub option_id: String,
    /// What to show.
    pub name: String,
    /// `allow_once`, `allow_always`, `reject_once` or `reject_always`.
    pub kind: String,
}

/// macrod to a pane window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ToPane {
    /// Sent first, once per attach.
    Hello {
        /// The ACP session this window shows.
        session: String,
        /// Where the session opens in the Macro web app, once known.
        web_url: Option<String>,
    },
    /// A prompt delivered to the agent, whoever sent it.
    Prompted {
        /// The prompt's text blocks, joined.
        text: String,
    },
    /// One ACP `session/update` payload, verbatim.
    Update {
        /// The `update` object of the notification.
        update: serde_json::Value,
    },
    /// The session's turn state changed.
    State {
        /// The new state.
        state: AgentState,
        /// Why, when there is something to say (a stop reason, a permission).
        detail: Option<String>,
    },
    /// The agent is waiting on a permission answer, which only a user in
    /// Macro may give: the service refuses approvals a runtime forwards.
    Permission {
        /// The agent's request id.
        request_id: serde_json::Value,
        /// The tool call it is about.
        title: Option<String>,
        /// What the agent offered.
        options: Vec<PermissionChoice>,
    },
    /// A permission request was answered, from here or from Macro.
    PermissionSettled,
    /// Something the window should tell its reader.
    Notice {
        /// The text.
        text: String,
        /// Whether it reports a failure.
        error: bool,
    },
}

/// A pane window to macrod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum FromPane {
    /// Subscribe to one ACP session. Must be the first message.
    Attach {
        /// The ACP session id.
        session: String,
    },
    /// Prompt the session through Macro.
    Prompt {
        /// The text to send.
        text: String,
    },
    /// Interrupt the running turn.
    Stop,
}
