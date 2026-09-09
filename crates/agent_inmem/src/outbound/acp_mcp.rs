//! Dialing the HTTP MCP servers a session was handed over ACP.

use std::collections::HashMap;

use agent_client_protocol::schema::v1::McpServerHttp;
use http::header::{AUTHORIZATION, HeaderName, HeaderValue};
use mcp_toolset::{ConnectedServer, RemoteMcpToolSet, client_info};
use rmcp::ServiceExt as _;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClient, StreamableHttpClientTransportConfig,
};

use crate::domain::mcp::{MACRO_MCP_NAME, McpToolConnector};
use crate::domain::user_input::SharedUserInputRequester;

struct ElicitationClient {
    server: String,
    input: Option<SharedUserInputRequester>,
}

impl rmcp::ClientHandler for ElicitationClient {
    fn get_info(&self) -> rmcp::model::ClientInfo {
        let mut info = client_info();
        if self.input.is_some() {
            if self.server == MACRO_MCP_NAME {
                info.capabilities
                    .experimental
                    .get_or_insert_with(Default::default)
                    .insert("macro/composer".into(), Default::default());
            }
            info.capabilities.elicitation = Some(rmcp::model::ElicitationCapability {
                form: Some(Default::default()),
                url: None,
            });
        }
        info
    }

    async fn create_elicitation(
        &self,
        params: rmcp::model::CreateElicitationRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleClient>,
    ) -> Result<rmcp::model::CreateElicitationResult, rmcp::ErrorData> {
        let input = self.input.as_ref().ok_or_else(|| {
            rmcp::ErrorData::invalid_params("form elicitation is unsupported", None)
        })?;
        let rmcp::model::CreateElicitationRequestParams::FormElicitationParams {
            message,
            requested_schema,
            meta,
        } = params
        else {
            return Err(rmcp::ErrorData::invalid_params(
                "only form elicitation is supported",
                None,
            ));
        };
        let schema = serde_json::to_value(requested_schema)
            .map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?;
        // rmcp moves request metadata into RequestContext before dispatch.
        let mut metadata = context.meta.0.clone();
        if let Some(meta) = meta {
            metadata.extend(meta.0);
        }
        let mut meta = (!metadata.is_empty()).then_some(metadata);
        if self.server != MACRO_MCP_NAME
            && let Some(meta) = &mut meta
        {
            meta.remove("macro");
        }
        let response = tokio::select! {
            biased;
            _ = context.ct.cancelled() => return Ok(rmcp::model::CreateElicitationResult::new(rmcp::model::ElicitationAction::Cancel)),
            response = input.form(format!("{}: {message}", self.server), schema, meta) => response,
        }.map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?;
        serde_json::from_value(response)
            .map_err(|error| rmcp::ErrorData::invalid_params(error.to_string(), None))
    }
}

#[cfg(test)]
mod test;

/// Where one advertised header goes on the rmcp transport.
#[derive(Debug, PartialEq, Eq)]
enum HeaderPlacement {
    /// `Authorization: Bearer <token>`: rmcp takes the bare token and adds the
    /// scheme itself, so the scheme must come off here or the proxy sees
    /// `Bearer Bearer <token>` and knows no such session.
    BearerToken(String),
    /// Anything else, sent verbatim.
    Custom(HeaderName, HeaderValue),
}

/// Decide how an ACP `HttpHeader` reaches the wire. `None` when the name or
/// value is not a valid header.
fn place_header(name: &str, value: &str) -> Option<HeaderPlacement> {
    let header_name = HeaderName::from_bytes(name.as_bytes()).ok()?;
    if header_name == AUTHORIZATION {
        let mut parts = value.splitn(2, ' ');
        if let (Some(scheme), Some(token)) = (parts.next(), parts.next())
            && scheme.eq_ignore_ascii_case("bearer")
        {
            return Some(HeaderPlacement::BearerToken(token.trim().to_owned()));
        }
    }
    let header_value = HeaderValue::from_str(value).ok()?;
    Some(HeaderPlacement::Custom(header_name, header_value))
}

