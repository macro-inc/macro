# Tasks

## Surface

`Go to Tasks` → `/app/component/tasks`. Tabs `My tasks` / `All`. Table columns: Task, Status,
Priority, Assignees, Created By, Updated; grouped by priority by default (`Group` menu to
change). Toolbar: `Task` (create), search (`Ctrl+F`), `Sort`, `Group`, `Filter`, `Preview`,
and an active filter row (`Status: In Progress +2`, `Add filters`, `Clear all` — note the
default filter hides Done tasks).

New accounts are seeded with three sample tasks (`Intro to tasks`, `Advanced task features`,
`How we use tasks at Macro`).

## Create a task

1. Click the `Task` button (or `Create` → `Task T`, or keyboard `c` then `t`).
2. A dialog opens with the title contenteditable focused (placeholder `New task`), plus
   `Add description...`, and property buttons: `Not Started` (status), `Priority`, assignee
   chip (defaults to you), `Due Date`, `Change or select tags`, `Attach image or video`,
   a `Create More` switch, and `Create Task Ctrl ↵`.
3. `type_text` the title, then press **Ctrl+Enter** to create (the `Create Task` button
   enables once there is a title). Dialog also offers `Continue editing in split` to open the
   task as a full document.

Tasks are documents under the hood (creation hits `POST /dss/documents/create_task`), so they
also show up in Files/`All` and in AI-chat document listings.

## View and edit task properties

An open task shows Status, Priority, and Assignees as property pills below its title. Task
mentions and document references also show the same three pills in their hover-card preview,
including properties that do not have a value yet. Click a preview pill to edit it without
opening the task; the property picker keeps the preview open while you make a selection.
Users with view or comment access see the same pills read-only.

## Messages as tasks

In any channel composer, toggle the `Task` switch before sending to create a task from the
message.
