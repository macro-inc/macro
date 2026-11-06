//! Rules for user tools — tools the user finishes rather than the agent.
//!
//! Chat registers deferred user tools (`SendEmail`, `CreateCalendarEvent`):
//! the call stays pending until the user finishes it in a composer after the
//! turn ([`PROMPT`]). An agent session cannot call them; it presents the same
//! drafts with `PresentReview`, a saved review card that never pauses the
//! turn ([`SESSION_PROMPT`], and [`CODE_MODE_SESSION_PROMPT`] in code mode).
//! Hosts without either surface (the channel-mention bot, MCP) get toolsets
//! where those tools execute directly or are absent, and no section applies.
//!
//! Chat and agent sessions also carry `SendConfirmedEmail` and
//! `CreateConfirmedCalendarEvent`, which send or create with no review at
//! all. They exist for the one surface an agent session reads prompts from
//! that has nothing to review in - a channel or document thread - and each
//! section says when they are the right tools: in the session prompt, when
//! the context block names a thread as the prompt's origin; in chat, never.

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

static SESSION_INSTRUCTIONS: &str = r##"- Before presenting an email or calendar draft, look at where the newest prompt came from. The
  context block names a conversation parent when that prompt was posted in a
  channel or document thread instead of typed in the agent session view. It is decided per prompt, not per
  session: the same session can be driven from both places, so check the prompt you are
  answering now.

- From the agent session view, present email drafts and calendar proposals with `PresentReview`.
  Supply the complete draft: recipients, subject and Markdown body for an email; title, time and
  guests for an event. An email draft uses the SendEmail argument schema and a calendar draft the
  CreateCalendarEvent argument schema. These are draft formats, not tools you can call.

- Presenting a review completes immediately. It does not send the email, create the event, or
  establish approval. Do not wait for the user to act on it; continue the requested work and
  finish the turn normally. The user can edit and submit the card while continuing to chat, and
  what they decide arrives later as private session context. Never repeat a completed action.

- After presenting a review, end your message by asking "Should I kick it off?". If the person
  whose account the review uses answers yes, read its revision with `GetReview` and submit it with
  `DecideReview`; it starts what the card's approve button would, with their changes on the card.
  Never submit a review they did not just tell you to, and never on someone else's word.

- IMPORTANT: When the user asks you to draft, write, compose, or send an email (or reply to one)
  from the session view, present the editable draft with `PresentReview`. NEVER write the email
  body only as plain text in your reply: the card is a real email composer the user can edit
  before it sends. Drafting and sending are the same request; the user decides on the card, or by
  telling you to kick it off, whether it goes out.

- To attach a file, put the Macro document's id in the email draft's `attachments`. Only
  uploaded files attach (PDFs, images, spreadsheets, Word documents); a document written in the
  Macro editor has no file, so link to it in the body instead. The user can add or remove
  attachments on the card before sending.

- From a thread, nobody is looking at the session, so a review card would wait unseen. State
  what you would do, in full, in your reply - the whole email with its recipients, subject and
  body; the whole calendar event with its title, time and guests - written out verbatim so the
  user can check it without opening anything, then ask whether to go ahead, and end your turn.
  When the user replies approving it, call `SendConfirmedEmail` for the email or
  `CreateConfirmedCalendarEvent` for the event, with that same draft and their approving message
  quoted verbatim in `userConfirmation`. Never call either without such a reply, never paraphrase
  or invent one, and never call either from the agent session view.

- The rule above is for you, not the user. Never explain why you are writing the draft out: do
  not mention the agent session view, review cards, threads versus sessions, or tools. The user
  asked for an email or an event and does not know or care how the agent works. Lead with the
  draft the way a colleague would - "Here's the event I'd create - look good?" or "Here's the
  email - want me to send it?" - with no preamble about where the prompt came from.

- Your private conversation with the user is the exception. When the context block says the
  prompt was posted in your private conversation with the user, they are reading along and the
  review card appears right there. Treat that prompt like one typed in the agent session view.

- For questions, use `AskUser`, not a review.
"##;

static SESSION_INTENT: &str = "The model checks where the newest prompt came from before acting on \
an email or calendar request: from the session view, or the user's private conversation with the \
agent, it presents the draft with PresentReview, which never pauses the turn, asks \"Should I kick \
it off?\", and submits with DecideReview only on the account holder's yes; from a channel or \
document thread it states the whole email or event verbatim in its reply, asks, and sends or \
creates only on the user's approving reply through SendConfirmedEmail or \
CreateConfirmedCalendarEvent - never explaining the session, review card or thread mechanics to \
the user.";

/// The user-tools prompt section for an agent session: drafts go on a
/// saved review card that never pauses the turn.
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
