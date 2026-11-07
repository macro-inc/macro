//! System skill for reconstructing a timeline of the user's activity yesterday.

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "What I Did Yesterday";

static INSTRUCTIONS: &str = r##"Follow this skill when the user asks what they did yesterday (or on another specific day) — for a standup, a work log, or their own recall. Build a single chronological timeline from every source available, then present it.

Compute the day's bounds in the user's timezone first: yesterday runs from 00:00 to 24:00 local time, as ISO timestamps. Use those exact bounds in every query below.

## Gather activity from every source

Run these in parallel:

1. **Macro workspace** — `ListEntities` sorted by `recently_updated` with a `df` updatedAt window for the day: documents edited, projects touched, calls joined. Query tasks separately with `df` subtype task plus the same window, filtering Status = Completed and Assignees = the user, to find tasks they finished.
2. **Conversations** — from the entities that surfaced, note channels and email threads the user was active in; use `ReadChannelMessages` / `ReadThread` only where needed to attribute what the user actually said or sent, not just what changed around them.
3. **GitHub and other integrations** — `SearchTools` with queries like "github commits", "github pull requests", "github reviews", then call the loaded tools scoped to the user and the day: commits pushed, PRs opened or merged, reviews given. Repeat for other connected trackers that record the user's work (e.g. Linear issues closed). If no integration matches, say so rather than silently omitting that source.

Only include things the user did — skip other people's edits, messages, and commits.

## Present the timeline

Order everything chronologically and group by part of day (morning / afternoon / evening). One line per event:

- `9:14 — Merged PR #512 "fix flaky retry test" (macro-inc/macro)`
- `11:30 — Call with design team (32 min)`
- `2:05 — Completed task "Migrate mentions table"`

Link each event to its Macro item or external URL. After the timeline, add a two-or-three-sentence summary of the day's main threads of work — what the day was mostly about, not a restatement of every line. If a source returned nothing, note it in one line ("No GitHub activity yesterday").
"##;

static INTENT: &str = "Day-recap requests produce a chronological, linked timeline of the user's own actions \
     across Macro, GitHub, and connected integrations, grouped by part of day and followed by a short \
     summary of the day's main work.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The what-i-did-yesterday system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "what-i-did-yesterday",
    name: "What I Did Yesterday",
    content: &PROMPT,
};
