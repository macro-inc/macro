//! Chat-only rules for user tools — tools the user finishes in a composer.
//!
//! Only compose this section into prompts for hosts whose toolset registers
//! deferred user tools (`SendEmail`, `CreateCalendarEvent`) and whose surface
//! can render the composer card that executes them. Hosts without that
//! surface (the channel-mention bot, MCP) get toolsets where those tools
//! execute directly or are absent, and this section would describe the
//! opposite of what their tools do.

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
