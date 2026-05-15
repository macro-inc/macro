//! Tool object types for runtime tool invocation.
//!
//! This module contains the compiled tool representations that enable
//! runtime deserialization and invocation of tools.

#[macro_use]
mod util;

mod json_tool;
mod object;
mod tool_async;
mod user_tool;

pub use json_tool::JsonAsyncTool;
pub use object::{SchemaRegistrar, ToolObject, ValidationError};
pub use tool_async::{AsyncToolObject, ToolSetCallable};
pub use user_tool::{UserTool, UserToolResponse};
pub use util::{
    MinimizedOutput, input_schema_generator, minimized_output_schema_generator,
    output_schema_generator, validate_tool_schema,
};
