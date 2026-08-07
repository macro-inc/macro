//! Core JSON-RPC server support.

use agent_client_protocol_schema::v1::{
    JsonRpcMessage as VersionedJsonRpcMessage, Notification as RpcNotification,
    Request as RpcRequest, RequestId, Response as RpcResponse, SessionId,
};

// Types re-exported from crate root
use serde::{Deserialize, Serialize};
use std::any::TypeId;
use std::collections::HashMap;
use std::fmt::Debug;
use std::panic::Location;
use std::pin::pin;
use std::sync::Arc;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use uuid::Uuid;

use futures::FutureExt;
use futures::channel::{mpsc, oneshot};
use futures::future::{self, BoxFuture, Either};
use futures::{AsyncRead, AsyncWrite, StreamExt};

mod dynamic_handler;
pub(crate) mod handlers;
mod incoming_actor;
mod outgoing_actor;
mod protocol_compat;
pub(crate) mod run;
mod task_actor;
mod transport_actor;

use crate::jsonrpc::dynamic_handler::DynamicHandlerMessage;
pub use crate::jsonrpc::handlers::NullHandler;
use crate::jsonrpc::handlers::{ChainedHandler, NamedHandler};
use crate::jsonrpc::handlers::{MessageHandler, NotificationHandler, RequestHandler};
use crate::jsonrpc::outgoing_actor::{OutgoingMessageTx, send_raw_message};
use crate::jsonrpc::protocol_compat::{ProtocolCompat, ProtocolMode};
use crate::jsonrpc::run::SpawnedRun;
use crate::jsonrpc::run::{ChainRun, NullRun, RunWithConnectionTo};
use crate::jsonrpc::task_actor::{Task, TaskTx};
use crate::mcp_server::McpServer;
use crate::role::HasPeer;
use crate::role::Role;
use crate::{Agent, Client, ConnectTo, RoleId};

/// Raw JSON-RPC message transported by [`Channel`].
///
/// This uses the JSON-RPC envelope types from `agent-client-protocol-schema`
/// while keeping method params as raw, JSON-RPC-valid params at the transport boundary.
#[derive(Debug, Clone)]
pub enum RawJsonRpcMessage {
    /// A JSON-RPC request with an id and expected response.
    Request(RpcRequest<RawJsonRpcParams>),
    /// A JSON-RPC notification without a response.
    Notification(RpcNotification<RawJsonRpcParams>),
    /// A JSON-RPC response to a prior request.
    Response(RpcResponse<serde_json::Value>),
}

/// Raw JSON-RPC request or notification parameters.
///
/// JSON-RPC params, when present, must be either an array or an object.
#[derive(Debug, Clone, PartialEq)]
pub enum RawJsonRpcParams {
    /// Positional JSON-RPC params.
    Array(Vec<serde_json::Value>),
    /// Named JSON-RPC params.
    Object(serde_json::Map<String, serde_json::Value>),
}

impl RawJsonRpcParams {
    /// Convert a JSON value into JSON-RPC params.
    pub fn from_value(value: serde_json::Value) -> Result<Option<Self>, crate::Error> {
        match value {
            serde_json::Value::Null => Ok(None),
            serde_json::Value::Array(array) => Ok(Some(Self::Array(array))),
            serde_json::Value::Object(object) => Ok(Some(Self::Object(object))),
            _ => {
                Err(crate::Error::invalid_params()
                    .data("JSON-RPC params must be an object or array"))
            }
        }
    }

    /// Convert params back into a JSON value.
    #[must_use]
    pub fn into_value(self) -> serde_json::Value {
        match self {
            Self::Array(array) => serde_json::Value::Array(array),
            Self::Object(object) => serde_json::Value::Object(object),
        }
    }
}

impl Serialize for RawJsonRpcParams {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Array(array) => array.serialize(serializer),
            Self::Object(object) => object.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for RawJsonRpcParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value {
            serde_json::Value::Array(array) => Ok(Self::Array(array)),
            serde_json::Value::Object(object) => Ok(Self::Object(object)),
            _ => Err(serde::de::Error::custom(
                "JSON-RPC params must be an object or array",
            )),
        }
    }
}

impl RawJsonRpcMessage {
    /// Build a raw JSON-RPC request message.
    pub fn request(
        method: String,
        params: serde_json::Value,
        id: RequestId,
    ) -> Result<Self, crate::Error> {
        Ok(Self::Request(RpcRequest {
            id,
            method: Arc::from(method),
            params: RawJsonRpcParams::from_value(params)?,
        }))
    }

    /// Build a raw JSON-RPC notification message.
    pub fn notification(method: String, params: serde_json::Value) -> Result<Self, crate::Error> {
        Ok(Self::Notification(RpcNotification {
            method: Arc::from(method),
            params: RawJsonRpcParams::from_value(params)?,
        }))
    }

    /// Build a raw JSON-RPC response message.
    #[must_use]
    pub fn response(id: RequestId, response: Result<serde_json::Value, crate::Error>) -> Self {
        Self::Response(RpcResponse::new(id, response))
    }

    /// The response id, if this is a response.
    #[must_use]
    pub fn response_id(&self) -> Option<&RequestId> {
        match self {
            Self::Response(RpcResponse::Result { id, .. } | RpcResponse::Error { id, .. }) => {
                Some(id)
            }
            Self::Request(_) | Self::Notification(_) => None,
        }
    }
}

impl Serialize for RawJsonRpcMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Request(request) => {
                VersionedJsonRpcMessage::wrap(request.clone()).serialize(serializer)
            }
            Self::Notification(notification) => {
                VersionedJsonRpcMessage::wrap(notification.clone()).serialize(serializer)
            }
            Self::Response(response) => {
                VersionedJsonRpcMessage::wrap(response.clone()).serialize(serializer)
            }
        }
    }
}

impl<'de> Deserialize<'de> for RawJsonRpcMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        if value.get("method").is_some() {
            if value.get("id").is_some() {
                let request = serde_json::from_value::<
                    VersionedJsonRpcMessage<RpcRequest<RawJsonRpcParams>>,
                >(value)
                .map_err(serde::de::Error::custom)?
                .into_inner();
                Ok(Self::Request(request))
            } else {
                let notification = serde_json::from_value::<
                    VersionedJsonRpcMessage<RpcNotification<RawJsonRpcParams>>,
                >(value)
                .map_err(serde::de::Error::custom)?
                .into_inner();
                Ok(Self::Notification(notification))
            }
        } else if value.get("result").is_some() || value.get("error").is_some() {
            let response = serde_json::from_value::<
                VersionedJsonRpcMessage<RpcResponse<serde_json::Value>>,
            >(value)
            .map_err(serde::de::Error::custom)?
            .into_inner();
            Ok(Self::Response(response))
        } else {
            Err(serde::de::Error::custom("invalid JSON-RPC message"))
        }
    }
}

fn params_from_transport(params: Option<RawJsonRpcParams>) -> serde_json::Value {
    params.map_or(serde_json::Value::Null, RawJsonRpcParams::into_value)
}

/// Handlers process incoming JSON-RPC messages on a connection.
///
/// When messages arrive, they flow through a chain of handlers. Each handler can
/// either **claim** the message (handle it) or **decline** it (pass to the next handler).
///
/// # Message Flow
///
/// Messages flow through three layers of handlers in order:
///
/// ```text
/// ┌─────────────────────────────────────────────────────────────────┐
/// │                     Incoming Message                            │
/// └─────────────────────────────────────────────────────────────────┘
///                              │
///                              ▼
/// ┌─────────────────────────────────────────────────────────────────┐
/// │  1. User Handlers (registered via on_receive_request, etc.)     │
/// │     - Tried in registration order                               │
/// │     - First handler to return Handled::Yes claims the message   │
/// └─────────────────────────────────────────────────────────────────┘
///                              │ Handled::No
///                              ▼
/// ┌─────────────────────────────────────────────────────────────────┐
/// │  2. Dynamic Handlers (added at runtime)                         │
/// │     - Used for session-specific message handling                │
/// │     - Added via ConnectionTo::add_dynamic_handler             │
/// └─────────────────────────────────────────────────────────────────┘
///                              │ Handled::No
///                              ▼
/// ┌─────────────────────────────────────────────────────────────────┐
/// │  3. Role Default Handler                                        │
/// │     - Fallback based on the connection's Role                   │
/// │     - Handles protocol-level messages (e.g., proxy forwarding)  │
/// └─────────────────────────────────────────────────────────────────┘
///                              │ Handled::No
///                              ▼
/// ┌─────────────────────────────────────────────────────────────────┐
/// │  Unhandled: requests error, notifications ignored               │
/// └─────────────────────────────────────────────────────────────────┘
/// ```
///
/// # The `Handled` Return Value
///
/// Each handler returns [`Handled`] to indicate whether it processed the message:
///
/// - **`Handled::Yes`** - Message was handled. No further handlers are invoked.
/// - **`Handled::No { message, retry }`** - Message was not handled. The message
///   (possibly modified) is passed to the next handler in the chain.
///
/// For convenience, handlers can return `()` which is equivalent to `Handled::Yes`.
///
/// # The Retry Mechanism
///
/// The `retry` flag in `Handled::No` controls what happens when no handler claims a message:
///
/// - **`retry: false`** (default) - Send a "method not found" error
///   response immediately for requests, or ignore notifications.
/// - **`retry: true`** - Queue the message and retry it when new dynamic handlers are added.
///
/// This mechanism exists because of a timing issue with sessions: when a `session/new`
/// response is being processed, the dynamic handler for that session hasn't been registered
/// yet, but `session/update` notifications for that session may already be arriving.
/// By setting `retry: true`, these early notifications are queued until the session's
/// dynamic handler is added.
///
/// # Handler Registration
///
/// Most users register handlers using the builder methods on [`Builder`]:
///
/// ```
/// # use agent_client_protocol::{Agent, Client, ConnectTo};
/// # use agent_client_protocol::schema::v1::{AgentCapabilities, InitializeRequest, InitializeResponse};
/// # use agent_client_protocol_test::StatusUpdate;
/// # async fn example(transport: impl ConnectTo<Agent>) -> Result<(), agent_client_protocol::Error> {
/// Agent.builder()
///     .on_receive_request(async |req: InitializeRequest, responder, cx| {
///         responder.respond(
///             InitializeResponse::new(req.protocol_version)
///                 .agent_capabilities(AgentCapabilities::new()),
///         )
///     }, agent_client_protocol::on_receive_request!())
///     .on_receive_notification(async |notif: StatusUpdate, cx| {
///         // Process notification
///         Ok(())
///     }, agent_client_protocol::on_receive_notification!())
///     .connect_to(transport)
///     .await?;
/// # Ok(())
/// # }
/// ```
///
/// The type parameter on the closure determines which messages are dispatched to it.
/// Messages that don't match the type are automatically passed to the next handler.
///
/// # Implementing Custom Handlers
///
/// For advanced use cases, you can implement `HandleMessageAs` directly:
///
/// ```ignore
/// struct MyHandler;
///
/// impl HandleMessageAs<Agent> for MyHandler {
///
///     async fn handle_dispatch(
///         &mut self,
///         message: Dispatch,
///         cx: ConnectionTo<Self::Role>,
///     ) -> Result<Handled<Dispatch>, Error> {
///         if message.method() == "my/custom/method" {
///             // Handle it
///             Ok(Handled::Yes)
///         } else {
///             // Pass to next handler
///             Ok(Handled::No { message, retry: false })
///         }
///     }
///
///     fn describe_chain(&self) -> impl std::fmt::Debug {
///         "MyHandler"
///     }
/// }
/// ```
///
/// # Important: Handlers Must Not Block
///
/// The connection processes messages on a single async task. While a handler is running,
/// no other messages can be processed. For expensive operations, use [`ConnectionTo::spawn`]
/// to run work concurrently:
///
/// ```
/// # use agent_client_protocol::{Client, Agent, ConnectTo};
/// # use agent_client_protocol_test::{expensive_operation, ProcessComplete};
/// # async fn example(transport: impl ConnectTo<Client>) -> Result<(), agent_client_protocol::Error> {
/// # Client.builder().connect_with(transport, async |cx| {
/// cx.spawn({
///     let connection = cx.clone();
///     async move {
///         let result = expensive_operation("data").await?;
///         connection.send_notification(ProcessComplete { result })?;
///         Ok(())
///     }
/// })?;
/// # Ok(())
/// # }).await?;
/// # Ok(())
/// # }
/// ```
#[allow(async_fn_in_trait)]
/// A handler for incoming JSON-RPC messages.
///
/// This trait is implemented by types that can process incoming messages on a connection.
/// Handlers are registered with a [`Builder`] and are called in order until
/// one claims the message.
///
/// The type parameter `R` is the role this handler plays - who I am.
/// For an agent handler, `R = Agent` (I handle messages as an agent).
/// For a client handler, `R = Client` (I handle messages as a client).
pub trait HandleDispatchFrom<Counterpart: Role>: Send {
    /// Attempt to claim an incoming message (request or notification).
    ///
    /// # Important: do not block
    ///
    /// The server will not process new messages until this handler returns.
    /// You should avoid blocking in this callback unless you wish to block the server (e.g., for rate limiting).
    /// The recommended approach to manage expensive operations is to the [`ConnectionTo::spawn`] method available on the message context.
    ///
    /// # Parameters
    ///
    /// * `message` - The incoming message to handle.
    /// * `connection` - The connection, used to send messages and access connection state.
    ///
    /// # Returns
    ///
    /// * `Ok(Handled::Yes)` if the message was claimed. It will not be propagated further.
    /// * `Ok(Handled::No(message))` if not; the (possibly changed) message will be passed to the remaining handlers.
    /// * `Err` if an internal error occurs (this will bring down the server).
    fn handle_dispatch_from(
        &mut self,
        message: Dispatch,
        connection: ConnectionTo<Counterpart>,
    ) -> impl Future<Output = Result<Handled<Dispatch>, crate::Error>> + Send;

    /// Returns a debug description of the registered handlers for diagnostics.
    fn describe_chain(&self) -> impl std::fmt::Debug;
}

impl<Counterpart: Role, H> HandleDispatchFrom<Counterpart> for &mut H
where
    H: HandleDispatchFrom<Counterpart>,
{
    fn handle_dispatch_from(
        &mut self,
        message: Dispatch,
        cx: ConnectionTo<Counterpart>,
    ) -> impl Future<Output = Result<Handled<Dispatch>, crate::Error>> + Send {
        H::handle_dispatch_from(self, message, cx)
    }

    fn describe_chain(&self) -> impl std::fmt::Debug {
        H::describe_chain(self)
    }
}

