//! Checking for duplicate tasks before creating one in code mode.

use crate::types::StaticPrompt;

static TITLE: &str = "Creating Tasks";

static INSTRUCTIONS: &str = r##"Before creating a task, check for existing tasks that already cover it — in the same ExecuteCode program, not a later call. Put the branch in code: if similar tasks exist, return them and do not create; otherwise create and return the new task.

```js
export async function main({macro}) {
  const title = "Fix login bug";
  const body = "Optional details";
  const similar = await macro.tasks.findSimilar({ title, body });
  if (similar.length > 0) {
    return {
      data: {
        created: false,
        similar: similar.map((item) => ({
          id: item.task.id,
          name: item.name,
          url: item.task.webUrl(),
          similarity: item.similarity,
        })),
      },
    };
  }
  const task = await macro.tasks.create({ name: title, markdown: body });
  return { data: { created: true, id: task.id, url: task.webUrl() } };
}
```

If the program returns similar tasks, tell the user and ask instead of creating. Never edit, merge or delete the matches unless the user asks.
"##;

static INTENT: &str = "Before creating a task the agent checks macro.tasks.findSimilar \
in the same ExecuteCode program as create, returns likely duplicates without \
creating, and asks the user instead of creating a duplicate.";

/// The duplicate-check rule for agents that create tasks through the SDK.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creating_tasks_is_one_execution_with_the_branch_in_code() {
        let rendered = PROMPT.to_string();
        assert!(rendered.contains("same ExecuteCode program"));
        assert!(rendered.contains("if similar tasks exist, return them and do not create"));
        assert!(rendered.contains("macro.tasks.findSimilar"));
        assert!(rendered.contains("macro.tasks.create"));
        assert!(
            rendered.find("findSimilar").unwrap() < rendered.find("macro.tasks.create").unwrap()
        );
        assert!(rendered.contains("if (similar.length > 0)"));
        assert!(!rendered.contains("setTimeout"));
        assert!(!rendered.contains("sleep"));
    }
}
