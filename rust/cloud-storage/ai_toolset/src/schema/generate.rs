use crate::AsyncToolSet;
use schemars::Schema;
use schemars::transform::Transform;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Normalises `$ref` nodes that carry sibling keywords.
///
/// Downstream TS tooling (`json-schema-to-typescript`) predates Draft 2020-12
/// and doesn't merge `$ref` with sibling keywords. This [`schemars::Transform`]
/// rewrites those nodes so the output is consumable:
///
/// * `$ref` + `description` only → drops the description (the referenced type
///   already carries its own).
/// * `$ref` + structural siblings (`properties`, `required`, …) → rewrites to
///   `allOf` so the intersection is explicit.
#[derive(Debug, Clone)]
pub struct NormaliseRefSiblings;

impl Transform for NormaliseRefSiblings {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };
        if !obj.contains_key("$ref") {
            return;
        }

        let sibling_keys: Vec<String> = obj
            .keys()
            .filter(|k| *k != "$ref" && *k != "$schema")
            .cloned()
            .collect();

        if sibling_keys.is_empty() {
            return;
        }

        if sibling_keys == ["description"] {
            obj.remove("description");
            return;
        }

        let ref_val = obj.remove("$ref").unwrap();
        let mut ref_part = serde_json::Map::new();
        ref_part.insert("$ref".to_string(), ref_val);

        let mut sibling_part = serde_json::Map::new();
        for key in &sibling_keys {
            if key == "description" {
                continue;
            }
            if let Some(val) = obj.remove(key) {
                sibling_part.insert(key.clone(), val);
            }
        }
        obj.remove("description");

        obj.insert(
            "allOf".to_string(),
            serde_json::json!([
                serde_json::Value::Object(ref_part),
                serde_json::Value::Object(sibling_part),
            ]),
        );
    }
}

/// Schema information for a single tool, serializable for API responses.
#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchema {
    /// The name of the tool.
    pub name: String,
    /// The JSON schema for the tool's input parameters.
    pub input_schema: serde_json::Value,
    /// The JSON schema for the tool's output.
    pub output_schema: serde_json::Value,
}

/// A collection of tool schemas, typically used for API responses.
#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchemas {
    /// The list of tool schemas.
    pub schemas: Vec<ToolSchema>,
}

/// Entry in a combined schema mapping a tool name to its input/output definition names.
#[derive(Serialize, Deserialize, Clone)]
pub struct CombinedToolEntry {
    /// The tool name.
    pub name: String,
    /// The schema definition name for the tool's input.
    pub input: String,
    /// The schema definition name for the tool's output.
    pub output: String,
}

/// Combined schema with shared `$defs` and a tool→type mapping.
///
/// All tool input/output types and their transitive dependencies live in a
/// single `$defs` map, deduplicated by schemars' [`SchemaGenerator`].
#[derive(Serialize, Deserialize, Clone)]
pub struct CombinedToolSchemas {
    /// Shared JSON Schema definitions (keyed by type name).
    #[serde(rename = "$defs")]
    pub defs: serde_json::Map<String, serde_json::Value>,
    /// Tool entries referencing definitions by name.
    pub tools: Vec<CombinedToolEntry>,
}

impl CombinedToolSchemas {
    /// Replaces schemars' numeric collision suffixes (e.g. `ReadContent2`)
    /// with tool-name-prefixed names (e.g. `ReadThreadReadContent`).
    ///
    /// When two different Rust types share a `schema_name()`, schemars
    /// disambiguates with a numeric suffix. This method finds those,
    /// determines which tool references them, and renames to
    /// `{ToolName}{BaseName}` across `$defs`, `tools`, and all `$ref`s.
    pub fn mangle_collisions(&mut self) {
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

/// Trait for types that can generate tool schemas.
///
/// Implement this trait to provide schema information about available tools.
pub trait ToolSchemaGenerator {
    /// Generates the schemas for all tools in this generator.
    fn generate_schemas(&self) -> ToolSchemas;

    /// Registers this generator's tool types with a shared
    /// [`schemars::SchemaGenerator`], returning an entry per tool.
    ///
    /// The generator accumulates shared definitions so that types used by
    /// multiple tools (e.g. `CodeExecutionErrorCode`) appear only once.
    fn register_schemas(&self, generator: &mut schemars::SchemaGenerator)
    -> Vec<CombinedToolEntry>;
}

impl<Context> ToolSchemaGenerator for AsyncToolSet<Context> {
    fn generate_schemas(&self) -> ToolSchemas {
        let schemas = self
            .tools
            .iter()
            .map(|(name, tool_object)| ToolSchema {
                name: name.clone(),
                input_schema: serde_json::Value::Object(tool_object.input_schema.clone()),
                output_schema: tool_object.output_schema.clone(),
            })
            .collect();
        ToolSchemas { schemas }
    }

    fn register_schemas(
        &self,
        generator: &mut schemars::SchemaGenerator,
    ) -> Vec<CombinedToolEntry> {
        self.tools
            .iter()
            .map(|(name, tool_object)| {
                let (input, output) = (tool_object.schema_registrar)(generator);
                CombinedToolEntry {
                    name: name.clone(),
                    input,
                    output,
                }
            })
            .collect()
    }
}
