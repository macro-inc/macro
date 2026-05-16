<div align="center">
  <a target="_blank" href="https://macro.com">
    <img width="100%" alt="Macro, built for high-output teams" src=".github/readme/Hero Image from Figma.png" />
  </a>

  <p>
    <a href="https://macro.com/app">Sign up</a>
    ·
    <a href="https://cal.com/team/macro/macro-demo-call?metadata%5Bfbp%5D=fb.1.1778954074516.817396687896036613">Book demo</a>
    ·
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

We built Macro because we wanted a single unified system. There are many good products, but nothing works together. So, we rebuilt everything from scratch, from first principles, in SolidJS and Rust, to work together as one. We've been dogfooding it for two years and now we've opened it up so you can use it too.

[Sign up](https://macro.com/app) · [Book demo](https://cal.com/team/macro/macro-demo-call?metadata%5Bfbp%5D=fb.1.1778954074516.817396687896036613)

# Features

<img width="100%" alt="Macro feature grid" src=".github/readme/CRM Feature Grid Request.png" />

# About

Macro has raised $30m led by a16z. We are based in NYC.

Core contributors: [@whutchinson98](https://github.com/whutchinson98), [@gbirman](https://github.com/gbirman), [@synoet](https://github.com/synoet), [@sedson](https://github.com/sedson), [@evanhutnik](https://github.com/evanhutnik), [@peterchinman](https://github.com/peterchinman), [@ehayes2000](https://github.com/ehayes2000), [@seanaye](https://github.com/seanaye), [@dev-rb](https://github.com/dev-rb), [@danielkweon](https://github.com/danielkweon), and [@aquaductape](https://github.com/aquaductape).

<iframe width="100%" height="405" src="https://www.youtube.com/embed/hZRin23hRKc?start=35" title="Macro demo" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

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
