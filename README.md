
<div align="center">
  <a target="_blank" href="https://macro.com">
    <img width="2195" height="721" alt="Frame 11" src="https://github.com/user-attachments/assets/50405352-785e-4984-b24f-544e89731acb" />
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


Macro is the all-in-one workspace that combines email, messages, docs, tasks, code, agents, calls, and CRM into a single fast interface. With shared team-level memory, everything in your workspace is @linked and queryable, so you and your agents never lose context.

Macro has raised $30m led by a16z. We are based in NYC.


## Features

Full documentation lives at [docs.macro.com](https://docs.macro.com):
 
- **[Email](https://docs.macro.com/product/email):** the fastest, smartest email client. The best of Superhuman, Gmail, and Outlook in one keyboard-first inbox. Multi-account, unified, with shared inboxes.
- **[Messages](https://docs.macro.com/product/channels):** team chat built for focused deep work. Channels and DMs for focused technical discussions.
- **[Tasks](https://docs.macro.com/product/tasks):** keyboard-first tasks built around chat messages that agents can close. Nothing stranded elsewhere.
- **[Docs](https://docs.macro.com/product/docs):** collaborative, version-controlled, markdown-native docs built for agents. Real-time and built on CRDTs.
- **[Canvas](https://docs.macro.com/product/canvas):** 2D board with embedded @links to tasks, files, and emails.
- **[Agents](https://docs.macro.com/product/agents):** unified team-level memory, the most knowledgeable "person" at your company. Takes action on your behalf.
- **[Calls](https://docs.macro.com/product/calls):** recorded, transcribed, and logged to team memory.
- **[File storage](https://docs.macro.com/product/folders):** auto-imported from email and channels, fully searchable.
- **[Pull requests](https://docs.macro.com/integrations/github):** linked to tasks, embeddable in channels, available to agents.
- **[CRM](https://docs.macro.com/product/crm):** contact objects, custom properties, email sync, enrichment.

  
### A few ideas make the blocks work as one system:
 
- **[Bidirectional @linking](https://docs.macro.com/concepts/mentions):** @mention a doc in a message and both know about each other. Your workspace becomes a web of context you can navigate in either direction.
- **[Channel-based permissions](https://docs.macro.com/permissions):** anything you @mention in a channel is automatically shared with its members. Join a channel, gain access; leave, lose it. No permission-request dance.
- **[Unified memory](https://docs.macro.com/product/unified-memory):** agents remember what your whole team is doing across email, messages, tasks, docs, and calls, not just your own chat history. Refreshed nightly.
- **[One inbox](https://docs.macro.com/product/inbox):** emails, channel messages, task assignments, @mentions, and agent responses all land in one place, split into Signal and Noise.
- **Built for speed:** Rust backend, SolidJS frontend, [keyboard-first](https://docs.macro.com/keyboard-shortcuts) everywhere.

### Additional Resources:

- [Getting started](https://docs.macro.com/getting-started): setup and the core workflow
- [Key concepts](https://docs.macro.com/concepts/blocks): blocks, mentions, properties, and permissions
- [Keyboard shortcuts](https://docs.macro.com/keyboard-shortcuts): the complete reference
- [Agents & MCP](https://docs.macro.com/AI/mcp/overview): connect AI clients to your workspace
- [FAQ](https://docs.macro.com/faq): comparisons, licensing, self-hosting, and data questions
- [Changelog](https://docs.macro.com/changelog/introduction): what shipped each month


## Getting started
 
[Sign up](https://macro.com/app) and connect your Gmail or Google Workspace account. Macro runs in any modern browser, with an [iOS app](https://apps.apple.com/us/app/macro-app/id6743133649) for your phone. The [getting started guide](https://docs.macro.com/getting-started) takes you from a fresh account to a working setup in about 15 minutes. Coming from Notion, Slack, Superhuman, or Linear? See [Switch to Macro](https://docs.macro.com/switch-to-macro).
 
## Agents & MCP
 
Your coding agents can use Macro too. Point Claude Code, Codex, or any MCP client at your workspace:
 
```bash
claude mcp add --transport http macro https://mcp-server.macro.com/mcp
```
 
See [MCP setup](https://docs.macro.com/AI/mcp/overview) and [agent recipes](https://docs.macro.com/AI/recipes) for what they can do once connected.

 
## Repository
 
| Directory | Contents |
| --- | --- |
| [`js/`](js) | SolidJS frontend ([`js/app`](js/app)) and TypeScript services |
| [`rust/`](rust) | Rust backend services |
| [`docs/`](docs) | Source for [docs.macro.com](https://docs.macro.com) |
| [`infra/`](infra) | Infrastructure as code |
 
See [RUNNING_LOCALLY.md](RUNNING_LOCALLY.md) to run the stack locally (work in progress).
 
# Security

<img width="520" alt="ISO 27001 and SOC 2 Type II badges" src=".github/readme/security-badges.svg" />

Enterprise-grade security. Zero data retention with model providers, including no training on customer data. SOC 2 Type II certified. We welcome responsible security reports and pay bounties in accordance with severity and impact. Send reports to [security@macro.com](mailto:security@macro.com).

# License

Macro is fully open source — not "open core" — under the GNU Affero General Public License v3.0. See `LICENSE.txt` for details.

You can self-host Macro under the terms of the AGPLv3; the [FAQ](https://docs.macro.com/faq) covers what that involves. If you want to build on top of Macro under a different license, contact [licensing@macro.com](mailto:licensing@macro.com). For managed hosting or commercial arrangements, contact [self-host@macro.com](mailto:self-host@macro.com).

# Community

Have an idea, want to contribute, or want to work on Macro?

- Feature requests: [contact@macro.com](mailto:contact@macro.com)
- Contributions: open a PR, or email [contribute@macro.com](mailto:contribute@macro.com) if you're not sure where to start
- Hiring: [teo@macro.com](mailto:teo@macro.com)
