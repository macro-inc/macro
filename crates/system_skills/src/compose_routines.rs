//! System skill for writing a routine, or changing one, from a conversation.
//!
//! It ends with `routine_program::WRITING`, the text every writer of routines
//! follows; this module adds only how a session finds the items, checks and
//! saves the routine, and answers. The skill ([`PROMPT`]) says that for code,
//! then briefly for the routine tools; [`CODE`] is the code part alone, which
//! code mode carries after the routines guide, and [`DIRECT`] the
//! routine-tools part alone, for hosts without code, which ends with
//! `routine_program::ROUTINE_RULES` instead: `CreateRoutine`'s description
//! carries the code-step half.

use prompt::{ComposedPrompt, StaticPrompt};

use crate::SystemSkill;

static TITLE: &str = "Compose Routines";

static INSTRUCTIONS: &str = r##"Follow this skill when someone asks for a routine, or to change one.

Be quick. Usually one program finds what the request names, checks the routine and saves it, and then a one- or two-sentence reply ends the turn. Write that program from this skill and the example below; read the SDK reference only for a method a step calls that isn't shown here.

## Find what it names

- Look up every item the request names with one `macro.search.names([...])` call (it takes up to ten names; split more across calls), each name as written, as `{ name, kinds }` when the request says its kind: `channel` (a #name), `person`, `initiative` (what the app calls a project), `project` (a folder), `document`, `task`, `database`, `agent`, `label` (an email label) or `tag`. The item is the match marked `exact`. A kind in `unavailable` wasn't checked: look for the item there another way before saying it doesn't exist.
- When a name has no exact match, or several, ask which one before saving anything: with `AskUser` where you have it, otherwise in your reply. Ask about nothing else: a vague request gets the routine it most likely means, which your reply describes so they can change it.
- When they mean a routine they have (attached, or "my invoice routine"), change it rather than adding another. Find it by name in `await macro.routines.list({ includeEvents: true })`, or with `macro.routines.byId(id)` when it is attached. Return `routine.toJSON().detail` (after `await routine.name()` for one from `byId`) to read its `trigger` and `task` as stored.

## Write it

Write it as `macro.routines.create` takes it:

- `trigger`: `{ type: 'cron', schedule, timezone }` in the person's time zone, `{ type: 'once', at }`, `{ type: 'events', filters: [{ events, entities, condition }] }`, or `{ type: 'multiple', triggers }`. A filter names the items it watches in `entities`, as references to the handles the lookup returned: `{ type: 'channel', entity: channel }`, or `'document'` for a task or document. Never an id, and never an `ids` key.
- `steps`: code steps `{ type: 'code', title, summary, knobs, sentence, source }`, then an Ask AI step `{ type: 'agent', instructions, model: 'anthropic/claude-sonnet-5-5' }` only when the work needs one.
- A knob for an item the request names holds the name it matched, and the step looks it up when it runs, as in the example.
- Create beforehand only what the routine needs to exist before it runs, when the request asks for something new that the routine then uses (a database it adds rows to, a folder it files into): create it with the name given, put its id in the knob, and pass its handle in `created`. Create nothing else.
- To change a routine, `routine.update(options)` replaces all of it, so pass everything as stored with only the change asked for: each code step with its `id`, an Ask AI step's `model` and, when it has one, its agent (`macro.agents.byId(step.agent.bot_id)`), `dangerouslyOperateAsUser` from `task.dangerously_operate_as_user`, and each filter with every field kept (such as a `property` or `github` selector) but its `ids` given again as `entities` (`macro.channels.byId(id)`, `macro.tasks.byId(id)`): a filter passed back with its stored `ids` loses them and watches everything. A routine stored as one agent task (`task.prompt`) is passed back the same way, as `prompt`, `userPrompt`, `model` and `agent`, or, when the change adds a step, as `steps` ending in an Ask AI step whose instructions join its `prompt` and `user_prompt`. A routine with apps (`task.mcp_servers`) can't be changed here: say so, with its link.

## Check, then save, in the same program

`macro.routines.check(routine, { created })` runs saving's checks without saving. Save only when `ok` is true; otherwise return `problems` and `steps`, fix what they name, and run the program again. A new routine is switched on. Don't run or test it.

## Reply

In one or two sentences, say when it runs and what each run does, with its link (`routine.webUrl()`). Add only what they must act on.

## Example

"Whenever someone reports a bug in #customer-feedback, post it in #bug-triage."

```js
export async function main({ macro }) {
  const { results } = await macro.search.names([
    { name: '#customer-feedback', kinds: ['channel'] },
    { name: '#bug-triage', kinds: ['channel'] },
  ]);
  const exact = results.map((result) => result.matches.filter((match) => match.exact));
  if (exact.some((matches) => matches.length !== 1)) {
    const options = results.map(({ name, matches }) => ({ name, matches: matches.map(({ type, name, exact }) => ({ type, name, exact })) }));
    return { data: { ask: options } };
  }
  const [feedback, triage] = exact.map(([match]) => match);
  const routine = {
    name: 'Bugs from #customer-feedback in #bug-triage',
    trigger: {
      type: 'events',
      filters: [
        {
          events: ['channel.message_posted'],
          entities: [{ type: 'channel', entity: feedback.entity }],
          condition: 'Does the message report a bug?',
        },
      ],
    },
    steps: [
      {
        type: 'code',
        title: 'Post the bug',
        summary: 'Posts a message that reports a bug in the triage channel.',
        knobs: [{ type: 'text', name: 'channel', label: 'Channel to post bugs in', value: triage.name }],
        sentence: 'Post the message in {channel}.',
        source: `export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const [lookup] = (await macro.search.names([{ name: knobs.channel, kinds: ['channel'] }])).results;
  const channel = lookup?.matches.find((match) => match.exact && match.type === 'channel');
  if (channel?.type !== 'channel') throw new Error('There is no channel named ' + knobs.channel + '. Change the channel to post bugs in.');
  await channel.entity.send(trigger.item.message?.text ?? 'A bug was reported.');
  return { posted: true };
}`,
      },
    ],
  };
  const check = await macro.routines.check(routine);
  if (!check.ok) return { data: { problems: check.problems, steps: check.steps } };
  const saved = await macro.routines.create(routine);
  return { data: { url: saved.webUrl() } };
}
```
"##;

