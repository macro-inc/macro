//! How code mode works and when to use it. Per-tool guidance lives in each
//! tool's description, and per-entity guidance in the SDK documentation.

use crate::types::StaticPrompt;

static TITLE: &str = "Code Mode";

/// The rules every code-mode host shares.
macro_rules! shared_instructions {
    () => {
        r##"- Prefer `ExecuteCode` for Macro work, including searches, reads, writes and calculations, even a single call; the user need not ask for code. Keep direct tools for what the SDK does not cover: questions to the user and `RenderCanvas` to see a canvas. Search across every kind of item with `macro.search`, and browse activity, the inbox and mixed-entity feeds with `macro.workspace`.
- Discover before writing: entity indexes in context list each method's signature. Read the symbols a program uses with `ReadCodeDocs`, all in one call, unless their reference is already in context, and call `DescribeCodeTools` only for an entity index not in context. Do not guess methods or options.
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
    "- Answer in your reply: name what you found or changed with its link.\n",
    "- Never sleep, set timers, poll or schedule anything to check back later: finish the work in this reply.\n",
    "- You cannot send, forward or schedule email here, even with the user's approval: write the email out in your reply and tell the user to send it from Macro.\n"
);

static INTENT: &str = "The model does Macro work in as few ExecuteCode programs as possible \
after reading the SDK symbols it uses, keeps direct tools for what the SDK does not cover, \
returns ids and URLs, schedules a routine instead of waiting, and presents what matters as a \
view without being asked, never telling the user it works in code.";

static REPLY_INTENT: &str = "The model does Macro work in as few ExecuteCode programs as \
possible after reading the SDK symbols it uses, keeps direct tools for what the SDK does not \
cover, returns ids and URLs, never waits or schedules a check-back, and answers in its reply, \
never telling the user it works in code.";

/// The code-mode section, for hosts that offer `ExecuteCode`.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The code-mode section for hosts whose programs cannot present views.
pub static REPLY_PROMPT: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, REPLY_INSTRUCTIONS, REPLY_INTENT);