/// A JSON-RPC connection that can act as either a server, client, or both.
///
/// [`Builder`] provides a builder-style API for creating JSON-RPC servers and clients.
/// You start by calling `Role.builder()` (e.g., `Client.builder()`), then add message
/// handlers, and finally drive the connection with either [`connect_to`](Builder::connect_to)
/// or [`connect_with`](Builder::connect_with), providing a component implementation
/// (e.g., [`ByteStreams`] for byte streams).
///
/// # JSON-RPC Primer
///
/// JSON-RPC 2.0 has two fundamental message types:
///
/// * **Requests** - Messages that expect a response. They have an `id` field that gets
///   echoed back in the response so the sender can correlate them.
/// * **Notifications** - Fire-and-forget messages with no `id` field. The sender doesn't
///   expect or receive a response.
///
/// # Type-Driven Message Dispatch
///
/// The handler registration methods use Rust's type system to determine which messages
/// to handle. The type parameter you provide controls what gets dispatched to your handler:
///
/// ## Single Message Types
///
/// The simplest case - handle one specific message type:
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # use agent_client_protocol::schema::v1::{InitializeRequest, InitializeResponse, SessionNotification};
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// connection
///     .on_receive_request(async |req: InitializeRequest, responder, cx| {
///         // Handle only InitializeRequest messages
///         responder.respond(InitializeResponse::make())
///     }, agent_client_protocol::on_receive_request!())
///     .on_receive_notification(async |notif: SessionNotification, cx| {
///         // Handle only SessionUpdate notifications
///         Ok(())
///     }, agent_client_protocol::on_receive_notification!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// ## Enum Message Types
///
/// You can also handle multiple related messages with a single handler by defining an enum
/// that implements the appropriate trait ([`JsonRpcRequest`] or [`JsonRpcNotification`]):
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # use agent_client_protocol::{JsonRpcRequest, JsonRpcMessage, UntypedMessage};
/// # use agent_client_protocol::schema::v1::{InitializeRequest, InitializeResponse, PromptRequest, PromptResponse};
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// // Define an enum for multiple request types
/// #[derive(Debug, Clone)]
/// enum MyRequests {
///     Initialize(InitializeRequest),
///     Prompt(PromptRequest),
/// }
///
/// // Implement JsonRpcRequest for your enum
/// # impl JsonRpcMessage for MyRequests {
/// #     fn matches_method(_method: &str) -> bool { false }
/// #     fn method(&self) -> &str { "myRequests" }
/// #     fn to_untyped_message(&self) -> Result<UntypedMessage, agent_client_protocol::Error> { todo!() }
/// #     fn parse_message(_method: &str, _params: &impl serde::Serialize) -> Result<Self, agent_client_protocol::Error> { Err(agent_client_protocol::Error::method_not_found()) }
/// # }
/// impl JsonRpcRequest for MyRequests { type Response = serde_json::Value; }
///
/// // Handle all variants in one place
/// connection.on_receive_request(async |req: MyRequests, responder, cx| {
///     match req {
///         MyRequests::Initialize(init) => { responder.respond(serde_json::json!({})) }
///         MyRequests::Prompt(prompt) => { responder.respond(serde_json::json!({})) }
///     }
/// }, agent_client_protocol::on_receive_request!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// ## Mixed Message Types
///
/// For enums containing both requests AND notifications, use [`on_receive_dispatch`](Self::on_receive_dispatch):
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # use agent_client_protocol::Dispatch;
/// # use agent_client_protocol::schema::v1::{InitializeRequest, InitializeResponse, SessionNotification};
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// // on_receive_dispatch receives Dispatch which can be either a request or notification
/// connection.on_receive_dispatch(async |msg: Dispatch<InitializeRequest, SessionNotification>, _cx| {
///     match msg {
///         Dispatch::Request(req, responder) => {
///             responder.respond(InitializeResponse::make())
///         }
///         Dispatch::Notification(notif) => {
///             Ok(())
///         }
///         Dispatch::Response(result, router) => {
///             // Forward response to its destination
///             router.respond_with_result(result)
///         }
///     }
/// }, agent_client_protocol::on_receive_dispatch!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// # Handler Registration
///
/// Register handlers using these methods (listed from most common to most flexible):
///
/// * [`on_receive_request`](Self::on_receive_request) - Handle JSON-RPC requests (messages expecting responses)
/// * [`on_receive_notification`](Self::on_receive_notification) - Handle JSON-RPC notifications (fire-and-forget)
/// * [`on_receive_dispatch`](Self::on_receive_dispatch) - Handle enums containing both requests and notifications
/// * [`with_handler`](Self::with_handler) - Low-level primitive for maximum flexibility
///
/// ## Handler Ordering
///
/// Handlers are tried in the order you register them. The first handler that claims a message
/// (by matching its type) will process it. Subsequent handlers won't see that message:
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # use agent_client_protocol::{Dispatch, UntypedMessage};
/// # use agent_client_protocol::schema::v1::{InitializeRequest, InitializeResponse, PromptRequest, PromptResponse};
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// connection
///     .on_receive_request(async |req: InitializeRequest, responder, cx| {
///         // This runs first for InitializeRequest
///         responder.respond(InitializeResponse::make())
///     }, agent_client_protocol::on_receive_request!())
///     .on_receive_request(async |req: PromptRequest, responder, cx| {
///         // This runs first for PromptRequest
///         responder.respond(PromptResponse::make())
///     }, agent_client_protocol::on_receive_request!())
///     .on_receive_dispatch(async |msg: Dispatch, cx| {
///         // This runs for any message not handled above
///         msg.respond_with_error(agent_client_protocol::util::internal_error("unknown method"), cx)
///     }, agent_client_protocol::on_receive_dispatch!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// # Event Loop and Concurrency
///
/// Understanding the event loop is critical for writing correct handlers.
///
/// ## The Event Loop
///
/// [`Builder`] runs all handler callbacks on a single async task - the event loop.
/// While a handler is running, **the server cannot receive new messages**. This means
/// any blocking or expensive work in your handlers will stall the entire connection.
///
/// To avoid blocking the event loop, use [`ConnectionTo::spawn`] to offload serious
/// work to concurrent tasks:
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// connection.on_receive_request(async |req: AnalyzeRequest, responder, cx| {
///     // Clone cx for the spawned task
///     cx.spawn({
///         let connection = cx.clone();
///         async move {
///             let result = expensive_analysis(&req.data).await?;
///             connection.send_notification(AnalysisComplete { result })?;
///             Ok(())
///         }
///     })?;
///
///     // Respond immediately without blocking
///     responder.respond(AnalysisStarted { job_id: 42 })
/// }, agent_client_protocol::on_receive_request!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// Note that the entire connection runs within one async task, so parallelism must be
/// managed explicitly using [`spawn`](ConnectionTo::spawn).
///
/// ## The Connection Context
///
/// Handler callbacks receive a context object (`cx`) for interacting with the connection:
///
/// * **For request handlers** - [`Responder<R>`] provides [`respond`](Responder::respond)
///   to send the response, plus methods to send other messages
/// * **For notification handlers** - [`ConnectionTo`] provides methods to send messages
///   and spawn tasks
///
/// Both context types support:
/// * [`send_request`](ConnectionTo::send_request) - Send requests to the other side
/// * [`send_notification`](ConnectionTo::send_notification) - Send notifications
/// * [`spawn`](ConnectionTo::spawn) - Run tasks concurrently without blocking the event loop
///
/// The [`SentRequest`] returned by `send_request` provides methods like
/// [`on_receiving_result`](SentRequest::on_receiving_result) that help you
/// avoid accidentally blocking the event loop while waiting for responses.
///
/// # Driving the Connection
///
/// After adding handlers, you must drive the connection using one of two modes:
///
/// ## Server Mode: `connect_to()`
///
/// Use [`connect_to`](Self::connect_to) when you only need to respond to incoming messages:
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// connection
///     .on_receive_request(async |req: MyRequest, responder, cx| {
///         responder.respond(MyResponse { status: "ok".into() })
///     }, agent_client_protocol::on_receive_request!())
///     .connect_to(MockTransport)  // Runs until connection closes or error occurs
///     .await?;
/// # Ok(())
/// # }
/// ```
///
/// The connection will process incoming messages and invoke your handlers until the
/// connection is closed or an error occurs.
///
/// ## Client Mode: `connect_with()`
///
/// Use [`connect_with`](Self::connect_with) when you need to both handle incoming messages
/// AND send your own requests/notifications:
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # use agent_client_protocol::schema::v1::InitializeRequest;
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// connection
///     .on_receive_request(async |req: MyRequest, responder, cx| {
///         responder.respond(MyResponse { status: "ok".into() })
///     }, agent_client_protocol::on_receive_request!())
///     .connect_with(MockTransport, async |cx| {
///         // You can send requests to the other side
///         let response = cx.send_request(InitializeRequest::make())
///             .block_task()
///             .await?;
///
///         // And send notifications
///         cx.send_notification(StatusUpdate { message: "ready".into() })?;
///
///         Ok(())
///     })
///     .await?;
/// # Ok(())
/// # }
/// ```
///
/// The connection will serve incoming messages in the background while your client closure
/// runs. When the closure returns, the connection shuts down.
///
/// # Example: Complete Agent
///
/// ```no_run
/// # use agent_client_protocol::UntypedRole;
/// # use agent_client_protocol::{Builder};
/// # use agent_client_protocol::Stdio;
/// # use agent_client_protocol::schema::v1::{InitializeRequest, InitializeResponse, PromptRequest, PromptResponse, SessionNotification};
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// let transport = Stdio::new();
///
/// UntypedRole.builder()
///     .name("my-agent")  // Optional: for debugging logs
///     .on_receive_request(async |init: InitializeRequest, responder, cx| {
///         let response: InitializeResponse = todo!();
///         responder.respond(response)
///     }, agent_client_protocol::on_receive_request!())
///     .on_receive_request(async |prompt: PromptRequest, responder, cx| {
///         // You can send notifications while processing a request
///         let notif: SessionNotification = todo!();
///         cx.send_notification(notif)?;
///
///         // Then respond to the request
///         let response: PromptResponse = todo!();
///         responder.respond(response)
///     }, agent_client_protocol::on_receive_request!())
///     .connect_to(transport)
///     .await?;
/// # Ok(())
/// # }
/// ```
#[must_use]
#[derive(Debug)]
pub struct Builder<Host: Role, Handler = NullHandler, Runner = NullRun>
where
    Handler: HandleDispatchFrom<Host::Counterpart>,
    Runner: RunWithConnectionTo<Host::Counterpart>,
{
    /// My role.
    host: Host,

    /// Name of the connection, used in tracing logs.
    name: Option<String>,

    /// Handler for incoming messages.
    handler: Handler,

    /// Responder for background tasks.
    responder: Runner,

    /// Protocol version mode for the public API and wire compatibility layer.
    protocol_mode: ProtocolMode,
}

fn default_protocol_mode<Host: Role>() -> ProtocolMode {
    let role = TypeId::of::<Host>();

    if role == TypeId::of::<Agent>() {
        ProtocolMode::v1_agent()
    } else if role == TypeId::of::<Client>() {
        ProtocolMode::v1_client()
    } else {
        ProtocolMode::disabled()
    }
}

impl<Host: Role> Builder<Host, NullHandler, NullRun> {
    /// Create a new connection builder for the given role.
    /// This type follows a builder pattern; use other methods to configure and then invoke
    /// [`Self::connect_to`] (to use as a server) or [`Self::connect_with`] to use as a client.
    pub fn new(role: Host) -> Self {
        Self {
            host: role,
            name: None,
            handler: NullHandler,
            responder: NullRun,
            protocol_mode: default_protocol_mode::<Host>(),
        }
    }
}

impl<Host: Role, Handler> Builder<Host, Handler, NullRun>
where
    Handler: HandleDispatchFrom<Host::Counterpart>,
{
    /// Create a new connection builder with the given handler.
    pub fn new_with(role: Host, handler: Handler) -> Self {
        Self {
            host: role,
            name: None,
            handler,
            responder: NullRun,
            protocol_mode: default_protocol_mode::<Host>(),
        }
    }
}

impl<
    Host: Role,
    Handler: HandleDispatchFrom<Host::Counterpart>,
    Runner: RunWithConnectionTo<Host::Counterpart>,
