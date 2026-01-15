//! AI Toolset library for building type-safe, schema-validated AI tool integrations.
//!
//! This crate provides infrastructure for defining tools that can be called by AI models,
//! with automatic JSON schema generation for inputs and outputs. It supports both
//! synchronous and asynchronous tools, and can generate tool definitions compatible
//! with various AI APIs.
//!
//! # Features
//!
//! - Type-safe tool definitions using Rust traits
//! - Automatic JSON schema generation via `schemars`
//! - Support for both sync and async tools
//! - Toolset management for grouping related tools
//!
//! # Example
//!
//! ```ignore
//! use ai_toolset::{AsyncTool, ToolResult};
//! use schemars::JsonSchema;
//! use serde::{Deserialize, Serialize};
//!
//! #[derive(JsonSchema, Deserialize)]
//! #[schemars(title = "Greet", description = "Greets a user by name")]
//! struct GreetTool {
//!     name: String,
//! }
//!
//! #[derive(Serialize, JsonSchema)]
//! struct GreetOutput {
//!     message: String,
//! }
//!
//! #[async_trait::async_trait]
//! impl AsyncTool<(), ()> for GreetTool {
//!     type Output = GreetOutput;
//!     async fn call(&self, _: (), _: ()) -> ToolResult<Self::Output> {
//!         Ok(GreetOutput {
//!             message: format!("Hello, {}!", self.name),
//!         })
//!     }
//! }
//! ```

#![deny(missing_docs)]

pub mod schema;
mod tool;
mod toolset;

pub use tool::*;
pub use toolset::*;
