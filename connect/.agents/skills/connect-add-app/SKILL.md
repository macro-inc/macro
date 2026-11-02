---
name: connect-add-app
description: Add or re-check an app in the Macro Connect catalog. Use when adding a vendor's MCP server to `connect/registry/`, refreshing an app's OAuth classification, or writing its catalog description or icon.
---

# Add an app to the catalog

The catalog spec is `connect/docs/catalog.md`; read it first.

1. **Confirm it is first-party.** The vendor itself hosts the MCP server, per
   its own docs or developer site. A third-party or community server stops
   here: report it, add nothing.
2. **Probe** the server with `connect/docs/probing.md`, all six steps. Keep
   the fetched URLs.
3. **Set `client_registration`** from the probe. For `own_app`, open or update
   `connect/submissions/<vendor>.md` and set `status = "pending"`; the app
   goes live when that record reaches `approved`.
4. **Write `app.toml`.** `description` comes from the server's `tools/list`
   (fetch it unauthenticated where the server allows, otherwise from the
   vendor's tool reference): one line of plain verbs.
5. **Add `icon.svg`** per the spec.
6. **Run conformance** for `live` apps once it exists: sign in with the
   vendor's test account, refresh, list tools, one read-only call. Until then,
   say in the pull request that the app is probed but not conformance-tested.
7. **Commit** on a feature branch with the probed URLs in the commit body.

Done when `app.toml` and `icon.svg` exist, `client_registration` is backed by
fetched metadata, and an `own_app` app has a submission record with a next
action.
