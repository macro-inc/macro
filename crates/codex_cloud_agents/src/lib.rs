#![deny(missing_docs)]
//! Standalone Codex cloud feasibility probe. No Codex subprocess or ambient auth.

/// OAuth orchestration and credential contracts.
pub mod domain;
/// ACP protocol adapters.
pub mod inbound;
/// OpenAI HTTP and local JSON storage adapters.
pub mod outbound;

/// Prototype credential and session directory shared by the login and ACP binaries.
pub const DEFAULT_STATE_DIR: &str = "/home/wolf/.local/state/macro-codex-probe";
/// Pinned disposable `404Wolf/temp-test-repo` cloud environment.
pub const DEFAULT_ENVIRONMENT: &str = "6aa96d450dc88191a2ae2f7f93456e48";
/// Branch selected for new prototype cloud tasks.
pub const DEFAULT_BRANCH: &str = "main";
