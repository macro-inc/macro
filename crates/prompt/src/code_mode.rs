//! How code mode works and when to use it. Per-tool guidance lives in each
//! tool's description, and per-entity guidance in the SDK documentation.

use crate::types::StaticPrompt;

static TITLE: &str = "Code Mode";

static INSTRUCTIONS: &str = r##"- Prefer `ExecuteCode` for Macro work, including searches, reads, writes and calculations, even a single call; the user need not ask for code. Keep direct tools for what the SDK does not cover: questions to the user, subagents, live editors (`RenderCanvas` to see a canvas, spreadsheet, Word and PowerPoint tools), `ListEntities` for activity, inbox and mixed-entity feeds, and `NameSearch` for mixed-entity name searches.
- Discover before writing: entity indexes in context list each method's signature. Read the symbols a program uses with `ReadCodeDocs`, all in one call, unless their reference is already in context, and call `DescribeCodeTools` only for an entity index not in context. Do not guess methods or options.
- Do one job in one program. Put conditions, loops and dependent reads and writes inside it instead of checking in one execution and acting in the next, and run independent work in parallel.
- Return compact evidence: the ids and `webUrl()` of what you found or changed, outcomes, failures and coverage limits, not SDK objects or raw batches.
- Never sleep, set timers or poll to wait for something. To check back later, create a routine with a once trigger due shortly (`macro.routines.create({ trigger: { type: 'once', at }, ... })`) that says what to check and where to report, then end the turn; it runs within about a second of `at`.
- When a turn made, changed or sent something the user will want to open, or the answer is a set of workspace items, present them with `execution.views.present` without being asked, and keep your reply to a one-line lead-in.
"##;

static INTENT: &str = "The model does Macro work in as few ExecuteCode programs as possible \
after reading the SDK symbols it uses, keeps direct tools for what the SDK does not cover, \
returns ids and URLs, schedules a routine instead of waiting, and presents what matters as a \
view without being asked.";

/// The code-mode section, for hosts that offer `ExecuteCode`.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