> Builder<Host, Handler, Runner>
{
    /// Set the "name" of this connection -- used only for debugging logs.
    pub fn name(mut self, name: impl ToString) -> Self {
        self.name = Some(name.to_string());
        self
    }

    pub(crate) fn v1_agent(mut self) -> Self {
        self.protocol_mode = ProtocolMode::v1_agent();
        self
    }

    pub(crate) fn v1_client(mut self) -> Self {
        self.protocol_mode = ProtocolMode::v1_client();
        self
    }

    #[cfg(feature = "unstable_protocol_v2")]
    pub(crate) fn v2_agent(mut self) -> Self {
        self.protocol_mode = ProtocolMode::v2_agent();
        self
    }

    #[cfg(feature = "unstable_protocol_v2")]
    pub(crate) fn v2_client(mut self) -> Self {
        self.protocol_mode = ProtocolMode::v2_client();
        self
    }

    /// Merge another [`Builder`] into this one.
    ///
    /// Prefer [`Self::on_receive_request`] or [`Self::on_receive_notification`].
    /// This is a low-level method that is not intended for general use.
    pub fn with_connection_builder(
        self,
        other: Builder<
            Host,
            impl HandleDispatchFrom<Host::Counterpart>,
            impl RunWithConnectionTo<Host::Counterpart>,
        >,
    ) -> Builder<
        Host,
        impl HandleDispatchFrom<Host::Counterpart>,
        impl RunWithConnectionTo<Host::Counterpart>,
    > {
        let Builder {
            name: other_name,
            handler: other_handler,
            responder: other_responder,
            protocol_mode: other_protocol_mode,
            host: _,
        } = other;
        Builder {
            host: self.host,
            name: self.name,
            handler: ChainedHandler::new(
                self.handler,
                NamedHandler::new(other_name, other_handler),
            ),
            responder: ChainRun::new(self.responder, other_responder),
            protocol_mode: self.protocol_mode.merge(other_protocol_mode),
        }
    }

    /// Add a new [`HandleDispatchFrom`] to the chain.
    ///
    /// Prefer [`Self::on_receive_request`] or [`Self::on_receive_notification`].
    /// This is a low-level method that is not intended for general use.
    pub fn with_handler(
        self,
        handler: impl HandleDispatchFrom<Host::Counterpart>,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner> {
        Builder {
            host: self.host,
            name: self.name,
            handler: ChainedHandler::new(self.handler, handler),
            responder: self.responder,
            protocol_mode: self.protocol_mode,
        }
    }

    /// Add a new [`RunWithConnectionTo`] to the chain.
    pub fn with_responder<Run1>(
        self,
        responder: Run1,
    ) -> Builder<Host, Handler, impl RunWithConnectionTo<Host::Counterpart>>
    where
        Run1: RunWithConnectionTo<Host::Counterpart>,
    {
        Builder {
            host: self.host,
            name: self.name,
            handler: self.handler,
            responder: ChainRun::new(self.responder, responder),
            protocol_mode: self.protocol_mode,
        }
    }

    /// Enqueue a task to run once the connection is actively serving traffic.
    #[track_caller]
    pub fn with_spawned<F, Fut>(
        self,
        task: F,
    ) -> Builder<Host, Handler, impl RunWithConnectionTo<Host::Counterpart>>
    where
        F: FnOnce(ConnectionTo<Host::Counterpart>) -> Fut + Send,
        Fut: Future<Output = Result<(), crate::Error>> + Send,
    {
        let location = Location::caller();
        self.with_responder(SpawnedRun::new(location, task))
    }

    /// Register a handler for messages that can be either requests OR notifications.
    ///
    /// Use this when you want to handle an enum type that contains both request and
    /// notification variants. Your handler receives a [`Dispatch<Req, Notif>`] which
    /// is an enum with two variants:
    ///
    /// - `Dispatch::Request(request, responder)` - A request with its response context
    /// - `Dispatch::Notification(notification)` - A notification
    /// - `Dispatch::Response(result, router)` - A response to a request we sent
    ///
    /// # Example
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # use agent_client_protocol::Dispatch;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_dispatch(async |message: Dispatch<MyRequest, StatusUpdate>, _cx| {
    ///     match message {
    ///         Dispatch::Request(req, responder) => {
    ///             // Handle request and send response
    ///             responder.respond(MyResponse { status: "ok".into() })
    ///         }
    ///         Dispatch::Notification(notif) => {
    ///             // Handle notification (no response needed)
    ///             Ok(())
    ///         }
    ///         Dispatch::Response(result, router) => {
    ///             // Forward response to its destination
    ///             router.respond_with_result(result)
    ///         }
    ///     }
    /// }, agent_client_protocol::on_receive_dispatch!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// For most use cases, prefer [`on_receive_request`](Self::on_receive_request) or
    /// [`on_receive_notification`](Self::on_receive_notification) which provide cleaner APIs
    /// for handling requests or notifications separately.
    ///
    /// # Ordering
    ///
    /// This callback runs inside the dispatch loop and blocks further message processing
    /// until it completes. See the [`ordering`](crate::concepts::ordering) module for details on
    /// ordering guarantees and how to avoid deadlocks.
    pub fn on_receive_dispatch<Req, Notif, F, T, ToFut>(
        self,
        op: F,
        to_future_hack: ToFut,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner>
    where
        Host::Counterpart: HasPeer<Host::Counterpart>,
        Req: JsonRpcRequest,
        Notif: JsonRpcNotification,
        F: AsyncFnMut(
                Dispatch<Req, Notif>,
                ConnectionTo<Host::Counterpart>,
            ) -> Result<T, crate::Error>
            + Send,
        T: IntoHandled<Dispatch<Req, Notif>>,
        ToFut: Fn(
                &mut F,
                Dispatch<Req, Notif>,
                ConnectionTo<Host::Counterpart>,
            ) -> crate::BoxFuture<'_, Result<T, crate::Error>>
            + Send
            + Sync,
    {
        let handler = MessageHandler::new(
            self.host.counterpart(),
            self.host.counterpart(),
            op,
            to_future_hack,
        );
        self.with_handler(handler)
    }

    /// Register a handler for JSON-RPC requests of type `Req`.
    ///
    /// Your handler receives two arguments:
    /// 1. The request (type `Req`)
    /// 2. A [`Responder<R, Req::Response>`] for sending the response
    ///
    /// The request context allows you to:
    /// - Send the response with [`Responder::respond`]
    /// - Send notifications to the client with [`ConnectionTo::send_notification`]
    /// - Send requests to the client with [`ConnectionTo::send_request`]
    ///
    /// # Example
    ///
    /// ```ignore
    /// # use agent_client_protocol::UntypedRole;
    /// # use agent_client_protocol::{Builder};
    /// # use agent_client_protocol::schema::v1::{PromptRequest, PromptResponse, SessionNotification};
    /// # fn example<R: agent_client_protocol::Role>(connection: Builder<R, impl agent_client_protocol::HandleMessageAs<R>>) {
    /// connection.on_receive_request(async |request: PromptRequest, responder, cx| {
    ///     // Send a notification while processing
    ///     let notif: SessionNotification = todo!();
    ///     cx.send_notification(notif)?;
    ///
    ///     // Do some work...
    ///     let result = todo!("process the prompt");
    ///
    ///     // Send the response
    ///     let response: PromptResponse = todo!();
    ///     responder.respond(response)
    /// }, agent_client_protocol::on_receive_request!());
    /// # }
    /// ```
    ///
    /// # Type Parameter
    ///
    /// `Req` can be either a single request type or an enum of multiple request types.
    /// See the [type-driven dispatch](Self#type-driven-message-dispatch) section for details.
    ///
    /// # Ordering
    ///
    /// This callback runs inside the dispatch loop and blocks further message processing
    /// until it completes. See the [`ordering`](crate::concepts::ordering) module for details on
    /// ordering guarantees and how to avoid deadlocks.
    pub fn on_receive_request<Req: JsonRpcRequest, F, T, ToFut>(
        self,
        op: F,
        to_future_hack: ToFut,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner>
    where
        Host::Counterpart: HasPeer<Host::Counterpart>,
        F: AsyncFnMut(
                Req,
                Responder<Req::Response>,
                ConnectionTo<Host::Counterpart>,
            ) -> Result<T, crate::Error>
            + Send,
        T: IntoHandled<(Req, Responder<Req::Response>)>,
        ToFut: Fn(
                &mut F,
                Req,
                Responder<Req::Response>,
                ConnectionTo<Host::Counterpart>,
            ) -> crate::BoxFuture<'_, Result<T, crate::Error>>
            + Send
            + Sync,
    {
        let handler = RequestHandler::new(
            self.host.counterpart(),
            self.host.counterpart(),
            op,
            to_future_hack,
        );
        self.with_handler(handler)
    }

    /// Register a handler for JSON-RPC notifications of type `Notif`.
    ///
    /// Notifications are fire-and-forget messages that don't expect a response.
    /// Your handler receives:
    /// 1. The notification (type `Notif`)
    /// 2. A [`ConnectionTo<R>`] for sending messages to the other side
    ///
    /// Unlike request handlers, you cannot send a response (notifications don't have IDs),
    /// but you can still send your own requests and notifications using the context.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_notification(async |notif: SessionUpdate, cx| {
    ///     // Process the notification
    ///     update_session_state(&notif)?;
    ///
    ///     // Optionally send a notification back
    ///     cx.send_notification(StatusUpdate {
    ///         message: "Acknowledged".into(),
    ///     })?;
    ///
    ///     Ok(())
    /// }, agent_client_protocol::on_receive_notification!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Type Parameter
    ///
    /// `Notif` can be either a single notification type or an enum of multiple notification types.
    /// See the [type-driven dispatch](Self#type-driven-message-dispatch) section for details.
    ///
    /// # Ordering
    ///
    /// This callback runs inside the dispatch loop and blocks further message processing
    /// until it completes. See the [`ordering`](crate::concepts::ordering) module for details on
    /// ordering guarantees and how to avoid deadlocks.
    pub fn on_receive_notification<Notif, F, T, ToFut>(
        self,
        op: F,
        to_future_hack: ToFut,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner>
    where
        Host::Counterpart: HasPeer<Host::Counterpart>,
        Notif: JsonRpcNotification,
        F: AsyncFnMut(Notif, ConnectionTo<Host::Counterpart>) -> Result<T, crate::Error> + Send,
        T: IntoHandled<(Notif, ConnectionTo<Host::Counterpart>)>,
        ToFut: Fn(
                &mut F,
                Notif,
                ConnectionTo<Host::Counterpart>,
            ) -> crate::BoxFuture<'_, Result<T, crate::Error>>
            + Send
            + Sync,
    {
        let handler = NotificationHandler::new(
            self.host.counterpart(),
            self.host.counterpart(),
            op,
            to_future_hack,
        );
        self.with_handler(handler)
    }

    /// Register a handler for messages from a specific peer.
    ///
    /// This is similar to [`on_receive_dispatch`](Self::on_receive_dispatch), but allows
    /// specifying the source peer explicitly. This is useful when receiving messages
    /// from a peer that requires message transformation (e.g., unwrapping `SuccessorMessage`
    /// envelopes when receiving from an agent via a proxy).
    ///
    /// For the common case of receiving from the default counterpart, use
    /// [`on_receive_dispatch`](Self::on_receive_dispatch) instead.
    ///
    /// # Ordering
    ///
    /// This callback runs inside the dispatch loop and blocks further message processing
    /// until it completes. See the [`ordering`](crate::concepts::ordering) module for details on
    /// ordering guarantees and how to avoid deadlocks.
    pub fn on_receive_dispatch_from<
        Req: JsonRpcRequest,
        Notif: JsonRpcNotification,
        Peer: Role,
        F,
        T,
        ToFut,
    >(
        self,
        peer: Peer,
        op: F,
        to_future_hack: ToFut,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner>
    where
        Host::Counterpart: HasPeer<Peer>,
        F: AsyncFnMut(
                Dispatch<Req, Notif>,
                ConnectionTo<Host::Counterpart>,
            ) -> Result<T, crate::Error>
            + Send,
        T: IntoHandled<Dispatch<Req, Notif>>,
        ToFut: Fn(
                &mut F,
                Dispatch<Req, Notif>,
                ConnectionTo<Host::Counterpart>,
            ) -> crate::BoxFuture<'_, Result<T, crate::Error>>
            + Send
            + Sync,
    {
        let handler = MessageHandler::new(self.host.counterpart(), peer, op, to_future_hack);
        self.with_handler(handler)
    }

    /// Register a handler for JSON-RPC requests from a specific peer.
    ///
    /// This is similar to [`on_receive_request`](Self::on_receive_request), but allows
    /// specifying the source peer explicitly. This is useful when receiving messages
    /// from a peer that requires message transformation (e.g., unwrapping `SuccessorRequest`
    /// envelopes when receiving from an agent via a proxy).
    ///
    /// For the common case of receiving from the default counterpart, use
    /// [`on_receive_request`](Self::on_receive_request) instead.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use agent_client_protocol::Agent;
    /// use agent_client_protocol::schema::v1::InitializeRequest;
    ///
    /// // Conductor receiving from agent direction - messages will be unwrapped from SuccessorMessage
    /// connection.on_receive_request_from(Agent, async |req: InitializeRequest, responder, cx| {
    ///     // Handle the request
    ///     responder.respond(InitializeResponse::make())
    /// })
    /// ```
    ///
    /// # Ordering
    ///
    /// This callback runs inside the dispatch loop and blocks further message processing
    /// until it completes. See the [`ordering`](crate::concepts::ordering) module for details on
    /// ordering guarantees and how to avoid deadlocks.
    pub fn on_receive_request_from<Req: JsonRpcRequest, Peer: Role, F, T, ToFut>(
        self,
        peer: Peer,
        op: F,
        to_future_hack: ToFut,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner>
    where
        Host::Counterpart: HasPeer<Peer>,
        F: AsyncFnMut(
                Req,
                Responder<Req::Response>,
                ConnectionTo<Host::Counterpart>,
            ) -> Result<T, crate::Error>
            + Send,
        T: IntoHandled<(Req, Responder<Req::Response>)>,
        ToFut: Fn(
                &mut F,
                Req,
                Responder<Req::Response>,
                ConnectionTo<Host::Counterpart>,
            ) -> crate::BoxFuture<'_, Result<T, crate::Error>>
            + Send
            + Sync,
    {
        let handler = RequestHandler::new(self.host.counterpart(), peer, op, to_future_hack);
        self.with_handler(handler)
    }

    /// Register a handler for JSON-RPC notifications from a specific peer.
    ///
    /// This is similar to [`on_receive_notification`](Self::on_receive_notification), but allows
    /// specifying the source peer explicitly. This is useful when receiving messages
    /// from a peer that requires message transformation (e.g., unwrapping `SuccessorNotification`
    /// envelopes when receiving from an agent via a proxy).
    ///
    /// For the common case of receiving from the default counterpart, use
    /// [`on_receive_notification`](Self::on_receive_notification) instead.
    ///
    /// # Ordering
    ///
    /// This callback runs inside the dispatch loop and blocks further message processing
    /// until it completes. See the [`ordering`](crate::concepts::ordering) module for details on
    /// ordering guarantees and how to avoid deadlocks.
    pub fn on_receive_notification_from<Notif: JsonRpcNotification, Peer: Role, F, T, ToFut>(
        self,
        peer: Peer,
        op: F,
        to_future_hack: ToFut,
    ) -> Builder<Host, impl HandleDispatchFrom<Host::Counterpart>, Runner>
    where
        Host::Counterpart: HasPeer<Peer>,
        F: AsyncFnMut(Notif, ConnectionTo<Host::Counterpart>) -> Result<T, crate::Error> + Send,
        T: IntoHandled<(Notif, ConnectionTo<Host::Counterpart>)>,
        ToFut: Fn(
                &mut F,
                Notif,
                ConnectionTo<Host::Counterpart>,
            ) -> crate::BoxFuture<'_, Result<T, crate::Error>>
            + Send
            + Sync,
    {
        let handler = NotificationHandler::new(self.host.counterpart(), peer, op, to_future_hack);
        self.with_handler(handler)
    }

    /// Add an MCP server that will be added to all new sessions that are proxied through this connection.
    ///
    /// Only applicable to proxies.
    pub fn with_mcp_server(
        self,
        mcp_server: McpServer<Host::Counterpart, impl RunWithConnectionTo<Host::Counterpart>>,
    ) -> Builder<
        Host,
        impl HandleDispatchFrom<Host::Counterpart>,
        impl RunWithConnectionTo<Host::Counterpart>,
    >
    where
        Host::Counterpart: HasPeer<Agent> + HasPeer<Client>,
    {
        let (handler, responder) = mcp_server.into_handler_and_responder();
        self.with_handler(handler).with_responder(responder)
    }

    /// Run in server mode with the provided transport.
    ///
    /// This drives the connection by continuously processing messages from the transport
    /// and dispatching them to your registered handlers. The connection will run until:
    /// - The transport closes (e.g., EOF on byte streams)
    /// - An error occurs
    /// - One of your handlers returns an error
    ///
    /// The transport is responsible for serializing and deserializing [`RawJsonRpcMessage`]
    /// values to/from the underlying I/O mechanism (byte streams, channels, etc.).
    ///
    /// Use this mode when you only need to respond to incoming messages and don't need
    /// to initiate your own requests. If you need to send requests to the other side,
    /// use [`connect_with`](Self::connect_with) instead.
    ///
    /// # Example: Byte Stream Transport
    ///
    /// ```no_run
    /// # use agent_client_protocol::UntypedRole;
    /// # use agent_client_protocol::{Builder};
    /// # use agent_client_protocol::Stdio;
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// let transport = Stdio::new();
    ///
    /// UntypedRole.builder()
    ///     .on_receive_request(async |req: MyRequest, responder, cx| {
    ///         responder.respond(MyResponse { status: "ok".into() })
    ///     }, agent_client_protocol::on_receive_request!())
    ///     .connect_to(transport)
    ///     .await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn connect_to(
        self,
        transport: impl ConnectTo<Host> + 'static,
    ) -> Result<(), crate::Error> {
        self.connect_with(transport, async move |_cx| future::pending().await)
            .await
    }

    /// Run the connection until the provided closure completes.
    ///
    /// This drives the connection by:
    /// 1. Running your registered handlers in the background to process incoming messages
    /// 2. Executing your `main_fn` closure with a [`ConnectionTo<R>`] for sending requests/notifications
    ///
    /// The connection stays active until your `main_fn` returns, then shuts down gracefully.
    /// If the connection closes unexpectedly before `main_fn` completes, this returns an error.
    ///
    /// Use this mode when you need to initiate communication (send requests/notifications)
    /// in addition to responding to incoming messages. For server-only mode where you just
    /// respond to messages, use [`connect_to`](Self::connect_to) instead.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # use agent_client_protocol::UntypedRole;
    /// # use agent_client_protocol::{Builder};
    /// # use agent_client_protocol::ByteStreams;
    /// # use agent_client_protocol::schema::v1::InitializeRequest;
    /// # use agent_client_protocol::Stdio;
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// let transport = Stdio::new();
    ///
    /// UntypedRole.builder()
    ///     .on_receive_request(async |req: MyRequest, responder, cx| {
    ///         // Handle incoming requests in the background
    ///         responder.respond(MyResponse { status: "ok".into() })
    ///     }, agent_client_protocol::on_receive_request!())
    ///     .connect_with(transport, async |cx| {
    ///         // Initialize the protocol
    ///         let init_response = cx.send_request(InitializeRequest::make())
    ///             .block_task()
    ///             .await?;
    ///
    ///         // Send more requests...
    ///         let result = cx.send_request(MyRequest {})
    ///             .block_task()
    ///             .await?;
    ///
    ///         // When this closure returns, the connection shuts down
    ///         Ok(())
    ///     })
    ///     .await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Parameters
    ///
    /// - `main_fn`: Your client logic. Receives a [`ConnectionTo<R>`] for sending messages.
    ///
    /// # Errors
    ///
    /// Returns an error if the connection closes before `main_fn` completes.
    pub async fn connect_with<R>(
        self,
        transport: impl ConnectTo<Host> + 'static,
        main_fn: impl AsyncFnOnce(ConnectionTo<Host::Counterpart>) -> Result<R, crate::Error>,
    ) -> Result<R, crate::Error> {
        let (_, future) = self.into_connection_and_future(transport, main_fn);
        future.await
    }

    /// Helper that returns a [`ConnectionTo<R>`] and a future that runs this connection until `main_fn` returns.
    fn into_connection_and_future<R>(
        self,
        transport: impl ConnectTo<Host> + 'static,
        main_fn: impl AsyncFnOnce(ConnectionTo<Host::Counterpart>) -> Result<R, crate::Error>,
    ) -> (
        ConnectionTo<Host::Counterpart>,
        impl Future<Output = Result<R, crate::Error>>,
    ) {
        let Self {
            name,
            handler,
            responder,
            host: me,
            protocol_mode,
        } = self;

        let (outgoing_tx, outgoing_rx) = mpsc::unbounded();
        let (new_task_tx, new_task_rx) = mpsc::unbounded();
        let (dynamic_handler_tx, dynamic_handler_rx) = mpsc::unbounded();
        let connection = ConnectionTo::new(
            me.counterpart(),
            outgoing_tx,
            new_task_tx,
            dynamic_handler_tx,
        );

        // Convert transport into server - this returns a channel for us to use
        // and a future that runs the transport
        let transport_component = crate::DynConnectTo::new(transport);
        let (transport_channel, transport_future) = transport_component.into_channel_and_future();
        let spawn_result = connection.spawn(transport_future);

        // Destructure the channel endpoints
        let Channel {
            rx: transport_incoming_rx,
            tx: transport_outgoing_tx,
        } = transport_channel;

        let (reply_tx, reply_rx) = mpsc::unbounded();
        let protocol_compat = ProtocolCompat::new(protocol_mode);

        let future = crate::util::instrument_with_connection_name(name, {
            let connection = connection.clone();
            async move {
                let () = spawn_result?;

                let background = async {
                    futures::try_join!(
                        // Protocol layer: OutgoingMessage -> RawJsonRpcMessage
                        outgoing_actor::outgoing_protocol_actor(
                            outgoing_rx,
                            reply_tx.clone(),
                            transport_outgoing_tx,
                            protocol_compat.clone(),
                        ),
                        // Protocol layer: RawJsonRpcMessage -> handler/reply routing
                        incoming_actor::incoming_protocol_actor(
                            me.counterpart(),
                            &connection,
                            transport_incoming_rx,
                            dynamic_handler_rx,
                            reply_rx,
                            handler,
                            protocol_compat,
                        ),
                        task_actor::task_actor(new_task_rx, &connection),
                        responder.run_with_connection_to(connection.clone()),
                    )?;
                    Ok(())
                };

                crate::util::run_until(Box::pin(background), Box::pin(main_fn(connection.clone())))
                    .await
            }
        });

        (connection, future)
    }
}

impl<R, H, Run> ConnectTo<R::Counterpart> for Builder<R, H, Run>
where
    R: Role,
    H: HandleDispatchFrom<R::Counterpart> + 'static,
    Run: RunWithConnectionTo<R::Counterpart> + 'static,
{
    async fn connect_to(self, client: impl ConnectTo<R>) -> Result<(), crate::Error> {
        Builder::connect_to(self, client).await
    }
}

/// The payload sent through the response oneshot channel.
///
/// Includes the response value and an optional ack channel for dispatch loop
/// synchronization.
pub(crate) struct ResponsePayload {
    /// The response result - either the JSON value or an error.
    pub(crate) result: Result<serde_json::Value, crate::Error>,

    /// Optional acknowledgment channel for dispatch loop synchronization.
    ///
    /// When present, the receiver must send on this channel to signal that
    /// response processing is complete, allowing the dispatch loop to continue
    /// to the next message.
    ///
    /// This is `None` for error paths where the response is sent directly
    /// (e.g., when the outgoing channel is broken) rather than through the
    /// normal dispatch loop flow.
    pub(crate) ack_tx: Option<oneshot::Sender<()>>,
}

impl std::fmt::Debug for ResponsePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResponsePayload")
            .field("result", &self.result)
            .field("ack_tx", &self.ack_tx.as_ref().map(|_| "..."))
            .finish()
    }
}

/// Message sent to the incoming actor for reply subscription management.
enum ReplyMessage {
    /// Subscribe to receive a response for the given request id.
    /// When a response with this id arrives, it will be sent through the oneshot
    /// along with an ack channel that must be signaled when processing is complete.
    /// The method name is stored to allow routing responses through typed handlers.
    Subscribe {
        id: RequestId,

        /// id of the peer this request was sent to
        role_id: RoleId,

        /// (original) method of the request -- the actual request may have been transformed
        /// to a successor method, but this will reflect the method of the wrapped request
        method: String,

        sender: oneshot::Sender<ResponsePayload>,

        cancellation_disarm: SentRequestCancellationDisarm,
    },
}

impl std::fmt::Debug for ReplyMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplyMessage::Subscribe { id, method, .. } => f
                .debug_struct("Subscribe")
                .field("id", id)
                .field("method", method)
                .finish(),
        }
    }
}

/// A request-local marker that is set when the peer asks to cancel the request.
///
/// Request handlers can get this handle from [`Responder::cancellation`] and
/// use it from spawned work to stop long-running request processing
/// cooperatively.
#[derive(Clone)]
pub struct RequestCancellation {
    state: Arc<RequestCancellationState>,
}

struct RequestCancellationState {
    cancelled: AtomicBool,
    signal_tx: Mutex<Option<oneshot::Sender<()>>>,
    signal_rx: future::Shared<BoxFuture<'static, ()>>,
}

impl RequestCancellation {
    fn new() -> Self {
        let (signal_tx, signal_rx) = oneshot::channel();
        let signal_rx = signal_rx.map(|_| ()).boxed().shared();
        Self {
            state: Arc::new(RequestCancellationState {
                cancelled: AtomicBool::new(false),
                signal_tx: Mutex::new(Some(signal_tx)),
                signal_rx,
            }),
        }
    }

    /// Wait until the peer sends `$/cancel_request` for this request.
    ///
    /// If cancellation was already requested, this returns immediately.
    pub async fn cancelled(&self) {
        self.state.signal_rx.clone().await;
    }

    /// Run request work until it completes or the peer asks to cancel it.
    ///
    /// If cancellation is requested first, this returns
    /// [`Error::request_cancelled`]. This is a convenience for request handlers
    /// that want to respond with the normal result or the standard
    /// cancellation error.
    ///
    /// When cancellation wins, `future` is dropped: work stops at its next
    /// await point, partial results are lost, and any cleanup must happen in
    /// `Drop` implementations. Handlers that need to flush partial results or
    /// run async cleanup should instead watch [`cancelled`](Self::cancelled)
    /// or poll [`is_cancelled`](Self::is_cancelled) from inside the work.
    ///
    /// [`Error::request_cancelled`]: crate::Error::request_cancelled
    pub async fn run_until_cancelled<T>(
        &self,
        future: impl std::future::Future<Output = Result<T, crate::Error>>,
    ) -> Result<T, crate::Error> {
        if self.is_cancelled() {
            return Err(crate::Error::request_cancelled());
        }

        match future::select(pin!(future), pin!(self.cancelled())).await {
            Either::Left((result, _)) => result,
            Either::Right(((), _)) => Err(crate::Error::request_cancelled()),
        }
    }

    /// Returns whether the peer has already requested cancellation.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::Acquire)
    }

    fn cancel(&self) {
        if self.state.cancelled.swap(true, Ordering::AcqRel) {
            return;
        }

        let signal_tx = self
            .state
            .signal_tx
            .lock()
            .expect("request cancellation signal mutex poisoned")
            .take();

        // Complete the oneshot outside the lock: it wakes waiters, and
        // arbitrary waker code must not observe the lock held.
        if let Some(signal_tx) = signal_tx {
            let _ = signal_tx.send(());
        }
    }
}

