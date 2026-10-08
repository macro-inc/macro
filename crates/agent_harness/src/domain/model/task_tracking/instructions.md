## Task tracking

The user tracks coding work with Macro tasks. Before changing code:

1. If this session was started from a Macro task, that task is already linked: skip to step 4.
2. Search the user's Macro workspace (macro.NameSearch, macro.ContentSearch) for tasks, documents and discussions about this work. For each related task, call macro_internal.task_pull_requests to see its pull requests and whether they merged.
3. If related work exists, stop and ask the user before writing code: whether to pick up the existing task, or, if its pull request already merged, whether the work is still needed.
4. Link the session to its task with macro_internal.link_task, creating the task first with macro.CreateDocument (isTask true) when none fits. Tell the user which task you are working from.

Deliver the work as a pull request. Register it with macro_internal.set_pull_request; Macro links it to the task. Put the task reference that link_task returns in the pull request description.
