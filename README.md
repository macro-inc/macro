<div align="center">
  <a target="_blank" href="https://macro.com">
    <img width="1414" height="314" alt="Macro" src="https://github.com/user-attachments/assets/48250880-b1cf-4e18-bcaf-f314be1d1bfb" />
  </a>

  <p>
    Extremely fast email, messaging, tasks, docs, files, calls, and AI, linked together in one system.
  </p>

  <p>
    <a href="https://macro.com">Website</a>
    ·
    <a href="mailto:contact@macro.com">Feature requests</a>
    ·
    <a href="mailto:contribute@macro.com">Contribute</a>
    ·
    <a href="mailto:teo@macro.com">Hiring</a>
  </p>
</div>

# Why Macro

Macro is the workspace for teams that move through information all day: email, chat, documents, files, tasks, calls, search, and AI in one fast surface.

Everything in Macro is connected with bi-directional `@links`. Mention a doc in a channel, link a task from an email, drop a file into a canvas, or ask AI about the context around any object. The result is a workspace that keeps the thread intact instead of scattering work across tabs.

# Features

## Search Across Everything

Macro's search is a command center for the whole workspace. Filter across emails, channels, documents, tasks, files, calls, and people, then jump straight into the object you need. The same surface also lets you ask AI questions over your workspace with `@mentions` for precise context.

<img width="100%" alt="Macro unified search across workspace objects" src=".github/readme/search.png" />

## Channels That Keep Context

Channels are built for messy team work: messages, replies, attachments, docs, tasks, canvases, PDFs, and calls can all live in the same conversation. Every `@link` is bi-directional, so a reference in chat also becomes a path back from the thing being discussed.

<img width="100%" alt="Macro channel with linked messages, documents, and files" src=".github/readme/channels.png" />

## Calls With Memory

Calls in Macro do not disappear when the meeting ends. Recordings, participants, summaries, and transcripts stay connected to the rest of the workspace, so follow-ups can link back to the exact discussion that created them.

<img width="100%" alt="Macro call recording with summary and participants" src=".github/readme/calls.png" />

## AI Agents For The Workspace

Macro's AI can read across your recent calls, channels, docs, tasks, and notifications to build a useful picture of what happened. Agents can search, filter, inspect transcripts, and gather context before answering, so workspace intelligence is grounded in the objects your team already uses.

<img width="100%" alt="Macro AI agent gathering context across workspace activity" src=".github/readme/agents.png" />

## More In The Box

<table>
  <tr>
    <td width="50%">
      <p><img src=".github/icons/email.svg" width="28" height="28" alt="Email" /></p>
      <strong>Email</strong>
      <br />
      Full email client with keyboard-driven triage, instant search, and Gmail sync.
    </td>
    <td width="50%">
      <p><img src=".github/icons/book.svg" width="28" height="28" alt="Docs" /></p>
      <strong>Docs & Notes</strong>
      <br />
      Real-time collaborative documents using CRDTs and the same editor used across the app.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <p><img src=".github/icons/diagram.svg" width="28" height="28" alt="Canvas" /></p>
      <strong>Canvas</strong>
      <br />
      2D diagramming with embedded links to tasks, files, emails, and documents.
    </td>
    <td width="50%">
      <p><img src=".github/icons/file-md.svg" width="28" height="28" alt="Unified editor" /></p>
      <strong>Unified Editor</strong>
      <br />
      One rich text surface for emails, notes, channel messages, tasks, and AI context.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <p><img src=".github/icons/folder.svg" width="28" height="28" alt="Files" /></p>
      <strong>File Storage</strong>
      <br />
      Store and share videos, images, PDFs, and documents. Attachments are imported from emails and channels.
    </td>
    <td width="50%">
      <p><img src=".github/icons/keyboard.svg" width="28" height="28" alt="Keyboard" /></p>
      <strong>Keyboard First</strong>
      <br />
      Every action has a hotkey so you can navigate, triage, search, and execute without leaving the keyboard.
    </td>
  </tr>
</table>

# Stack

- TypeScript and Rust
- SolidJS, Tauri, Vite, Lexical, and CRDT-backed collaboration
- Bun workspaces, Biome, Vitest, and Playwright
- PostgreSQL, OpenSearch, WebSockets, and AWS
- Pulumi infrastructure

# Repository Layout

While we're not accepting contributions yet, we encourage you to explore the codebase. This overview should help you navigate.

```txt
macro/
├── js/app/                      # Frontend (SolidJS + Tauri)
│   ├── packages/
│   │   ├── app/                 # Web/Desktop app entry point
│   │   ├── core/                # Core shared logic and components
│   │   ├── lexical-core/        # Core text editor (Lexical-based)
│   │   ├── block-*/             # UI block components (email, chat, canvas, etc.)
│   │   └── service-*/           # API clients for backend services
│   └── src-tauri/               # Tauri Rust backend for desktop
│
├── rust/cloud-storage/          # Backend services (Rust)
│   ├── document-storage-service/    # Document storage API
│   ├── email_service/               # Email processing
│   ├── comms_service/               # Messaging
│   ├── search_service/              # Full-text search
│   ├── authentication_service/      # Auth
│   ├── connection_gateway/          # WebSocket gateway
│   ├── macro_db_client/             # PostgreSQL client
│   └── ...                          # Other services and shared crates
│
├── infra/                       # Infrastructure (Pulumi + AWS)
│   ├── stacks/                  # Pulumi deployment stacks
│   ├── lambda/                  # Lambda function configs
│   └── resources/               # Reusable AWS resource definitions
│
└── scripts/                     # Build and utility scripts
```

# Community

Macro is licensed under the Business Source License. See `LICENSE.md` for details.

Have an idea, want to contribute, or want to work on Macro?

- Feature requests: [contact@macro.com](mailto:contact@macro.com)
- Contributions: [contribute@macro.com](mailto:contribute@macro.com)
- Hiring: [teo@macro.com](mailto:teo@macro.com)

# Star History

<a href="https://www.star-history.com/?repos=macro-inc%2Fmacro&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=macro-inc/macro&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=macro-inc/macro&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=macro-inc/macro&type=date&legend=top-left" />
  </picture>
</a>
