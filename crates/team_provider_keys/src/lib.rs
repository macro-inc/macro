#![deny(missing_docs)]
//! A team's own model provider API keys (Anthropic, OpenAI) for in-app AI
//! chat.
//!
//! Team admins register a key; any member's in-memory AI chat may then run on
//! it instead of Macro's allowance. Usage on it is recorded against the key
//! and never counted toward the member's quota.
//!
//! Keys live in `cursor_configs` beside users' Cursor keys, one row per team
//! and provider, encrypted with the same KMS key under an encryption context
//! bound to the team and the provider. A member's key lookup joins
//! `team_user`, so membership is checked on every read, not cached.

/// Models, ports and the policy around registering and using keys.
pub mod domain;
/// Postgres and KMS adapters for the domain ports.
pub mod outbound;
