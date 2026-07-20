//! Agent proxy service.
//!
//! This crate is the agent service / proxy service for external coding
//! agents. It is *not* an agent runtime. It accepts WebSocket RPC
//! connections initiated by agent runtimes (via the
//! [`agent_runtime_protocol`] crate), proxies ACP messages between users and
//! the runtime hosting their agent session, translates agent-originated ACP
//! messages into the chat message format used by `document_cognition_service`
//! (persisting them through the `chat` crate), and pushes live updates to the
//! connection gateway.
//!
//! It also exposes a CRUD API for external agents. External agents are
//! stored as regular chats (same tables and message format as DCS agents),
//! distinguished by the `chat` crate's `ChatAgentKind` column on the chat
//! row.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod swagger;
