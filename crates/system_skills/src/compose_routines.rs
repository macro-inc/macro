//! System skill for composing a routine's triggers and steps.

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "Compose Routines";

static INSTRUCTIONS: &str = r##"Follow this skill when the user asks to create a routine or to change one - when it runs, what each run does, or whether it runs at all. A routine is triggers plus steps that run as the user after this session ends. `CreateRoutine` documents the configuration and how to write code steps; this skill is how to put one together well.

## Start from what exists

1. When the user means an existing routine (attached, mentioned, or "my invoice routine"), find it with `ListRoutines` and call `ReadRoutine`. Its `configuration` (name, `triggers`, `steps`, `requiredApps`) is the starting point. When it has `notEditableHere` instead (GitHub or payload filters), you can only pause or resume it; send the user to the routine's page for anything else.
2. Before creating one, check `ListRoutines` for a routine that already does this, and offer to change it instead of adding a duplicate.

## Choose the triggers

- **Schedule**: `cron` (six fields, seconds first, with the user's IANA time zone) for recurring work, `once` (a future RFC3339 time) for a single run. A scheduled run has no triggering item.
- **Activity**: `event` with the events that should start a run. Limit message, status, priority and deletion events to chosen channels, tasks or documents with `ids`; creation events, `channel.mentioned` and `email.message_received` usually watch everything. Add a yes/no `condition` when only some events matter ("Is this email from a customer?"); events answered no are skipped before any step runs.
- Any trigger starts a run. Only people's actions trigger routines, never routines or agents. GitHub triggers aren't available through these tools; point the user to the routine's page for them.

## Compose the steps

Steps run in order and a failed step stops the run.

A routine has two kinds of step: `code` and `agent` ("Ask AI").

- Use a `code` step for everything that acts or decides: label or archive an email, set a property, create a task, comment, post in a channel, move to a folder, judge items with `macro.ai.decide`, or read many items and loop. One code step usually does all of it. Write it like code-mode code, type the argument `StepContext`, check `trigger.kind` before reading the triggering item, take the run's time from `run.at` and `run.timezone` rather than the clock, list every area it changes in `writes`, and give it a title and one-sentence summary the user can read. Saving type-checks it; fix the errors the tool returns and save again.
- Use an `agent` step only for open-ended work: drafting, research, summarizing many items. A routine has at most one, and it sees the triggering event and what earlier steps returned, so put it last. Apps it needs beyond its own go in `requiredApps`, and the user must already have them connected.
- A later code step reads an earlier one's output as `steps.<id>`. Saving gives a step without an `id` one from its title ("Find invoices" becomes `find_invoices`); set one to choose the name.
- Resolve names in code through the SDK, or look ids up first (ListTags, GetEntityProperties, ListTeamMembers, channel search). Never invent an id.
- Limits: 40 steps in all.

## Confirm, then write

1. When something is ambiguous - which channel, label, folder or person, or whether it should run on a schedule or on activity - ask before writing.
2. Pass `steps` as a JSON array encoded in a string.
3. To change a routine, call `UpdateRoutine` with `"type": "configuration"` and its `configuration` from ReadRoutine with only the user's change: it replaces the name, triggers and steps, so carry over everything the user didn't ask to change. Omit `requiredApps` to keep its apps; a list replaces them. Pause or resume with `"type": "enabled"` instead. A running routine can be paused but not reconfigured until its run ends.
4. If the tool refuses, fix what its message names and try once more; otherwise relay the reason.

## Report

Say in one or two sentences what the routine now does - when it runs and what each run does - and mention it as `CreateRoutine` describes. Offer `RunRoutine` to try a scheduled routine; one that reads its triggering item only does something on real activity.

## Example

"When an invoice email arrives, label it Finance." `CreateRoutine` ends with this routine's configuration: an `email.message_received` trigger and one code step that asks `macro.ai.decide` whether the email is an invoice and adds the inbox's Finance label if so.
"##;

static INTENT: &str = "Requests to create or change a routine become one complete configuration - triggers \
     that fit the work, code steps that act and decide, and at most one Ask AI step, with every \
     id resolved - written through CreateRoutine or UpdateRoutine and reported in plain words.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The compose-routines system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "compose-routines",
    name: "Compose Routines",
    content: &PROMPT,
};
