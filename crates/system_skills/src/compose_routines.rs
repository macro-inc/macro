//! System skill for writing a routine, or changing one, from a conversation.
//!
//! Its second half is `routine_program::WRITING`, the text every writer of
//! routines follows; this module adds only how a code-mode session finds the
//! items, checks and saves the routine, and answers.

use prompt::{ComposedPrompt, StaticPrompt};

use crate::SystemSkill;

static TITLE: &str = "Compose Routines";

static INSTRUCTIONS: &str = r##"Follow this skill when someone asks for a routine, or to change one: work that runs later, as them, on a schedule or whenever something happens ("remind me", "every Monday", "when an email arrives"). A meeting with other people is a calendar event, and a to-do with a due date is a task.

Be quick. Usually one program finds what the request names, checks the routine and creates it, and then a one- or two-sentence reply ends the turn. Write that program from this skill and the example below; read the SDK reference only for a method a step calls that isn't shown here.

## Find what it names

- Look up every item the request names (a channel, person, project or folder, document, database, label or tag) with one `macro.search.names([...])` call, each name as written. The item is the match marked `exact`. A kind in `unavailable` wasn't checked: look for the item there another way before saying it doesn't exist.
- When a name has no exact match, or several and the request doesn't say which kind it means, ask which one with `AskUser` instead of creating the routine with it left out.
- When they mean a routine they have (attached, or "my invoice routine"), change it rather than adding another. Find it by name in `await macro.routines.list({ includeEvents: true })`, or with `macro.routines.byId(id)` when it is attached. Return `routine.toJSON().detail` (after `await routine.name()` for one from `byId`) to read its `trigger` and `task.steps` as stored.

## Write it

Write it as `macro.routines.create` takes it:

- `trigger`: `{ type: 'cron', schedule, timezone }` in the person's time zone, `{ type: 'once', at }`, `{ type: 'events', filters: [{ events, entities, condition }] }`, or `{ type: 'multiple', triggers }`. A filter names the items it watches in `entities`, as references to handles the SDK returned: `{ type: 'channel', entity: channel }`, or `'document'` for a task or document. Never an id, and never an `ids` key.
- `steps`: `{ type: 'code', title, summary, knobs, sentence, source }`, and at most one `{ type: 'agent', instructions }`, last.
- `dangerouslyOperateAsUser: true` only when they asked for it to post or send as them.
- Create beforehand only what the routine needs to exist before it runs, when the request asks for something new that the routine then uses (a database it adds rows to, a folder it files into): create it with the name given and pass its handle in `created`. Create nothing else.
- To change a routine, `routine.update(options)` replaces its name, trigger and steps, so pass all of them with only the change asked for, keeping each code step's `id`. Give every filter's items again as `entities` (`macro.channels.byId(id)`, `macro.tasks.byId(id)`): a filter passed back with its stored `ids` loses them and watches everything.

## Check, then save, in the same program

`macro.routines.check(routine, { created })` runs saving's checks without saving. Create or update only when `ok` is true; otherwise return `problems` and `steps`, fix what they name, and run the program again. A new routine is switched on. Don't run or test it.

## Reply

In one or two sentences, say when it runs and what each run does, with its link (`routine.webUrl()`). Add only what they must act on.

## Without code

With the routine tools (`CreateRoutine`, `UpdateRoutine`) instead of `ExecuteCode`, find each named item with `NameSearch` (ask in your reply about one that isn't settled), and a routine to change with `ListRoutines` and `ReadRoutine`. Save with `CreateRoutine`, or with `UpdateRoutine` (`"type": "configuration"`, the whole configuration with only the change asked for). Their descriptions give the configuration's shape, in which a filter lists its items' ids in `ids`. Saving checks it: fix what a refusal names and save again.

## Example

"Whenever a task in the Website Redesign project moves to In review, post the task name in #design-review."

```js
export async function main({ macro }) {
  const { results } = await macro.search.names(['Website Redesign', '#design-review']);
  const exact = results.map((result) => result.matches.filter((match) => match.exact));
  if (exact.some((matches) => matches.length !== 1)) {
    const options = results.map(({ name, matches }) => ({ name, matches: matches.map(({ type, name, exact }) => ({ type, name, exact })) }));
    return { data: { ask: options } };
  }
  const [project, channel] = exact.map(([match]) => match.entity);
  const routine = {
    name: 'Website Redesign reviews in #design-review',
    // A status change is about the task, never its project: watch every task.
    trigger: {
      type: 'events',
      filters: [{ events: ['task.status_changed'], condition: 'Did the task just move to In review?' }],
    },
    steps: [
      {
        type: 'code',
        title: 'Post the task',
        summary: 'Posts the name of a task in the project that moved to In review.',
        knobs: [
          { type: 'text', name: 'project', label: 'Project its tasks are in', value: project.id },
          { type: 'text', name: 'channel', label: 'Channel to post in', value: channel.id },
        ],
        sentence: 'Post the name of a task in {project} in {channel}.',
        source: `export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const task = macro.tasks.byId(trigger.item.entity_id);
  if ((await task.project())?.id !== knobs.project) return { posted: false };
  await macro.channels.byId(knobs.channel).send(trigger.item.item?.name ?? 'A task');
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

static WRITING: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Writing the routine",
    routine_program::WRITING,
    "Triggers, steps, items and code steps, the same for every writer of routines.",
);

/// The skill's instructions as a composable prompt section: how a session
/// finds, checks, saves and reports a routine, then how to write one.
pub static PROMPT: ComposedPrompt = SESSION.compose(&WRITING);

/// The compose-routines system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "compose-routines",
    name: "Compose Routines",
    content: &PROMPT,
};
