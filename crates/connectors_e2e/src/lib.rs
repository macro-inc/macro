//! End-to-end tests of connectors on dev: Macro's public HTTP API
//! (`/connectors`, an import) and an agent session, driven as two test
//! accounts against the real Pipedream, Macro Connect, a native MCP server
//! and the GitHub account link.
//!
//! A scenario starts with [`Suite::from_env`], which reads the accounts'
//! API keys and the fixtures from the environment and answers `None` when a
//! key is missing, so a run without them skips instead of failing.
//! `AGENTS.md` lists the settings and shows how to write a scenario.
#![deny(missing_docs)]

mod agent;
mod api;
mod config;
mod connector;

pub use agent::{AgentReport, parse_report};
pub use api::{Account, AccountKind, ApiError, Response};
pub use config::{
    CONNECT_APP, FLAGGED_API_KEY, Fixtures, GITHUB_LINKED, MCP_SERVER_URL, NOTION_PAGE,
    PIPEDREAM_APP, Suite, UNFLAGGED_API_KEY, skip,
};
pub use connector::{ConnectStep, Connector, Status, Target, app_key};

/// Every failure a scenario reports.
pub type Report = rootcause::Report;