impl Debug for RequestCancellation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RequestCancellation")
            .field("is_cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

/// Per-request cancellation state tracked by [`RequestCancellationRegistry`].
///
/// The full [`RequestCancellation`] marker (with its wakeup machinery) is only
/// allocated once a handler asks for it via [`Responder::cancellation`]; until
/// then an incoming `$/cancel_request` just flips the entry to `Cancelled`.
/// This keeps the per-request cost of the registry to a single map entry.
#[derive(Debug)]
enum RequestCancellationEntry {
    /// The request is in flight; no marker handed out, no cancellation yet.
    Armed,
    /// `$/cancel_request` arrived before a marker was handed out.
    Cancelled,
    /// A marker was handed out via [`Responder::cancellation`].
    Marker(RequestCancellation),
}

/// A registered request's cancellation state, tagged with the generation of
/// its registration.
///
/// The generation distinguishes a registration from earlier ones that used
/// the same request ID, so that when a (protocol-violating) peer reuses the
/// ID of a request that is still in flight, the stale request's responder can
/// neither remove nor observe the cancellation state of the newer request.
#[derive(Debug)]
struct RequestCancellationSlot {
    generation: u64,
    entry: RequestCancellationEntry,
}

#[derive(Debug, Default)]
struct RequestCancellationRegistryInner {
    slots: HashMap<RequestId, RequestCancellationSlot>,
    next_generation: u64,
}

#[derive(Clone, Debug, Default)]
struct RequestCancellationRegistry {
    inner: Arc<Mutex<RequestCancellationRegistryInner>>,
}

#[derive(Debug)]
struct ResponderCancellation {
    id: RequestId,
    generation: u64,
    registry: RequestCancellationRegistry,
}

impl RequestCancellationRegistry {
    fn new() -> Self {
        Self::default()
    }

    fn register(&self, id: &RequestId) -> ResponderCancellation {
        let generation = {
            let mut inner = self
                .inner
                .lock()
                .expect("request cancellation registry mutex poisoned");
            let generation = inner.next_generation;
            inner.next_generation += 1;
            if inner
                .slots
                .insert(
                    id.clone(),
                    RequestCancellationSlot {
                        generation,
                        entry: RequestCancellationEntry::Armed,
                    },
                )
                .is_some()
            {
                tracing::debug!(
                    ?id,
                    "peer reused the ID of a request that is still in flight"
                );
            }
            generation
        };
        ResponderCancellation {
            id: id.clone(),
            generation,
            registry: self.clone(),
        }
    }

    /// Get the cancellation marker for a registered request, creating it on
    /// first use. Repeated calls return markers that share the same state.
    ///
    /// Exception: when the registration is stale (a protocol-violating peer
    /// reused this request ID and the slot now belongs to a newer request, or
    /// was already removed by it), every call returns a fresh *detached*
    /// marker. Detached markers can never fire, and detached markers from
    /// repeated calls do not share state with each other.
    fn marker(&self, id: &RequestId, generation: u64) -> RequestCancellation {
        let mut inner = self
            .inner
            .lock()
            .expect("request cancellation registry mutex poisoned");
        let Some(slot) = inner.slots.get_mut(id) else {
            // The slot lives as long as the responder that owns it, so this
            // is only reachable if the peer reused this request ID and the
            // newer request's responder already removed the replacement slot.
            // Hand out a detached marker rather than panicking.
            return RequestCancellation::new();
        };
        if slot.generation != generation {
            // The peer reused this request ID while the request was still in
            // flight, and the slot now belongs to the newer request. Hand the
            // stale responder a detached marker instead of cross-wiring the
            // two requests' cancellation states.
            return RequestCancellation::new();
        }
        let entry = &mut slot.entry;
        match entry {
            RequestCancellationEntry::Marker(marker) => marker.clone(),
            RequestCancellationEntry::Armed => {
                let marker = RequestCancellation::new();
                *entry = RequestCancellationEntry::Marker(marker.clone());
                marker
            }
            RequestCancellationEntry::Cancelled => {
                // No one can be waiting on a marker that did not exist yet,
                // so firing it while holding the registry lock is fine.
                let marker = RequestCancellation::new();
                marker.cancel();
                *entry = RequestCancellationEntry::Marker(marker.clone());
                marker
            }
        }
    }

    fn cancel_if_requested(&self, dispatch: &Dispatch) -> Result<bool, crate::Error> {
        let Some(request_id) = cancellation_request_id(dispatch)? else {
            return Ok(false);
        };
        Ok(self.cancel(&request_id))
    }

    /// Mark whichever request currently owns `request_id` as cancelled.
    fn cancel(&self, request_id: &RequestId) -> bool {
        let marker = {
            let mut inner = self
                .inner
                .lock()
                .expect("request cancellation registry mutex poisoned");
            let Some(slot) = inner.slots.get_mut(request_id) else {
                return false;
            };
            let entry = &mut slot.entry;
            match entry {
                RequestCancellationEntry::Marker(marker) => marker.clone(),
                RequestCancellationEntry::Cancelled => return true,
                RequestCancellationEntry::Armed => {
                    *entry = RequestCancellationEntry::Cancelled;
                    return true;
                }
            }
        };

        // Fire the marker outside the registry lock: waking waiters runs
        // arbitrary waker code that must not observe the lock held.
        marker.cancel();
        true
    }

    /// Remove the slot for `request_id`, but only if it still belongs to the
    /// registration identified by `generation`.
    fn remove(&self, request_id: &RequestId, generation: u64) {
        let mut inner = self
            .inner
            .lock()
            .expect("request cancellation registry mutex poisoned");
        if inner
            .slots
            .get(request_id)
            .is_some_and(|slot| slot.generation == generation)
        {
            inner.slots.remove(request_id);
        }
    }
}

impl ResponderCancellation {
    fn cancellation(&self) -> RequestCancellation {
        self.registry.marker(&self.id, self.generation)
    }
}

impl Drop for ResponderCancellation {
    fn drop(&mut self) {
        self.registry.remove(&self.id, self.generation);
    }
}

fn cancellation_request_id(dispatch: &Dispatch) -> Result<Option<RequestId>, crate::Error> {
    let Dispatch::Notification(message) = dispatch else {
        return Ok(None);
    };
    cancellation_request_id_from_message(message)
}

fn cancellation_request_id_from_message(
    message: &UntypedMessage,
) -> Result<Option<RequestId>, crate::Error> {
    let (method, params) = peel_successor_envelopes(&message.method, &message.params);
    if !crate::schema::v1::CancelRequestNotification::matches_method(method) {
        return Ok(None);
    }

    let notification = crate::schema::v1::CancelRequestNotification::parse_message(method, params)?;
    Ok(Some(notification.request_id))
}

/// Peel any [`SuccessorMessage`] envelopes off a notification by reference,
/// returning the innermost method and params.
///
/// This only peeks at the envelope's `method`/`params` fields instead of
/// deserializing the envelope, for two reasons:
///
/// - It avoids deep-cloning the params of every wrapped notification on the
///   hot dispatch path just to inspect the inner method name.
/// - It is deliberately lenient: a malformed envelope is left as-is here and
///   flows on to the handler chain, which is responsible for reporting it.
///
/// [`SuccessorMessage`]: crate::schema::SuccessorMessage
fn peel_successor_envelopes<'message>(
    mut method: &'message str,
    mut params: &'message serde_json::Value,
) -> (&'message str, &'message serde_json::Value) {
    while crate::schema::SuccessorMessage::<UntypedMessage>::matches_method(method) {
        let Some(inner_method) = params.get("method").and_then(serde_json::Value::as_str) else {
            break;
        };
        method = inner_method;
        params = params.get("params").unwrap_or(&serde_json::Value::Null);
    }
    (method, params)
}

/// Whether a notification is a `$/cancel_request`, even when it is still
/// wrapped in `_proxy/successor` envelopes.
///
/// `$/cancel_request` is connection-scoped: its `requestId` was allocated on
/// the connection the notification arrived over and means nothing on any
/// other connection. Generic forwarding code (such as
/// [`ConnectionTo::send_proxied_message_to`]) uses this check to drop the raw
/// notification instead of tunneling it across a hop; the cancellation still
/// propagates because [`forward_response_to`](SentRequest::forward_response_to)
/// re-issues it with the forwarded request's own ID.
///
/// Checking a notification whose method is not the successor envelope is a
/// plain method-name comparison. Only successor-wrapped notifications pay for
/// a serialization to peel the envelope.
#[must_use]
pub fn is_cancel_request_notification<N: JsonRpcNotification>(notification: &N) -> bool {
    let method = notification.method();
    if crate::schema::v1::CancelRequestNotification::matches_method(method) {
        return true;
    }
    if !crate::schema::SuccessorMessage::<UntypedMessage>::matches_method(method) {
        return false;
    }

    match notification.to_untyped_message() {
        Ok(untyped) => {
            let (method, _params) = peel_successor_envelopes(&untyped.method, &untyped.params);
            crate::schema::v1::CancelRequestNotification::matches_method(method)
        }
        Err(error) => {
            tracing::debug!(
                ?error,
                "failed to inspect successor-wrapped notification for cancellation"
            );
            false
        }
    }
}

/// Messages send to be serialized over the transport.
#[derive(Debug)]
enum OutgoingMessage {
    /// Send a request to the server.
    Request {
        /// id assigned to this request (generated by sender)
        id: RequestId,

        /// the original method
        method: String,

        /// the peer we sent this to
        role_id: RoleId,

        /// the message to send; this may have a distinct method
        /// depending on the peer
        untyped: UntypedMessage,

        /// where to send the response when it arrives (includes ack channel)
        response_tx: oneshot::Sender<ResponsePayload>,

        cancellation_disarm: SentRequestCancellationDisarm,
    },

    /// Send a notification to the server.
    Notification {
        /// the message to send; this may have a distinct method
        /// depending on the peer
        untyped: UntypedMessage,
    },

    /// Send a response to a message from the server
    Response {
        id: RequestId,

        /// Method of the incoming request this response completes.
        method: String,

        response: Result<serde_json::Value, crate::Error>,
    },

    /// Send a generalized error message
    Error { error: crate::Error },
}

/// Return type from JrHandler; indicates whether the request was handled or not.
#[must_use]
#[derive(Debug)]
pub enum Handled<T> {
    /// The message was handled
    Yes,

    /// The message was not handled; returns the original value.
    ///
    /// If `retry` is true,
    No {
        /// The message to be passed to subsequent handlers
        /// (typically the original message, but it may have been
        /// mutated.)
        message: T,

        /// If true, request the message to be queued and retried with
        /// dynamic handlers as they are added.
        ///
        /// This is used for managing session updates since the dynamic
        /// handler for a session cannot be added until the response to the
        /// new session request has been processed and there may be updates
        /// that get processed at the same time.
        retry: bool,
    },
}

/// Trait for converting handler return values into [`Handled`].
///
/// This trait allows handlers to return either `()` (which becomes `Handled::Yes`)
/// or an explicit `Handled<T>` value for more control over handler propagation.
pub trait IntoHandled<T> {
    /// Convert this value into a `Handled<T>`.
    fn into_handled(self) -> Handled<T>;
}

impl<T> IntoHandled<T> for () {
    fn into_handled(self) -> Handled<T> {
        Handled::Yes
    }
}

impl<T> IntoHandled<T> for Handled<T> {
    fn into_handled(self) -> Handled<T> {
        self
    }
}

/// Connection context for sending messages and spawning tasks.
///
/// This is the primary handle for interacting with the JSON-RPC connection from
/// within handler callbacks. You can use it to:
///
/// * Send requests and notifications to the other side
/// * Spawn concurrent tasks that run alongside the connection
/// * Respond to requests (via [`Responder`] which wraps this)
///
/// # Cloning
///
/// `ConnectionTo` is cheaply cloneable - all clones refer to the same underlying connection.
/// This makes it easy to share across async tasks.
///
/// # Event Loop and Concurrency
///
/// Handler callbacks run on the event loop, which means the connection cannot process new
/// messages while your handler is running. Use [`spawn`](Self::spawn) to offload any
/// expensive or blocking work to concurrent tasks.
///
/// See the [Event Loop and Concurrency](Builder#event-loop-and-concurrency) section
/// for more details.
#[derive(Clone, Debug)]
pub struct ConnectionTo<Counterpart: Role> {
    counterpart: Counterpart,
    message_tx: OutgoingMessageTx,
    task_tx: TaskTx,
    dynamic_handler_tx: mpsc::UnboundedSender<DynamicHandlerMessage<Counterpart>>,
}

impl<Counterpart: Role> ConnectionTo<Counterpart> {
    fn new(
        counterpart: Counterpart,
        message_tx: mpsc::UnboundedSender<OutgoingMessage>,
        task_tx: mpsc::UnboundedSender<Task>,
        dynamic_handler_tx: mpsc::UnboundedSender<DynamicHandlerMessage<Counterpart>>,
    ) -> Self {
        Self {
            counterpart,
            message_tx,
            task_tx,
            dynamic_handler_tx,
        }
    }

    /// Return the counterpart role this connection is talking to.
    pub fn counterpart(&self) -> Counterpart {
        self.counterpart.clone()
    }

