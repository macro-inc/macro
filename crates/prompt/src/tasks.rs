//! Checking for duplicate tasks and creating one in a single code-mode program.

use crate::types::StaticPrompt;

static TITLE: &str = "Creating Tasks";

static INSTRUCTIONS: &str = r##"Check for existing tasks that already cover a new task in the same program that creates it, so the check and the create take one ExecuteCode call:

```javascript
export async function main({ macro }) {
  const title = "Fix login bug";
  const markdown = "Optional details";
  const similar = await macro.tasks.findSimilar({ title, body: markdown });
  if (similar.length > 0) {
    return { data: { created: false, similar: similar.map(({ task, name, similarity }) => ({ id: task.id, url: task.webUrl(), name, similarity })) } };
  }
  const task = await macro.tasks.create({ name: title, markdown });
  return { data: { created: true, id: task.id, url: task.webUrl() } };
}
```

findSimilar returns only likely duplicates. When it returns any, the task was not created: tell the user and ask instead. Never edit, merge or delete the matches unless the user asks.
"##;

static INTENT: &str = "The agent checks macro.tasks.findSimilar and creates the task in one \
ExecuteCode program, creating it only when nothing matches, and asks the user about a likely \
duplicate instead of creating it.";

/// The duplicate-check rule for agents that create tasks through the SDK.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_check_and_create_share_one_program() {
        let program = INSTRUCTIONS
            .split("```javascript")
            .nth(1)
            .and_then(|rest| rest.split("```").next())
            .unwrap();
        assert!(program.contains("macro.tasks.findSimilar"));
        assert!(program.contains("macro.tasks.create"));
        assert!(INSTRUCTIONS.contains("one ExecuteCode call"));
    }
}
