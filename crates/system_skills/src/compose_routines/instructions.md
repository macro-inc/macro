Follow this skill when someone asks for a routine, or to change one.

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
- To change a routine, `routine.update(options)` replaces all of it, so pass everything as stored with only the change asked for: each code step with its `id`, an Ask AI step's `model` and, when it has one, its agent (`macro.agents.byId(step.agent.bot_id)`), `dangerouslyOperateAsUser` from `task.dangerously_operate_as_user`, and each filter with every field kept (such as a `property` or `github` selector) but its `ids` given again as `entities` (`macro.channels.byId(id)`, `macro.tasks.byId(id)`): a filter passed back with its stored `ids` loses them and watches everything. A routine stored as one agent task (`task.prompt`) is passed back the same way, as `prompt`, `userPrompt`, `model` and `agent`, or, when the change adds a step, as `steps` ending in an Ask AI step whose instructions join its `prompt` and `user_prompt`. Its sub-routines (`task.sub_routines`) go back as `subRoutines`, each with its `name`, `title`, `inputs` and steps passed back as the routine's are. A routine with apps (`task.mcp_servers`, or a sub-routine's), or with input values (`task.inputs`), can't be changed here: say so, with its link. A routine another routine scheduled (`task.sub_routine`) runs its parent's sub-routine of that name, so change that instead.

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
