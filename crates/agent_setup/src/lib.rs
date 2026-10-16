//! Agent-led setup over MCP: the workflow tools a person's own AI agent uses
//! to set up their Macro workspace — check the setup state, hand out connect
//! links, discover what is in each tool, agree one plan with the person, start
//! the import and report what came in.
//!
//! Every step wraps a service Macro already has. Sign-in is Macro's MCP
//! sign-in, connections are Macro's Pipedream connections, and copying is the
//! import service's. Content never passes through the agent, and no setup
//! tool can share, invite, send or spend.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
#[cfg(test)]
mod test_support;