    /// Spawns a task that will run so long as the JSON-RPC connection is being served.
    ///
    /// This is the primary mechanism for offloading expensive work from handler callbacks
    /// to avoid blocking the event loop. Spawned tasks run concurrently with the connection,
    /// allowing the server to continue processing messages.
    ///
    /// # Event Loop
    ///
    /// Handler callbacks run on the event loop, which cannot process new messages while
    /// your handler is running. Use `spawn` for any expensive operations:
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_request(async |req: ProcessRequest, responder, cx| {
    ///     // Clone cx for the spawned task
    ///     cx.spawn({
    ///         let connection = cx.clone();
    ///         async move {
    ///             let result = expensive_operation(&req.data).await?;
    ///             connection.send_notification(ProcessComplete { result })?;
    ///             Ok(())
    ///         }
    ///     })?;
    ///
    ///     // Respond immediately
    ///     responder.respond(ProcessResponse { result: "started".into() })
    /// }, agent_client_protocol::on_receive_request!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Errors
    ///
    /// If the spawned task returns an error, the entire server will shut down.
    #[track_caller]
    pub fn spawn(
        &self,
        task: impl IntoFuture<Output = Result<(), crate::Error>, IntoFuture: Send + 'static>,
    ) -> Result<(), crate::Error> {
        let location = std::panic::Location::caller();
        let task = task.into_future();
        Task::new(location, task).spawn(&self.task_tx)
    }

    /// Spawn a JSON-RPC connection in the background and return a [`ConnectionTo`] for sending messages to it.
    ///
    /// This is useful for creating multiple connections that communicate with each other,
    /// such as implementing proxy patterns or connecting to multiple backend services.
    ///
    /// # Arguments
    ///
    /// - `builder`: The connection builder with handlers configured
    /// - `transport`: The transport component to connect to
    ///
    /// # Returns
    ///
    /// A `ConnectionTo` that you can use to send requests and notifications to the spawned connection.
    ///
    /// # Example: Proxying to a backend connection
    ///
    /// ```
    /// # use agent_client_protocol::UntypedRole;
    /// # use agent_client_protocol::{Builder, ConnectionTo};
    /// # use agent_client_protocol_test::*;
    /// # async fn example(cx: ConnectionTo<UntypedRole>) -> Result<(), agent_client_protocol::Error> {
    /// // Set up a backend connection builder
    /// let backend = UntypedRole.builder()
    ///     .on_receive_request(async |req: MyRequest, responder, _cx| {
    ///         responder.respond(MyResponse { status: "ok".into() })
    ///     }, agent_client_protocol::on_receive_request!());
    ///
    /// // Spawn it and get a context to send requests to it
    /// let backend_connection = cx.spawn_connection(backend, MockTransport)?;
    ///
    /// // Now you can forward requests to the backend
    /// let response = backend_connection.send_request(MyRequest {}).block_task().await?;
    /// # Ok(())
    /// # }
    /// ```
    #[track_caller]
    pub fn spawn_connection<R: Role>(
        &self,
        builder: Builder<
            R,
            impl HandleDispatchFrom<R::Counterpart> + 'static,
            impl RunWithConnectionTo<R::Counterpart> + 'static,
        >,
        transport: impl ConnectTo<R> + 'static,
    ) -> Result<ConnectionTo<R::Counterpart>, crate::Error> {
        let (connection, future) =
            builder.into_connection_and_future(transport, |_| std::future::pending());
        Task::new(std::panic::Location::caller(), future).spawn(&self.task_tx)?;
        Ok(connection)
    }

    /// Send a request/notification and forward the response appropriately.
    ///
    /// The request context's response type matches the request's response type,
    /// enabling type-safe message forwarding.
    pub fn send_proxied_message<Req: JsonRpcRequest<Response: Send>, Notif: JsonRpcNotification>(
        &self,
        message: Dispatch<Req, Notif>,
    ) -> Result<(), crate::Error>
    where
        Counterpart: HasPeer<Counterpart>,
    {
        self.send_proxied_message_to(self.counterpart(), message)
    }

    /// Send a request/notification and forward the response appropriately.
    ///
    /// The request context's response type matches the request's response type,
    /// enabling type-safe message forwarding.
    ///
    /// `$/cancel_request` notifications are *not* forwarded: their `requestId`
    /// refers to a request on the connection they arrived over and would be
    /// meaningless to `peer`. Cancellation instead propagates hop by hop,
    /// because the responders passed to
    /// [`forward_response_to`](SentRequest::forward_response_to) observe it
    /// and re-issue the cancellation with the forwarded request's own ID.
    pub fn send_proxied_message_to<
        Peer: Role,
        Req: JsonRpcRequest<Response: Send>,
        Notif: JsonRpcNotification,
    >(
        &self,
        peer: Peer,
        message: Dispatch<Req, Notif>,
    ) -> Result<(), crate::Error>
    where
        Counterpart: HasPeer<Peer>,
    {
        match message {
            Dispatch::Request(request, responder) => self
                .send_request_to(peer, request)
                .forward_response_to(responder),
            Dispatch::Notification(notification) => {
                // `$/cancel_request` is connection-scoped: its `requestId` was
                // allocated on the connection the notification arrived over
                // and means nothing to `peer`. The cancellation has already
                // been recorded on this connection's responder markers, and
                // `forward_response_to` re-issues it for the forwarded request
                // with the correct per-hop ID, so drop the raw notification
                // instead of tunneling a meaningless ID across the hop.
                if is_cancel_request_notification(&notification) {
                    tracing::debug!(
                        "not forwarding hop-scoped `$/cancel_request` notification across proxy hop"
                    );
                    return Ok(());
                }
                self.send_notification_to(peer, notification)
            }
            Dispatch::Response(result, router) => {
                // Responses are forwarded directly to their destination
                router.respond_with_result(result)
            }
        }
    }

    /// Send an outgoing request and return a [`SentRequest`] for handling the reply.
    ///
    /// The returned [`SentRequest`] provides methods for receiving the response without
    /// blocking the event loop:
    ///
    /// * [`on_receiving_result`](SentRequest::on_receiving_result) - Schedule
    ///   a callback to run when the response arrives (doesn't block the event loop)
    /// * [`block_task`](SentRequest::block_task) - Block the current task until the response
    ///   arrives (only safe in spawned tasks, not in handlers)
    ///
    /// # Anti-Footgun Design
    ///
    /// The API intentionally makes it difficult to block on the result directly to prevent
    /// the common mistake of blocking the event loop while waiting for a response:
    ///
    /// ```compile_fail
    /// # use agent_client_protocol_test::*;
    /// # async fn example(cx: agent_client_protocol::ConnectionTo<agent_client_protocol::UntypedRole>) -> Result<(), agent_client_protocol::Error> {
    /// // ❌ This doesn't compile - prevents blocking the event loop
    /// let response = cx.send_request(MyRequest {}).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example(cx: agent_client_protocol::ConnectionTo<agent_client_protocol::UntypedRole>) -> Result<(), agent_client_protocol::Error> {
    /// // ✅ Option 1: Schedule callback (safe in handlers)
    /// cx.send_request(MyRequest {})
    ///     .on_receiving_result(async |result| {
    ///         // Handle the response
    ///         Ok(())
    ///     })?;
    ///
    /// // ✅ Option 2: Block in spawned task (safe because task is concurrent)
    /// cx.spawn({
    ///     let cx = cx.clone();
    ///     async move {
    ///         let response = cx.send_request(MyRequest {})
    ///             .block_task()
    ///             .await?;
    ///         // Process response...
    ///         Ok(())
    ///     }
    /// })?;
    /// # Ok(())
    /// # }
    /// ```
    /// Send an outgoing request to the default counterpart peer.
    ///
    /// This is a convenience method that sends to the counterpart role `R`.
    /// For explicit control over the target peer, use [`send_request_to`](Self::send_request_to).
    pub fn send_request<Req: JsonRpcRequest>(&self, request: Req) -> SentRequest<Req::Response>
    where
        Counterpart: HasPeer<Counterpart>,
    {
        self.send_request_to(self.counterpart.clone(), request)
    }

    /// Send an outgoing request to a specific peer.
    ///
    /// The message will be transformed according to the [`HasPeer`](crate::role::HasPeer)
    /// implementation before being sent.
    pub fn send_request_to<Peer: Role, Req: JsonRpcRequest>(
        &self,
        peer: Peer,
        request: Req,
    ) -> SentRequest<Req::Response>
    where
        Counterpart: HasPeer<Peer>,
    {
        let method = request.method().to_string();
        let id = RequestId::Str(uuid::Uuid::new_v4().to_string());
        let (response_tx, response_rx) = oneshot::channel();
        let role_id = peer.role_id();
        let remote_style = self.counterpart.remote_style(peer);
        let cancellation =
            SentRequestCancellation::new(self.message_tx.clone(), remote_style, id.clone());
        match remote_style.transform_outgoing_message(request) {
            Ok(untyped) => {
                // Transform the message for the target role
                let message = OutgoingMessage::Request {
                    id: id.clone(),
                    method: method.clone(),
                    role_id,
                    untyped,
                    response_tx,
                    cancellation_disarm: cancellation.disarm_handle(),
                };

                match self.message_tx.unbounded_send(message) {
                    Ok(()) => (),
                    Err(error) => {
                        cancellation.disarm();

                        let OutgoingMessage::Request {
                            method,
                            response_tx,
                            ..
                        } = error.into_inner()
                        else {
                            unreachable!();
                        };

                        response_tx
                            .send(ResponsePayload {
                                result: Err(crate::util::internal_error(format!(
                                    "failed to send outgoing request `{method}"
                                ))),
                                ack_tx: None,
                            })
                            .unwrap();
                    }
                }
            }

            Err(err) => {
                cancellation.disarm();

                response_tx
                    .send(ResponsePayload {
                        result: Err(crate::util::internal_error(format!(
                            "failed to create untyped request for `{method}`: {err}"
                        ))),
                        ack_tx: None,
                    })
                    .unwrap();
            }
        }

        SentRequest::new(
            id,
            method.clone(),
            self.task_tx.clone(),
            response_rx,
            cancellation,
        )
        .map(move |json| <Req::Response>::from_value(&method, json))
    }

    /// Send an outgoing notification to the default counterpart peer (no reply expected).
    ///
    /// Notifications are fire-and-forget messages that don't have IDs and don't expect responses.
    /// This method sends the notification immediately and returns.
    ///
    /// This is a convenience method that sends to the counterpart role `R`.
    /// For explicit control over the target peer, use [`send_notification_to`](Self::send_notification_to).
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example(cx: agent_client_protocol::ConnectionTo<agent_client_protocol::Agent>) -> Result<(), agent_client_protocol::Error> {
    /// cx.send_notification(StatusUpdate {
    ///     message: "Processing...".into(),
    /// })?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn send_notification<N: JsonRpcNotification>(
        &self,
        notification: N,
    ) -> Result<(), crate::Error>
    where
        Counterpart: HasPeer<Counterpart>,
    {
        self.send_notification_to(self.counterpart.clone(), notification)
    }

    /// Send an outgoing notification to a specific peer (no reply expected).
    ///
    /// The message will be transformed according to the [`HasPeer`](crate::role::HasPeer)
    /// implementation before being sent.
    pub fn send_notification_to<Peer: Role, N: JsonRpcNotification>(
        &self,
        peer: Peer,
        notification: N,
    ) -> Result<(), crate::Error>
    where
        Counterpart: HasPeer<Peer>,
    {
        let remote_style = self.counterpart.remote_style(peer);
        tracing::debug!(
            role = std::any::type_name::<Counterpart>(),
            peer = std::any::type_name::<Peer>(),
            notification_type = std::any::type_name::<N>(),
            ?remote_style,
            original_method = notification.method(),
            "send_notification_to"
        );
        let transformed = remote_style.transform_outgoing_message(notification)?;
        tracing::debug!(
            transformed_method = %transformed.method,
            "send_notification_to transformed"
        );
        send_raw_message(
            &self.message_tx,
            OutgoingMessage::Notification {
                untyped: transformed,
            },
        )
    }

    /// Send a `$/cancel_request` notification for an arbitrary request ID to
    /// the default counterpart peer.
    ///
    /// Prefer [`SentRequest::cancel`] when you have the request handle: it
    /// already knows the correct peer, request ID, and proxy wrapping. Use this
    /// low-level method only when implementing custom routing with a request ID
    /// that is valid on this connection.
    pub fn send_cancel_request(
        &self,
        request_id: impl Into<crate::schema::v1::RequestId>,
    ) -> Result<(), crate::Error>
    where
        Counterpart: HasPeer<Counterpart>,
    {
        self.send_cancel_request_to(self.counterpart.clone(), request_id)
    }

    /// Send a `$/cancel_request` notification for an arbitrary request ID to a
    /// specific peer.
    ///
    /// Prefer [`SentRequest::cancel`] when you have the request handle: it
    /// already knows the correct peer, request ID, and proxy wrapping. Use this
    /// low-level method only when implementing custom routing with a request ID
    /// that is valid on the target peer's connection.
    pub fn send_cancel_request_to<Peer: Role>(
        &self,
        peer: Peer,
        request_id: impl Into<crate::schema::v1::RequestId>,
    ) -> Result<(), crate::Error>
    where
        Counterpart: HasPeer<Peer>,
    {
        self.send_notification_to(
            peer,
            crate::schema::v1::CancelRequestNotification::new(request_id),
        )
    }

    /// Send an error notification (no reply expected).
    pub fn send_error_notification(&self, error: crate::Error) -> Result<(), crate::Error> {
        send_raw_message(&self.message_tx, OutgoingMessage::Error { error })
    }

    /// Register a dynamic message handler, used to intercept messages specific to a particular session
    /// or some similar modal thing.
    ///
    /// Dynamic message handlers are called first for every incoming message.
    ///
    /// If they decline to handle the message, then the message is passed to the regular registered handlers.
    ///
    /// The handler will stay registered until the returned registration guard is dropped.
    pub fn add_dynamic_handler(
        &self,
        handler: impl HandleDispatchFrom<Counterpart> + 'static,
    ) -> Result<DynamicHandlerRegistration<Counterpart>, crate::Error> {
        let uuid = Uuid::new_v4();
        self.dynamic_handler_tx
            .unbounded_send(DynamicHandlerMessage::AddDynamicHandler(
                uuid,
                Box::new(handler),
            ))
            .map_err(crate::util::internal_error)?;

        Ok(DynamicHandlerRegistration::new(uuid, self.clone()))
    }

    fn remove_dynamic_handler(&self, uuid: Uuid) {
        // Ignore errors
        drop(
            self.dynamic_handler_tx
                .unbounded_send(DynamicHandlerMessage::RemoveDynamicHandler(uuid)),
        );
    }
}

#[derive(Clone, Debug)]
pub struct DynamicHandlerRegistration<R: Role> {
    uuid: Uuid,
    cx: ConnectionTo<R>,
}

impl<R: Role> DynamicHandlerRegistration<R> {
    fn new(uuid: Uuid, cx: ConnectionTo<R>) -> Self {
        Self { uuid, cx }
    }

    /// Prevents the dynamic handler from being removed when dropped.
    pub fn run_indefinitely(self) {
        std::mem::forget(self);
    }
}

impl<R: Role> Drop for DynamicHandlerRegistration<R> {
    fn drop(&mut self) {
        self.cx.remove_dynamic_handler(self.uuid);
    }
}

/// The context to respond to an incoming request.
///
/// This context is provided to request handlers and serves a dual role:
///
/// 1. **Respond to the request** - Use [`respond`](Self::respond) or
///    [`respond_with_result`](Self::respond_with_result) to send the response
/// 2. **Send other messages** - Use the [`ConnectionTo`] parameter passed to your
///    handler, which provides [`send_request`](`ConnectionTo::send_request`),
///    [`send_notification`](`ConnectionTo::send_notification`), and
///    [`spawn`](`ConnectionTo::spawn`)
///
/// # Example
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// connection.on_receive_request(async |req: ProcessRequest, responder, cx| {
///     // Send a notification while processing
///     cx.send_notification(StatusUpdate {
///         message: "processing".into(),
///     })?;
///
///     // Do some work...
///     let result = process(&req.data)?;
///
///     // Respond to the request
///     responder.respond(ProcessResponse { result })
/// }, agent_client_protocol::on_receive_request!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// # Event Loop Considerations
///
/// Like all handlers, request handlers run on the event loop. Use
/// [`spawn`](ConnectionTo::spawn) for expensive operations to avoid blocking
/// the connection.
///
/// See the [Event Loop and Concurrency](Builder#event-loop-and-concurrency)
/// section for more details.
#[must_use]
pub struct Responder<T: JsonRpcResponse = serde_json::Value> {
    /// The method of the request.
    method: String,

    /// The `id` of the message we are replying to.
    id: RequestId,

    /// Request-local cancellation state.
    cancellation: ResponderCancellation,

    /// Function to send the response to its destination.
    ///
    /// For incoming requests: serializes to JSON and sends over the wire.
    /// For incoming responses: sends to the waiting oneshot channel.
    send_fn: Box<dyn FnOnce(Result<T, crate::Error>) -> Result<(), crate::Error> + Send>,
}

impl<T: JsonRpcResponse> std::fmt::Debug for Responder<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Responder")
            .field("method", &self.method)
            .field("id", &self.id)
            .field("response_type", &std::any::type_name::<T>())
            .finish_non_exhaustive()
    }
}

impl Responder<serde_json::Value> {
    /// Create a new request context for an incoming request.
    ///
    /// The response will be serialized to JSON and sent over the wire.
    fn new(
        message_tx: OutgoingMessageTx,
        method: String,
        id: RequestId,
        cancellation_registry: &RequestCancellationRegistry,
    ) -> Self {
        let id_clone = id.clone();
        let method_clone = method.clone();
        let cancellation = cancellation_registry.register(&id);
        Self {
            method,
            id,
            cancellation,
            send_fn: Box::new(move |response: Result<serde_json::Value, crate::Error>| {
                send_raw_message(
                    &message_tx,
                    OutgoingMessage::Response {
                        id: id_clone,
                        method: method_clone,
                        response,
                    },
                )
            }),
        }
    }

    /// Cast this request context to a different response type.
    ///
    /// The provided type `T` will be serialized to JSON before sending.
    pub fn cast<T: JsonRpcResponse>(self) -> Responder<T> {
        self.wrap_params(move |method, value| match value {
            Ok(value) => T::into_json(value, method),
            Err(e) => Err(e),
        })
    }
}

impl<T: JsonRpcResponse> Responder<T> {
    /// Method of the incoming request
    #[must_use]
    pub fn method(&self) -> &str {
        &self.method
    }

    /// ID of the incoming request/response as a JSON value
    #[must_use]
    pub fn id(&self) -> serde_json::Value {
        crate::util::id_to_json(&self.id)
    }

    /// Returns the cancellation marker for this request.
    ///
    /// The marker is set when the peer sends `$/cancel_request` for this
    /// request's JSON-RPC ID. Cancellation is cooperative: handlers should use
    /// the marker to stop long-running work and then decide whether to respond
    /// with [`Error::request_cancelled`] or partial data.
    ///
    /// [`Error::request_cancelled`]: crate::Error::request_cancelled
    #[must_use]
    pub fn cancellation(&self) -> RequestCancellation {
        self.cancellation.cancellation()
    }

    /// Convert to a `Responder` that expects a JSON value
    /// and which checks (dynamically) that the JSON value it receives
    /// can be converted to `T`.
    pub fn erase_to_json(self) -> Responder<serde_json::Value> {
        self.wrap_params(|method, value| T::from_value(method, value?))
    }

    /// Return a new Responder with a different method name.
    pub fn wrap_method(self, method: String) -> Responder<T> {
        Responder {
            method,
            id: self.id,
            cancellation: self.cancellation,
            send_fn: self.send_fn,
        }
    }

    /// Return a new Responder that expects a response of type U.
    ///
    /// `wrap_fn` will be invoked with the method name and the result to transform
    /// type `U` into type `T` before sending.
    pub fn wrap_params<U: JsonRpcResponse>(
        self,
        wrap_fn: impl FnOnce(&str, Result<U, crate::Error>) -> Result<T, crate::Error> + Send + 'static,
    ) -> Responder<U> {
        let method = self.method.clone();
        Responder {
            method: self.method,
            id: self.id,
            cancellation: self.cancellation,
            send_fn: Box::new(move |input: Result<U, crate::Error>| {
                let t_value = wrap_fn(&method, input);
                (self.send_fn)(t_value)
            }),
        }
    }

    /// Respond to the JSON-RPC request with either a value (`Ok`) or an error (`Err`).
    pub fn respond_with_result(
        self,
        response: Result<T, crate::Error>,
    ) -> Result<(), crate::Error> {
        tracing::debug!(id = ?self.id, "respond called");
        (self.send_fn)(response)
    }

    /// Respond to the JSON-RPC request with a value.
    pub fn respond(self, response: T) -> Result<(), crate::Error> {
        self.respond_with_result(Ok(response))
    }

    /// Respond to the JSON-RPC request with an internal error containing a message.
    pub fn respond_with_internal_error(self, message: impl ToString) -> Result<(), crate::Error> {
        self.respond_with_error(crate::util::internal_error(message))
    }

    /// Respond to the JSON-RPC request with an error.
    pub fn respond_with_error(self, error: crate::Error) -> Result<(), crate::Error> {
        tracing::debug!(id = ?self.id, ?error, "respond_with_error called");
        self.respond_with_result(Err(error))
    }
}

/// Context for handling an incoming JSON-RPC response.
///
/// This is the response-side counterpart to [`Responder`]. While `Responder` handles
/// incoming requests (where you send a response over the wire), `ResponseRouter` handles
/// incoming responses (where you route the response to a local task waiting for it).
///
/// Both are fundamentally "sinks" that push the message through a `send_fn`, but they
/// represent different points in the message lifecycle and carry different metadata.
///
/// # Drop Behavior
///
/// Dropping a `ResponseRouter` without responding (for example, from a
/// dispatch handler that claims a [`Dispatch::Response`]) discards the
/// response: the local awaiter observes the response as never received. The
/// request still counts as settled: routing a response this far disarms the
/// originating [`SentRequest`]'s drop-time auto-cancellation even if the router
/// is never invoked, since the peer has already answered.
#[must_use]
pub struct ResponseRouter<T: JsonRpcResponse = serde_json::Value> {
    /// The method of the original request.
    method: String,

    /// The `id` of the original request.
    id: RequestId,

    /// The RoleId to which the original request was sent
    /// (and hence from which the reply is expected).
    role_id: RoleId,

    /// Function to send the response to the waiting task.
    send_fn: Box<dyn FnOnce(Result<T, crate::Error>) -> Result<(), crate::Error> + Send>,
}

impl<T: JsonRpcResponse> std::fmt::Debug for ResponseRouter<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResponseRouter")
            .field("method", &self.method)
            .field("id", &self.id)
            .field("response_type", &std::any::type_name::<T>())
            .finish_non_exhaustive()
    }
}

impl ResponseRouter<serde_json::Value> {
    /// Create a new response context for routing a response to a local awaiter.
    ///
    /// When `respond_with_result` is called, the response is sent through the oneshot
    /// channel to the code that originally sent the request. If that receiver was
    /// dropped, the response is discarded because there is no local awaiter left.
    pub(crate) fn new(
        method: String,
        id: RequestId,
        role_id: RoleId,
        sender: oneshot::Sender<ResponsePayload>,
        cancellation_disarm: SentRequestCancellationDisarm,
    ) -> Self {
        let response_method = method.clone();
        let response_id = id.clone();
        // A response for the request reached this router, so the request is
        // settled from the peer's perspective and a `$/cancel_request` could
        // only ever be redundant. Disarm immediately so handlers may retain
        // the router without leaving auto-cancellation armed.
        cancellation_disarm.disarm();
        Self {
            method,
            id,
            role_id,
            send_fn: Box::new(move |response: Result<serde_json::Value, crate::Error>| {
                if sender
                    .send(ResponsePayload {
                        result: response,
                        ack_tx: None,
                    })
                    .is_err()
                {
                    tracing::debug!(
                        method = %response_method,
                        id = ?response_id,
                        "dropped response because local receiver was gone"
                    );
                }
                Ok(())
            }),
        }
    }

    /// Cast this response context to a different response type.
    ///
    /// The provided type `T` will be serialized to JSON before sending.
    pub fn cast<T: JsonRpcResponse>(self) -> ResponseRouter<T> {
        self.wrap_params(move |method, value| match value {
            Ok(value) => T::into_json(value, method),
            Err(e) => Err(e),
        })
    }
}

impl<T: JsonRpcResponse> ResponseRouter<T> {
    /// Method of the original request
    #[must_use]
    pub fn method(&self) -> &str {
        &self.method
    }

    /// ID of the original request as a JSON value
    #[must_use]
    pub fn id(&self) -> serde_json::Value {
        crate::util::id_to_json(&self.id)
    }

    /// The peer to which the original request was sent.
    ///
    /// This is the peer from which we expect to receive the response.
    #[must_use]
    pub fn role_id(&self) -> RoleId {
        self.role_id.clone()
    }

    /// Convert to a `ResponseRouter` that expects a JSON value
    /// and which checks (dynamically) that the JSON value it receives
    /// can be converted to `T`.
    pub fn erase_to_json(self) -> ResponseRouter<serde_json::Value> {
        self.wrap_params(|method, value| T::from_value(method, value?))
    }

    /// Return a new ResponseRouter that expects a response of type U.
    ///
    /// `wrap_fn` will be invoked with the method name and the result to transform
    /// type `U` into type `T` before sending.
    fn wrap_params<U: JsonRpcResponse>(
        self,
        wrap_fn: impl FnOnce(&str, Result<U, crate::Error>) -> Result<T, crate::Error> + Send + 'static,
    ) -> ResponseRouter<U> {
        let method = self.method.clone();
        ResponseRouter {
            method: self.method,
            id: self.id,
            role_id: self.role_id,
            send_fn: Box::new(move |input: Result<U, crate::Error>| {
                let t_value = wrap_fn(&method, input);
                (self.send_fn)(t_value)
            }),
        }
    }

    /// Complete the response by sending the result to the waiting task.
    pub fn respond_with_result(
        self,
        response: Result<T, crate::Error>,
    ) -> Result<(), crate::Error> {
        tracing::debug!(id = ?self.id, "response routed to awaiter");
        (self.send_fn)(response)
    }

    /// Complete the response by sending a value to the waiting task.
    pub fn respond(self, response: T) -> Result<(), crate::Error> {
        self.respond_with_result(Ok(response))
    }

    /// Complete the response by sending an internal error to the waiting task.
    pub fn respond_with_internal_error(self, message: impl ToString) -> Result<(), crate::Error> {
        self.respond_with_error(crate::util::internal_error(message))
    }

