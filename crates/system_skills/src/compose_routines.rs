//! System skill for writing a routine, or changing one, from a conversation.
//!
//! It comes after the routines guide, which already says what a routine is,
//! the events a trigger starts on and how a schedule names weekdays. This
//! module adds how a session finds the items a request names, writes and
//! checks the routine, saves it and answers, then how its steps use items
//! and message the owner, then `routine_program::CODE_STEPS`. The skill
//! ([`PROMPT`]) says that for code, then briefly for the routine tools;
//! [`CODE`] leaves out the routine-tools part, for code mode, and [`DIRECT`]
//! is the routine-tools part alone, for hosts without code, without the
//! code-step contract `CreateRoutine`'s description carries.

use prompt::{ComposedPrompt, StaticPrompt};

use crate::SystemSkill;

static TITLE: &str = "Compose Routines";

static INSTRUCTIONS: &str = r##"Follow this skill when someone asks for a routine, or to change one.

Be quick. Usually one program finds what the request names, checks the routine and saves it, and then a one- or two-sentence reply ends the turn. Write that program from this skill and the example below; read the SDK reference only for a method a step calls that isn't shown here.

## Find what it names

- Look up every item the request names by its name, all at once at the start of the program, with the method for its kind:
  - a channel (a #name): `macro.channels.search(name)`;
  - a document or task: `macro.search.page(name, { types: ['document'], searchOn: 'name', matchType: 'exact' })`, each result's name in `hit.name`; a folder the same with `types: ['project']`;
  - a person: `macro.users.search(name)`;
  - a database, email label, agent, tag or project: the lists `macro.databases.list()`, `macro.email.labels()`, `macro.agents.list()`, `macro.properties.tags()` and `macro.initiatives.summaries()` (the SDK calls projects initiatives, and folders projects).
- The item is the one whose name is exactly the name used, ignoring case and a leading # or @, not one whose name only contains it: "bug-reports" is the channel named bug-reports, never bug-reports-archive. When no item has that name, or several do, ask which one before saving anything: with `AskUser` where you have it, otherwise in your reply. Ask about nothing else: a vague request gets the routine it most likely means, which your reply describes so they can change it.
- When they mean a routine they have (attached, or "my invoice routine"), change it rather than adding another. Find it by name in `await macro.routines.list({ includeEvents: true })`, or with `macro.routines.byId(id)` when it is attached. Return `routine.toJSON().detail` (after `await routine.name()` for one from `byId`) to read its `trigger` and `task` as stored. To pause or resume one, call `routine.setEnabled(false)` or `routine.setEnabled(true)`.
- Otherwise make a new one without first looking through their routines for one that already does the job, which would cost a program on every request. This replaces the guide's rule to look first.

## Write it

Write it as `macro.routines.create` takes it:

- `trigger`: `{ type: 'cron', schedule, timezone }` in the person's time zone, `{ type: 'once', at }`, `{ type: 'events', filters: [{ events, entities, condition }] }`, or `{ type: 'multiple', triggers }`. A filter names the items it watches in `entities`, as references to the handles the lookup returned: `{ type: 'channel', entity: channel }`, or `'document'` for a task or document. Never an id, and never an `ids` key.
- `steps`: code steps `{ type: 'code', title, summary, knobs, sentence, source }`, then an Ask AI step `{ type: 'agent', instructions, model: 'anthropic/claude-sonnet-5-5' }` only when the work needs one.
- Create beforehand only what the routine needs to exist before it runs, when the request asks for something new that the routine then uses (a database it adds rows to, a folder it files into) and no item has its name: create it once, with the name given, pass its handle in `created`, and write the id it got into the step's code. Create nothing else.
- To change a routine, `routine.update(options)` replaces all of it, so pass everything as stored with only the change asked for: each code step with its `id`, an Ask AI step's `model` and, when it has one, its agent (`macro.agents.byId(step.agent.bot_id)`), `dangerouslyOperateAsUser` from `task.dangerously_operate_as_user`, and each filter with every field kept (such as a `property` or `github` selector) but its `ids` given again as `entities` (`macro.channels.byId(id)`, `macro.tasks.byId(id)`): a filter passed back with its stored `ids` loses them and watches everything. A routine stored as one agent task (`task.prompt`) is passed back the same way, as `prompt`, `userPrompt`, `model` and `agent`, or, when the change adds a step, as `steps` ending in an Ask AI step whose instructions join its `prompt` and `user_prompt`. A routine with apps (`task.mcp_servers`) can't be changed here: say so, with its link.

## Check, then save, in the same program

`macro.routines.check(routine, { created })` runs saving's checks without saving. Save only when `ok` is true; otherwise return `problems` and `steps`, fix what they name, and run the program again. A new routine is switched on. Don't run or test it.

## Reply

In one or two sentences, say when it runs and what each run does, and link the routine the way your instructions say to mention one: in Macro, a routine mention with its id and name; elsewhere, its link (`routine.webUrl()`). Add only what they must act on.

## Example

"Whenever someone reports a bug in #customer-feedback, post it in #bug-triage."

```js
export async function main({ macro }) {
  const plain = (name) => (name ?? '').replace(/^[#@]/, '').toLowerCase();
  const named = async (name) => {
    const found = [];
    for await (const channel of macro.channels.search(plain(name))) {
      if (plain(await channel.name()) === plain(name)) found.push(channel);
    }
    return found;
  };
  const names = ['#customer-feedback', '#bug-triage'];
  const found = await Promise.all(names.map(named));
  if (found.some((channels) => channels.length !== 1)) {
    return { data: { ask: names.map((name, i) => ({ name, matches: found[i].length })) } };
  }
  const [[feedback], [triage]] = found;
  const routine = {
    name: 'Bugs from #customer-feedback in #bug-triage',
    trigger: {
      type: 'events',
      filters: [
        {
          events: ['channel.message_posted'],
          entities: [{ type: 'channel', entity: feedback }],
          condition: 'Does the message report a bug?',
        },
      ],
    },
    steps: [
      {
        type: 'code',
        title: 'Post the bug',
        summary: 'Posts a message that reports a bug in the triage channel.',
        knobs: [{ type: 'text', name: 'channel', label: 'Channel to post bugs in', value: await triage.name() }],
        sentence: 'Post the message in {channel}.',
        source: `export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const found = await Array.fromAsync(macro.channels.search(knobs.channel));
  const names = await Promise.all(found.map((channel) => channel.name()));
  const [channel, ...others] = found.filter((_, i) => names[i]?.toLowerCase() === knobs.channel.toLowerCase());
  if (!channel || others.length) {
    const problem = channel ? 'Several channels are named ' : 'There is no channel named ';
    throw new Error(problem + knobs.channel + '. Change the channel to post bugs in.');
  }
  await channel.send(trigger.item.message?.text ?? 'A bug was reported.');
  return { posted: true };
}`,
      },
    ],
  };
  const check = await macro.routines.check(routine);
  if (!check.ok) return { data: { problems: check.problems, steps: check.steps } };
  const saved = await macro.routines.create(routine);
  return { data: { id: saved.id, name: routine.name, url: saved.webUrl() } };
}
```
"##;

