# Probing an MCP server's OAuth

How to find out, from the live server, how Macro Connect gets an OAuth client
for it. Used when adding an app (`connect-add-app`) and by the nightly prober.

## Steps

Use `curl -sS -m10`. Record every URL you fetch.

1. **Find the server.** The vendor's own MCP URL, from the vendor's docs or
   developer site. A server hosted by anyone other than the vendor is not a
   candidate.
2. **Trigger the challenge.** POST an MCP `initialize` request (a bare `{}`
   is rejected by some servers, e.g. Apollo):

   ```sh
   curl -sS -m10 -i -X POST "$MCP_URL" \
     -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"macro-connect-probe","version":"0"}}}'
   ```

   Read `WWW-Authenticate` for `resource_metadata`. Some servers only
   challenge on `tools/call` (Google), so a 200 here is not "no auth".
3. **Protected-resource metadata.** Fetch `resource_metadata`, or
   `<origin>/.well-known/oauth-protected-resource<path>`, then the same at the
   origin root (Apify publishes only there). Note `authorization_servers`,
   `scopes_supported`, and whether `resource` equals the MCP URL (Raindrop's
   does not).
4. **Authorization-server metadata.** For each authorization server fetch
   `/.well-known/oauth-authorization-server` (path-style per RFC 8414 when the
   issuer has a path, as Airtable's does), then `/.well-known/openid-configuration`.
5. **Classify** by what step 4 advertises:

   | Metadata | `client_registration` |
   | --- | --- |
   | `client_id_metadata_document_supported: true` | `cimd` (also `dcr` if below) |
   | `registration_endpoint` | `dcr` |
   | neither | `own_app`: Macro Connect must register an OAuth app with the vendor |

   Also note `token_endpoint_auth_methods_supported` (`none` means public
   clients are allowed; some servers only register confidential clients).
6. **Check for a gate the metadata hides.** Search the vendor's docs and
   forums for a client allowlist (Figma and Vercel advertise DCR but reject
   unapproved clients), licence requirements (Microsoft Agent 365), per-region
   URLs (Datadog), and admin enablement (Box, Atlassian domain allowlists).

## Done when

The app has a `client_registration` value backed by the fetched metadata, the
fetched URLs are listed, and any gate from step 6 is recorded. Probing alone
does not prove a connection works; conformance (a real sign-in, refresh, tool
list, and one read-only call) does.