    /// Complete the response by sending an error to the waiting task.
    pub fn respond_with_error(self, error: crate::Error) -> Result<(), crate::Error> {
        tracing::debug!(id = ?self.id, ?error, "error routed to awaiter");
        self.respond_with_result(Err(error))
    }
}

/// Common bounds for any JSON-RPC message.
///
/// # Derive Macro
///
/// For simple message types, you can use the `JsonRpcRequest` or `JsonRpcNotification` derive macros
/// which will implement both `JsonRpcMessage` and the respective trait. See [`JsonRpcRequest`] and
/// [`JsonRpcNotification`] for examples.
pub trait JsonRpcMessage: 'static + Debug + Sized + Send + Clone {
    /// Check if this message type matches the given method name.
    fn matches_method(method: &str) -> bool;

    /// The method name for the message.
    fn method(&self) -> &str;

    /// Convert this message into an untyped message.
    fn to_untyped_message(&self) -> Result<UntypedMessage, crate::Error>;

    /// Parse this type from a method name and parameters.
    ///
    /// Returns an error if the method doesn't match or deserialization fails.
    /// Callers should use `matches_method` first to check if this type handles the method.
    fn parse_message(method: &str, params: &impl Serialize) -> Result<Self, crate::Error>;
}

/// Defines the "payload" of a successful response to a JSON-RPC request.
///
/// # Derive Macro
///
/// Use `#[derive(JsonRpcResponse)]` to automatically implement this trait:
///
/// ```ignore
/// use agent_client_protocol::JsonRpcResponse;
/// use serde::{Serialize, Deserialize};
///
/// #[derive(Debug, Serialize, Deserialize, JsonRpcResponse)]
/// #[response(method = "_hello")]
/// struct HelloResponse {
///     greeting: String,
/// }
/// ```
pub trait JsonRpcResponse: 'static + Debug + Sized + Send + Clone {
    /// Convert this message into a JSON value.
    fn into_json(self, method: &str) -> Result<serde_json::Value, crate::Error>;

    /// Parse a JSON value into the response type.
    fn from_value(method: &str, value: serde_json::Value) -> Result<Self, crate::Error>;
}

impl JsonRpcResponse for serde_json::Value {
    fn from_value(_method: &str, value: serde_json::Value) -> Result<Self, crate::Error> {
        Ok(value)
    }

    fn into_json(self, _method: &str) -> Result<serde_json::Value, crate::Error> {
        Ok(self)
    }
}

/// A struct that represents a notification (JSON-RPC message that does not expect a response).
///
/// # Derive Macro
///
/// Use `#[derive(JsonRpcNotification)]` to automatically implement both `JsonRpcMessage` and `JsonRpcNotification`:
///
/// ```ignore
/// use agent_client_protocol::JsonRpcNotification;
/// use serde::{Serialize, Deserialize};
///
/// #[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
/// #[notification(method = "_ping")]
/// struct PingNotification {
///     timestamp: u64,
/// }
/// ```
pub trait JsonRpcNotification: JsonRpcMessage {}

/// A struct that represents a request (JSON-RPC message expecting a response).
///
/// # Derive Macro
///
/// Use `#[derive(JsonRpcRequest)]` to automatically implement both `JsonRpcMessage` and `JsonRpcRequest`:
///
/// ```ignore
/// use agent_client_protocol::{JsonRpcRequest, JsonRpcResponse};
/// use serde::{Serialize, Deserialize};
///
/// #[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
/// #[request(method = "_hello", response = HelloResponse)]
/// struct HelloRequest {
///     name: String,
/// }
///
/// #[derive(Debug, Serialize, Deserialize, JsonRpcResponse)]
/// struct HelloResponse {
///     greeting: String,
/// }
/// ```
pub trait JsonRpcRequest: JsonRpcMessage {
    /// The type of data expected in response.
    type Response: JsonRpcResponse;
}

/// An enum capturing an in-flight request or notification.
/// In the case of a request, also includes the context used to respond to the request.
///
/// Type parameters allow specifying the concrete request and notification types.
/// By default, both are `UntypedMessage` for dynamic dispatch.
/// The request context's response type matches the request's response type.
#[derive(Debug)]
pub enum Dispatch<Req: JsonRpcRequest = UntypedMessage, Notif: JsonRpcMessage = UntypedMessage> {
    /// Incoming request and the context where the response should be sent.
    Request(Req, Responder<Req::Response>),

    /// Incoming notification.
    Notification(Notif),

    /// Incoming response to a request we sent.
    ///
    /// The first field is the response result (success or error from the remote).
    /// The second field is the context for forwarding the response to its destination
    /// (typically a waiting oneshot channel).
    Response(
        Result<Req::Response, crate::Error>,
        ResponseRouter<Req::Response>,
    ),
}

impl<Req: JsonRpcRequest, Notif: JsonRpcMessage> Dispatch<Req, Notif> {
    /// Map the request and notification types to new types.
    ///
    /// Note: Response variants are passed through unchanged since they don't
    /// contain a parseable message payload.
    pub fn map<Req1, Notif1>(
        self,
        map_request: impl FnOnce(Req, Responder<Req::Response>) -> (Req1, Responder<Req1::Response>),
        map_notification: impl FnOnce(Notif) -> Notif1,
    ) -> Dispatch<Req1, Notif1>
    where
        Req1: JsonRpcRequest<Response = Req::Response>,
        Notif1: JsonRpcMessage,
    {
        match self {
            Dispatch::Request(request, responder) => {
                let (new_request, new_responder) = map_request(request, responder);
                Dispatch::Request(new_request, new_responder)
            }
            Dispatch::Notification(notification) => {
                let new_notification = map_notification(notification);
                Dispatch::Notification(new_notification)
            }
            Dispatch::Response(result, router) => Dispatch::Response(result, router),
        }
    }

    /// Respond to the message with an error.
    ///
    /// If this message is a request, this error becomes the reply to the request.
    ///
    /// If this message is a notification, the error is sent as a notification.
    ///
    /// If this message is a response, the error is forwarded to the waiting handler.
    pub fn respond_with_error<R: Role>(
        self,
        error: crate::Error,
        cx: ConnectionTo<R>,
    ) -> Result<(), crate::Error> {
        match self {
            Dispatch::Request(_, responder) => responder.respond_with_error(error),
            Dispatch::Notification(_) => cx.send_error_notification(error),
            Dispatch::Response(_, responder) => responder.respond_with_error(error),
        }
    }

    /// Convert to a `Responder` that expects a JSON value
    /// and which checks (dynamically) that the JSON value it receives
    /// can be converted to `T`.
    ///
    /// Note: Response variants cannot be erased since their payload is already
    /// parsed. This returns an error for Response variants.
    pub fn erase_to_json(self) -> Result<Dispatch, crate::Error> {
        match self {
            Dispatch::Request(response, responder) => Ok(Dispatch::Request(
                response.to_untyped_message()?,
                responder.erase_to_json(),
            )),
            Dispatch::Notification(notification) => {
                Ok(Dispatch::Notification(notification.to_untyped_message()?))
            }
            Dispatch::Response(_, _) => Err(crate::util::internal_error(
                "cannot erase Response variant to JSON",
            )),
        }
    }

    /// Convert the message in self to an untyped message.
    ///
    /// Note: Response variants don't have an untyped message representation.
    /// This returns an error for Response variants.
    pub fn to_untyped_message(&self) -> Result<UntypedMessage, crate::Error> {
        match self {
            Dispatch::Request(request, _) => request.to_untyped_message(),
            Dispatch::Notification(notification) => notification.to_untyped_message(),
            Dispatch::Response(_, _) => Err(crate::util::internal_error(
                "Response variant has no untyped message representation",
            )),
        }
    }

    /// Convert self to an untyped message context.
    ///
    /// Note: Response variants cannot be converted. This returns an error for Response variants.
    pub fn into_untyped_dispatch(self) -> Result<Dispatch, crate::Error> {
        match self {
            Dispatch::Request(request, responder) => Ok(Dispatch::Request(
                request.to_untyped_message()?,
                responder.erase_to_json(),
            )),
            Dispatch::Notification(notification) => {
                Ok(Dispatch::Notification(notification.to_untyped_message()?))
            }
            Dispatch::Response(_, _) => Err(crate::util::internal_error(
                "cannot convert Response variant to untyped message context",
            )),
        }
    }

    /// Returns the request ID if this is a request or response, None if notification.
    pub fn id(&self) -> Option<serde_json::Value> {
        match self {
            Dispatch::Request(_, cx) => Some(cx.id()),
            Dispatch::Notification(_) => None,
            Dispatch::Response(_, cx) => Some(cx.id()),
        }
    }

    /// Returns the method of the message.
    ///
    /// For requests and notifications, this is the method from the message payload.
    /// For responses, this is the method of the original request.
    pub fn method(&self) -> &str {
        match self {
            Dispatch::Request(msg, _) => msg.method(),
            Dispatch::Notification(msg) => msg.method(),
            Dispatch::Response(_, cx) => cx.method(),
        }
    }
}

impl Dispatch {
    /// Attempts to parse `self` into a typed message context.
    ///
    /// # Returns
    ///
    /// * `Ok(Ok(typed))` if this is a request/notification of the given types
    /// * `Ok(Err(self))` if not
    /// * `Err` if has the correct method for the given types but parsing fails
    #[tracing::instrument(skip(self), fields(Request = ?std::any::type_name::<Req>(), Notif = ?std::any::type_name::<Notif>()), level = "trace", ret)]
    pub(crate) fn into_typed_dispatch<Req: JsonRpcRequest, Notif: JsonRpcNotification>(
        self,
    ) -> Result<Result<Dispatch<Req, Notif>, Dispatch>, crate::Error> {
        tracing::debug!(
            message = ?self,
            "into_typed_dispatch"
        );
        match self {
            Dispatch::Request(message, responder) => {
                if Req::matches_method(&message.method) {
                    match Req::parse_message(&message.method, &message.params) {
                        Ok(req) => {
                            tracing::trace!(?req, "parsed ok");
                            Ok(Ok(Dispatch::Request(req, responder.cast())))
                        }
                        Err(err) => {
                            tracing::trace!(?err, "parse error");
                            Err(err)
                        }
                    }
                } else {
                    tracing::trace!("method doesn't match");
                    Ok(Err(Dispatch::Request(message, responder)))
                }
            }

            Dispatch::Notification(message) => {
                if Notif::matches_method(&message.method) {
                    match Notif::parse_message(&message.method, &message.params) {
                        Ok(notif) => {
                            tracing::trace!(?notif, "parse ok");
                            Ok(Ok(Dispatch::Notification(notif)))
                        }
                        Err(err) => {
                            tracing::trace!(?err, "parse error");
                            Err(err)
                        }
                    }
                } else {
                    tracing::trace!("method doesn't match");
                    Ok(Err(Dispatch::Notification(message)))
                }
            }

            Dispatch::Response(result, cx) => {
                let method = cx.method();
                if Req::matches_method(method) {
                    // Parse the response result
                    let typed_result = match result {
                        Ok(value) => {
                            match <Req::Response as JsonRpcResponse>::from_value(method, value) {
                                Ok(parsed) => {
                                    tracing::trace!(?parsed, "parse ok");
                                    Ok(parsed)
                                }
                                Err(err) => {
                                    tracing::trace!(?err, "parse error");
                                    return Err(err);
                                }
                            }
                        }
                        Err(err) => {
                            tracing::trace!("error, passthrough");
                            Err(err)
                        }
                    };
                    Ok(Ok(Dispatch::Response(typed_result, cx.cast())))
                } else {
                    tracing::trace!("method doesn't match");
                    Ok(Err(Dispatch::Response(result, cx)))
                }
            }
        }
    }

    /// True if this message has a field with the given name.
    ///
    /// Returns `false` for Response variants.
    #[must_use]
    pub fn has_field(&self, field_name: &str) -> bool {
        self.message()
            .and_then(|m| m.params().get(field_name))
            .is_some()
    }

    /// Returns true if this message has a session-id field.
    ///
    /// Returns `false` for Response variants.
    pub(crate) fn has_session_id(&self) -> bool {
        self.has_field("sessionId")
    }

    /// Extract the ACP session-id from this message (if any).
    ///
    /// Returns `Ok(None)` for Response variants.
    pub(crate) fn get_session_id(&self) -> Result<Option<SessionId>, crate::Error> {
        let Some(message) = self.message() else {
            return Ok(None);
        };
        let Some(value) = message.params().get("sessionId") else {
            return Ok(None);
        };
        let session_id = serde_json::from_value(value.clone())?;
        Ok(Some(session_id))
    }

    /// Try to parse this as a notification of the given type.
    ///
    /// # Returns
    ///
    /// * `Ok(Ok(typed))` if this is a request/notification of the given types
    /// * `Ok(Err(self))` if not
    /// * `Err` if has the correct method for the given types but parsing fails
    pub fn into_notification<N: JsonRpcNotification>(
        self,
    ) -> Result<Result<N, Dispatch>, crate::Error> {
        match self {
            Dispatch::Notification(msg) => {
                if !N::matches_method(&msg.method) {
                    return Ok(Err(Dispatch::Notification(msg)));
                }
                match N::parse_message(&msg.method, &msg.params) {
                    Ok(n) => Ok(Ok(n)),
                    Err(err) => Err(err),
                }
            }
            Dispatch::Request(..) | Dispatch::Response(..) => Ok(Err(self)),
        }
    }

    /// Try to parse this as a request of the given type.
    ///
    /// # Returns
    ///
    /// * `Ok(Ok(typed))` if this is a request/notification of the given types
    /// * `Ok(Err(self))` if not
    /// * `Err` if has the correct method for the given types but parsing fails
    pub fn into_request<Req: JsonRpcRequest>(
        self,
    ) -> Result<Result<(Req, Responder<Req::Response>), Dispatch>, crate::Error> {
        match self {
            Dispatch::Request(msg, responder) => {
                if !Req::matches_method(&msg.method) {
                    return Ok(Err(Dispatch::Request(msg, responder)));
                }
                match Req::parse_message(&msg.method, &msg.params) {
                    Ok(req) => Ok(Ok((req, responder.cast()))),
                    Err(err) => Err(err),
                }
            }
            Dispatch::Notification(..) | Dispatch::Response(..) => Ok(Err(self)),
        }
    }
}

impl<M: JsonRpcRequest + JsonRpcNotification> Dispatch<M, M> {
    /// Returns the message payload for requests and notifications.
    ///
    /// Returns `None` for Response variants since they don't contain a message payload.
    pub fn message(&self) -> Option<&M> {
        match self {
            Dispatch::Request(msg, _) | Dispatch::Notification(msg) => Some(msg),
            Dispatch::Response(_, _) => None,
        }
    }

    /// Map the request/notification message.
    ///
    /// Response variants pass through unchanged.
    pub(crate) fn try_map_message(
        self,
        map_message: impl FnOnce(M) -> Result<M, crate::Error>,
    ) -> Result<Dispatch<M, M>, crate::Error> {
        match self {
            Dispatch::Request(request, cx) => Ok(Dispatch::Request(map_message(request)?, cx)),
            Dispatch::Notification(notification) => {
                Ok(Dispatch::<M, M>::Notification(map_message(notification)?))
            }
            Dispatch::Response(result, cx) => Ok(Dispatch::Response(result, cx)),
        }
    }
}

/// An incoming JSON message without any typing. Can be a request or a notification.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct UntypedMessage {
    /// The JSON-RPC method name
    pub method: String,
    /// The JSON-RPC parameters as a raw JSON value
    pub params: serde_json::Value,
}

impl UntypedMessage {
    /// Returns an untyped message with the given method and parameters.
    pub fn new(method: &str, params: impl Serialize) -> Result<Self, crate::Error> {
        let params = serde_json::to_value(params)?;
        Ok(Self {
            method: method.to_string(),
            params,
        })
    }

    /// Returns the method name
    #[must_use]
    pub fn method(&self) -> &str {
        &self.method
    }

    /// Returns the parameters as a JSON value
    #[must_use]
    pub fn params(&self) -> &serde_json::Value {
        &self.params
    }

    /// Consumes this message and returns the method and params
    #[must_use]
    pub fn into_parts(self) -> (String, serde_json::Value) {
        (self.method, self.params)
    }

    /// Convert `self` to a raw JSON-RPC message.
    pub(crate) fn into_raw_jsonrpc_message(
        self,
        id: Option<RequestId>,
    ) -> Result<RawJsonRpcMessage, crate::Error> {
        let Self { method, params } = self;
        match id {
            Some(id) => RawJsonRpcMessage::request(method, params, id),
            None => RawJsonRpcMessage::notification(method, params),
        }
    }
}

impl JsonRpcMessage for UntypedMessage {
    fn matches_method(_method: &str) -> bool {
        // UntypedMessage matches any method - it's the untyped fallback
        true
    }

    fn method(&self) -> &str {
        &self.method
    }

    fn to_untyped_message(&self) -> Result<UntypedMessage, crate::Error> {
        Ok(self.clone())
    }

    fn parse_message(method: &str, params: &impl Serialize) -> Result<Self, crate::Error> {
        UntypedMessage::new(method, params)
    }
}

impl JsonRpcRequest for UntypedMessage {
    type Response = serde_json::Value;
}

impl JsonRpcNotification for UntypedMessage {}

/// Represents a pending response of type `R` from an outgoing request.
///
/// Returned by [`ConnectionTo::send_request`], this type provides methods for handling
/// the response without blocking the event loop. The API is intentionally designed to make
/// it difficult to accidentally block.
///
/// # Anti-Footgun Design
///
/// You cannot directly `.await` a `SentRequest`. Instead, you must choose how to handle
/// the response:
///
/// ## Option 1: Schedule a Callback (Safe in Handlers)
///
/// Use [`on_receiving_result`](Self::on_receiving_result) to schedule a task
/// that runs when the response arrives. This doesn't block the event loop:
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # async fn example(cx: agent_client_protocol::ConnectionTo<agent_client_protocol::UntypedRole>) -> Result<(), agent_client_protocol::Error> {
/// cx.send_request(MyRequest {})
///     .on_receiving_result(async |result| {
///         match result {
///             Ok(response) => {
///                 // Handle successful response
///                 Ok(())
///             }
///             Err(error) => {
///                 // Handle error
///                 Err(error)
///             }
///         }
///     })?;
/// # Ok(())
/// # }
/// ```
///
/// ## Option 2: Block in a Spawned Task (Safe Only in `spawn`)
///
/// Use [`block_task`](Self::block_task) to block until the response arrives, but **only**
/// in a spawned task (never in a handler):
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # async fn example(cx: agent_client_protocol::ConnectionTo<agent_client_protocol::UntypedRole>) -> Result<(), agent_client_protocol::Error> {
/// // ✅ Safe: Spawned task runs concurrently
/// cx.spawn({
///     let cx = cx.clone();
///     async move {
///         let response = cx.send_request(MyRequest {})
///             .block_task()
///             .await?;
///         // Process response...
///         Ok(())
///     }
/// })?;
/// # Ok(())
/// # }
/// ```
///
/// ```no_run
/// # use agent_client_protocol_test::*;
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// # let connection = mock_connection();
/// // ❌ NEVER do this in a handler - blocks the event loop!
/// connection.on_receive_request(async |req: MyRequest, responder, cx| {
///     let response = cx.send_request(MyRequest {})
///         .block_task()  // This will deadlock!
///         .await?;
///     responder.respond(response)
/// }, agent_client_protocol::on_receive_request!())
/// # .connect_to(agent_client_protocol_test::MockTransport).await?;
/// # Ok(())
/// # }
/// ```
///
/// # Why This Design?
///
/// If you block the event loop while waiting for a response, the connection cannot process
/// the incoming response message, creating a deadlock. This API design prevents that footgun
/// by making blocking explicit and encouraging non-blocking patterns.
///
/// # Drop Behavior
///
/// By default, dropping a `SentRequest` before the SDK has received the
/// response sends a `$/cancel_request` notification asking the peer to cancel
/// the request, then discards the response when it arrives. Requests whose
/// eventual response should be ignored, but which should keep running on the
/// peer, should use [`detach`](Self::detach) instead.
#[must_use = "dropping a SentRequest asks the peer to cancel the request and \
              discards the response; consume it with `block_task`, \
              `on_receiving_result`, `forward_response_to`, or `detach`"]
