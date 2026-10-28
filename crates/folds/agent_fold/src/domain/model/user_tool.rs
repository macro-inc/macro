//! Macro user tools: drafted by the agent, finished by the user.

use serde::Serialize;
use specta::Type;

/// How far a user tool has got - the fold's reading of the backend's
/// `UserToolResponse`, restated each time the call is patched.
///
/// A user tool's call completes, from ACP's point of view, the moment the
/// agent invokes it: the backend answers `"PendingUserExecution"` and does
/// nothing. What happens next - the user editing, sending, or rejecting the
/// draft - reaches the log as later patches to the same call, so
/// [`Self::Pending`] is where every user tool starts and where one the user
/// never touched stays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UserToolOutcome {
    /// Awaiting the user. The draft is whatever the input currently holds.
    Pending,
    /// The user edited the draft without finishing it; the input holds
    /// their edits.
    Edited,
    /// `SendEmail`: the email went out.
    Sent {
        /// The sent message's id.
        #[serde(rename = "messageId")]
        message_id: String,
        /// The thread the message landed in.
        #[serde(rename = "threadId")]
        thread_id: String,
    },
    /// `SendEmail`: the user saved the draft instead of sending it.
    Draft {
        /// The saved draft's id.
        #[serde(rename = "draftId")]
        draft_id: String,
        /// The thread the draft belongs to, when it is a reply.
        #[serde(rename = "threadId")]
        thread_id: Option<String>,
    },
    /// The user executed the tool; this is what the tool returned. The shape
    /// is the tool's own - a calendar event for `CreateCalendarEvent`.
    Completed {
        /// The tool's result, verbatim.
        #[specta(type = specta_typescript::Unknown)]
        result: serde_json::Value,
    },
    /// The user declined.
    Rejected,
    /// The call itself failed before the user could act.
    Failed {
        /// The error, as reported.
        message: String,
    },
    /// A result arrived that this fold could not read as a user tool
    /// response - a shape the backend added after this was written.
    Unrecognized,
}
