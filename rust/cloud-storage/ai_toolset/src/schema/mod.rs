//! Schema generation utilities for AI tools.
//!
//! This module provides types and traits for generating and managing
//! tool schemas that describe tool inputs and outputs.

mod generate;
mod phantom_tool;

pub use generate::{
    CombinedToolEntry, CombinedToolSchemas, CombinedToolSchemasBuilder, NormaliseRefSiblings,
    ToolSchema, ToolSchemaGenerator, ToolSchemas,
};
pub use phantom_tool::PhantomTool;
