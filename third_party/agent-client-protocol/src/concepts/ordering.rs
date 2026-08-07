//! Message ordering, concurrency, and the dispatch loop.
//!
//! Understanding how agent-client-protocol processes messages is key to writing correct code.
//! This chapter explains the dispatch loop and the ordering guarantees you
//! can rely on.
//!
//! # The Dispatch Loop
//!
//! Each connection has a central **dispatch loop** that processes incoming
//! messages one at a time. When a message arrives, it is passed to your
//! handlers in order until one claims it.
//!
//! The key property: **the dispatch loop waits for each handler to complete
//! before processing the next message.** This gives you sequential ordering
//! guarantees within a single connection.
//!
//! # `on_*` Methods Block the Loop
//!
//! Methods whose names begin with `on_` register callbacks that run inside
//! the dispatch loop. When your callback is invoked, the loop is blocked
//! until your callback completes.
//!
//! This includes:
//! - [`on_receive_request`] and [`on_receive_notification`]
//! - [`on_receiving_result`] and [`on_receiving_ok_result`]
//! - [`on_session_start`] and [`on_proxy_session_start`]
//!
//! This means:
//! - No other messages are processed while your callback runs
//! - You can safely do setup before "releasing" control back to the loop
//! - Messages are processed in the order they arrive
//!
//! # Deadlock Risk
//!
//! Because `on_*` callbacks block the dispatch loop, it's easy to create
//! deadlocks. The most common pattern:
//!
//! ```ignore
//! // DEADLOCK: This blocks the loop waiting for a response,
//! // but the response can't arrive because the loop is blocked!
//! builder.on_receive_request(async |request: MyRequest, responder, cx| {
//!     let response = cx.send_request(SomeRequest { ... })
//!         .block_task()  // <-- Waits for response
//!         .await?;       // <-- But response can never arrive!
//!     responder.respond(response)
//! }, on_receive_request!());
//! ```
//!
//! The response can never arrive because the dispatch loop is blocked waiting
//! for your callback to complete.
//!
//! # `block_task` vs `on_receiving_result`
//!
//! When you send a request, you get a [`SentRequest`] with two ways to handle it:
//!
//! ## `block_task()` - Acks immediately, you process later
//!
//! Use this in spawned tasks where you need to wait for the response:
//!
//! ```
//! # use agent_client_protocol::{Client, Agent, ConnectTo};
//! # use agent_client_protocol_test::MyRequest;
//! # async fn example(transport: impl ConnectTo<Client>) -> Result<(), agent_client_protocol::Error> {
//! # Client.builder().connect_with(transport, async |cx| {
//! cx.spawn({
//!     let cx = cx.clone();
//!     async move {
//!         // Safe: we're in a spawned task, not blocking the dispatch loop
//!         let response = cx.send_request(MyRequest {})
//!             .block_task()
//!             .await?;
//!         // Process response...
//!         Ok(())
//!     }
//! })?;
//! # Ok(())
//! # }).await?;
//! # Ok(())
//! # }
//! ```
//!
//! The dispatch loop continues immediately after delivering the response.
//! Your code receives the response and can take as long as it wants.
//!
//! ## `on_receiving_result()` - Your callback blocks the loop
//!
//! Use this when you need ordering guarantees:
//!
//! ```
//! # use agent_client_protocol::{Client, Agent, ConnectTo};
//! # use agent_client_protocol_test::MyRequest;
//! # async fn example(transport: impl ConnectTo<Client>) -> Result<(), agent_client_protocol::Error> {
//! # Client.builder().connect_with(transport, async |cx| {
//! cx.send_request(MyRequest {})
//!     .on_receiving_result(async |result| {
//!         // Dispatch loop is blocked until this completes
//!         let response = result?;
//!         // Do something with response...
//!         Ok(())
//!     })?;
//! # Ok(())
//! # }).await?;
//! # Ok(())
//! # }
//! ```
//!
//! The dispatch loop waits for your callback to complete before processing
//! the next message. Use this when you need to ensure no other messages
//! are processed until you've handled the response.
//!
//! # Escaping the Loop: `spawn`
//!
//! Use [`spawn`] to run work outside the dispatch loop:
//!
//! ```ignore
//! builder.on_receive_request(async |request: MyRequest, responder, cx| {
//!     cx.spawn(async move {
//!         // This runs outside the loop - other messages may be processed
//!         let response = cx.send_request(SomeRequest { ... })
//!             .block_task()
//!             .await?;
//!         // ...
//!         Ok(())
//!     })?;
//!     responder.respond(MyResponse { ... })  // Return immediately
//! }, on_receive_request!());
//! ```
//!
//! # `run_until` Methods
//!
//! Methods named `run_until` (like on session builders) run in a spawned task,
//! so awaiting them won't cause deadlocks:
//!
//! ```
//! # use agent_client_protocol::{Client, Agent, ConnectTo};
//! # async fn example(transport: impl ConnectTo<Client>) -> Result<(), agent_client_protocol::Error> {
//! # Client.builder().connect_with(transport, async |cx| {
//! cx.build_session_cwd()?
//!     .block_task()
//!     .run_until(async |mut session| {
//!         // Safe to await here - we're in a spawned task
//!         session.send_prompt("Hello")?;
//!         let response = session.read_to_string().await?;
//!         Ok(())
//!     })
//!     .await?;
//! # Ok(())
//! # }).await?;
//! # Ok(())
//! # }
//! ```
//!
//! # Summary
//!
//! | Pattern | Blocks Loop? | Use When |
//! |---------|--------------|----------|
//! | `on_*` callback | Yes | Quick decisions, need ordering |
//! | `on_receiving_result` | Yes | Need to process response before next message |
//! | `block_task()` | No | In spawned tasks, need response value |
//! | `spawn(...)` | No | Long-running work, don't need ordering |
//! | `block_task().run_until(...)` | No | Session-scoped work |
//!
//! # Next Steps
//!
//! - [Proxies and Conductors](super::proxies) - Building message interceptors
//!
//! [`on_receive_request`]: crate::Builder::on_receive_request
//! [`on_receive_notification`]: crate::Builder::on_receive_notification
//! [`on_receiving_result`]: crate::SentRequest::on_receiving_result
//! [`on_receiving_ok_result`]: crate::SentRequest::on_receiving_ok_result
//! [`on_session_start`]: crate::SessionBuilder::on_session_start
//! [`on_proxy_session_start`]: crate::SessionBuilder::on_proxy_session_start
//! [`SentRequest`]: crate::SentRequest
//! [`spawn`]: crate::ConnectionTo::spawn
