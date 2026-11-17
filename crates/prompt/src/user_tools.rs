//! Rules for user tools — tools the user finishes rather than the agent.
//!
//! Chat registers deferred user tools (`SendEmail`, `CreateCalendarEvent`):
//! the call stays pending until the user finishes it in a composer after the
//! turn ([`PROMPT`]). An agent session never calls them. In code mode it
//! presents the same drafts with `PresentReview`, a saved review card that
//! never pauses the turn ([`CODE_MODE_SESSION_PROMPT`]). A session turn on
//! direct tools runs only when the code-mode tools, `PresentReview` among
//! them, are unreachable; it writes the draft out and sends through
//! `SendConfirmedEmail` / `CreateConfirmedCalendarEvent` on the user's
//! approving reply ([`SESSION_PROMPT`]). Hosts without a composer (the
//! channel-mention bot, MCP) get toolsets where those tools execute directly
//! or are absent, and no section applies.

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

static SESSION_INSTRUCTIONS: &str = r##"- You have no review card or composer for email and calendar events in this session,
  so the user confirms in the conversation. When asked to draft, write, compose, or send an email (or
  reply to one), or to create a calendar event, write out what you would do, in full, in your
  reply - the whole email with its recipients, subject and Markdown body; the whole calendar event
  with its title, time and guests - verbatim, so the user can check it without opening anything.
  Then ask whether to go ahead, and end your turn.

- When the user replies approving it, call `SendConfirmedEmail` for the email or
  `CreateConfirmedCalendarEvent` for the event, with that same draft and their approving message
  quoted verbatim in `userConfirmation`. Being asked to send an email or schedule an event is a
  request for the draft, never approval of it. Never call either without such a reply, and never
  paraphrase or invent one. If they ask for changes instead, write the revised draft out and ask
  again.

- To attach a file, put the Macro document's id in the email's `attachments`. Only uploaded
  files attach (PDFs, images, spreadsheets, Word documents); a document written in the Macro
  editor has no file, so link to it in the body instead.

- The rule above is for you, not the user. Never explain why you are writing the draft out: do
  not mention review cards, composers, or tools. Lead with the draft the way a colleague would -
  "Here's the event I'd create - look good?" or "Here's the email - want me to send it?".

- For questions, use `AskUser`.
"##;

static SESSION_INTENT: &str = "With no review card in the session, the model writes the whole \
email or event verbatim in its reply, asks, and sends or creates only on the user's approving reply \
through SendConfirmedEmail or CreateConfirmedCalendarEvent, quoting it - never pausing the turn \
and never explaining the mechanics to the user.";

/// The user-tools prompt section for an agent session running Macro's
/// direct tools, which happens only when the code-mode tools (and with them
/// `PresentReview`) are unreachable: drafts are confirmed in the
/// conversation.
pub static SESSION_PROMPT: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, SESSION_INSTRUCTIONS, SESSION_INTENT);

/// Saved reviews return immediately instead of holding an elicitation open.
pub static CODE_MODE_SESSION_PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    TITLE,
    include_str!("user_tools/code_mode.md"),
    "Present editable drafts without blocking the conversation; user actions arrive separately.",
);

#[cfg(test)]
mod test;
