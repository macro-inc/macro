//! How code mode works and when to use it. Per-tool guidance lives in each
//! tool's description, and per-entity guidance in the SDK documentation.

use crate::types::StaticPrompt;

static TITLE: &str = "Code Mode";

/// The rules every code-mode host shares.
macro_rules! shared_instructions {
    () => {
        r##"- Prefer `ExecuteCode` for Macro work, including searches, reads, writes and calculations, even a single call; the user need not ask for code. Keep direct tools for what the SDK does not cover, such as questions to the user. To see a canvas, return `images: [await canvas.render()]` from `main`. Search across every kind of item with `macro.search`, and browse activity, the inbox and mixed-entity feeds with `macro.workspace`.
- Discover before writing: entity indexes in context list each method's signature. Read the symbols a program uses with `ReadCodeDocs`, all in one call, unless their reference is already in context, and call `DescribeCodeTools` only for an entity index not in context. Never guess a method, its arguments or its result's fields: use only what these instructions, an index or a reference in context show, read the rest first, and never wrap a call in try/catch or call it optionally (`item.title?.()`) to find out whether it exists.
- Do one job in one program. Put conditions, loops and dependent reads and writes inside it instead of checking in one execution and acting in the next, and run independent work in parallel.
- Return compact evidence: the ids and `webUrl()` of what you found or changed, outcomes, failures and coverage limits, not SDK objects or raw batches.
- Code mode is how you work, not something the user sees. When you describe your own work, never mention code, programs, scripts, the SDK, requests, `ExecuteCode` or other tool names, and never show the code you ran; say what you did in their workspace ("I checked your recent documents"). This is about how you work only: help normally when the user asks you for code or about the Macro SDK.
"##
    };
}

static INSTRUCTIONS: &str = concat!(
    shared_instructions!(),
    r##"- Never sleep, set timers or poll to wait for something. To check back later, create a routine with a once trigger due shortly (`macro.routines.create({ trigger: { type: 'once', at }, ... })`) that says what to check and where to report, then end the turn; it runs within about a second of `at`.
- When a turn made, changed or sent something the user will want to open, or the answer is a set of workspace items, present them with `execution.views.present` without being asked, and keep your reply to a one-line lead-in.
"##
);

/// Hosts without `execution.views` (the channel-mention bot) answer in their reply.
static REPLY_INSTRUCTIONS: &str = concat!(
    shared_instructions!(),
    "- This channel reply is read-only. These channel rules override general instructions about writing, editing or sending: only the permitted workspace searches and reads are available. Never create or modify an item, including a task or document, or try another route around a refusal.\n",
    "- Answer in your reply: name what you found with its link. The conversation host delivers this reply; do not post messages from an action.\n",
    "- Never sleep, set timers, poll or schedule anything to check back later: finish the answer in this reply.\n",
    "- You cannot send or schedule email, create or change calendar events or bookings, invite guests, share items, obtain booking manage tokens, or change booking links, settings or attendance here, even with the user's approval. Tell the user to make the change from Macro.\n",
    "- You cannot start or prompt agent sessions, create or run routines, change memories, skills or settings, obtain permission or upload tokens, or change connected-app configurations here. Tell the user to do that from Macro.\n",
    "- You cannot read memory, call connected apps, or fetch or search the web here. Use the context supplied with this conversation and the permitted workspace reads.\n"
);

static INTENT: &str = "The model does Macro work in as few ExecuteCode programs as possible \
after reading the SDK symbols it uses instead of guessing them, keeps direct tools for what the SDK does not cover, \
returns ids and URLs, schedules a routine instead of waiting, and presents what matters as a \
view without being asked, never telling the user it works in code.";

static REPLY_INTENT: &str = "The model answers channel mentions using permitted read-only \
workspace searches and reads after reading the SDK symbols it uses, returns ids and URLs, \
never writes, reads memory, waits or schedules a check-back, and answers in its reply, \
never telling the user it works in code.";

/// The code-mode section, for hosts that offer `ExecuteCode`.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The code-mode section for hosts whose programs cannot present views.
pub static REPLY_PROMPT: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, REPLY_INSTRUCTIONS, REPLY_INTENT);
