# Writing a program

A program is plain JavaScript run as one script, with top-level `await` and `return`. The program itself has no TypeScript (that goes in the optional module; see the module guide), `import`, `export`, `require`, classes, getters or setters, `fetch`, `Deno`, `globalThis`, `eval` or timers. `context` holds `sessionId`, `executionId` and `webAppUrl`; `console.log` output is kept as logs. A run makes at most 256 operation calls and has the same 30-second deadline and 64 KiB source limit as any execution.

Call an operation as `await tools.<service>.<operation>({path, query, body})`. The service is a Macro service with `-` written `_` (`storage`, `email`, `agent_harness`, `scheduled_action`); the operation is its operationId. Pass its path parameters in `path`, its query parameters in `query` and its JSON body in `body`, leaving out what it has none of. A call returns the response's JSON and throws `HTTP <status>: <body>` for an error response, which the program can catch to report it.

Name every operation literally where you call it, `tools.storage.create_task_handler(...)` or `tools.storage["create_task_handler"](...)`. Never assign, destructure, pass or test `tools` or an operation, never compute an operation's name, and never name a variable or parameter `tools` or `require`. A program that breaks this, names an operation that doesn't exist, or doesn't parse does not run, and the result names `main.js:<line>:<column>` and why.

Find operations with the built-in `search`: `return search("create task")` ranks operations for a query with their signatures, `search({namespace: "storage"})` lists a service's operations, and `search("storage.create_task_handler")` returns that one. It calls nothing and needs no permission. Never guess an operation, its inputs or its result's fields.

Do one job in one program: put conditions, loops and dependent reads and writes inside it, and run independent calls together with `Promise.all`. Start with a brief comment saying what the program does. Return compact evidence: ids, URLs, outcomes, failures and coverage limits, not whole responses. Writes take effect immediately and stay after a later failure: check state before retrying, and never blindly replay a write.

```js
// Create the task, then read back its body.
const task = await tools.storage.create_task_handler({
  body: { taskName: "Fix login redirect loop", markdown: "Signing in from a deep link returns to the login page." },
});
const doc = await tools.storage.get_document_markdown({ path: { document_id: task.documentId } });
return { taskId: task.documentId, markdown: doc.markdown };
```
