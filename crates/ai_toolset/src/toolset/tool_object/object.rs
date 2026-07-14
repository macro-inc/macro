use schemars::SchemaGenerator;
use serde_json::Map;
use serde_json::Value;

/// Closure that registers a tool's input/output types with a shared
/// [`SchemaGenerator`], returning `(input_name, output_name)`.
pub type SchemaRegistrar = Box<dyn Fn(&mut SchemaGenerator) -> (String, String) + Send + Sync>;

/// A compiled tool object containing schema and deserialization logic.
///
/// `ToolObject` holds the metadata and deserializer for a tool, allowing
/// it to be invoked with JSON input at runtime.
pub struct ToolObject<T> {
    /// The JSON schema describing the tool's input parameters.
    pub input_schema: Map<String, Value>,
    /// A human-readable description of what the tool does.
    pub description: String,
    /// The unique name of the tool.
    pub name: String,
    /// The deserializer function for converting JSON to the tool type.
    pub deserializer: T,
    /// Registers this tool's input/output types with a shared generator
    /// for combined schema generation.
    pub schema_registrar: SchemaRegistrar,
}
