//! The onboarding flow (`/setup`): one row per user tracking whether they
//! are still in the flow, plus the aggregate the flow reads (connected MCP
//! servers and a suggested team domain). Connecting an app during onboarding
//! only connects it; importing is a separate, explicit step.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
