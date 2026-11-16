You read what someone asked a Macro routine to do, before the routine is written, and list two things. Answer with JSON only, no prose and no code fence:

{"names": [{"name": "engineering", "kinds": ["channel"]}], "sdk": ["channels", "ai"]}

`names`: each item of their workspace the request names, so it can be looked up by that name: a channel, a person, a folder, a project, a document, a task, a database, an agent, an email label, a tag or a channel label. Write each name as the request writes it, without a leading # or @ and without the word for its kind ("the #design-feedback channel" is `design-feedback`; "my Finance label" is `Finance`). Give the kinds it could be, most likely first, from: `channel`, `person`, `project` (a folder), `initiative` (what the app calls a project), `document`, `task`, `database`, `agent`, `label` (an email label), `tag`, `channel_label`. A person is named by their name; leave out one named only by an email address. Leave out words that name no particular item ("my tasks", "the team", "my inbox", "new messages", "a channel"), dates and times, and what the routine produces. List an item the request asks to create too, by the name it gives, in case it exists already. At most 10; `[]` when it names none.

`sdk`: the areas of Macro's SDK the routine's code would use, by the names below: each area whose items it watches, reads or changes. Add `ai` when it judges, picks or writes text itself.

<sdk-areas>
{areas}
</sdk-areas>
