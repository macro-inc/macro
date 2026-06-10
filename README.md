<div align="center">
  <a target="_blank" href="https://macro.com">
    <img width="100%" alt="Macro, built for high-output teams" src=".github/readme/Hero Image from Figma.png" />
  </a>

  <p>
    <a href="https://macro.com/app">Sign up</a>
    ·
    <a href="https://docs.macro.com">Docs</a>
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

Macro is a unified system for teams. We built it for our startup. Email, tasks, calls, messages, agents, docs, diagrams, and CRM in one place — @linked together with team-level memory. Replaces Slack, Linear, Notion, HubSpot, and Superhuman. Or integrates with them.

We built Macro because we wanted a single unified system. There are many good products, but nothing works together. So, we rebuilt everything from scratch, from first principles, in SolidJS and Rust, to work together as one. We've been dogfooding it for two years and now we've opened it up so you can use it too.

[Sign up](https://macro.com/app) · [Book demo](https://cal.com/team/macro/macro-demo-call?metadata%5Bfbp%5D=fb.1.1778954074516.817396687896036613) · [Read the docs](https://docs.macro.com)

# Features

Email inspired by Superhuman, with better AI. Tasks inspired by Linear, deeply integrated into channels. Channels like Slack, with Reddit-style threading for focused technical discussions. And AI to separate #random pings from important ones. CRM that "just works". Video calls logged to team-level memory. A unified inbox for all of this, in one place, and much more.

<img width="100%" alt="Macro feature grid" src=".github/readme/CRM Feature Grid Request.png" />

For each block, we studied the best prior art and tried to make it even better. Every block has its own page in the [docs](https://docs.macro.com):

| Block | What it does |
| --- | --- |
| [Email](https://docs.macro.com/product/email) | Multi-account unified inbox, keyboard shortcuts, and shared inboxes. Gmail. |
| [Messages](https://docs.macro.com/product/channels) | Channels and direct messages designed for focused technical discussions. |
| [Tasks](https://docs.macro.com/product/tasks) | Linear-inspired tasks, tightly integrated with channels, email, and agents. |
| [Docs](https://docs.macro.com/product/docs) | Real-time collaborative, markdown-native docs built on CRDTs, with @mentions. |
| [Canvas](https://docs.macro.com/product/canvas) | 2D board with embedded @links to tasks, files, and emails. |
| [Agents](https://docs.macro.com/product/agents) | Unified, team-level memory. Can take action on your behalf. |
| [Calls](https://docs.macro.com/product/calls) | Recorded, transcribed, and logged to team memory for agents. |
| [File storage](https://docs.macro.com/product/folders) | Auto-imported from email and channels, fully searchable. |
| [Pull requests](https://docs.macro.com/integrations/github) | Linked to tasks, embeddable in channels, available to agents. |
| [CRM](https://docs.macro.com/product/crm) | Customer and contact objects, custom properties, email sync, enrichment. |

# How it works

A few ideas make the blocks work as one system:

- **[Bidirectional @linking](https://docs.macro.com/concepts/mentions)** — @mention a doc in a message and both know about each other. Your workspace becomes a web of context you can navigate in either direction.
- **[Channel-based permissions](https://docs.macro.com/permissions)** — anything you @mention in a channel is automatically shared with its members. Join a channel, gain access; leave, lose it. No permission-request dance.
- **[Unified memory](https://docs.macro.com/product/unified-memory)** — agents remember what your whole team is doing across email, messages, tasks, docs, and calls, not just your own chat history. Refreshed nightly.
- **[One inbox](https://docs.macro.com/product/inbox)** — emails, channel messages, task assignments, @mentions, and agent responses all land in one place, split into Signal and Noise.
- **Built for speed** — Rust backend, SolidJS frontend, [keyboard-first](https://docs.macro.com/keyboard-shortcuts) everywhere.

# Getting started

[Sign up](https://macro.com/app) and connect your Gmail or Google Workspace account — Macro runs in any modern browser, with an [iOS app](https://apps.apple.com/us/app/macro-app/id6743133649) for your phone. The [getting started guide](https://docs.macro.com/getting-started) takes you from a fresh account to a working setup in about 15 minutes. Coming from Notion, Slack, Superhuman, or Linear? See [Switch to Macro](https://docs.macro.com/switch-to-macro).

Your coding agents can use Macro too. Point Claude Code, Codex, or any MCP client at your workspace:

```bash
claude mcp add --transport http macro https://mcp-server.macro.com/mcp
```

See [MCP setup](https://docs.macro.com/AI/mcp/overview) and [agent recipes](https://docs.macro.com/AI/recipes) for what they can do once connected.

# Docs

Full documentation lives at [docs.macro.com](https://docs.macro.com):

- [Getting started](https://docs.macro.com/getting-started) — setup and the core workflow
- [Key concepts](https://docs.macro.com/concepts/blocks) — blocks, mentions, properties, and permissions
- [Keyboard shortcuts](https://docs.macro.com/keyboard-shortcuts) — the complete reference
- [Agents & MCP](https://docs.macro.com/AI/mcp/overview) — connect AI clients to your workspace
- [FAQ](https://docs.macro.com/faq) — comparisons, licensing, self-hosting, and data questions
- [Changelog](https://docs.macro.com/changelog/introduction) — what shipped each month

The docs are open source too — the site is built from [`docs/`](docs) in this repo.

# About

Macro has raised $30m led by a16z. We are based in NYC.

Core contributors: [@whutchinson98](https://github.com/whutchinson98), [@gbirman](https://github.com/gbirman), [@synoet](https://github.com/synoet), [@sedson](https://github.com/sedson), [@evanhutnik](https://github.com/evanhutnik), [@peterchinman](https://github.com/peterchinman), [@ehayes2000](https://github.com/ehayes2000), [@seanaye](https://github.com/seanaye), [@dev-rb](https://github.com/dev-rb), [@danielkweon](https://github.com/danielkweon), and [@aquaductape](https://github.com/aquaductape).

<a href="https://www.youtube.com/watch?v=hZRin23hRKc">
  <img width="100%" alt="Watch the Macro demo" src="https://img.youtube.com/vi/hZRin23hRKc/maxresdefault.jpg" />
</a>

Want to see it in the wild? Watch [how Desync runs their engineer-heavy company on Macro](https://www.youtube.com/watch?v=fZFIW2toHwk).

# Security

<img width="520" alt="ISO 27001 and SOC 2 Type II badges" src=".github/readme/security-badges.svg" />

Enterprise-grade security. Zero data retention with model providers, including no training on customer data. SOC 2 Type II certified. We welcome responsible security reports and pay bounties in accordance with severity and impact. Send reports to [security@macro.com](mailto:security@macro.com).

# Repository

Macro is developed in this monorepo:

| Directory | Contents |
| --- | --- |
| [`js/`](js) | SolidJS frontend ([`js/app`](js/app)) and TypeScript services |
| [`rust/`](rust) | Rust backend services |
| [`docs/`](docs) | Source for [docs.macro.com](https://docs.macro.com) |
| [`infra/`](infra) | Infrastructure as code |

See [RUNNING_LOCALLY.md](RUNNING_LOCALLY.md) to run the stack on your own machine (a work in progress).

# License

Macro is fully open source — not "open core" — under the GNU Affero General Public License v3.0. See `LICENSE.txt` for details.

You can self-host Macro under the terms of the AGPLv3; the [FAQ](https://docs.macro.com/faq) covers what that involves. If you want to build on top of Macro under a different license, contact [licensing@macro.com](mailto:licensing@macro.com). For managed hosting or commercial arrangements, contact [self-host@macro.com](mailto:self-host@macro.com).

# Community

Have an idea, want to contribute, or want to work on Macro?

- Feature requests: [contact@macro.com](mailto:contact@macro.com)
- Contributions: open a PR, or email [contribute@macro.com](mailto:contribute@macro.com) if you're not sure where to start
- Hiring: [teo@macro.com](mailto:teo@macro.com)

<div align="center">
  <a target="_blank" href="https://macro.com/app">
    <img width="100%" alt="Everything your team needs, connected. Sign up." src=".github/readme/Footer Readme CTA.png" />
  </a>
</div>
