//! Rules for user tools — tools the user finishes rather than the agent.
//!
//! Chat is the one host that registers deferred user tools (`SendEmail`,
//! `CreateCalendarEvent`): the call stays pending until the user finishes it
//! in a composer after the turn ([`PROMPT`]). Hosts without a composer (the
//! channel-mention bot, MCP) get toolsets where those tools execute directly
//! or are absent, and the section does not apply. Agent sessions run code
//! mode, where a program presents a saved review that returns immediately
//! ([`CODE_MODE_SESSION_PROMPT`]).
//!
//! Chat also carries `SendConfirmedEmail` and `CreateConfirmedCalendarEvent`,
//! which send or create with no review at all, so its section says never to
//! use them there.

use crate::types::StaticPrompt;

static TITLE: &str = "User Tools";

static INSTRUCTIONS: &str = r##"- User tools are tools that must be executed by a user on the frontend.
  A user tool will return "PendingUserExecution" until a user chooses to
  accept / reject the tool.

- IMPORTANT: When the user asks you to draft, write, compose, or send an email (or reply to one),
  you MUST use the `SendEmail` tool to produce it. NEVER write the email body as plain text in the
  chat. The `SendEmail` tool opens a real draft in the email composer that the user can review,
  edit, and send — writing the email inline in chat does none of that and is wrong. Drafting and
  sending are the same tool: it always creates a draft for the user to confirm before anything is
  sent, so use it even when the user only wants a draft.

- To attach a file, pass the Macro document's id in `SendEmail`'s `attachments`. Only uploaded
  files attach (PDFs, images, spreadsheets, Word documents); a document written in the Macro
  editor has no file, so link to it in the body instead. The user can add or remove attachments
  in the composer before sending.

- `SendConfirmedEmail` and `CreateConfirmedCalendarEvent` send or create immediately, with no
  composer. They are for conversation threads that have no composer, and this chat does, so
  never use them here: `SendEmail` and `CreateCalendarEvent` and their composers are how the
  user confirms an email or an event in chat.
"##;

static INTENT: &str = "The model treats user tools as composer-confirmed: a PendingUserExecution \
result means the user still has to finish the call, and email drafting or sending always goes \
through the SendEmail tool rather than inline text in the chat - never through SendConfirmedEmail \
or CreateConfirmedCalendarEvent, which are for surfaces without a composer.";

/// The user-tools prompt section for composer-capable chat hosts.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// Saved reviews return immediately instead of holding an elicitation open.
pub static CODE_MODE_SESSION_PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    TITLE,
    include_str!("user_tools/code_mode.md"),
    "Present editable drafts without blocking the conversation; user actions arrive separately.",
);

#[cfg(test)]
mod test;
