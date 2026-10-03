# Support

Support is a team workspace at `/support`, also available through the sidebar (`g u`) and split components. Customer tickets have their own lifecycle: Open, In progress, Waiting on customer, Waiting on team, and Resolved. New customer messages reopen a ticket; public teammate and agent replies move it to Waiting on customer. Internal notes do not change the customer lifecycle. Manually created tickets track customer issues with internal notes; public replies require a website or email conversation, and their agent output stays in draft form.

The left panel provides Open, Assigned to me, Unassigned, High priority, Recent activity, Resolved, and All tickets. The main inbox searches subject, customer, company, and message preview. Lists page in batches of 100; use Load more for larger backlogs. Conversation reads show the latest 200 messages. Tickets support assignment, priority, resolution/reopening, and pausing the agent per ticket.

## Tasks, CRM, and references

Create a team-shared Macro Task or link an existing team-shared Task by document ID from a ticket. Each ticket may link up to 20 Tasks. Open linked Tasks in the normal Markdown/Task surface. Completing or deleting a Task does not resolve or delete its ticket. New Tasks include a tracked Macro reference to the canonical Support conversation.

New intake resolves the customer's email through the owning CRM service in the team's scope, respecting CRM visibility and its killswitch. This association supplies internal customer context, never access to previous conversations for a visitor who merely provides the same email. Company and contact records have a Support history tab; a ticket opens its linked company in CRM. CRM opens preserve the selected ticket and company/contact scope in pane-local router state. Shared `/support?ticket=<id>&companyId=<id>&contactId=<id>` links initialize that same scope; each Support pane keeps its own scope.

The production composer and transcript use Macro's shared Markdown editor and renderer. Canonical channel posts go through the existing message command boundary, preserving mentions, references, and backlinks. Use Conversation & references to open that channel. Customer replies are sent from Support so their public/private classification is explicit; ordinary channel posts are internal workspace communication and are not automatically forwarded to visitors or email.

## Support agent

A team admin configures one Support agent: name, system prompt, curated public knowledge, enablement, minimum confidence, and response mode. Modes are human-reviewed drafts, immediate automatic replies, waiting for a human response (default five minutes), or confidence-gated replies. Every automatic mode applies the minimum confidence and handoff checks; low-confidence or handoff answers remain drafts. Confidence is a model estimate, not a calibrated probability.

Generation uses Macro's existing agent completion and metered usage infrastructure. Only public ticket history and explicitly supplied public knowledge enter generation. Durable jobs retry up to five attempts, run with bounded concurrency, and recheck current configuration, latest customer trigger, human response, ticket state, and pause state before sending. A changed human-response window reschedules the job. Acknowledging an older trigger cannot remove a newer job. Failed attempts are logged and retain their durable job record.

## Website chat and email

An admin enables Website chat, sets a welcome message and exact allowed HTTPS origins, and copies the embed script in Channels & installation. HTTP is allowed for localhost development. Install the snippet near the end of the website's body. Visitor sessions expire after 30 days, are scoped to their origin and ticket, and persist through the widget's local storage. Server storage contains token hashes. Intake and polling are rate limited. The widget displays safe text; internal notes, email identities, agent drafts, and rich Macro reference payloads are not included in visitor responses.

For email, select an active connected Macro inbox and enter the support address or receiving alias that delivers to it. New incoming messages to that exact address become tickets; sent mail and drafts are excluded. Intake begins when configured, without importing the historic inbox. Public replies use the original email thread through the existing scheduled delivery pipeline. Stable request bindings prevent duplicate sends on retries. Changing the connected inbox does not grant access to old threads in another inbox.

Existing support auto-channels are not migrated. SMS is not included. Actual email delivery and AI generation require the existing inbox connection, delivery queue, and provider credentials. This change adds a database migration and starts the Support worker with DSS; it does not deploy those changes.

## Verification and sample workspace

From the repository root, use a migrated local Postgres database and run `cargo test -p support` and `cargo test -p email --all-features` with `DATABASE_URL` set and `SQLX_OFFLINE` unset. Run `just prepare_db` to regenerate root SQLx metadata, `just hakari` after manifest changes, and `just check` for local formatting and code rules.

From `apps/web`, run:

```sh
bunx vitest run src/features/support/navigation.test.ts src/features/support/core/types.test.ts src/features/crm/core/record.test.ts src/features/crm/views/record-detail.test.tsx src/features/crm/architecture.test.ts
bun run type-check
bun run build
bunx playwright test --config src/features/support/browser-test/playwright.config.ts
```

The browser test launches a standalone sample workspace using the production Support view and fixture adapters. It exercises queue/search, preserved composer drafts, notes, independent Task completion, replies/resolution, agent configuration, embed installation, and a customer using the actual widget script. Email delivery and AI inference are not live in this fixture demo. The widget's closed shadow root is opened only in the test to enable browser assertions. The PR's downloadable MP4 records that workflow.
