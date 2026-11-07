use schemars::Schema;
use schemars::transform::Transform;

/// Rewrites `oneOf` to `anyOf`.
///
/// Neither OpenAI nor Anthropic strict mode supports `oneOf`; both support
/// `anyOf`. schemars emits `oneOf` for enums whose variants carry doc
/// comments — those variants are mutually exclusive `const` subschemas, so
/// the rewrite is semantically lossless for generation purposes.
#[derive(Debug, Clone)]
pub struct OneOfToAnyOf;

impl Transform for OneOfToAnyOf {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };
        // If anyOf is already present, leave oneOf in place for the
        // validator to reject rather than guessing how to merge them.
        if obj.contains_key("anyOf") {
            return;
        }
        if let Some(subschemas) = obj.remove("oneOf") {
            obj.insert("anyOf".to_string(), subschemas);
        }
    }
}
