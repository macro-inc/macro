//! Rules for user tools — tools the user finishes rather than the agent.
//!
//! Two flavours for the two hosts that register deferred user tools
//! (`SendEmail`, `CreateCalendarEvent`): chat, where the call stays pending
//! until the user finishes it in a composer after the turn ([`PROMPT`]), and
//! an agent session, where the call is reviewed in the turn and the tool
//! returns the outcome ([`SESSION_PROMPT`]). Hosts without either surface
//! (the channel-mention bot, MCP) get toolsets where those tools execute
//! directly or are absent, and neither section applies.

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
"##;

static INTENT: &str = "The model treats user tools as composer-confirmed: a PendingUserExecution \
result means the user still has to finish the call, and email drafting or sending always goes \
through the SendEmail tool rather than inline text in the chat.";

/// The user-tools prompt section for composer-capable chat hosts.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

static SESSION_INSTRUCTIONS: &str = r##"- `SendEmail` and `CreateCalendarEvent` are reviewed by the user before they run. Calling one opens a review card in the session, the turn waits while the user edits, confirms or declines, and the tool then returns what happened: the sent email or created event, or "Rejected". Nothing is pending afterwards and there is no chat composer; do not tell the user to confirm anything, and do not ask for confirmation in prose before calling the tool - the review card is the confirmation.

- IMPORTANT: When the user asks you to draft, write, compose, or send an email (or reply to one),
  you MUST use the `SendEmail` tool to produce it. NEVER write the email body as plain text in your
  reply. The review card is a real email composer the user can edit before it sends; inline text
  does none of that and is wrong. Drafting and sending are the same tool: the user decides in the
  card whether it goes out.
"##;

static SESSION_INTENT: &str = "The model treats user tools as reviewed in the turn: the call \
opens a review card, waits for the user, and returns the outcome - so it never describes a \
pending composer, never asks for confirmation in prose first, and drafts or sends email through \
SendEmail rather than inline text.";

/// The user-tools prompt section for an agent session, whose in-process
/// agent finishes user tools in the turn through a review elicitation.
pub static SESSION_PROMPT: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, SESSION_INSTRUCTIONS, SESSION_INTENT);
