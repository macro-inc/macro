//! Internal MCP tools. Session identity comes from egress authentication, never tool arguments.
use crate::domain::{AgentIdentity, PreviewService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use axum::Router;
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::{
    ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Content, ListToolsResult, PaginatedRequestParams,
        ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext as McpContext,
    transport::{
        StreamableHttpService,
        streamable_http_server::{StreamableHttpServerConfig, session::local::LocalSessionManager},
    },
};
use rootcause::compat::anyhow1::IntoAnyhow;
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

/// Shell functions appended only for local stacks that published a quick tunnel.
///
/// Cloudflare's edge proxies HTTP ports only, so a raw SSH dial to the minted
/// hostname is dropped: the stream has to be wrapped in a WebSocket, which is
/// what `cloudflared access ssh` does as an OpenSSH `ProxyCommand`. That helper
/// therefore has to exist on the agent's machine, so fetch it when missing. Its
/// directory is deliberately not cleaned up: the backgrounded `ssh` keeps
/// `cloudflared` as a child for the life of the tunnel.
const PROXY_SUPPORT: &str = r#"preview_cloudflared() {
if command -v cloudflared >/dev/null 2>&1; then return 0; fi
preview_arch=$(uname -m)
case "$preview_arch" in
  x86_64|amd64) preview_arch=amd64 ;;
  aarch64|arm64) preview_arch=arm64 ;;
  *) printf '%s\n' "no cloudflared build for $preview_arch" >&2; return 1 ;;
esac
preview_os=$(uname -s | tr '[:upper:]' '[:lower:]')
preview_bin=$(mktemp -d)
curl -fsSL --max-time 120 -o "$preview_bin/cloudflared" \
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-$preview_os-$preview_arch" || return 1
chmod +x "$preview_bin/cloudflared"
PATH="$preview_bin:$PATH"
export PATH
}
preview_connect_proxy() {
preview_cloudflared || return 1
ssh -F /dev/null -fNT \
  -o BatchMode=yes \
  -o PubkeyAuthentication=no \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o StrictHostKeyChecking=yes \
  -o HostKeyAlgorithms=ssh-ed25519 \
  -o UserKnownHostsFile="$preview_known_hosts" \
  -o GlobalKnownHostsFile=/dev/null \
  -o ControlMaster=no \
  -o ControlPath=none \
  -o ConnectTimeout=30 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -o ProxyCommand="cloudflared access ssh --hostname $1" \
  -R 127.0.0.1:1:127.0.0.1:PREVIEW_LOCAL_PORT \
  -p 22 -l 'PREVIEW_TOKEN' "$1"
}
"#;

/// The name `ssh` looks up in `known_hosts`: bracketed only on a non-default port.
fn known_hosts_name(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_owned()
    } else {
        format!("[{host}]:{port}")
    }
}

