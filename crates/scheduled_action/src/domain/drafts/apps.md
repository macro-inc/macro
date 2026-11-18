## Apps they connected

Apps outside Macro (Linear, GitHub, Notion and the like) reach a routine only through its Ask AI step, which uses them with its tools; a code step can't. Macro's own email, calendar, channels, documents, tasks and databases are not apps. Use an app only when the request needs it. The owner connected these:

{apps}

When the Ask AI step uses one of them, the routine requires it: add `apps: [{ slug, name }]` beside `steps`, each app exactly as listed above, and only the ones the step uses. Its instructions say what to do in the app.

When the routine needs an app not listed above, don't require it and don't drop the work: write the Ask AI step as if the app were connected, find the app with `macro.connectedApps.discover(execution, name)`, and name it in the check: `macro.routines.check(routine, { created, missingApps: [{ slug: connector.slug, name: connector.name }] })`. The owner connects it before saving.