/// [`McpToolConnector`] over rmcp's streamable-HTTP client.
///
/// Each entry is dialed exactly as handed over: its URL is the egress proxy
/// and its `Authorization` header is the session token, so this process holds
/// no upstream credential any more than a sandbox does. What carries the
/// request is the `Client` - in production
/// [`EgressMcpClient`](super::egress_mcp::EgressMcpClient), which hands it
/// to the proxy's service without a socket.
#[derive(Clone)]
pub struct AcpMcpConnector<Client> {
    client: Client,
}

impl<Client> AcpMcpConnector<Client>
where
    Client: StreamableHttpClient + Send + Sync,
{
    /// A connector sharing one client across every server it dials.
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    async fn connect_one(
        &self,
        server: McpServerHttp,
        input: Option<SharedUserInputRequester>,
    ) -> Option<ConnectedServer> {
        let mut config = StreamableHttpClientTransportConfig::with_uri(server.url.clone());
        let mut custom = HashMap::new();
        for header in &server.headers {
            match place_header(&header.name, &header.value) {
                Some(HeaderPlacement::BearerToken(token)) => {
                    config = config.auth_header(token);
                }
                Some(HeaderPlacement::Custom(name, value)) => {
                    custom.insert(name, value);
                }
                None => {
                    tracing::warn!(server = %server.name, header = %header.name, "dropping an invalid header");
                }
            }
        }
        config.custom_headers = custom;

        // Reconnect on a later request, never replay a potentially mutating call.
        config.reinit_on_expired_session = false;
        let transport = StreamableHttpClientTransport::with_client(self.client.clone(), config);
        let handler = ElicitationClient {
            server: server.name.clone(),
            input,
        };
        match tokio::time::timeout(
            std::time::Duration::from_secs(20),
            handler.into_dyn().serve(transport),
        )
        .await
        {
            Ok(Ok(client)) => Some(ConnectedServer {
                name: server.name,
                client,
            }),
            Err(error) => {
                tracing::warn!(server = %server.name, error = ?error, "timed out initializing MCP server");
                None
            }
            Ok(Err(error)) => {
                tracing::warn!(server = %server.name, error = ?error, "failed to initialize MCP server");
                None
            }
        }
    }
}

#[async_trait::async_trait]
impl<Client> McpToolConnector for AcpMcpConnector<Client>
where
    Client: StreamableHttpClient + Send + Sync + 'static,
{
    async fn connect(
        &self,
        servers: Vec<McpServerHttp>,
        input: Option<SharedUserInputRequester>,
    ) -> Result<Option<RemoteMcpToolSet>, String> {
        if servers
            .iter()
            .filter(|server| server.name == MACRO_MCP_NAME)
            .count()
            != 1
        {
            return Err("Exactly one Macro MCP server is required".to_owned());
        }
        let connected: Vec<_> = futures::future::join_all(
            servers
                .into_iter()
                .map(|server| self.connect_one(server, input.clone())),
        )
        .await
        .into_iter()
        .flatten()
        .collect();
        if !connected.iter().any(|server| server.name == MACRO_MCP_NAME) {
            return Err("Could not connect to Macro MCP; retry the session".to_owned());
        }
        let tools = tokio::time::timeout(
            std::time::Duration::from_secs(25),
            RemoteMcpToolSet::from_connected(connected, None),
        )
        .await
        .map_err(|_| "MCP tool discovery timed out".to_owned())?;
        let catalog = tools.searchable_catalog();
        if !["mcp__macro__SendEmail", "mcp__macro__CreateCalendarEvent"]
            .iter()
            .all(|name| catalog.iter().any(|tool| tool.name == *name))
        {
            return Err(
                "Macro MCP must expose its full reviewed tool catalog before inmem can run"
                    .to_owned(),
            );
        }
        Ok(Some(tools))
    }
}
