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

## Messages as tasks

In any channel composer, toggle the `Task` switch before sending to create a task from the
message.
