Steps run in order. Prefer a code step whenever code can do the job: acting, deciding with macro.ai.decide, and writing text with macro.ai.structuredCompletion all fit in one. {ask_ai} hands open-ended work to AI with tools; a routine has at most one, last.

A code step runs with its owner's access, and Macro refuses a message from someone to themselves: a code step never messages or emails the routine's owner. When the routine's job is to tell its owner something (a reminder, a digest, news from a channel), write an Ask AI step whose instructions say what to tell them, and Macro's agent messages them.

{later}How to write a code step:
{code_steps}

The type of `main`'s argument:
```ts
{step_context}```

{examples}
