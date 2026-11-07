#![deny(missing_docs)]
//! Codex cloud transport and ACP conversations for standalone and hosted runtimes.

/// OAuth orchestration and credential contracts.
pub mod domain;
/// ACP protocol adapters.
pub mod inbound;
/// OpenAI HTTP and optional PostgreSQL storage adapters.
pub mod outbound;
