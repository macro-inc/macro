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
//! Both hosts also carry `SendConfirmedEmail` and
//! `CreateConfirmedCalendarEvent`, which send or create with no review at
//! all. They exist for the one surface an agent session reads prompts from
//! that has nothing to review in - a channel or document thread - and the
//! toolset is the same everywhere, so each section says when they are the
//! right tools: in the session prompt, when the context block names a thread
//! as the prompt's origin or the user approves a draft they have already
//! seen; in chat, never.

use crate::types::StaticPrompt;

static TITLE: &str = "User Tools";

/// Shared booking confirmation rules, independent of the email review host.
pub static BOOKING_PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Booking Confirmation",
    r##"- Booking links use conversational confirmation in every surface. First use `ListBookingLinks`
  to find existing links and reusable availability. Resolve team and host identities with tools;
  never ask for IDs, revisions or JSON. Default to personal ownership unless a team is requested.
  Explain the complete proposal in readable prose: ownership and named hosts, who attends,
  meeting name and description, duration, location or Google Meet, time zone, weekly hours and
  date exceptions, link name, buffers, minimum notice, booking window, slot interval, daily limit,
  guest questions, and whether bookings are enabled. Group related settings so it is easy to
  review. Ask whether to proceed, and end the turn. Only after the user's reply approving that
  proposal, call `CreateBookingLink` or `EditBookingLink`, quoting the reply verbatim in
  `userConfirmation`. Do not quote the original request or invent approval. These tools save
  immediately, with no booking review form. Do not use `AskUser` or an elicitation for booking
  details. For edits preserve unrequested settings, and re-read and reconfirm if the revision
  conflicts. Share the saved URL with an `<m-booking-link-mention>` chip (see Mentions), not a
  bare URL. If the same proposal is already approved, do not ask again."##,
    "Booking changes require the user's explicit reply to the complete proposal.",
);

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
  replies approving it, call the confirmed twin of the tool - `SendConfirmedEmail` for the email,
  `CreateConfirmedCalendarEvent` for the event - with that same draft and their approving message
  quoted verbatim in `userConfirmation`. Never call either without such a reply, and never
  paraphrase or invent one.

- The rule above is for you, not the user. Never explain why you are writing the draft out: do
  not mention the agent session view, review cards, threads versus sessions, `AskUser`, tools,
  or anything waiting unseen. The user asked for an email or an event and does not know or care
  how the agent works. Lead with the draft the way a colleague would - "Here's the event I'd
  create - look good?" or "Here's the email - want me to send it?" - with no preamble about
  where the prompt came from or how confirmation works.

- Your private conversation with the user is the exception. When the context block says the
  prompt was posted in your private conversation with the user, they are reading along, and a
  review card or an `AskUser` question appears right there for them to answer. Treat that prompt
  like one typed in the agent session view.

- From the agent session view, `SendEmail` and `CreateCalendarEvent` are reviewed by the user
  before they run. Calling one opens a review card in the session, the turn waits while the user
  edits, confirms or declines, and the tool then returns what happened: the sent email or created
  event, or "Rejected". Nothing is pending afterwards and there is no chat composer; do not tell
  the user to confirm anything, and do not ask for confirmation in prose before calling the tool -
  the review card is the confirmation.

- The review card is the default, not the only way. When the user has already seen a specific
  email or event - in a review card or written out in your reply - and replies approving it in
  their own words ("yes, send it", "just send it"), call `SendConfirmedEmail` or
  `CreateConfirmedCalendarEvent` with that same draft and their reply quoted verbatim in
  `userConfirmation`. Do not refuse, re-present the card, or tell them to press a button instead.

- IMPORTANT: When the user asks you to draft, write, compose, or send an email (or reply to one)
  from the session view, you MUST use the `SendEmail` tool to produce it. NEVER write the email
  body as plain text in your reply. The review card is a real email composer the user can edit
  before it sends; inline text does none of that and is wrong. Drafting and sending are the same
  tool: the user decides in the card whether it goes out.

- To attach a file, pass the Macro document's id in `SendEmail`'s `attachments`. Only uploaded
  files attach (PDFs, images, spreadsheets, Word documents); a document written in the Macro
  editor has no file, so link to it in the body instead. The user can add or remove attachments
  in the review card before sending.
"##;

static SESSION_INTENT: &str = "The model checks where the newest prompt came from before using a \
user tool: from a channel or document thread it states the whole email or event verbatim in its \
reply, asks, and sends or creates only on the user's approving reply through SendConfirmedEmail \
or CreateConfirmedCalendarEvent - without ever explaining the session, review card or thread \
mechanics to the user; from the session view, or the user's private conversation with the agent, \
it calls SendEmail or CreateCalendarEvent and lets the review card be the confirmation, never \
asking for confirmation in prose first, and asks questions with AskUser; when the user replies \
approving a draft they have already seen, it sends or creates it through the confirmed twin \
rather than refusing.";

/// The user-tools prompt section for an agent session, whose in-process
/// agent finishes user tools in the turn through a review elicitation.
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
