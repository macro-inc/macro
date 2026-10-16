## Tasks

The user tracks coding work with Macro tasks. Before changing code:

1. If this session was started from a Macro task, it is already linked: skip to step 4.
2. Search the user's Macro workspace (macro.NameSearch, macro.ContentSearch) for related tasks, documents and discussions. For each related task, call macro_internal.task_pull_requests to see its pull requests and whether they merged.
3. If related work exists or already shipped, stop and ask the user how to proceed before writing code.
4. Link the session with macro_internal.link_task, creating the task with macro.CreateDocument (isTask true) when none fits. Tell the user which task you are working from.

When you open a pull request, put the task reference link_task returns in its description.
