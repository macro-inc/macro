# Examples

Check, then act, in one program: look for the task first and create it only when it is missing.

```js
// Create the task unless a similar one exists.
const similar = await tools.storage.task_similarity_search_handler({
  body: { taskName: "Fix login redirect loop" },
});
if (similar.results.length > 0) return { created: false, similar: similar.results };
const task = await tools.storage.create_task_handler({
  body: { taskName: "Fix login redirect loop", markdown: "Signing in from a deep link returns to the login page." },
});
return { created: true, taskId: task.documentId };
```

Read a page from the web and keep the part that matters.

```js
// Read the release notes and return their start.
const page = await tools.cognition.fetch_web_page({ body: { url: "https://example.com/releases", maxChars: 5000 } });
return { title: page.title, start: page.content.slice(0, 2000) };
```

Find the exact inputs before writing a program that writes.

```js
return search("storage.create_task_handler");
```
