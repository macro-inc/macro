//! System skill for composing a routine's triggers and steps.

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "Compose Routines";

static INSTRUCTIONS: &str = r##"Follow this skill when the user asks to create a routine or to change one - when it runs, what each run does, or whether it runs at all. A routine is triggers plus steps that run as the user after this session ends. `CreateRoutine` documents the configuration, the tools a step may call and their arguments; this skill is how to put one together well.

## Start from what exists

1. When the user means an existing routine (attached, mentioned, or "my invoice routine"), find it with `ListRoutines` and call `ReadRoutine`. Its saved `triggers`, `steps` and `requiredApps` are the starting point.
2. Before creating one, check `ListRoutines` for a routine that already does this, and offer to change it instead of adding a duplicate.

## Choose the triggers

- **Schedule**: `cron` (six fields, seconds first, with the user's IANA time zone) for recurring work, `once` (a future RFC3339 time) for a single run. A scheduled run has no triggering item.
- **Activity**: `event` with the events that should start a run. Limit message, status, priority and deletion events to chosen channels, tasks or documents with `ids`; creation events, `channel.mentioned` and `email.message_received` usually watch everything. Add a yes/no `condition` when only some events matter ("Is this email from a customer?"); events answered no are skipped before any step runs.
- Any trigger starts a run. Only people's actions trigger routines, never routines or agents. GitHub triggers aren't available through these tools; point the user to the routine's page for them.

## Compose the steps

Steps run in order and a failed step stops the run.

- Prefer `tool` steps: they are exact, cheap and predictable. Use one per action the user described - label or archive an email, set a property, create a task or document, comment, post or reply in a channel, move to a folder.
- Route with decisions rather than an agent: `if` for a yes/no question, `choose` for 2 to 8 labelled options, with `"multiple": true` when several can apply (labels, tags). One classifier call answers every decision before any step runs, so a decision judges the triggering item, not what earlier steps did.
- Use an `agent` step only for open-ended work: drafting, research, summarizing many items. A run reaches at most one agent (agents in different branches are fine). It sees the triggering event and what earlier steps did, so put it last. Apps it needs beyond its own go in `requiredApps`, and the user must already have them connected.
- Decisions and `{{trigger.…}}` placeholders read the triggering item, so they need activity triggers only: a routine that also has a schedule is rejected. A schedule-only routine uses fixed arguments or an agent step.
- To act on what an earlier step made, give that step an `id` and pass its output, e.g. `{{steps.task.documentId}}` for the task a `CreateDocument` step created.
- Resolve every id before writing (ListTags, GetEntityProperties, ListTeamMembers, channel search). Never invent an id or pass a name where an id is required; label steps take the label's name.
- Limits: 40 steps in all, decisions nested at most 4 deep, 32 questions across decisions (each option of a choice is one), option labels up to 80 characters, choice questions and option descriptions up to 200.

## Confirm, then write

1. When something is ambiguous - which channel, label, folder or person, or whether it should run on a schedule or on activity - ask before writing.
2. Pass `steps` as a JSON array encoded in a string.
3. To change a routine, call `UpdateRoutine` with `"type": "configuration"` and the complete configuration: it replaces the name, triggers, steps and `requiredApps`, so carry over everything the user didn't ask to change. Pause or resume with `"type": "enabled"` instead. A running routine can be paused but not reconfigured until its run ends.
4. If the tool refuses, fix what its message names and try once more; otherwise relay the reason.

## Report

Say in one or two sentences what the routine now does - when it runs and what each run does - and mention it as `CreateRoutine` describes. Offer `RunRoutine` to try a scheduled routine; one that reads its triggering item only does something on real activity.

## Example

"When an invoice email arrives, label it Finance and make a task to pay it if it's due within a week; archive newsletters." Triggers: `[{"type":"event","events":["email.message_received"]}]`. The `steps` string holds:

[{"type":"choose","question":"What kind of email is this?","options":[{"label":"Invoice","description":"bills, receipts, payment requests","steps":[{"type":"tool","tool":"UpdateThreadLabels","arguments":{"thread_id":"{{trigger.entity_id}}","label":"Finance","add":true}},{"type":"if","condition":"Is the payment due within 7 days?","then":[{"type":"tool","id":"task","tool":"CreateDocument","arguments":{"documentName":"Pay: {{trigger.email.subject}}","fileContent":"","fileExtension":"md","isTask":true}}]}]},{"label":"Newsletter","description":"digests, announcements, marketing","steps":[{"type":"tool","tool":"UpdateThreadLabels","arguments":{"thread_id":"{{trigger.entity_id}}","label":"INBOX","add":false}}]}]}]
"##;

static INTENT: &str = "Requests to create or change a routine become one complete configuration - triggers \
     that fit the work, plain tool steps first, decisions for routing and at most one agent, with \
     every id resolved - written through CreateRoutine or UpdateRoutine and reported in plain \
     words.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The compose-routines system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "compose-routines",
    name: "Compose Routines",
    content: &PROMPT,
};
