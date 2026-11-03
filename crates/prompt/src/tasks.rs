//! Checking for duplicate tasks before creating one in code mode.

use crate::types::StaticPrompt;

static TITLE: &str = "Creating Tasks";

static INSTRUCTIONS: &str = r##"Before creating a task, check for existing tasks that already cover it, in the same execution that creates it:

```ts
const similar = await macro.tasks.findSimilar({ title: "Fix login bug", body: "Optional details" });
const duplicates = similar.filter((match) => match.similarity >= 0.85);
if (duplicates.length > 0) {
  return { data: { created: null, duplicates: duplicates.map((match) => ({ id: match.task.id, name: match.name })) } };
}
const task = await macro.tasks.create({ name: "Fix login bug", markdown: "Optional details" });
return { data: { created: { id: task.id }, duplicates: [] } };
```

If it returns a likely duplicate, tell the user it created nothing and ask instead of creating the task. Never edit, merge or delete the matches unless the user asks.
"##;

static INTENT: &str = "Before creating a task the agent checks macro.tasks.findSimilar in the \
same execution, creates the task only when nothing is a likely duplicate, and otherwise asks the \
user instead of creating it.";

/// The duplicate-check rule for agents that create tasks through the SDK.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
