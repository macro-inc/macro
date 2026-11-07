#![deny(missing_docs)]
//! Agents' own model provider API keys (Anthropic, OpenAI).
//!
//! An in-memory agent on an Anthropic or OpenAI model can have one key, for
//! its model's provider. While the agent still fits the key and its owner is
//! on a paid plan, every turn of the agent runs on the key instead of Macro's
//! allowance, and usage on it is recorded against the key without counting.
//!
//! Keys live in `agent_api_keys`, one row per agent, encrypted with the
//! Cursor key's KMS key under an encryption context bound to the agent and
//! the provider. They are write-only: nothing reads a key back out but a
//! turn that runs on it.

/// Models, ports and the policy around saving and using keys.
pub mod domain;
/// Postgres, KMS and plan adapters for the domain ports.
pub mod outbound;
