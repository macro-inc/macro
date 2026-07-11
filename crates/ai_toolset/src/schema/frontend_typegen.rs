//! Frontend typegen schema types: shared `$defs` accumulation, collision
//! mangling, and the registration trait.
//!
//! The entry point for this codepath is
//! [`frontend_schemas_builder`](super::generate::frontend_schemas_builder),
//! which composes the generator these types operate on. The output feeds the
//! `gen_tool_schemas` binary and the TypeScript codegen behind it — none of
//! it is ever sent to an AI provider.

use crate::AsyncToolCollection;
use serde::Serialize;

/// Entry in a [`FrontendSchemas`] mapping a tool name to its input/output
/// definition names.
#[derive(Serialize, Clone)]
pub struct FrontendToolEntry {
    /// The tool name.
    pub name: String,
    /// The schema definition name for the tool's input.
    pub input: String,
    /// The schema definition name for the tool's output.
    pub output: String,
}

/// Trait for types that can register tool schemas for frontend type
/// generation.
pub trait ToolSchemaGenerator {
    /// Registers this generator's tool types with a shared
    /// [`schemars::SchemaGenerator`] for frontend type generation,
    /// returning an entry per tool.
    ///
    /// The generator accumulates shared definitions so that types used by
    /// multiple tools (e.g. `CodeExecutionErrorCode`) appear only once.
    fn register_schemas(&self, generator: &mut schemars::SchemaGenerator)
    -> Vec<FrontendToolEntry>;
}

impl<Context> ToolSchemaGenerator for AsyncToolCollection<Context> {
    fn register_schemas(
        &self,
        generator: &mut schemars::SchemaGenerator,
    ) -> Vec<FrontendToolEntry> {
        self.tools
            .iter()
            .map(|(name, tool_object)| {
                let (input, output) = (tool_object.schema_registrar)(generator);
                FrontendToolEntry {
                    name: name.clone(),
                    input,
                    output,
                }
            })
            .collect()
    }
}

/// Combined tool schemas for frontend type generation, with shared `$defs`
/// and a tool→type mapping.
///
/// All tool input/output types and their transitive dependencies live in a
/// single `$defs` map, deduplicated by schemars' [`schemars::SchemaGenerator`].
///
/// Deliberately does **not** implement `Serialize`: these schemas are shaped
/// for TypeScript codegen (refs preserved, no structured-output transforms)
/// and must never be embedded in an AI provider request. The codegen JSON is
/// produced explicitly via [`FrontendSchemas::to_json_pretty`].
pub struct FrontendSchemas {
    /// Shared JSON Schema definitions (keyed by type name).
    defs: serde_json::Map<String, serde_json::Value>,
    /// Tool entries referencing definitions by name.
    tools: Vec<FrontendToolEntry>,
}

impl FrontendSchemas {
    /// Serializes the schemas to pretty-printed JSON for the codegen script:
    /// `{ "$defs": { ... }, "tools": [ ... ] }`.
    pub fn to_json_pretty(&self) -> serde_json::Result<String> {
        serde_json::to_string_pretty(&serde_json::json!({
            "$defs": &self.defs,
            "tools": &self.tools,
        }))
    }

    /// Replaces schemars' numeric collision suffixes (e.g. `ReadContent2`)
    /// with tool-name-prefixed names (e.g. `ReadThreadReadContent`).
    ///
    /// When two different Rust types share a `schema_name()`, schemars
    /// disambiguates with a numeric suffix. This method finds those,
    /// determines which tool references them, and renames to
    /// `{ToolName}{BaseName}` across `$defs`, `tools`, and all `$ref`s.
    fn mangle_collisions(&mut self) {
        let suffixed: Vec<(String, String)> = self
            .defs
            .keys()
            .filter_map(|name| {
                let base = name.trim_end_matches(|c: char| c.is_ascii_digit());
                if base.len() < name.len() && self.defs.contains_key(base) {
                    Some((name.clone(), base.to_owned()))
                } else {
                    None
                }
            })
            .collect();

        for (suffixed_name, base_name) in suffixed {
            let tool_name = self.find_owning_tool(&suffixed_name);
            let new_name = format!("{tool_name}{base_name}");
            let old_ref = format!("#/$defs/{suffixed_name}");
            let new_ref = format!("#/$defs/{new_name}");

            if let Some(def) = self.defs.remove(&suffixed_name) {
                self.defs.insert(new_name.clone(), def);
            }

            for tool in &mut self.tools {
                if tool.input == suffixed_name {
                    tool.input = new_name.clone();
                }
                if tool.output == suffixed_name {
                    tool.output = new_name.clone();
                }
            }

            Self::rename_refs(&mut self.defs, &old_ref, &new_ref);
        }
    }

