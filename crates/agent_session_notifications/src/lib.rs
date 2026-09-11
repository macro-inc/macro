//! Agent-session lifecycle facts, turned into notifications for people.
//!
//! The harness publishes what happened to a session on
//! `macro.agent_session_lifecycle`. This crate decides, per fact, who is told
//! what ([`domain::plan`]), and provides the publisher decorator the harness
//! composes over its broker publisher so the same fact that goes on the topic
//! also reaches the notification service's ingress queue - the door every
//! other producer uses.
//!
//! Lives beside `graphql_notification` rather than inside `notification`
//! because the notification *kinds* live in `model_notifications`, which
//! already depends on `notification`.

#![deny(missing_docs)]

pub mod domain;
pub mod outbound;
