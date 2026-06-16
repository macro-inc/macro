//! Schema generation for AI tools.
//!
//! The entry points live in [`generate`] — one function per codepath:
//! [`generate_validated_input_schema`] for the schema an AI provider
//! receives, and [`frontend_schemas_builder`] for TypeScript codegen. The
//! `transform`, `validate`, and `frontend_typegen` modules are internal
//! building blocks those entry points compose.

mod error;
mod frontend_typegen;
mod generate;
mod phantom_tool;
mod transform;
mod validate;

pub use error::ValidationError;
pub use frontend_typegen::{
    FrontendSchemas, FrontendSchemasBuilder, FrontendToolEntry, ToolSchemaGenerator,
};
pub use generate::{ValidatedSchema, frontend_schemas_builder, generate_validated_input_schema};
pub use phantom_tool::PhantomTool;
