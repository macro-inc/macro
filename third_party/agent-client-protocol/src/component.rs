//! ConnectTo abstraction for agents and proxies.
//!
//! This module provides the [`ConnectTo`] trait that defines the interface for things
//! that can be run as part of a conductor's chain - agents, proxies, or any ACP-speaking component.
//!
//! ## Usage
//!
//! Components connect to other components, creating a chain of message processors.
//! The type parameter `R` is the role that this component connects to (its counterpart).
//!
//! To implement a component, implement the `connect_to` method:
//!
//! ```rust,ignore
//! use agent_client_protocol::{Agent, Client, Connect, Result};
//!
//! struct MyAgent {
//!     // configuration fields
//! }
//!
//! // An agent connects to clients
//! impl ConnectTo<Client> for MyAgent {
//!     async fn connect_to(self, client: impl ConnectTo<Agent>) -> Result<()> {
//!         Agent.builder()
//!             .name("my-agent")
//!             // configure handlers here
//!             .connect_to(client)
//!             .await
//!     }
//! }
//! ```

use futures::future::BoxFuture;
use std::{fmt::Debug, future::Future, marker::PhantomData};

use crate::{Channel, Result, role::Role};

/// A component that can exchange JSON-RPC messages to an endpoint playing the role `R`
/// (e.g., an ACP [`Agent`](`crate::role::acp::Agent`) or an MCP [`Server`](`crate::role::mcp::Server`)).
///
/// This trait represents anything that can communicate via JSON-RPC messages over channels -
/// agents, proxies, in-process connections, or any ACP-speaking component.
///
/// The type parameter `R` is the role that this component serves (its counterpart).
/// For example:
/// - An agent implements `Serve<Client>` - it serves clients
/// - A proxy implements `Serve<Conductor>` - it serves conductors
/// - Transports like `Channel` implement `Serve<R>` for all `R` since they're role-agnostic
///
/// # Component Types
///
/// The trait is implemented by several built-in types representing different communication patterns:
///
/// - **[`ByteStreams`]**: A component communicating over byte streams (stdin/stdout, sockets, etc.)
/// - **[`Channel`]**: A component communicating via in-process message channels (for testing or direct connections)
/// - **[`AcpAgent`]**: An external agent running in a separate process with stdio communication
/// - **Custom components**: Proxies, transformers, or any ACP-aware service
///
/// # Two Ways to Serve
///
/// Components can be used in two ways:
///
/// 1. **`serve(client)`** - Serve by forwarding to another component (most components implement this)
/// 2. **`into_server()`** - Convert into a channel endpoint and server future (base cases implement this)
///
/// Most components only need to implement `serve(client)` - the `into_server()` method has a default
/// implementation that creates an intermediate channel and calls `serve`.
///
/// # Implementation Example
///
/// ```rust,ignore
/// use agent_client_protocol::{Agent, Result, Serve, role::Client};
///
/// struct MyAgent {
///     config: AgentConfig,
/// }
///
/// impl Serve<Client> for MyAgent {
///     async fn serve(self, client: impl Serve<Client::Counterpart>) -> Result<()> {
///         // Set up connection that forwards to client
///         Agent.builder()
///             .name("my-agent")
///             .on_receive_request(async |req: MyRequest, cx| {
///                 // Handle request
///                 cx.respond(MyResponse { status: "ok".into() })
///             })
///             .serve(client)
///             .await
///     }
/// }
/// ```
///
/// # Heterogeneous Collections
///
/// For storing different component types in the same collection, use [`DynConnectTo`]:
///
/// ```rust,ignore
/// use agent_client_protocol::Client;
///
/// let components: Vec<DynConnectTo<Client>> = vec![
///     DynConnectTo::new(proxy1),
///     DynConnectTo::new(proxy2),
///     DynConnectTo::new(agent),
/// ];
/// ```
///
/// [`ByteStreams`]: crate::ByteStreams
/// [`AcpAgent`]: crate::AcpAgent
/// [`Builder`]: crate::Builder
pub trait ConnectTo<R: Role>: Send + 'static {
    /// Serve this component by forwarding to a client component.
    ///
    /// Most components implement this method to set up their connection and
    /// forward messages to the provided client.
    ///
    /// # Arguments
    ///
    /// * `client` - The component to forward messages to (implements `Serve<R::Counterpart>`)
    ///
    /// # Returns
    ///
    /// A future that resolves when the component stops serving, either successfully
    /// or with an error. The future must be `Send`.
    fn connect_to(
        self,
        client: impl ConnectTo<R::Counterpart>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Convert this component into a channel endpoint and server future.
    ///
    /// This method returns:
    /// - A `Channel` that can be used to communicate with this component
    /// - A `BoxFuture` that runs the component's server logic
    ///
    /// The default implementation creates an intermediate channel pair and calls `serve`
    /// on one endpoint while returning the other endpoint for the caller to use.
    ///
    /// Base cases like `Channel` and `ByteStreams` override this to avoid unnecessary copying.
    ///
    /// # Returns
    ///
    /// A tuple of `(Channel, BoxFuture)` where the channel is for the caller to use
    /// and the future must be spawned to run the server.
    fn into_channel_and_future(self) -> (Channel, BoxFuture<'static, Result<()>>)
    where
        Self: Sized,
    {
        let (channel_a, channel_b) = Channel::duplex();
        let future = Box::pin(self.connect_to(channel_b));
        (channel_a, future)
    }
}

/// Type-erased connect trait for object-safe dynamic dispatch.
///
/// This trait is internal and used by [`DynConnectTo`]. Users should implement
/// [`ConnectTo`] instead, which is automatically converted to `ErasedConnectTo`
/// via a blanket implementation.
trait ErasedConnectTo<R: Role>: Send {
    fn type_name(&self) -> String;

    fn connect_to_erased(
        self: Box<Self>,
        client: Box<dyn ErasedConnectTo<R::Counterpart>>,
    ) -> BoxFuture<'static, Result<()>>;

    fn into_channel_and_future_erased(self: Box<Self>)
    -> (Channel, BoxFuture<'static, Result<()>>);
}

/// Blanket implementation: any `Serve<R>` can be type-erased.
impl<C: ConnectTo<R>, R: Role> ErasedConnectTo<R> for C {
    fn type_name(&self) -> String {
        std::any::type_name::<C>().to_string()
    }

    fn connect_to_erased(
        self: Box<Self>,
        client: Box<dyn ErasedConnectTo<R::Counterpart>>,
    ) -> BoxFuture<'static, Result<()>> {
        Box::pin(async move {
            (*self)
                .connect_to(DynConnectTo {
                    inner: client,
                    _marker: PhantomData,
                })
                .await
        })
    }

    fn into_channel_and_future_erased(
        self: Box<Self>,
    ) -> (Channel, BoxFuture<'static, Result<()>>) {
        (*self).into_channel_and_future()
    }
}

/// A dynamically-typed component for heterogeneous collections.
///
/// This type wraps any [`ConnectTo`] implementation and provides dynamic dispatch,
/// allowing you to store different component types in the same collection.
///
/// The type parameter `R` is the role that all components in the
/// collection serve (their counterpart).
///
/// # Examples
///
/// ```rust,ignore
/// use agent_client_protocol::{DynConnectTo, Client};
///
/// let components: Vec<DynConnectTo<Client>> = vec![
///     DynConnectTo::new(Proxy1),
///     DynConnectTo::new(Proxy2),
///     DynConnectTo::new(Agent),
/// ];
/// ```
pub struct DynConnectTo<R: Role> {
    inner: Box<dyn ErasedConnectTo<R>>,
    _marker: PhantomData<R>,
}

impl<R: Role> DynConnectTo<R> {
    /// Create a new `DynConnectTo` from any type implementing [`ConnectTo`].
    pub fn new<C: ConnectTo<R>>(component: C) -> Self {
        Self {
            inner: Box::new(component),
            _marker: PhantomData,
        }
    }

    /// Returns the type name of the wrapped component.
    #[must_use]
    pub fn type_name(&self) -> String {
        self.inner.type_name()
    }
}

impl<R: Role> ConnectTo<R> for DynConnectTo<R> {
    async fn connect_to(self, client: impl ConnectTo<R::Counterpart>) -> Result<()> {
        self.inner
            .connect_to_erased(Box::new(client) as Box<dyn ErasedConnectTo<R::Counterpart>>)
            .await
    }

    fn into_channel_and_future(self) -> (Channel, BoxFuture<'static, Result<()>>) {
        self.inner.into_channel_and_future_erased()
    }
}

impl<R: Role> Debug for DynConnectTo<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DynServe")
            .field("type_name", &self.type_name())
            .finish()
    }
}
