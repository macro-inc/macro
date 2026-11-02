---
vendor: xero
apps: [xero_accounting_api]
state: drafting
portal: https://developer.xero.com/app/manage
account: connect@macro.com
submitted:
last_contact:
next_action: Human approves the Core plan (AUD$35/month, card on file) and supplies the redirect host; the agent then creates the PKCE app
next_action_owner: human
due: 2026-11-02
---

## Requirements

No DCR or CIMD on either Xero endpoint (probed). Xero has no app review for
this path: the gate is the paid Core plan.

**Endpoint mismatch:** Xero's docs name `https://api.xero.com/mcp/v1` as the
Remote MCP server for custom clients. The registry and research use
`https://mcp.xero.com/mcp`, which serves a different, read-only scope set and
appears to be the server behind Xero's own Claude connector. The registry
entry should be re-probed and moved to `api.xero.com/mcp/v1`.

- [ ] **Account:** Xero developer account as `connect@macro.com`.
  ([Developer portal](https://developer.xero.com/app/manage))
- [ ] **App type:** app with the **Auth Code with PKCE** grant (public client,
  no client secret); Custom Connections apps are not eligible; single-page
  apps unsupported.
  ([Remote MCP overview](https://developer.xero.com/documentation/guides/remote-mcp/overview/),
  [Remote MCP FAQ](https://developer.xero.com/faq/remote-mcp),
  [PKCE flow](https://developer.xero.com/documentation/guides/oauth2/pkce-flow))
- [ ] **App fields:** app name, integration type, company or application URL
  (HTTPS), redirect URIs (HTTPS, no custom schemes, up to 50).
  ([Remote MCP overview](https://developer.xero.com/documentation/guides/remote-mcp/overview/),
  [auth flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/))
- [ ] **Required pages:** none required for Core. A Xero App Store listing is
  not applicable to Core.
  ([Pricing](https://developer.xero.com/pricing))
- [ ] **Domain verification:** none found.
- [ ] **Demo video:** not required for Core.
- [ ] **Certification and security assessment:** not required for Core; Plus
  (1,000 connections) requires App Certification (eight checkpoints); Advanced
  and Enterprise also require an annual security self-assessment.
  ([Pricing](https://developer.xero.com/pricing),
  [certification checkpoints](https://developer.xero.com/documentation/xero-app-store/app-partner-guides/certification-checkpoints))
- [ ] **Reviewer SLA:** none for Core (no review).
- [ ] **User cap before approval:** Starter (free, 5 connections) reaches Remote
  MCP only with the Xero demo organisation; real customer organisations need
  Core or above. Core caps at 50 connections (Macro has 15 today).
  ([Remote MCP FAQ](https://developer.xero.com/faq/remote-mcp),
  [Pricing](https://developer.xero.com/pricing))
- [ ] **Costs:** Core AUD$35/month (tax excl.), 10 GB egress, AUD$2.40/GB over;
  payment card required to move Starter to Core (human gate). Plus AUD$245/month.
  ([Pricing](https://developer.xero.com/pricing))
- [ ] **Developer terms:** accept Xero's developer terms when creating the app
  (human gate).
- [ ] **Rate limits:** 5,000 calls/day per organisation on Core.
  ([Remote MCP FAQ](https://developer.xero.com/faq/remote-mcp))

## Scopes

From `https://api.xero.com/.well-known/oauth-protected-resource/mcp/v1`
(2026-10-30); authorization server `https://identity.xero.com`. Xero maps each
tool to one scope; the agent can only call tools whose scopes the grant holds.
Xero does not review scopes, so the split below is about least privilege, not
review speed.

**Base:**

- `offline_access`: refresh tokens, so connections survive the 30-minute
  access token.
- `openid`: identifies the Xero user for the connection record.
  (`profile` and `email` are not requested; Macro Connect needs no personal data.)

**Read (request now):**

- `accounting.invoices.read`: list invoices, credit notes, items, quotes.
- `accounting.contacts.read`: list contacts.
- `accounting.payments.read`: list payments.
- `accounting.banktransactions.read`: list bank transactions.
- `accounting.manualjournals.read`: list manual journals.
- `accounting.settings.read`: chart of accounts, tax rates, organisation details.
- `accounting.reports.profitandloss.read`, `accounting.reports.balancesheet.read`,
  `accounting.reports.trialbalance.read`, `accounting.reports.aged.read`: reports.

**Write (only if Macro exposes write tools; Xero's server does not ask users
to confirm writes):**

- `accounting.invoices`, `accounting.contacts`, `accounting.payments`,
  `accounting.banktransactions`, `accounting.manualjournals`,
  `accounting.settings`: the matching create, update, and void tools.

NEEDS-HUMAN: read-only or read-write for v1.

## Draft

| Field | Value |
| --- | --- |
| App name | Macro Connect |
| Integration type / grant | Auth Code with PKCE |
| Company or application URL | NEEDS-HUMAN: Macro Connect landing page URL |
| Redirect URI | NEEDS-HUMAN: `connect_api` production host and callback path |
| Plan | Core (AUD$35/month); NEEDS-HUMAN: approve the spend and add the card |
| Scopes | Base + read list above; write list pending the decision above |
| MCP URL for the registry | `https://api.xero.com/mcp/v1` |
| Developer terms | NEEDS-HUMAN: accept Xero developer terms |

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Requirements, scopes, and draft filled from Xero's Remote MCP
  overview, FAQ, and pricing pages, and live metadata of both endpoints. Found
  that the documented endpoint is `api.xero.com/mcp/v1`, not `mcp.xero.com/mcp`.
  Nothing submitted.
