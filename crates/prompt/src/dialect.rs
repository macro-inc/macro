//! The session prompt for agents that run code mode's dialect, where
//! programs reach Macro only through `tools.<service>.<operation>(...)`.
//!
//! It is today's code-mode session prompt with the dialect's code-mode
//! section in place of [`code_mode::PROMPT`], and every hint that names a
//! TypeScript SDK call (`macro.web.fetch()`, `execution.views.present`)
//! swapped for the dialect operation. The swaps keep one source for the
//! shared rules; a test fails when a swapped phrase is no longer there.

use std::sync::LazyLock;

use crate::{SESSION_BASE_PROMPT, agent_session, code_mode, skills, user_tools};

/// Phrases of the session base prompt (Macro terms, mentions) that name a
/// TypeScript SDK call, and their dialect wording.
pub(crate) const BASE_SWAPS: [(&str, &str); 7] = [
    (
        "or SDK document-write content",
        "or document content a program writes",
    ),
    (
        "(`macro.web.fetch()` in code mode)",
        "(`tools.cognition.fetch_web_page` in code mode)",
    ),
    (
        "(`macro.agentSessions.byId()` in code mode)",
        "(`tools.agent_harness.get_agent_session` in code mode)",
    ),
    (
        "(`macro.workspace` in code mode)",
        "(`tools.storage.post_items_soup_ast` in code mode)",
    ),
    (
        "`execution.views.present`",
        "`tools.agent_harness.present_session_view`",
    ),
    (
        "read that PR's diff with the SDK's `macro.githubPullRequests.byId(id)`",
        "read that PR's changes with `tools.storage.get_github_pull_request_changes`",
    ),
    (
        "with the `markdown` an SDK image carries (`image.toMarkdown()`), or with ",
        "with ",
    ),
];

/// Phrases of the code-mode review rules that name TypeScript SDK calls.
pub(crate) const USER_TOOLS_SWAPS: [(&str, &str); 2] = [
    (
        "`execution.reviews.create`",
        "`tools.agent_harness.create_session_review`",
    ),
    (
        "`macro.email.sendConfirmed` sends the email,
`EmailMessage.forwardConfirmed` forwards a message, `EmailDraft.send` or
`EmailDraft.schedule` sends a saved draft, and `macro.calendar.createConfirmed`
creates the event. A program cannot send email or create an event any other way:
`macro.email.send`, thread replies and `macro.calendar.createEvent` are refused.
Do not explain these internal surface distinctions to the user. The confirmed
methods are not appropriate for drafts presented in the session view.",
        "`tools.cognition.send_confirmed_email` sends an email,
a reply or a forward written as an email draft (its body is the SendEmail
arguments plus `userConfirmation`),
`tools.cognition.create_confirmed_calendar_event` creates the event (the
CreateCalendarEvent arguments plus `userConfirmation`), and
`tools.email.upsert_scheduled_message` sends or schedules a saved draft (with
`user_confirmation` in its body). A program cannot send email or create an event
any other way: the plain send and create operations are refused. Do not explain
these internal surface distinctions to the user. The confirmed operations are not
appropriate for drafts presented in the session view.",
    ),
];

/// Phrases of the agent-session preamble that name a TypeScript SDK call.
pub(crate) const AGENT_SESSION_SWAPS: [(&str, &str); 1] = [(
    "`macro.connectedApps.discover` in code mode",
    "`tools.agent_harness.discover_connected_apps` in code mode",
)];

/// `text` with every phrase of `swaps` replaced by its dialect wording.
pub(crate) fn swap(text: String, swaps: &[(&str, &str)]) -> String {
    swaps
        .iter()
        .fold(text, |text, (from, to)| text.replace(from, to))
}

/// [`crate::CODE_MODE_SESSION_TOOL_USE_PROMPT`] for the dialect.
pub fn session_tool_use_prompt() -> &'static str {
    static PROMPT: LazyLock<String> = LazyLock::new(|| {
        format!(
            "{}{}{}{}",
            swap(SESSION_BASE_PROMPT.to_string(), &BASE_SWAPS),
            code_mode::DIALECT_PROMPT,
            swap(
                user_tools::CODE_MODE_SESSION_PROMPT.to_string(),
                &USER_TOOLS_SWAPS
            ),
            skills::PROMPT,
        )
    });
    &PROMPT
}

/// [`agent_session::PROMPT`] for the dialect.
pub fn agent_session_prompt() -> &'static str {
    static PROMPT: LazyLock<String> =
        LazyLock::new(|| swap(agent_session::PROMPT.to_string(), &AGENT_SESSION_SWAPS));
    &PROMPT
}

#[cfg(test)]
mod test;
