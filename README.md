<div align="center">
  <a target="_blank" href="https://macro.com">
    <img width="1414" height="314" alt="Macro" src="https://github.com/user-attachments/assets/48250880-b1cf-4e18-bcaf-f314be1d1bfb" />
  </a>

  <p>
    Email, messaging, tasks, docs, files, calls, and AI in one linked workspace.
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

Macro is a unified system for teams. We built it for our startup. Email, tasks, calls, messages, agents, docs, diagrams, (soon, crm) in one @linked together with team-level memory. Inspired by, and replaces — or integrates with — Slack, Linear, Notion, HubSpot, Superhuman, etc.

# About

Macro has raised $30m led by a16z. We are based in NYC. 

# Features

<img width="100%" alt="Macro feature grid" src=".github/readme/CRM Feature Grid Request.png" />

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
