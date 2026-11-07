# Service URL crates

## What it is

Shared infrastructure: one crate per typed Macro service URL, plus
`service_url` (the macro and override reader). A crate that calls a service
depends on that URL's crate only, so changing one URL rebuilds its users
instead of every crate that knows any URL. `crates/macro_service_urls`
re-exports all of them and keeps the `ServiceUrls` collection.

## Recipes

- Add a service URL: copy a sibling crate (Cargo.toml, `src/lib.rs`,
  `AGENTS.md`, `CLAUDE.md` symlink), add it to the root `members`, re-export it
  and add its field to `ServiceUrls` in `crates/macro_service_urls/src/lib.rs`,
  add a parse test there, then update the other copies of the URL table (see
  the rule).
- Use a URL: depend on its crate (`app_service_url = { path = ... }`) and
  call `AppServiceUrl::new()`, not `macro_service_urls`.

## Checks

- `cargo test -p macro_service_urls` covers every URL's defaults and overrides.

## Crates

| Crate | Type |
| --- | --- |
| `service_url` | `service_url!`, `ServiceUrl`, `ServiceUrlVarErr` |
| `app_service_url` | `AppServiceUrl` |
| `auth_service_url` | `AuthServiceUrl` |
| `document_storage_service_url` | `DocumentStorageServiceUrl` |
| `convert_service_url` | `ConvertServiceUrl` |
| `search_processing_service_url` | `SearchProcessingServiceUrl` |
| `connection_gateway_url` | `ConnectionGatewayUrl` |
| `connection_gateway_websocket_url` | `ConnectionGatewayWebsocketUrl` |
| `document_cognition_service_url` | `DocumentCognitionServiceUrl` |
| `notification_service_url` | `NotificationServiceUrl` |
| `static_file_service_url` | `StaticFileServiceUrl` |
| `static_file_public_url` | `StaticFilePublicUrl` |
| `agent_harness_service_url` | `AgentHarnessServiceUrl` |
| `scheduled_action_service_url` | `ScheduledActionServiceUrl` |
| `agent_harness_egress_url` | `AgentHarnessEgressUrl` |
| `mcp_service_url` | `McpServiceUrl` |
| `mcp_public_url` | `McpPublicUrl` |
| `cognition_public_url` | `CognitionPublicUrl` |
| `connect_api_url` | `ConnectApiUrl` |
| `unfurl_service_url` | `UnfurlServiceUrl` |
| `contacts_service_url` | `ContactsServiceUrl` |
| `email_service_url` | `EmailServiceUrl` |
| `calendar_service_url` | `CalendarServiceUrl` |
| `image_proxy_service_url` | `ImageProxyServiceUrl` |
| `lexical_service_url` | `LexicalServiceUrl` |
| `sync_service_url` | `SyncServiceUrl` |
| `ai_editing_worker_url` | `AiEditingWorkerUrl` |
| `preview_gateway_url` | `PreviewGatewayUrl` |

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Docs: `docs/guides/new-service.md`