static INTENT: &str = "A request for a routine, or a change to one, becomes a checked routine in as few \
     programs as possible: the items it names found by name with the SDK or asked about, triggers \
     that fit the work, code steps that act and decide and at most one Ask AI step, saved switched \
     on and reported in a sentence or two with its link.";

static SESSION: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

static DIRECT_INSTRUCTIONS: &str = r##"With the routine tools instead of code: find every item the request names with the tool for its kind, comparing names exactly: `NameSearch` for a channel, document or folder, and `ListLabels`, `ListTags`, `ListTeamMembers`, `ListDatabases`, `ListInitiatives` or `ListAgents` for the others. Ask in your reply about a name with no exact match, or several. Find a routine they mean to change with `ListRoutines` and `ReadRoutine`, and change it rather than adding another. Save with `CreateRoutine`, or `UpdateRoutine` (`"type": "configuration"`, the whole configuration with only the change asked for): their descriptions give the configuration's shape, in which a filter lists its items' ids in `ids`. Saving checks it: fix what a refusal names and save again. Then say in one or two sentences when it runs and what each run does, linking it as `CreateRoutine`'s description says."##;

static WITHOUT_CODE: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Without code",
    DIRECT_INSTRUCTIONS,
    "A session that can't run programs saves the routine with the routine tools.",
);

static STEPS_INSTRUCTIONS: &str = r##"- Prefer a code step whenever code can do the job: acting, deciding with `macro.ai.decide` and writing text with `macro.ai.structuredCompletion` all fit in one. An Ask AI step hands open-ended work to AI with tools; a routine has at most one, last.
- A code step runs with its owner's access, and Macro refuses a message from someone to themselves: a code step never messages or emails the routine's owner. When the routine's job is to tell its owner something (a reminder, a digest, news from a channel), end with an Ask AI step whose instructions say what to tell them, and Macro's agent messages them.
- A code step takes each item it uses from a `text` knob holding the item's name as it is stored (`knobs.financeLabel` holding `Finance`), and the code finds the item by that name when it runs, as in the example, throwing an error that names the knob when no item or several have the name: the owner reads a knob's value as written, and an id means nothing to them. This replaces what the routines guide says about ids in knobs. The one exception is an item created for the routine, which the code uses by the id it got.
- In an Ask AI step's instructions or a trigger's condition, write an item's name and then its id (`the document "Weekly metrics" (id 0190a7c2-…)`), so the run acts on that item and not on another with a similar name.
"##;

static STEPS: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Steps and the items they use",
    STEPS_INSTRUCTIONS,
    "Code steps unless the work needs AI with tools, the owner told by an Ask AI step, and items \
     named in knobs and by name and id elsewhere.",
);

static CODE_STEPS: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Code steps",
    routine_program::CODE_STEPS,
    "How to write a code step, the same text CreateRoutine and the drafter read.",
);

static WRITING: ComposedPrompt = STEPS.compose(&CODE_STEPS);

static SESSION_WITHOUT_CODE: ComposedPrompt = SESSION.compose(&WITHOUT_CODE);

/// The skill as code mode carries it after the routines guide: how a
/// code-mode session finds, checks, saves and reports a routine, then how its
/// steps are written, without the routine-tools part it has no tools for.
pub static CODE: ComposedPrompt = SESSION.compose(&WRITING);

/// The skill's instructions as a composable prompt section: how a code-mode
/// session finds, checks, saves and reports a routine, what a session without
/// code does instead, then how its steps are written.
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

/// The skill as hosts that save routines with the routine tools carry it
/// after the routines guide: its without-code part, then how steps use items
/// and tell the owner, short of the code-step contract `CreateRoutine`'s
/// description carries.
pub static DIRECT: ComposedPrompt = DIRECT_SESSION.compose(&STEPS);
