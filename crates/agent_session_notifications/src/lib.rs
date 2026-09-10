//! Agent-session lifecycle facts, turned into notifications for people.
//!
//! The harness publishes what happened to a session on
//! `macro.agent_session_lifecycle`; this crate is the one consumer of that
//! topic that talks to people. It decides, per event, who is told what
//! ([`domain::plan`]) and hands the result to the notification service's
//! ingress and reader ports, so it never reads the agent schema and the
//! harness never knows notifications exist.
//!
//! Lives beside `graphql_notification` rather than inside `notification`
//! because the notification *kinds* live in `model_notifications`, which
//! already depends on `notification`.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod topics;
