//! Checking for duplicate tasks before creating one in code mode.

use crate::types::StaticPrompt;

static TITLE: &str = "Creating Tasks";

static INSTRUCTIONS: &str = r##"Before creating a task, check for existing tasks that already cover it:

```ts
const similar = await macro.tasks.findSimilar({ title: "Fix login bug", body: "Optional details" });
```

If one is a likely duplicate, tell the user and ask instead of creating the task. Never edit, merge or delete the matches unless the user asks.
"##;

static INTENT: &str = "Before creating a task the agent checks macro.tasks.findSimilar and asks \
the user about a likely duplicate instead of creating it.";

/// The duplicate-check rule for agents that create tasks through the SDK.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
