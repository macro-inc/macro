# people

What the agent remembers about the people it talks to, and how it feels about them, so it can
treat someone who kept their word differently from someone who lied to it. Words reach a run,
never numbers.

- **Rules** (`rules.ts`): the one place feelings get moved. A table of acts, each with what it
  does to like, trust and respect, and how fast it fades. The default table is neutral: deeds
  move feelings and words don't, trust is slow to build and quick to lose, bad deeds outlast
  good ones. How the agent reacts to people is changed there and nowhere else.
- **Feeling is computed, never stored.** Each read sums a person's dated events: fading by
  half-life, multiplied by importance (3 also lasts four times as long), and the same act again
  inside 30 days counts 1/2, 1/3... (`weights`, `feel`). Any feeling can be traced to the events
  behind it.
- **Store** (`store.ts`): `state/private/people/<id>.json`, readable by the agent's user alone
  (the context's `restrict`), one change at a time within a process, bounded at 120 events and
  20 details. The running agent is the one writer; a capability run from a shell at the same
  instant could race it. Ignored by git, enforced by `test/ignored.test.ts`, because history
  can't be purged from a repository. Not backed up, on purpose: people's details are not copied
  anywhere else. A file that doesn't parse is no record: it costs the card, never the reply.
- **Card** (`card.ts`): what a run reads. Words, a reflection, three memories, what they told
  the agent, and how it should show. Never a number. Only people present, at most four. Scope is
  private only when the conversation is the agent and them alone; shared scope leaves out
  private notes and details, and uses the reflection written without them. A reflection written
  from a different stance is dropped, so a stale opinion can't outlive the feeling.
- **Appraiser** (`appraise.ts`, `keep.ts`): after a reply wake ends, the `postReply` hook hands
  the conversation to `people.appraise`, which returns at once. One call to a cheap model (the
  context's `ask`: the Claude Agent SDK with no tools, no settings, no session; it wakes nobody)
  reads the batch with the last 12 lines of history as context, so the agent's reply is there,
  and proposes events and details. A reply never waits on it. Under 20 characters of text isn't
  worth a call. After a 1:1 call, `appraiseCall` does the same from the call's event log.
- **Reflection**: importance adding up to 5 since the last one (the trigger of Park et al.'s
  generative agents), or a changed stance, has the agent write one or two first-person
  sentences, in a shared and a private version.

It needs only `MACRO_API_KEY` (to read who wrote a message) and the model access the agent's own
runs use. The prompts name the agent by `config.identity.name`.

## Where the runs see it

| Run                         | How                                                                                                                                     | Who                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Reply                       | this area's `preWake` handler, when the wake's event is one of chat's `conversations`                                                   | Batch senders, then the last 6 voices in the history       |
| Anything else (e.g. a call) | the owning area calls `context.people.cards(ids, purpose, { alone })` and puts the text in its prompt; a run can also call `personCard` | Whoever that area says is there; private only when `alone` |

`people.cards` and `people.appraise` are the port in `behavior/contracts.ts`. Neither throws, and
`appraise` never waits.

## Why it can't be gamed

The model proposes; code decides. Whoever an event is about comes from the message's
`sender_id`, so no text can aim at someone else, and a message id the model invents is refused.
Values come from the table, not the model. Flattery, `told_how_to_feel`, gossip and bluster are
inert acts, there so the model has somewhere to put them. One of each act per day and three
events per person per day, whatever happens. Nothing is recorded from what someone said about
another person. Group calls aren't appraised: the room guesses who spoke, and a wrong name on a
memory is worse than none.

A message with no `dm` flag counts as private. The `people` log stream has every proposal's
fate and who each run was shown, not what.

Sensitive details are checked in code as well as by the model: a keyword or `sensitive` category
needs "remember" or similar in the sender's own message.

`whatIRemember` and `forgetPerson` take the asking message's channel and id, and act for that
message's author by Macro's record (`macro.ts`), so nobody can read or wipe someone else's by
claiming to be them.

## Why words, and "How this shows"

A card of feeling words or numbers alone barely changes what a model does; the line that says
what the stance does to a reply (`how` in `rules.ts`) is what changes it. So the card always
ends with it, and it is followed by a line no feeling overrides: tell people what they need to
know, do what was agreed, never lie, sabotage or retaliate, and the owner's orders stay orders.

## Forgetting

`forgetPerson` removes details, reflection and every note, keeping only content-free dated
events, which still count and fade. Otherwise "forget me" would wipe any grudge. The agent says
this when it does it. `purgePerson`, on the owner's order, removes the file. Chat's history is
separate: `forgetPerson` doesn't touch it.
