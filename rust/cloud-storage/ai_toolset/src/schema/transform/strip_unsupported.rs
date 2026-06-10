use schemars::Schema;
use schemars::transform::Transform;
use serde_json::Value;

/// String formats accepted by both OpenAI and Anthropic strict mode.
///
/// Anthropic additionally supports `uri`, but OpenAI's list omits it, so it
/// is stripped to stay valid on both providers.
const FORMAT_WHITELIST: &[&str] = &[
    "date-time",
    "time",
    "date",
    "duration",
    "email",
    "hostname",
    "ipv4",
    "ipv6",
    "uuid",
];

/// schemars type-width artifacts (`"format": "uint32"` on a `u32` field,
/// etc.). Stripped silently — they encode the Rust type, not a constraint
/// the model needs to know about.
const TYPE_WIDTH_FORMATS: &[&str] = &[
    "int8", "int16", "int32", "int64", "int128", "uint8", "uint16", "uint32", "uint64", "uint128",
    "float", "double",
];

/// Keywords rejected by at least one provider's strict mode, stripped and
/// recorded in the property's `description` so the constraint still reaches
/// the model as guidance.
///
/// Numeric bounds (`minimum`, …) are OpenAI-supported but Anthropic-rejected;
/// string lengths (`minLength`, `maxLength`) are rejected by both; array
/// constraints beyond `minItems: 0|1` are Anthropic-rejected; `default` is
/// not in OpenAI's supported keyword set.
const STRIPPED_KEYWORDS: &[&str] = &[
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "maxItems",
    "uniqueItems",
    "contains",
    "minContains",
    "maxContains",
    "default",
];

/// Strips JSON Schema keywords that OpenAI or Anthropic strict mode rejects.
///
/// Stripped constraints are appended to the node's `description` so the
/// model still sees them as soft guidance (mirroring what the official
/// Anthropic SDKs do); validation of the original constraints remains the
/// tool implementation's job.
#[derive(Debug, Clone)]
pub struct StripUnsupported;

impl Transform for StripUnsupported {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };

        let mut notes: Vec<String> = Vec::new();

        for key in STRIPPED_KEYWORDS {
            if let Some(value) = obj.remove(*key) {
                notes.push(format!("{key}: {value}"));
            }
        }

        // `minItems` is allowed by both providers only for 0 and 1.
        if let Some(n) = obj.get("minItems").and_then(Value::as_u64)
            && n > 1
        {
            obj.remove("minItems");
            notes.push(format!("minItems: {n}"));
        }

        if let Some(format) = obj.get("format").and_then(Value::as_str).map(str::to_owned)
            && !FORMAT_WHITELIST.contains(&format.as_str())
        {
            obj.remove("format");
            if !TYPE_WIDTH_FORMATS.contains(&format.as_str()) {
                notes.push(format!("format: {format}"));
            }
        }

        if notes.is_empty() {
            return;
        }
        let note = format!("Constraints: {}", notes.join(", "));
        match obj.get_mut("description") {
            Some(Value::String(description)) => {
                description.push_str("\n\n");
                description.push_str(&note);
            }
            _ => {
                obj.insert("description".to_string(), Value::String(note));
            }
        }
    }
}
