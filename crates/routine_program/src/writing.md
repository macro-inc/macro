A routine is a name, a trigger and steps. It runs later, as its owner, and never sees the conversation that asked for it: what each run needs is in its trigger, its steps and their knobs.

Triggers: any one of a routine's triggers starts a run.
- On a schedule (cron): six fields (second minute hour day-of-month month day-of-week) and the owner's IANA time zone. Name weekdays MON to SUN, since weekday numbers start at 1 = Sunday: every weekday at 8:30am is `0 30 8 * * MON-FRI`, never `1-5`.
- Once: one run at a future time (RFC 3339), for "tomorrow at 9" or "on 3 March".
- On events: filters, each naming events from the list below. A filter can be limited to the items it watches, and an event's item is what it is about: the channel a message is posted in, the task or document itself. A project, folder or person is never an event's item, so a filter limited to one never fires: to act on tasks in a project, watch every task and check in the step that the task is in it. Creation events and `email.message_received` watch everything, and `channel.mentioned` every channel unless limited to some. A filter's `condition` is a yes/no question AI answers about each event before any step runs ("Did the task just move to In review?"); events answered no start nothing. Use one when a judgment, rather than an id, decides which events matter.

Events:
- `channel.created`: a channel the owner can access is created.
- `channel.message_posted`: someone sends a message in a watched channel.
- `channel.mentioned`: someone @ mentions the owner in a watched channel.
- `document.created`: a document the owner can access is created. Tasks have their own event.
- `document.deleted`: a watched document is deleted.
- `task.created`: a task the owner can access is created.
- `task.status_changed`: a task's status changes.
- `task.priority_changed`: a task's priority changes.
- `task.property_changed`: any property on a task changes, such as its assignees, due date, project or effort, including status and priority.
- `email.message_received`: new mail arrives in the owner's inbox. Excludes spam, trash, drafts and historical imports.
- `call.started`: a call the owner starts begins, with who has joined so far.
- `call.ended`: a call the owner joined ends, with its participants and transcript.

Steps run in order, and a failed step stops the run.
- A code step runs TypeScript against Macro's SDK. Use one for everything code can do: acting on items, deciding with `macro.ai.decide`, and writing text with `macro.ai.structuredCompletion` all fit in one step, which usually does the whole job.
- An Ask AI step hands open-ended work to AI with tools: research, or reading and summing up many items. A routine has at most one, and it goes last; it sees the triggering event and what the steps before it returned. Its instructions stand alone: what to do, the items by id or link, and where the result goes.

Items:
- Each item the request names is found while writing, by exactly that name, never a look-alike: "bug-reports" is never bug-reports-archive. A filter watches the item found. A code step takes it from a knob holding its name, which the code looks up when it runs, never from a name or id written into the code; a knob holds an id only for an item made for the routine.
- An item that isn't settled (nothing has that name, or several things do) is never guessed, and nothing is created in its place. Ask the person which one when you can; otherwise leave it out for the owner to pick, as a filter without it or a knob whose value is "".
- Writing a routine does none of its work: "every Monday make a task" makes no task today, and "when an email arrives, reply" sends nothing now.