pub struct SentRequest<T> {
    id: RequestId,
    method: String,
    task_tx: TaskTx,
    response_rx: oneshot::Receiver<ResponsePayload>,
    to_result: Box<dyn Fn(serde_json::Value) -> Result<T, crate::Error> + Send>,
    cancellation: SentRequestCancellation,
    /// Cancellation markers of other (incoming) requests whose cancellation
    /// should be forwarded to this request. See
    /// [`forward_cancellation_from`](Self::forward_cancellation_from).
    cancellation_sources: Vec<RequestCancellation>,
}

#[derive(Clone, Debug)]
pub(crate) struct SentRequestCancellationDisarm {
    armed: Arc<AtomicBool>,
}

impl SentRequestCancellationDisarm {
    fn new() -> Self {
        Self {
            armed: Arc::new(AtomicBool::new(true)),
        }
    }

    fn disarm(&self) {
        self.armed.store(false, Ordering::Release);
    }
}

struct SentRequestCancellation {
    message_tx: OutgoingMessageTx,
    remote_style: crate::role::RemoteStyle,
    request_id: RequestId,
    disarm: SentRequestCancellationDisarm,
}

impl SentRequestCancellation {
    fn new(
        message_tx: OutgoingMessageTx,
        remote_style: crate::role::RemoteStyle,
        request_id: RequestId,
    ) -> Self {
        Self {
            message_tx,
            remote_style,
            request_id,
            disarm: SentRequestCancellationDisarm::new(),
        }
    }

    fn disarm(&self) {
        self.disarm.disarm();
    }

    fn disarm_handle(&self) -> SentRequestCancellationDisarm {
        self.disarm.clone()
    }

    fn send(&self) -> Result<(), crate::Error> {
        if !self.disarm.armed.swap(false, Ordering::AcqRel) {
            return Ok(());
        }

        // Build the notification lazily: most requests are never cancelled,
        // so this avoids serializing a notification per outgoing request.
        let untyped = self.remote_style.transform_outgoing_message(
            crate::schema::v1::CancelRequestNotification::new(self.request_id.clone()),
        )?;

        send_raw_message(&self.message_tx, OutgoingMessage::Notification { untyped })
    }
}

impl Drop for SentRequestCancellation {
    fn drop(&mut self) {
        if let Err(error) = self.send() {
            tracing::debug!(?error, "failed to auto-cancel dropped request");
        }
    }
}

impl Debug for SentRequestCancellation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SentRequestCancellation")
            .field("request_id", &self.request_id)
            .field("remote_style", &self.remote_style)
            .field("armed", &self.disarm.armed.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

/// Await the response payload for an outgoing request, watching `sources` for
/// cancellation of the upstream requests it was registered with.
///
/// When any source reports cancellation, a `$/cancel_request` is forwarded to
/// the outgoing request (at most once, shared with [`SentRequest::cancel`] and
/// drop-time auto-cancellation), and the response is *still* awaited: the peer
/// always answers, with normal data or a cancellation error.
///
/// Watching is deliberately bounded by response arrival so that completed
/// requests do not leak waiters on markers that will never fire.
async fn await_response_forwarding_cancellation(
    response_rx: oneshot::Receiver<ResponsePayload>,
    cancellation: &SentRequestCancellation,
    sources: &[RequestCancellation],
) -> Result<ResponsePayload, oneshot::Canceled> {
    // Failing to forward the cancellation must not abort the wait: the
    // response (normal data or a cancellation error) may still arrive and
    // must still be processed.
    let forward_cancellation = || {
        if let Err(error) = cancellation.send() {
            tracing::debug!(
                ?error,
                "failed to forward cancellation to downstream request"
            );
        }
    };

    let response = if sources.is_empty() {
        response_rx.await
    } else if sources.iter().any(RequestCancellation::is_cancelled) {
        forward_cancellation();
        response_rx.await
    } else {
        let cancelled = sources.iter().map(|source| source.state.signal_rx.clone());
        match future::select(future::select_all(cancelled), response_rx).await {
            Either::Left((_, response_rx)) => {
                forward_cancellation();
                response_rx.await
            }
            Either::Right((response, _)) => response,
        }
    };

    cancellation.disarm();
    response
}

impl<T: Debug> Debug for SentRequest<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut debug = f.debug_struct("SentRequest");
        debug
            .field("id", &self.id)
            .field("method", &self.method)
            .field("task_tx", &self.task_tx)
            .field("response_rx", &self.response_rx);
        debug
            .field("cancellation", &self.cancellation)
            .field("cancellation_sources", &self.cancellation_sources);
        debug.finish_non_exhaustive()
    }
}

impl SentRequest<serde_json::Value> {
    fn new(
        id: RequestId,
        method: String,
        task_tx: mpsc::UnboundedSender<Task>,
        response_rx: oneshot::Receiver<ResponsePayload>,
        cancellation: SentRequestCancellation,
    ) -> Self {
        Self {
            id,
            method,
            response_rx,
            task_tx,
            to_result: Box::new(Ok),
            cancellation,
            cancellation_sources: Vec::new(),
        }
    }
}

impl<T> SentRequest<T> {
    /// Detach this request handle without waiting for its response.
    ///
    /// The response will be discarded when it arrives. This also disarms the
    /// drop-time automatic cancellation described in
    /// [Drop Behavior](Self#drop-behavior), so use it for requests whose
    /// eventual response should be ignored, but which should keep running on
    /// the peer. The peer is still expected to answer the JSON-RPC request
    /// eventually; use a notification instead when no response is expected at
    /// all.
    ///
    /// To ask the peer to stop the request, call `cancel` instead, or drop the
    /// handle while automatic cancellation is armed.
    pub fn detach(self) {
        self.cancellation.disarm();
    }

    /// Send a `$/cancel_request` notification for this outgoing request.
    ///
    /// This uses the same peer and message wrapping that were used to send the
    /// original request, so it is the preferred way to cancel a [`SentRequest`]
    /// when the request handle is still available.
    ///
    /// At most one `$/cancel_request` is ever sent per request: the first
    /// `cancel` call sends it (and also prevents the drop-time automatic
    /// cancellation described in [Drop Behavior](Self#drop-behavior)), while
    /// later calls return `Ok(())` without sending anything. Likewise, once
    /// the SDK has routed the response to this handle, `cancel` becomes a
    /// no-op: there is nothing left to cancel.
    ///
    /// Errors are only reported by the call that attempts to send the
    /// notification.
    pub fn cancel(&self) -> Result<(), crate::Error> {
        self.cancellation.send()
    }

    /// Forward cancellation of another request to this one.
    ///
    /// When the request that `source` belongs to is cancelled by its peer,
    /// a `$/cancel_request` for *this* request is sent to its peer, using the
    /// same wrapping as the original request. The response is still awaited
    /// and delivered as usual (normal data or a cancellation error), so this
    /// composes with [`block_task`](Self::block_task) and
    /// [`on_receiving_result`](Self::on_receiving_result).
    ///
    /// This is the building block for proxies that forward a request with
    /// custom logic instead of [`forward_response_to`](Self::forward_response_to)
    /// (which wires this up automatically from its responder). Without it,
    /// custom forwarding *absorbs* cancellation: the upstream marker is still
    /// set, but nothing is sent downstream.
    ///
    /// ```
    /// # use agent_client_protocol::{ConnectionTo, Error, Responder, UntypedRole};
    /// # use agent_client_protocol_test::{MyRequest, MyResponse};
    /// # async fn example(request: MyRequest, responder: Responder<MyResponse>, backend: ConnectionTo<UntypedRole>) -> Result<(), Error> {
    /// backend
    ///     .send_request(request)
    ///     .forward_cancellation_from(responder.cancellation())
    ///     .on_receiving_result(async move |result| {
    ///         // Custom result handling, e.g. bookkeeping or rewriting.
    ///         responder.respond_with_result(result)
    ///     })?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// May be called multiple times; cancellation of any registered source
    /// triggers the forwarding (at most one `$/cancel_request` is ever sent
    /// per request). Sources are observed while the response is being
    /// awaited — that is, once the handle is consumed with
    /// [`block_task`](Self::block_task),
    /// [`on_receiving_result`](Self::on_receiving_result), or
    /// [`forward_response_to`](Self::forward_response_to); a source that was
    /// already cancelled by then is honored immediately.
    pub fn forward_cancellation_from(mut self, source: RequestCancellation) -> Self {
        self.cancellation_sources.push(source);
        self
    }
}

impl<T: JsonRpcResponse> SentRequest<T> {
    /// The id of the outgoing request.
    #[must_use]
    pub fn id(&self) -> serde_json::Value {
        crate::util::id_to_json(&self.id)
    }

    /// The method of the request this is in response to.
    #[must_use]
    pub fn method(&self) -> &str {
        &self.method
    }

    /// Create a new response that maps the result of the response to a new type.
    pub fn map<U>(
        self,
        map_fn: impl Fn(T) -> Result<U, crate::Error> + 'static + Send,
    ) -> SentRequest<U> {
        SentRequest {
            id: self.id,
            method: self.method,
            response_rx: self.response_rx,
            task_tx: self.task_tx,
            to_result: Box::new(move |value| map_fn((self.to_result)(value)?)),
            cancellation: self.cancellation,
            cancellation_sources: self.cancellation_sources,
        }
    }

    /// Forward the response (success or error) to a request context when it arrives.
    ///
    /// This is a convenience method for proxying messages between connections. When the
    /// response arrives, it will be automatically sent to the provided request context,
    /// whether it's a successful response or an error.
    ///
    /// # Example: Proxying requests
    ///
    /// ```
    /// # use agent_client_protocol::UntypedRole;
    /// # use agent_client_protocol::{Builder, ConnectionTo};
    /// # use agent_client_protocol_test::*;
    /// # async fn example(cx: ConnectionTo<UntypedRole>) -> Result<(), agent_client_protocol::Error> {
    /// // Set up backend connection builder
    /// let backend = UntypedRole.builder()
    ///     .on_receive_request(async |req: MyRequest, responder, cx| {
    ///         responder.respond(MyResponse { status: "ok".into() })
    ///     }, agent_client_protocol::on_receive_request!());
    ///
    /// // Spawn backend and get a context to send to it
    /// let backend_connection = cx.spawn_connection(backend, MockTransport)?;
    ///
    /// // Set up proxy that forwards requests to backend
    /// UntypedRole.builder()
    ///     .on_receive_request({
    ///         let backend_connection = backend_connection.clone();
    ///         async move |req: MyRequest, responder, cx| {
    ///             // Forward the request to backend and proxy the response back
    ///             backend_connection.send_request(req)
    ///                 .forward_response_to(responder)?;
    ///             Ok(())
    ///         }
    ///     }, agent_client_protocol::on_receive_request!());
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Type Safety
    ///
    /// The request context's response type must match the request's response type,
    /// ensuring type-safe message forwarding.
    ///
    /// # When to Use
    ///
    /// Use this when:
    /// - You're implementing a proxy or gateway pattern
    /// - You want to forward responses without processing them
    /// - The response types match between the outgoing request and incoming request
    ///
    /// This is equivalent to calling `on_receiving_result` and manually forwarding
    /// the result, with two proxy-specific additions:
    ///
    /// - If the pending response is dropped without ever being delivered (for
    ///   example, the downstream connection closed), the incoming request is
    ///   answered with an internal error instead of being left unanswered.
    /// - When the peer cancels the incoming request, the cancellation is
    ///   forwarded to the outgoing request, and the downstream response
    ///   (normal data or a cancellation error) is still forwarded back. This is
    ///   equivalent to registering the responder's marker with
    ///   `forward_cancellation_from`.
    #[track_caller]
    pub fn forward_response_to(self, responder: Responder<T>) -> Result<(), crate::Error>
    where
        T: Send,
    {
        let this = self.forward_cancellation_from(responder.cancellation());

        this.consume_with(async move |response| {
            // A response that was never delivered (outer `Err`, e.g. the
            // downstream connection closed) is forwarded as an error: the
            // incoming request must not be left unanswered.
            responder.respond_with_result(response.unwrap_or_else(Err))
        })
    }

    /// Spawn the response-consumption task shared by
    /// [`on_receiving_result`](Self::on_receiving_result) and
    /// [`forward_response_to`](Self::forward_response_to).
    ///
    /// The task awaits the response (forwarding cancellation from registered
    /// sources while waiting, converts the payload, and invokes `handle` with
    /// the typed result (`Ok(Result<T, _>)`). The dispatch loop's ack, if any,
    /// is sent after `handle` completes.
    ///
    /// If the pending response is dropped without ever being delivered (for
    /// example, the connection closed), `handle` receives the outer `Err`
    /// describing the loss; there is no ack in that case.
    #[track_caller]
    fn consume_with<F>(
        self,
        handle: impl FnOnce(Result<Result<T, crate::Error>, crate::Error>) -> F + 'static + Send,
    ) -> Result<(), crate::Error>
    where
        F: Future<Output = Result<(), crate::Error>> + 'static + Send,
        T: Send,
    {
        let task_tx = self.task_tx.clone();
        let method = self.method;
        let response_rx = self.response_rx;
        let to_result = self.to_result;
        let cancellation = self.cancellation;
        let cancellation_sources = self.cancellation_sources;
        let location = Location::caller();

        Task::new(location, async move {
            let response = await_response_forwarding_cancellation(
                response_rx,
                &cancellation,
                &cancellation_sources,
            )
            .await;

            match response {
                Ok(ResponsePayload { result, ack_tx }) => {
                    // Convert the result using to_result for Ok values
                    let typed_result = match result {
                        Ok(json_value) => to_result(json_value),
                        Err(err) => Err(err),
                    };

                    let outcome = handle(Ok(typed_result)).await;

                    // Ack AFTER the handler completes - this is the key
                    // difference from block_task. The dispatch loop waits for
                    // this ack.
                    if let Some(tx) = ack_tx {
                        let _ = tx.send(());
                    }

                    outcome
                }
                Err(err) => {
                    handle(Err(crate::util::internal_error(format!(
                        "response to `{method}` never received: {err}"
                    ))))
                    .await
                }
            }
        })
        .spawn(&task_tx)
    }

