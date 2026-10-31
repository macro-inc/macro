# Test accounts

Real consents run in Connect's browser as `connect@macro.com`, signing in to
each vendor with Google. Each vendor gets its own free test workspace or
organization created by that account.

- Never join Macro's own workspaces: vendors offer them because the account
  is on `macro.com`, and joining adds a member (often a paid seat) and grants
  Connect access to company data. Choose "create new workspace" and turn off
  domain auto-join.
- Grant the narrowest access the consent screen offers (read-only where it
  is a choice), and call only read tools in checks.

| App | Test workspace | Created |
| --- | --- | --- |
| Linear | workspace "Macro Connect Test" (`linear.app/macro-connect-test`, EU region, domain access off) | 2026-10-31 |
| Notion | personal space "connect macro's Space" (Free) | 2026-10-31 |
| PostHog | organization "Macro Connect Test", US Cloud | 2026-10-31 |
| Sentry | organization `macro-connect-test`, US | 2026-10-31 |

The dev integration customer's key is `CONNECT_IT_CUSTOMER_KEY` and the demo
customer's is `CONNECT_DEMO_CUSTOMER_KEY`, both in Doppler `connect/dev`.
