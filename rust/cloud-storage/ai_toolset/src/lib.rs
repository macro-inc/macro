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
//! - Per-tool context extraction via `axum::extract::FromRef`
//!
//! # Multi-Context Toolset Example
//!
//! Tools can each consume different parts of a shared context. The `FromRef` bound
//! ensures compile-time safety when extracting tool-specific contexts.
//!
//! ```
//! use ai_toolset::{AsyncTool, AsyncToolSet, RequestContext, ServiceContext, ToolResult};
//! use axum_macros::FromRef;
//! use schemars::JsonSchema;
//! use serde::{Deserialize, Serialize};
//! use std::sync::Arc;
//!
//! // API traits for document and property operations
//! #[async_trait::async_trait]
//! trait DocumentApi: Send + Sync {
//!     async fn read(&self, id: &str) -> String;
//! }
//!
//! #[async_trait::async_trait]
//! trait PropertyApi: Send + Sync {
//!     async fn update(&self, id: &str, value: &str);
//! }
//!
//! // Shared toolset context with trait object clients
//! #[derive(Clone, FromRef)]
//! struct AppContext {
//!     document_api: Arc<dyn DocumentApi>,
//!     property_api: Arc<dyn PropertyApi>,
//! }
//!
//! // Tool that reads a document
//! #[derive(JsonSchema, Deserialize)]
//! #[schemars(title = "ReadDocument", description = "Reads a document by ID")]
//! struct ReadDocumentTool { document_id: String }
//!
//! #[async_trait::async_trait]
//! impl AsyncTool<Arc<dyn DocumentApi>> for ReadDocumentTool {
//!     type Output = serde_json::Value;
//!     async fn call(&self, api: ServiceContext<Arc<dyn DocumentApi>>, _req: RequestContext) -> ToolResult<Self::Output> {
//!         let content = api.read(&self.document_id).await;
//!         Ok(serde_json::json!({"content": content}))
//!     }
//! }
//!
//! // Tool that updates a property
//! #[derive(JsonSchema, Deserialize)]
//! #[schemars(title = "UpdateProperty", description = "Updates a property value")]
//! struct UpdatePropertyTool { property_id: String, value: String }
//!
//! #[async_trait::async_trait]
//! impl AsyncTool<Arc<dyn PropertyApi>> for UpdatePropertyTool {
//!     type Output = serde_json::Value;
//!     async fn call(&self, api: ServiceContext<Arc<dyn PropertyApi>>, _req: RequestContext) -> ToolResult<Self::Output> {
//!         api.update(&self.property_id, &self.value).await;
//!         Ok(serde_json::json!({"success": true}))
//!     }
//! }
//!
//! // Build toolset with tools using different contexts
//! let toolset = AsyncToolSet::<AppContext>::new()
//!     .add_tool::<ReadDocumentTool, Arc<dyn DocumentApi>>()
//!     .add_tool::<UpdatePropertyTool, Arc<dyn PropertyApi>>();
//! ```
//!
//! # Nested Toolsets
//!
//! Toolsets can be composed by merging a subtoolset with a narrower context into
//! a parent toolset with a broader context. The subtoolset's context must be
//! derivable from the parent context via `FromRef`.
//!
//! ```
//! use ai_toolset::{AsyncTool, AsyncToolSet, RequestContext, ServiceContext, ToolResult};
//! use axum_macros::FromRef;
//! use schemars::JsonSchema;
//! use serde::{Deserialize, Serialize};
//! use std::sync::Arc;
//!
//! // Narrower context for a subset of tools
//! #[derive(Clone)]
//! struct SubContext {
//!     sub_api: Arc<String>,
//! }
//!
//! // Broader parent context that contains SubContext
//! #[derive(Clone, FromRef)]
//! struct ParentContext {
//!     sub: SubContext,
//!     other_api: Arc<String>,
//! }
//!
//! // A tool that works with SubContext
//! #[derive(JsonSchema, Deserialize)]
//! #[schemars(title = "SubTool", description = "A tool using SubContext")]
//! struct SubTool { value: String }
//!
//! #[async_trait::async_trait]
//! impl AsyncTool<SubContext> for SubTool {
//!     type Output = serde_json::Value;
//!     async fn call(&self, ctx: ServiceContext<SubContext>, _req: RequestContext) -> ToolResult<Self::Output> {
//!         Ok(serde_json::json!({"value": self.value, "api": *ctx.sub_api}))
//!     }
//! }
//!
//! // Build a subtoolset with the narrower context
//! let sub_toolset = AsyncToolSet::<SubContext>::new()
//!     .add_tool::<SubTool, SubContext>();
//!
//! // Merge into parent toolset - tools are automatically widened
//! let parent_toolset = AsyncToolSet::<ParentContext>::new()
//!     .add_subtoolset::<SubContext>(sub_toolset);
//!
//! assert!(parent_toolset.tools.contains_key("SubTool"));
//! ```

#![deny(missing_docs)]

mod context;
pub mod schema;
mod tool;
mod toolset;

pub use context::{RequestContext, ServiceContext};
pub use tool::{AsyncTool, NoContext, ToolCallError, ToolResult};
pub use toolset::{
    AsyncToolCollection, RequestSchema, ToolCollection, ToolInfo, ToolSchema, ToolSet,
    ToolSetCreationError, ToolSetError, tool_object,
};