static INTENT: &str = "A request for a routine, or a change to one, becomes a checked routine in as few \
     programs as possible: the items it names found in one name lookup or asked about, triggers \
     that fit the work, code steps that act and decide and at most one Ask AI step, saved switched \
     on and reported in a sentence or two with its link.";

static SESSION: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

static DIRECT_INSTRUCTIONS: &str = r##"With the routine tools instead of code: find every item the request names with the tool for its kind, comparing names exactly: `NameSearch` for a channel, document or folder, and `ListLabels`, `ListTags`, `ListTeamMembers`, `ListDatabases`, `ListInitiatives` or `ListAgents` for the others. Ask in your reply about a name with no exact match, or several. Find a routine they mean to change with `ListRoutines` and `ReadRoutine`, and change it rather than adding another. Save with `CreateRoutine`, or `UpdateRoutine` (`"type": "configuration"`, the whole configuration with only the change asked for): their descriptions give the configuration's shape, in which a filter lists its items' ids in `ids`. Saving checks it: fix what a refusal names and save again. Then say in one or two sentences when it runs and what each run does, with its link."##;

static WITHOUT_CODE: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Without code",
    DIRECT_INSTRUCTIONS,
    "A session that can't run programs saves the routine with the routine tools.",
);

static WRITING: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Writing the routine",
    routine_program::WRITING,
    "Triggers, steps, items and code steps, the same for every writer of routines.",
);

static SESSION_WITHOUT_CODE: ComposedPrompt = SESSION.compose(&WITHOUT_CODE);

/// The skill as code mode carries it after the routines guide: how a
/// code-mode session finds, checks, saves and reports a routine, then how to
/// write one, without the routine-tools part it has no tools for.
pub static CODE: ComposedPrompt = SESSION.compose(&WRITING);

/// The skill's instructions as a composable prompt section: how a code-mode
/// session finds, checks, saves and reports a routine, what a session without
/// code does instead, then how to write one.
pub static PROMPT: ComposedPrompt = SESSION_WITHOUT_CODE.compose(&WRITING);

/// The compose-routines system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "compose-routines",
    name: "Compose Routines",
    content: &PROMPT,
};

static DIRECT_INTENT: &str = "A request for a routine, or a change to one, is saved with the routine \
     tools in one call when nothing is unsettled, and reported in a sentence or two.";

static DIRECT_SESSION: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, DIRECT_INSTRUCTIONS, DIRECT_INTENT);

static RULES: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Writing the routine",
    routine_program::ROUTINE_RULES,
    "Triggers, steps and items, the same for every writer of routines.",
);

/// The skill as hosts that save routines with the routine tools carry it
/// after the routines guide: its without-code part, then how to write a
/// routine, short of the code-step contract `CreateRoutine`'s description
/// carries.
pub static DIRECT: ComposedPrompt = DIRECT_SESSION.compose(&RULES);
