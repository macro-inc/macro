//! Protocol types for proxy and MCP-over-ACP communication.
//!
//! These types are intended to become part of the ACP protocol specification.

use crate::{JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, UntypedMessage};
use agent_client_protocol_schema::v1::{InitializeRequest, InitializeResponse};
use serde::{Deserialize, Serialize};

// =============================================================================
// Successor forwarding protocol
// =============================================================================

/// JSON-RPC method name for successor forwarding.
pub const METHOD_SUCCESSOR_MESSAGE: &str = "_proxy/successor";

/// A message being sent to the successor component.
///
/// Used in `_proxy/successor` when the proxy wants to forward a message downstream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessorMessage<M: JsonRpcMessage = UntypedMessage> {
    /// The message to be sent to the successor component.
    #[serde(flatten)]
    pub message: M,

    /// Optional `_meta` metadata.
    #[serde(
        rename = "_meta",
        alias = "meta",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<serde_json::Value>,
}

impl<M: JsonRpcMessage> JsonRpcMessage for SuccessorMessage<M> {
    fn matches_method(method: &str) -> bool {
        method == METHOD_SUCCESSOR_MESSAGE
    }

    fn method(&self) -> &str {
        METHOD_SUCCESSOR_MESSAGE
    }

    fn to_untyped_message(&self) -> Result<UntypedMessage, crate::Error> {
        UntypedMessage::new(
            METHOD_SUCCESSOR_MESSAGE,
            SuccessorMessage {
                message: self.message.to_untyped_message()?,
                meta: self.meta.clone(),
            },
        )
    }

    fn parse_message(method: &str, params: &impl Serialize) -> Result<Self, crate::Error> {
        if method != METHOD_SUCCESSOR_MESSAGE {
            return Err(crate::Error::method_not_found());
        }
        let outer = crate::util::json_cast_params::<_, SuccessorMessage<UntypedMessage>>(params)?;
        if !M::matches_method(&outer.message.method) {
            return Err(crate::Error::method_not_found());
        }
        let inner = M::parse_message(&outer.message.method, &outer.message.params)?;
        Ok(SuccessorMessage {
            message: inner,
            meta: outer.meta,
        })
    }
}

impl<Req: JsonRpcRequest> JsonRpcRequest for SuccessorMessage<Req> {
    type Response = Req::Response;
}

impl<Notif: JsonRpcNotification> JsonRpcNotification for SuccessorMessage<Notif> {}

// =============================================================================
// MCP-over-ACP protocol
// =============================================================================

/// JSON-RPC method name for MCP connect requests
pub const METHOD_MCP_CONNECT_REQUEST: &str = "_mcp/connect";

/// Creates a new MCP connection. This is equivalent to "running the command".
#[derive(Debug, Clone, Serialize, Deserialize, crate::JsonRpcRequest)]
#[request(method = "_mcp/connect", response = McpConnectResponse, crate = crate)]
pub struct McpConnectRequest {
    /// The ACP identifier for the server (e.g., "acp:uuid"), matching `McpServerAcp.id`
    pub acp_id: String,

    /// Optional `_meta` metadata.
    #[serde(
        rename = "_meta",
        alias = "meta",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<serde_json::Value>,
}

/// Response to an MCP connect request
#[derive(Debug, Clone, Serialize, Deserialize, crate::JsonRpcResponse)]
#[response(crate = crate)]
pub struct McpConnectResponse {
    /// Unique identifier for the established MCP connection
    pub connection_id: String,

    /// Optional `_meta` metadata.
    #[serde(
        rename = "_meta",
        alias = "meta",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<serde_json::Value>,
}

/// JSON-RPC method name for MCP disconnect notifications
pub const METHOD_MCP_DISCONNECT_NOTIFICATION: &str = "_mcp/disconnect";

/// Disconnects the MCP connection.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, crate::JsonRpcNotification)]
#[notification(method = "_mcp/disconnect", crate = crate)]
pub struct McpDisconnectNotification {
    /// The id of the connection to disconnect.
    pub connection_id: String,

    /// Optional `_meta` metadata.
    #[serde(
        rename = "_meta",
        alias = "meta",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<serde_json::Value>,
}

/// JSON-RPC method name for MCP requests over ACP
pub const METHOD_MCP_MESSAGE: &str = "_mcp/message";

/// An MCP request sent via ACP. This could be an MCP-server-to-MCP-client request
/// (in which case it goes from the ACP client to the ACP agent,
/// note the reversal of roles) or an MCP-client-to-MCP-server request
/// (in which case it goes from the ACP agent to the ACP client).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOverAcpMessage<M = UntypedMessage> {
    /// id given in response to `_mcp/connect` request.
    pub connection_id: String,

    /// Request to be sent to the MCP server or client.
    #[serde(flatten)]
    pub message: M,

    /// Optional `_meta` metadata.
    #[serde(
        rename = "_meta",
        alias = "meta",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<serde_json::Value>,
}

impl<M: JsonRpcMessage> JsonRpcMessage for McpOverAcpMessage<M> {
    fn matches_method(method: &str) -> bool {
        method == METHOD_MCP_MESSAGE
    }

    fn method(&self) -> &str {
        METHOD_MCP_MESSAGE
    }

    fn to_untyped_message(&self) -> Result<UntypedMessage, crate::Error> {
        let message = self.message.to_untyped_message()?;
        UntypedMessage::new(
            METHOD_MCP_MESSAGE,
            McpOverAcpMessage {
                connection_id: self.connection_id.clone(),
                message,
                meta: self.meta.clone(),
            },
        )
    }

    fn parse_message(method: &str, params: &impl Serialize) -> Result<Self, crate::Error> {
        if method != METHOD_MCP_MESSAGE {
            return Err(crate::Error::method_not_found());
        }
        let outer = crate::util::json_cast_params::<_, McpOverAcpMessage<UntypedMessage>>(params)?;
        if !M::matches_method(&outer.message.method) {
            return Err(crate::Error::method_not_found());
        }
        let inner = M::parse_message(&outer.message.method, &outer.message.params)?;
        Ok(McpOverAcpMessage {
            connection_id: outer.connection_id,
            message: inner,
            meta: outer.meta,
        })
    }
}

impl<R: JsonRpcRequest> JsonRpcRequest for McpOverAcpMessage<R> {
    type Response = R::Response;
}

impl<R: JsonRpcNotification> JsonRpcNotification for McpOverAcpMessage<R> {}

// =============================================================================
// Proxy initialization protocol
// =============================================================================

/// JSON-RPC method name for proxy initialization.
pub const METHOD_INITIALIZE_PROXY: &str = "_proxy/initialize";

/// Initialize request for proxy components.
///
/// This is sent to components that have a successor in the chain.
/// Components that receive this (instead of `InitializeRequest`) know they
/// are operating as a proxy and should forward messages to their successor.
#[derive(Debug, Clone, Serialize, Deserialize, crate::JsonRpcRequest)]
#[request(method = "_proxy/initialize", response = InitializeResponse, crate = crate)]
pub struct InitializeProxyRequest {
    /// The underlying initialize request data.
    #[serde(flatten)]
    pub initialize: InitializeRequest,
}

impl From<InitializeRequest> for InitializeProxyRequest {
    fn from(initialize: InitializeRequest) -> Self {
        Self { initialize }
    }
}