    fn find_owning_tool(&self, def_name: &str) -> String {
        let ref_str = format!("#/$defs/{def_name}");

        // Check if a tool directly uses this def as input or output.
        for tool in &self.tools {
            if tool.input == def_name || tool.output == def_name {
                return tool.name.clone();
            }
        }

        // Walk each tool's input/output def tree looking for a transitive $ref.
        for tool in &self.tools {
            for root in [&tool.input, &tool.output] {
                if let Some(def) = self.defs.get(root.as_str())
                    && Self::value_contains_ref(def, &ref_str)
                {
                    return tool.name.clone();
                }
            }
        }

        def_name.to_owned()
    }

    fn value_contains_ref(value: &serde_json::Value, target: &str) -> bool {
        match value {
            serde_json::Value::String(s) => s == target,
            serde_json::Value::Array(arr) => {
                arr.iter().any(|v| Self::value_contains_ref(v, target))
            }
            serde_json::Value::Object(map) => {
                map.values().any(|v| Self::value_contains_ref(v, target))
            }
            _ => false,
        }
    }

    fn rename_refs(
        defs: &mut serde_json::Map<String, serde_json::Value>,
        old_ref: &str,
        new_ref: &str,
    ) {
        for value in defs.values_mut() {
            Self::rename_refs_in_value(value, old_ref, new_ref);
        }
    }

    fn rename_refs_in_value(value: &mut serde_json::Value, old_ref: &str, new_ref: &str) {
        match value {
            serde_json::Value::String(s) if s == old_ref => {
                *s = new_ref.to_owned();
            }
            serde_json::Value::Array(arr) => {
                for v in arr {
                    Self::rename_refs_in_value(v, old_ref, new_ref);
                }
            }
            serde_json::Value::Object(map) => {
                for v in map.values_mut() {
                    Self::rename_refs_in_value(v, old_ref, new_ref);
                }
            }
            _ => {}
        }
    }
}

/// Builder for [`FrontendSchemas`] that accumulates tools from multiple
/// [`ToolSchemaGenerator`]s while sharing a single [`schemars::SchemaGenerator`]
/// for deduplication.
///
/// Construct via
/// [`frontend_schemas_builder`](super::generate::frontend_schemas_builder).
pub struct FrontendSchemasBuilder {
    generator: schemars::SchemaGenerator,
    tools: Vec<FrontendToolEntry>,
}

impl FrontendSchemasBuilder {
    /// Creates a builder around a generator configured by the frontend
    /// typegen codepath.
    pub(crate) fn new(generator: schemars::SchemaGenerator) -> Self {
        FrontendSchemasBuilder {
            generator,
            tools: Vec::new(),
        }
    }

    /// Registers all tools from the given generator.
    pub fn merge(mut self, schema_generator: &dyn ToolSchemaGenerator) -> Self {
        self.tools
            .extend(schema_generator.register_schemas(&mut self.generator));
        self
    }

    /// Consumes the builder and returns the frontend schemas.
    pub fn build(mut self) -> FrontendSchemas {
        let defs = self.generator.take_definitions(true);
        let mut schemas = FrontendSchemas {
            defs,
            tools: self.tools,
        };
        schemas.mangle_collisions();
        schemas
    }
}
