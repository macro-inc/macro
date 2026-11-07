---
name: herdr
description: Run long or parallel terminal work in herdr panes on this Macro computer. Use when a task needs a dev server, a watcher, a second agent, or a shell that outlives one command.
---

# herdr

herdr is a terminal multiplexer for agents. macrod uses it for native
sessions, and you can use it for anything that must keep running.

- `herdr --help` lists commands; `herdr list` shows workspaces, tabs, panes.
- Start a long-running process (dev server, `docker compose up`, a test
  watcher) in its own pane instead of backgrounding it with `&`, then read its
  output from the pane when you need it.
- Name panes after what runs in them, and stop what you started when the task
  is done.
- People watching the session in Macro can see herdr panes; keep them tidy.
