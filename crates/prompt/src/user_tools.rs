//! Rules for user tools — tools the user finishes rather than the agent.
//!
//! Two flavours for the two hosts that register deferred user tools
//! (`SendEmail`, `CreateCalendarEvent`): chat, where the call stays pending
//! until the user finishes it in a composer after the turn ([`PROMPT`]), and
//! an agent session, where the call is reviewed in the turn and the tool
//! returns the outcome ([`SESSION_PROMPT`]). Hosts without either surface
//! (the channel-mention bot, MCP) get toolsets where those tools execute
//! directly or are absent, and neither section applies.
//!
//! Both hosts also carry `SendConfirmedEmail`, which sends with no review at
//! all. It exists for the one surface an agent session reads prompts from
//! that has nothing to review in - a channel or document thread - and the
//! toolset is the same everywhere, so each section says when it is the right
//! tool: in the session prompt, when the context block names a thread as the
//! prompt's origin; in chat, never.

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

- `SendConfirmedEmail` sends immediately, with no composer. It is for conversation threads that
  have no composer, and this chat does, so never use it here: `SendEmail` and its composer are how
  the user confirms an email in chat.
"##;

static INTENT: &str = "The model treats user tools as composer-confirmed: a PendingUserExecution \
result means the user still has to finish the call, and email drafting or sending always goes \
through the SendEmail tool rather than inline text in the chat - never through SendConfirmedEmail, \
which is for surfaces without a composer.";

/// The user-tools prompt section for composer-capable chat hosts.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

static SESSION_INSTRUCTIONS: &str = r##"- Before reaching for `SendEmail` or `CreateCalendarEvent`, look at where the newest prompt came
  from. The context block names a conversation parent when that prompt was posted in a
  channel or document thread instead of typed in the agent session view. It is decided per
  prompt, not per session: the same session can be driven from both places, so check the
  prompt you are answering now.

- From a thread, nobody is looking at the session. A review card would wait unseen and `AskUser`
  would ask a question nobody sees, so use neither. State what the tool would have done, in full,
  in your reply - the whole email with its recipients, subject and body; the whole calendar event
  with its title, time and guests; whatever it is, written out verbatim so the user can check it
  without opening anything - then ask whether to go ahead, and end your turn. When the user
  replies approving it, call `SendConfirmedEmail` with that same email and their approving message
  quoted verbatim in `userConfirmation`. Never call it without such a reply, and never paraphrase
  or invent one.

- The rule above is for you, not the user. Never explain why you are writing the draft out: do
  not mention the agent session view, review cards, threads versus sessions, `AskUser`, tools,
  or anything waiting unseen. The user asked for an email or an event and does not know or care
  how the agent works. Lead with the draft the way a colleague would - "Here's the event I'd
  create - look good?" or "Here's the email - want me to send it?" - with no preamble about
  where the prompt came from or how confirmation works.

- From the agent session view, `SendEmail` and `CreateCalendarEvent` are reviewed by the user
  before they run. Calling one opens a review card in the session, the turn waits while the user
  edits, confirms or declines, and the tool then returns what happened: the sent email or created
  event, or "Rejected". Nothing is pending afterwards and there is no chat composer; do not tell
  the user to confirm anything, and do not ask for confirmation in prose before calling the tool -
  the review card is the confirmation. `SendConfirmedEmail` is never right here.

- IMPORTANT: When the user asks you to draft, write, compose, or send an email (or reply to one)
  from the session view, you MUST use the `SendEmail` tool to produce it. NEVER write the email
  body as plain text in your reply. The review card is a real email composer the user can edit
  before it sends; inline text does none of that and is wrong. Drafting and sending are the same
  tool: the user decides in the card whether it goes out.
"##;

static SESSION_INTENT: &str = "The model checks where the newest prompt came from before using a \
user tool: from a channel or document thread it states the whole email or event verbatim in its \
reply, asks, and sends only on the user's approving reply through SendConfirmedEmail - without \
ever explaining the session, review card or thread mechanics to the user; from the \
session view it calls SendEmail or CreateCalendarEvent and lets the review card be the \
confirmation, never asking for confirmation in prose first.";

/// The user-tools prompt section for an agent session, whose in-process
/// agent finishes user tools in the turn through a review elicitation.
pub static SESSION_PROMPT: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, SESSION_INSTRUCTIONS, SESSION_INTENT);
