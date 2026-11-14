# slack-linked

## What it is

Slack web-client sessions linked per workspace (External tab → Slack): sign
in, list each workspace's **Slack Connect** conversations (channels shared with
other organizations, DMs with people outside), and add one as its own
shareable external chat (`POST /external-chats` with `provider: 'slack'`).
Behind the `enable-slack-linked` flag. Architecture:
`docs/architecture/slack-linked.md`.

## Start here

- `slack-linked.tsx`: production wiring (shared queries + split navigation).
- `context/slack-linked-context.tsx`: the capability contract tests fake
  (`tests/fake-capabilities.ts`).
- `slack-linked-page.tsx`: the page's entry. It holds the state
  (`primitives/slack-page.ts`) and is the one device switch (FE-70): desktop
  `views/slack-page.tsx` (sticky search, each row's kind and last activity),
  touch `views/mobile/slack-page.tsx` (rows keep to the name and status;
  phones show the add buttons as icons). Both render
  `views/shared/slack-page-parts.tsx`: accounts (Connect card, session-ended
  cards, one workspace strip per signed-in workspace), the catalogue grouped
  by workspace, disconnect, and the sign-in dialog.
- `primitives/sign-in-flow.ts` + `components/sign-in-dialog.tsx`: sign-in.
  Email and Slack's emailed code first (web, desktop, phones); Slack's own page
  in a Macro desktop window for SSO workspaces (`finish_on_desktop`) and
  Slack's captcha; "Paste token and cookie" under Advanced. Server steps come
  from DSS's `SlackLogin` (`GET /slack-linked/login/{id}`, polled only while
  `working`); each answer returns the next step.
- `queries/desktop.ts`: the desktop commands `slack_desktop_sign_in` and
  `slack_desktop_captcha` (`apps/web/tauri/src-tauri/src/slack_desktop.rs`),
  and the `macro:///external?slackLogin=<id|browser>` handoff a computer's
  browser shows (phones, tablets and the mobile apps get none).
- `core/`: account states and ended-reason words, sign-in input checks and
  failure words, catalogue grouping and add failures.

## Scope

- Owns: the Slack page, the sign-in dialog, one-click add.
- Not here: chat timeline and sending (`features/external-chat`, which also
  holds the provider registry entry `providers/slack/`); the External shell
  (`features/external-view`); HTTP (`lib/service-clients/service-storage/
  slack-linked.ts`); shared queries (`lib/queries/slack-linked`); DSS routes
  (`crates/slack_linked`).

## Gotchas

- External mounts the page through `features/external-view/provider-pages.tsx`,
  which reads `?slackLogin=<uuid|browser>` once (the route keeps it as an
  external search key) and opens External on the Slack page.
- Sign-in material (emails, codes, tokens, cookies) stays in the
  `ph-no-capture` dialog and the never-persisted, `gcTime: 0` login query;
  never in a URL (handoffs carry only the attempt id), a log or a span.
- v1 lists Slack Connect conversations only; DSS filters, the page never does.
  A conversation several workspaces see shows once, under the first live one.
- Disconnect asks whether to sign the session out of Slack: a pasted session
  may be the person's own browser session.
- Closing the dialog cancels an attempt still waiting on the person; a handoff
  to desktop does not.

## Checks

- `bunx vitest run --project app src/features/slack-linked`
- `bun run test:functional -- 'slack-linked.spec.ts$'`

## Related

- Rules: `.agents/rules/web/architecture.md` (FE-33) · Docs:
  `docs/agent-guide/external.md`