/// Authenticated session context; constructed per request, never shared across agents.
#[derive(Clone)]
pub struct PreviewToolContext {
    service: PreviewService,
    identity: AgentIdentity,
}
/// Expose the current agent's local HTTP server as an entity-authorized live preview.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "SharePreview",
    description = "Share a running local HTTP development server with viewers of this agent session. Returns a shell script: execute it in the same machine/container as the server. Requires only OpenSSH, no helper or client key. Supports HTTP, WebSocket and HMR. The preview appears in Macro once reachable. Keep the dev server running; edits remain live. Call again to reconnect after the tunnel ends. Do not publish credentials or the script in a chat message."
)]
pub struct SharePreview {
    /// The local HTTP server port, such as 3000 or 5173.
    #[schemars(description = "Port of the running local HTTP server (1 through 65535).")]
    pub port: u16,
}
impl ToolAnnotated for SharePreview {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Share live preview");
}
#[async_trait::async_trait]
impl AsyncTool<PreviewToolContext> for SharePreview {
    type Output = serde_json::Value;
    async fn call(
        &self,
        context: ServiceContext<PreviewToolContext>,
        _: RequestContext,
    ) -> ToolResult<Self::Output> {
        let share = context
            .service
            .share(context.identity.clone(), self.port)
            .await
            .map_err(|e| ai_toolset::ToolCallError {
                description: e.to_string(),
                internal_error: rootcause::report!(e).into_anyhow(),
            })?;
        let settings = context.service.settings();
        // Endpoints are tried in order until one connects: the agent may share this
        // machine, the Docker network, or neither. Each contributes its own
        // known_hosts name, because all of them reach the same pinned host key.
        let mut endpoints = vec![(
            known_hosts_name(&settings.ssh_host, settings.ssh_port),
            format!(
                "preview_connect '{}' {}",
                settings.ssh_host, settings.ssh_port
            ),
        )];
        if settings.local_ssh_fallback {
            endpoints.push((
                known_hosts_name("preview-gateway", 2222),
                "preview_connect preview-gateway 2222".to_owned(),
            ));
        }
        if let Some(proxy) = &settings.ssh_proxy_host {
            // Cloudflare's edge only proxies HTTP ports, so the quick tunnel is
            // reached over a WebSocket ProxyCommand rather than a TCP dial.
            endpoints.push((
                known_hosts_name(proxy, 22),
                format!("preview_connect_proxy '{proxy}'"),
            ));
        }
        let known_host = endpoints
            .iter()
            .map(|(name, _)| format!("{name} {}", settings.host_key))
            .collect::<Vec<_>>()
            .join("\n");
        let connect = endpoints
            .iter()
            .map(|(_, call)| call.as_str())
            .collect::<Vec<_>>()
            .join(" || ");
        let proxy_support = if settings.ssh_proxy_host.is_some() {
            PROXY_SUPPORT
                .replace("PREVIEW_LOCAL_PORT", &share.port.to_string())
                .replace("PREVIEW_TOKEN", &share.token)
        } else {
            String::new()
        };
        // Every interpolated field is validated at startup or generated locally; no shell input from the model.
        let script = format!(
            r#"#!/bin/sh
set -eu
umask 077
preview_known_hosts=$(mktemp)
trap 'rm -f "$preview_known_hosts"' EXIT HUP INT TERM
cat > "$preview_known_hosts" <<'MACRO_PREVIEW_HOST_KEY'
{known_host}
MACRO_PREVIEW_HOST_KEY
preview_connect() {{
ssh -F /dev/null -fNT \
  -o BatchMode=yes \
  -o PubkeyAuthentication=no \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o StrictHostKeyChecking=yes \
  -o HostKeyAlgorithms=ssh-ed25519 \
  -o UserKnownHostsFile="$preview_known_hosts" \
  -o GlobalKnownHostsFile=/dev/null \
  -o ControlMaster=no \
  -o ControlPath=none \
  -o ConnectTimeout=10 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:1:127.0.0.1:{port} \
  -p "$2" -l '{token}' "$1"
}}
{proxy_support}{connect}
printf '%s\n' 'Preview tunnel connected. Keep the local server running; Macro shows the preview once HTTP is reachable.'
"#,
            port = share.port,
            token = share.token
        );
        Ok(
            serde_json::json!({ "preview": share.preview, "script": script, "instructions": "Execute this shell script within 120 seconds on the machine running the local server. The gateway forwards the root path unchanged and rewrites Host to localhost. If the app hardcodes a browser-facing localhost URL, configure its public origin. The tunnel expires after one hour or 15 minutes without browser requests. Do not print the script in your final response." }),
        )
    }
}
#[derive(Clone)]
struct Mcp(PreviewService);
impl Mcp {
    async fn identity(
        &self,
        context: &McpContext<rmcp::RoleServer>,
    ) -> Result<AgentIdentity, rmcp::ErrorData> {
        let token = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|p| p.headers.get(axum::http::header::AUTHORIZATION))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|v| v.len() <= 256)
            .ok_or_else(|| {
                rmcp::ErrorData::invalid_request("agent session authentication required", None)
            })?;
        self.0.agent(token).await.map_err(|_| {
            rmcp::ErrorData::invalid_request("agent session authentication failed", None)
        })
    }
}
impl ServerHandler for Mcp {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info =
            rmcp::model::Implementation::new("macro-preview", env!("CARGO_PKG_VERSION"));
        info.instructions = Some("Use SharePreview to share a local development server with viewers of the current Macro session. Execute the returned SSH script, then continue editing; WebSocket hot reload is forwarded automatically. Credentials must stay in tool execution, never final messages.".into());
        info
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        context: McpContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        self.identity(&context).await?;
        let schema = schemars::schema_for!(SharePreview);
        let value = serde_json::to_value(schema)
            .map_err(|_| rmcp::ErrorData::internal_error("tool schema unavailable", None))?;
        let object = value
            .as_object()
            .cloned()
            .ok_or_else(|| rmcp::ErrorData::internal_error("tool schema unavailable", None))?;
        Ok(ListToolsResult {
            tools: vec![Tool::new(
                "SharePreview",
                "Share a local HTTP development server with this session's viewers. Execute the returned OpenSSH script to connect it; supports WebSockets and HMR.",
                Arc::new(object),
            )],
            ..Default::default()
        })
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: McpContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let identity = self.identity(&context).await?;
        if request.name != "SharePreview" {
            return Err(rmcp::ErrorData::invalid_params(
                "unknown preview tool",
                None,
            ));
        }
        let tool: SharePreview = serde_json::from_value(serde_json::Value::Object(
            request.arguments.unwrap_or_default(),
        ))
        .map_err(|_| rmcp::ErrorData::invalid_params("expected {port: 1..65535}", None))?;
        let user = MacroUserIdStr::try_from(identity.owner.clone())
            .map_err(|_| rmcp::ErrorData::internal_error("session owner invalid", None))?;
        let result = tool
            .call(
                ServiceContext(PreviewToolContext {
                    service: self.0.clone(),
                    identity,
                }),
                RequestContext::new(user),
            )
            .await;
        Ok(match result {
            Ok(value) => CallToolResult::success(vec![Content::text(value.to_string())]),
            Err(error) => CallToolResult::error(vec![Content::text(error.to_string())]),
        })
    }
}
/// Build a stateless MCP server: every tool request authenticates its session credential.
pub fn router(service: PreviewService, allowed_hosts: Vec<String>) -> Router {
    let mut config = StreamableHttpServerConfig::default().with_allowed_hosts(allowed_hosts);
    config.stateful_mode = false;
    config.json_response = true;
    let transport = StreamableHttpService::new(
        move || Ok(Mcp(service.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    Router::new().nest_service("/mcp", transport)
}

#[cfg(test)]
mod test;
