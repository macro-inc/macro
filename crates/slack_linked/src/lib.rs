#![deny(missing_docs)]
//! Slack Connect conversations from a person's own Slack web sessions, as
//! `external_chat`s: sign-in, accounts per workspace, the Slack Connect
//! catalogue, adding chats, ingesting traffic and dispatching deliberate
//! sends. DSS serves the `/slack` API and composes
//! [`domain::provider::SlackProvider`]; the Slack session service calls
//! [`domain::session::SessionService`] in-process and is the only process
//! that talks to Slack. They coordinate only through Postgres rows and
//! `NOTIFY` (`docs/architecture/slack-linked.md`).

/// Models, ports and use cases.
pub mod domain;
/// DSS HTTP routes.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Postgres and KMS adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
/// `NOTIFY` channels between DSS and the session service.
pub mod signals;
