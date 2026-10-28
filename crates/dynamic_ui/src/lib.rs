//! The view an agent presents to a person, as the web's dynamic-UI renderer
//! draws it: the model-facing `PresentView` schema, generated from the
//! renderer's Zod schema, and a check that finds what the renderer would reject
//! before a view is presented.
#![deny(missing_docs)]

mod check;

pub use check::view_problems;

/// The `PresentView` tool's input schema. `bun run gen-dynamic-ui-schema` in
/// `apps/web` writes it from `src/features/dynamic-ui/toolSchema.ts`.
pub const PRESENT_VIEW_SCHEMA_JSON: &str = include_str!("present_view.schema.generated.json");

#[cfg(test)]
mod test;