    /// Block the current task until the response is received.
    ///
    /// **Warning:** This method blocks the current async task. It is **only safe** to use
    /// in spawned tasks created with [`ConnectionTo::spawn`]. Using it directly in a
    /// handler callback will deadlock the connection.
    ///
    /// # Safe Usage (in spawned tasks)
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_request(async |req: MyRequest, responder, cx| {
    ///     // Spawn a task to handle the request
    ///     cx.spawn({
    ///         let connection = cx.clone();
    ///         async move {
    ///             // Safe: We're in a spawned task, not blocking the event loop
    ///             let response = connection.send_request(OtherRequest {})
    ///                 .block_task()
    ///                 .await?;
    ///
    ///             // Process the response...
    ///             Ok(())
    ///         }
    ///     })?;
    ///
    ///     // Respond immediately
    ///     responder.respond(MyResponse { status: "ok".into() })
    /// }, agent_client_protocol::on_receive_request!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Unsafe Usage (in handlers - will deadlock!)
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_request(async |req: MyRequest, responder, cx| {
    ///     // ❌ DEADLOCK: Handler blocks event loop, which can't process the response
    ///     let response = cx.send_request(OtherRequest {})
    ///         .block_task()
    ///         .await?;
    ///
    ///     responder.respond(MyResponse { status: response.value })
    /// }, agent_client_protocol::on_receive_request!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # When to Use
    ///
    /// Use this method when:
    /// - You're in a spawned task (via [`ConnectionTo::spawn`])
    /// - You need the response value to proceed with your logic
    /// - Linear control flow is more natural than callbacks
    ///
    /// For handler callbacks, use [`on_receiving_result`](Self::on_receiving_result) instead.
    pub async fn block_task(self) -> Result<T, crate::Error>
    where
        T: Send,
    {
        let response = await_response_forwarding_cancellation(
            self.response_rx,
            &self.cancellation,
            &self.cancellation_sources,
        )
        .await;

        match response {
            Ok(ResponsePayload {
                result: Ok(json_value),
                ack_tx,
            }) => {
                // Ack immediately - we're in a spawned task, so the dispatch loop
                // can continue while we process the value.
                if let Some(tx) = ack_tx {
                    let _ = tx.send(());
                }
                match (self.to_result)(json_value) {
                    Ok(value) => Ok(value),
                    Err(err) => Err(err),
                }
            }
            Ok(ResponsePayload {
                result: Err(err),
                ack_tx,
            }) => {
                if let Some(tx) = ack_tx {
                    let _ = tx.send(());
                }
                Err(err)
            }
            Err(err) => Err(crate::util::internal_error(format!(
                "response to `{}` never received: {}",
                self.method, err
            ))),
        }
    }

    /// Schedule an async task to run when a successful response is received.
    ///
    /// This is a convenience wrapper around [`on_receiving_result`](Self::on_receiving_result)
    /// for the common pattern of forwarding errors to a request context while only processing
    /// successful responses.
    ///
    /// # Behavior
    ///
    /// - If the response is `Ok(value)`, your task receives the value and the request context
    /// - If the response is `Err(error)`, the error is automatically sent to `responder`
    ///   and your task is not called
    ///
    /// # Example: Chaining requests
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_request(async |req: ValidateRequest, responder, cx| {
    ///     // Send initial request
    ///     cx.send_request(ValidateRequest { data: req.data.clone() })
    ///         .on_receiving_ok_result(responder, async |validation, responder| {
    ///             // Only runs if validation succeeded
    ///             if validation.is_valid {
    ///                 // Respond to original request
    ///                 responder.respond(ValidateResponse { is_valid: true, error: None })
    ///             } else {
    ///                 responder.respond_with_error(agent_client_protocol::util::internal_error("validation failed"))
    ///             }
    ///         })?;
    ///
    ///     Ok(())
    /// }, agent_client_protocol::on_receive_request!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Ordering
    ///
    /// Like [`on_receiving_result`](Self::on_receiving_result), the callback blocks the
    /// dispatch loop until it completes. See the [`ordering`](crate::concepts::ordering) module
    /// for details.
    ///
    /// # When to Use
    ///
    /// Use this when:
    /// - You need to respond to a request based on another request's result
    /// - You want errors to automatically propagate to the request context
    /// - You only care about the success case
    ///
    /// For more control over error handling, use [`on_receiving_result`](Self::on_receiving_result).
    #[track_caller]
    pub fn on_receiving_ok_result<F>(
        self,
        responder: Responder<T>,
        task: impl FnOnce(T, Responder<T>) -> F + 'static + Send,
    ) -> Result<(), crate::Error>
    where
        F: Future<Output = Result<(), crate::Error>> + 'static + Send,
        T: Send,
    {
        self.on_receiving_result(async move |result| match result {
            Ok(value) => task(value, responder).await,
            Err(err) => responder.respond_with_error(err),
        })
    }

    /// Schedule an async task to run when the response is received.
    ///
    /// This is the recommended way to handle responses in handler callbacks, as it doesn't
    /// block the event loop. The task will be spawned automatically when the response arrives.
    ///
    /// # Example: Handle response in callback
    ///
    /// ```no_run
    /// # use agent_client_protocol_test::*;
    /// # async fn example() -> Result<(), agent_client_protocol::Error> {
    /// # let connection = mock_connection();
    /// connection.on_receive_request(async |req: MyRequest, responder, cx| {
    ///     // Send a request and schedule a callback for the response
    ///     cx.send_request(QueryRequest { id: 22 })
    ///         .on_receiving_result({
    ///             let connection = cx.clone();
    ///             async move |result| {
    ///                 match result {
    ///                     Ok(response) => {
    ///                         println!("Got response: {:?}", response);
    ///                         // Can send more messages here
    ///                         connection.send_notification(QueryComplete {})?;
    ///                         Ok(())
    ///                 }
    ///                     Err(error) => {
    ///                         eprintln!("Request failed: {}", error);
    ///                         Err(error)
    ///                     }
    ///                 }
    ///             }
    ///         })?;
    ///
    ///     // Handler continues immediately without waiting
    ///     responder.respond(MyResponse { status: "processing".into() })
    /// }, agent_client_protocol::on_receive_request!())
    /// # .connect_to(agent_client_protocol_test::MockTransport).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Ordering
    ///
    /// The callback runs as a spawned task, but the dispatch loop waits for it to complete
    /// before processing the next message. This gives you ordering guarantees: no other
    /// messages will be processed while your callback runs.
    ///
    /// This differs from [`block_task`](Self::block_task), which signals completion immediately
    /// upon receiving the response (before your code processes it).
    ///
    /// See the [`ordering`](crate::concepts::ordering) module for details on ordering guarantees
    /// and how to avoid deadlocks.
    ///
    /// # Error Handling
    ///
    /// If the scheduled task returns `Err`, the entire server will shut down. Make sure to handle
    /// errors appropriately within your task.
    ///
    /// # When to Use
    ///
    /// Use this method when:
    /// - You're in a handler callback (not a spawned task)
    /// - You want ordering guarantees (no other messages processed during your callback)
    /// - You need to do async work before "releasing" control back to the dispatch loop
    ///
    /// For spawned tasks where you don't need ordering guarantees, consider [`block_task`](Self::block_task).
    #[track_caller]
    pub fn on_receiving_result<F>(
        self,
        task: impl FnOnce(Result<T, crate::Error>) -> F + 'static + Send,
    ) -> Result<(), crate::Error>
    where
        F: Future<Output = Result<(), crate::Error>> + 'static + Send,
        T: Send,
    {
        self.consume_with(async move |response| {
            match response {
                // Run the user's callback on the peer's result.
                Ok(result) => task(result).await,
                // A response that was never delivered fails the consuming
                // task instead of invoking the callback.
                Err(err) => Err(err),
            }
        })
    }
}

// ============================================================================
// IntoJrConnectionTransport Implementations
// ============================================================================

/// A component that communicates over line streams.
///
/// `Lines` implements the [`ConnectTo`] trait for any pair of line-based streams
/// (a `Stream<Item = io::Result<String>>` for incoming and a `Sink<String>` for outgoing),
/// handling serialization of JSON-RPC messages to/from newline-delimited JSON.
///
/// This is a lower-level primitive than [`ByteStreams`] that enables interception and
/// transformation of individual lines before they are parsed or after they are serialized.
/// This is particularly useful for debugging, logging, or implementing custom line-based
/// protocols.
///
/// # Use Cases
///
/// - **Line-by-line logging**: Intercept and log each line before parsing
/// - **Custom protocols**: Transform lines before/after JSON-RPC processing
/// - **Debugging**: Inspect raw message strings
/// - **Line filtering**: Skip or modify specific messages
///
/// Most users should use [`ByteStreams`] instead, which provides a simpler interface
/// for byte-based I/O.
///
/// [`ConnectTo`]: crate::ConnectTo
#[derive(Debug)]
pub struct Lines<OutgoingSink, IncomingStream> {
    /// Outgoing line sink (where we write serialized JSON-RPC messages)
    pub outgoing: OutgoingSink,
    /// Incoming line stream (where we read and parse JSON-RPC messages)
    pub incoming: IncomingStream,
}

impl<OutgoingSink, IncomingStream> Lines<OutgoingSink, IncomingStream>
where
    OutgoingSink: futures::Sink<String, Error = std::io::Error> + Send + 'static,
    IncomingStream: futures::Stream<Item = std::io::Result<String>> + Send + 'static,
{
    /// Create a new line stream transport.
    pub fn new(outgoing: OutgoingSink, incoming: IncomingStream) -> Self {
        Self { outgoing, incoming }
    }
}

impl<OutgoingSink, IncomingStream, R: Role> ConnectTo<R> for Lines<OutgoingSink, IncomingStream>
where
    OutgoingSink: futures::Sink<String, Error = std::io::Error> + Send + 'static,
    IncomingStream: futures::Stream<Item = std::io::Result<String>> + Send + 'static,
{
    async fn connect_to(self, client: impl ConnectTo<R::Counterpart>) -> Result<(), crate::Error> {
        let (channel, serve_self) = ConnectTo::<R>::into_channel_and_future(self);
        match futures::future::select(Box::pin(client.connect_to(channel)), serve_self).await {
            Either::Left((result, _)) | Either::Right((result, _)) => result,
        }
    }

    fn into_channel_and_future(self) -> (Channel, BoxFuture<'static, Result<(), crate::Error>>) {
        let Self { outgoing, incoming } = self;

        // Create a channel pair for the client to use
        let (channel_for_caller, channel_for_lines) = Channel::duplex();

        // Create the server future that runs the line stream actors
        let server_future = Box::pin(async move {
            let Channel { rx, tx } = channel_for_lines;

            // Run both actors concurrently
            let outgoing_future = transport_actor::transport_outgoing_lines_actor(rx, outgoing);
            let incoming_future = transport_actor::transport_incoming_lines_actor(incoming, tx);

            // Wait for both to complete
            futures::try_join!(outgoing_future, incoming_future)?;

            Ok(())
        });

        (channel_for_caller, server_future)
    }
}

/// A component that communicates over byte streams (stdin/stdout, sockets, pipes, etc.).
///
/// `ByteStreams` implements the [`ConnectTo`] trait for any pair of `AsyncRead` and `AsyncWrite`
/// streams, handling serialization of JSON-RPC messages to/from newline-delimited JSON.
/// This is the standard way to communicate with external processes or network connections.
///
/// # Use Cases
///
/// - **Stdio communication**: Connect to agents or proxies via stdin/stdout
/// - **Network sockets**: TCP, Unix domain sockets, or other stream-based protocols
/// - **Named pipes**: Cross-process communication on the same machine
/// - **File I/O**: Reading from and writing to file descriptors
///
/// # Example
///
/// Connecting to an agent via stdio:
///
/// ```no_run
/// use agent_client_protocol::UntypedRole;
/// # use agent_client_protocol::{ByteStreams};
/// use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
///
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// let component = ByteStreams::new(
///     tokio::io::stdout().compat_write(),
///     tokio::io::stdin().compat(),
/// );
///
/// // Use as a component in a connection
/// agent_client_protocol::UntypedRole.builder()
///     .name("my-client")
///     .connect_to(component)
///     .await?;
/// # Ok(())
/// # }
/// ```
///
/// [`ConnectTo`]: crate::ConnectTo
#[derive(Debug)]
pub struct ByteStreams<OB, IB> {
    /// Outgoing byte stream (where we write serialized messages)
    pub outgoing: OB,
    /// Incoming byte stream (where we read and parse messages)
    pub incoming: IB,
}

impl<OB, IB> ByteStreams<OB, IB>
where
    OB: AsyncWrite + Send + 'static,
    IB: AsyncRead + Send + 'static,
{
    /// Create a new byte stream transport.
    pub fn new(outgoing: OB, incoming: IB) -> Self {
        Self { outgoing, incoming }
    }
}

impl<OB, IB, R: Role> ConnectTo<R> for ByteStreams<OB, IB>
where
    OB: AsyncWrite + Send + 'static,
    IB: AsyncRead + Send + 'static,
{
    async fn connect_to(self, client: impl ConnectTo<R::Counterpart>) -> Result<(), crate::Error> {
        let (channel, serve_self) = ConnectTo::<R>::into_channel_and_future(self);
        match futures::future::select(pin!(client.connect_to(channel)), serve_self).await {
            Either::Left((result, _)) | Either::Right((result, _)) => result,
        }
    }

    fn into_channel_and_future(self) -> (Channel, BoxFuture<'static, Result<(), crate::Error>>) {
        use futures::AsyncBufReadExt;
        use futures::AsyncWriteExt;
        use futures::io::BufReader;
        let Self { outgoing, incoming } = self;

        // Convert byte streams to line streams
        // Box both streams to satisfy Unpin requirements
        let incoming_lines = Box::pin(BufReader::new(incoming).lines());

        // Create a sink that writes lines (with newlines) to the outgoing byte stream
        // We need to Box the writer since it may not be Unpin
        let outgoing_sink =
            futures::sink::unfold(Box::pin(outgoing), async move |mut writer, line: String| {
                let mut bytes = line.into_bytes();
                bytes.push(b'\n');
                writer.write_all(&bytes).await?;
                Ok::<_, std::io::Error>(writer)
            });

        // Delegate to Lines component
        ConnectTo::<R>::into_channel_and_future(Lines::new(outgoing_sink, incoming_lines))
    }
}

/// A channel endpoint representing one side of a bidirectional message channel.
///
/// `Channel` represents a single endpoint's view of a bidirectional communication channel.
/// Each endpoint has:
/// - `rx`: A receiver for incoming messages (or errors) from the counterpart
/// - `tx`: A sender for outgoing messages (or errors) to the counterpart
///
/// # Example
///
/// ```no_run
/// # use agent_client_protocol::UntypedRole;
/// # use agent_client_protocol::{Channel, Builder};
/// # async fn example() -> Result<(), agent_client_protocol::Error> {
/// // Create a pair of connected channels
/// let (channel_a, channel_b) = Channel::duplex();
///
/// // Each channel can be used by a different component
/// UntypedRole.builder()
///     .name("connection-a")
///     .connect_to(channel_a)
///     .await?;
/// # Ok(())
/// # }
/// ```
#[derive(Debug)]
pub struct Channel {
    /// Receives messages (or errors) from the counterpart.
    pub rx: mpsc::UnboundedReceiver<Result<RawJsonRpcMessage, crate::Error>>,
    /// Sends messages (or errors) to the counterpart.
    pub tx: mpsc::UnboundedSender<Result<RawJsonRpcMessage, crate::Error>>,
}

impl Channel {
    /// Create a pair of connected channel endpoints.
    ///
    /// Returns two `Channel` instances that are connected to each other:
    /// - Messages sent via `channel_a.tx` are received on `channel_b.rx`
    /// - Messages sent via `channel_b.tx` are received on `channel_a.rx`
    ///
    /// # Returns
    ///
    /// A tuple `(channel_a, channel_b)` of connected channel endpoints.
    #[must_use]
    pub fn duplex() -> (Self, Self) {
        // Create channels: A sends Result<Message> which B receives as Message
        let (a_tx, b_rx) = mpsc::unbounded();
        let (b_tx, a_rx) = mpsc::unbounded();

        let channel_a = Self { rx: a_rx, tx: a_tx };
        let channel_b = Self { rx: b_rx, tx: b_tx };

        (channel_a, channel_b)
    }

    /// Copy messages from `rx` to `tx`.
    ///
    /// # Returns
    ///
    /// A `Result` indicating success or failure.
    pub async fn copy(mut self) -> Result<(), crate::Error> {
        while let Some(msg) = self.rx.next().await {
            self.tx
                .unbounded_send(msg)
                .map_err(crate::util::internal_error)?;
        }
        Ok(())
    }
}

impl<R: Role> ConnectTo<R> for Channel {
    async fn connect_to(self, client: impl ConnectTo<R::Counterpart>) -> Result<(), crate::Error> {
        let (client_channel, client_serve) = client.into_channel_and_future();

        match futures::try_join!(
            Channel {
                rx: client_channel.rx,
                tx: self.tx
            }
            .copy(),
            Channel {
                rx: self.rx,
                tx: client_channel.tx
            }
            .copy(),
            client_serve
        ) {
            Ok(((), (), ())) => Ok(()),
            Err(err) => Err(err),
        }
    }

    fn into_channel_and_future(self) -> (Channel, BoxFuture<'static, Result<(), crate::Error>>) {
        (self, Box::pin(future::ready(Ok(()))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peel_successor_envelopes_returns_plain_messages_unchanged() {
        let params = serde_json::json!({ "key": "value" });
        let (method, peeled) = peel_successor_envelopes("session/update", &params);
        assert_eq!(method, "session/update");
        assert_eq!(peeled, &params);
    }

    #[test]
    fn peel_successor_envelopes_unwraps_nested_envelopes() {
        let params = serde_json::json!({
            "method": "_proxy/successor",
            "params": {
                "method": "$/cancel_request",
                "params": { "requestId": "req-1" }
            }
        });
        let (method, peeled) = peel_successor_envelopes("_proxy/successor", &params);
        assert_eq!(method, "$/cancel_request");
        assert_eq!(peeled, &serde_json::json!({ "requestId": "req-1" }));
    }

    #[test]
    fn peel_successor_envelopes_leaves_malformed_envelopes_intact() {
        // No string `method` field: the envelope cannot be peeled, so the
        // message is returned as-is for the handler chain to deal with.
        let params = serde_json::json!({ "unexpected": true });
        let (method, peeled) = peel_successor_envelopes("_proxy/successor", &params);
        assert_eq!(method, "_proxy/successor");
        assert_eq!(peeled, &params);
    }

    mod cancel_request {
        use super::super::*;

        fn notification(method: &str, params: serde_json::Value) -> UntypedMessage {
            UntypedMessage::new(method, params).expect("well-formed JSON")
        }

        #[test]
        fn cancellation_request_id_is_extracted_from_wrapped_notifications() {
            let message = notification(
                "_proxy/successor",
                serde_json::json!({
                    "method": "$/cancel_request",
                    "params": { "requestId": "req-1" }
                }),
            );
            let request_id = cancellation_request_id_from_message(&message)
                .expect("wrapped cancel should parse");
            assert_eq!(request_id, Some(RequestId::Str("req-1".into())));
        }

        #[test]
        fn malformed_successor_envelope_is_not_treated_as_cancellation() {
            // The envelope cannot be peeled; the message must flow on to the
            // handler chain instead of erroring the dispatch.
            let message = notification("_proxy/successor", serde_json::json!({ "bogus": true }));
            let request_id = cancellation_request_id_from_message(&message)
                .expect("malformed envelope should be left to the handler chain");
            assert_eq!(request_id, None);
        }

        #[test]
        fn cancel_request_notifications_are_detected_even_when_wrapped() {
            let plain = notification("$/cancel_request", serde_json::json!({ "requestId": 1 }));
            assert!(is_cancel_request_notification(&plain));

            let wrapped = notification(
                "_proxy/successor",
                serde_json::json!({
                    "method": "$/cancel_request",
                    "params": { "requestId": 1 }
                }),
            );
            assert!(is_cancel_request_notification(&wrapped));

            let other_wrapped = notification(
                "_proxy/successor",
                serde_json::json!({
                    "method": "session/update",
                    "params": {}
                }),
            );
            assert!(!is_cancel_request_notification(&other_wrapped));

            let malformed_envelope =
                notification("_proxy/successor", serde_json::json!({ "bogus": true }));
            assert!(!is_cancel_request_notification(&malformed_envelope));
        }

        #[test]
        fn malformed_cancel_request_params_error() {
            let message = notification(
                "$/cancel_request",
                serde_json::json!({ "requestId": { "not": "an id" } }),
            );
            cancellation_request_id_from_message(&message)
                .expect_err("malformed cancel params should error");
        }

        #[test]
        fn registry_marks_and_removes_requests() {
            let registry = RequestCancellationRegistry::new();
            let id = RequestId::Str("req-1".into());

            let responder_cancellation = registry.register(&id);
            let marker = responder_cancellation.cancellation();
            assert!(!marker.is_cancelled());

            assert!(registry.cancel(&id));
            assert!(marker.is_cancelled());
            assert!(responder_cancellation.cancellation().is_cancelled());

            drop(responder_cancellation);
            assert!(!registry.cancel(&id), "slot should be removed on drop");
        }

        #[test]
        fn reused_request_id_does_not_cross_wire_cancellation_state() {
            let registry = RequestCancellationRegistry::new();
            let id = RequestId::Str("dup".into());

            // A protocol-violating peer reuses an in-flight request ID.
            let first = registry.register(&id);
            let first_marker = first.cancellation();
            let second = registry.register(&id);
            let second_marker = second.cancellation();

            // A cancellation targets whichever request currently owns the ID.
            assert!(registry.cancel(&id));
            assert!(second_marker.is_cancelled());
            assert!(
                !first_marker.is_cancelled(),
                "the stale request must not observe the newer request's cancellation"
            );

            // The stale responder must hand out detached markers, not the
            // newer request's marker.
            assert!(!first.cancellation().is_cancelled());

            // Dropping the stale responder must not remove the newer
            // request's slot.
            drop(first);
            assert!(registry.cancel(&id), "newer slot should still be present");

            drop(second);
            assert!(!registry.cancel(&id), "slot should be removed on drop");
        }
    }
}
