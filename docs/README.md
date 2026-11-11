# Docs

| Directory | Contents |
| --- | --- |
| [`development/`](development/) | How to build, run, test, and style code in this repository. |
| [`guides/`](guides/) | End-to-end walkthroughs: adding a service, entity, block, and more. |
| [`architecture/`](architecture/) | How shipped systems work today. |
| [`design/`](design/) | Proposals, plans, and audits; check each doc's status. |
| [`runbooks/`](runbooks/) | Rollouts, migrations, imports, demos, and the response steps that prod alerts link to. |
| [`agent-guide/`](agent-guide/) | How browser agents operate the app, not how to develop it. |

Docs that belong to one app, service, or crate live next to its code.

External chats: [architecture](architecture/external-chats.md), its WhatsApp
provider ([linked devices](architecture/whatsapp-linked-devices.md)) and the
[External view walkthrough](agent-guide/external.md).

Document sync: [DSS sync router](architecture/sync-router.md).

Contacts: [disk-backed directory implementation plan](design/disk-backed-contacts.md),
[approved name-focused search design](design/contact-name-search-proposal.md) (implementation in progress).

Agent guidance per SDK area: [`@routing` and `@agent`](architecture/agent-sdk-guidance.md).

MCP servers: [public MCP and the ChatGPT server](architecture/mcp-surfaces.md).

Bots: [building a bot](guides/bots.md) (set one up in the app, then search and
post from the TypeScript SDK).

Agent session activity: [correlation and visibility](architecture/agent-activity-correlation.md).
