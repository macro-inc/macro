//! What the renderer would reject in a view, found before the view is posted.
//!
//! A view is checked against the model-facing schema that the renderer's Zod
//! schema generates, and read the way Zod reads it: a field the schema does
//! not name is ignored, as the renderer ignores it. Problems name where they
//! are and what belongs there, never what the view holds, since they are
//! logged with the failed call.

use std::sync::LazyLock;

use serde_json::Value;

/// The model-facing schema, as JSON.
static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(super::SCHEMA_JSON)
        .expect("the generated Show tool schema must be valid JSON")
});

/// The schema keywords [`view_problems`] reads. The generated schema may use
/// only these and the ones it ignores, [`IGNORED_KEYWORDS`].
#[cfg(test)]
pub(super) const CHECKED_KEYWORDS: &[&str] = &[
    "$ref",
    "anyOf",
    "oneOf",
    "type",
    "const",
    "enum",
    "properties",
    "required",
    "items",
];

/// Schema keywords that do not change what the renderer accepts. Zod drops
/// fields its schema does not name, so `additionalProperties` rejects nothing.
#[cfg(test)]
pub(super) const IGNORED_KEYWORDS: &[&str] = &[
    "$schema",
    "$defs",
    "title",
    "description",
    "additionalProperties",
];

/// What in a view the renderer would reject, each problem with its place in
/// the view. Empty for a view it draws.
pub(super) fn view_problems(view: &Value) -> Vec<String> {
    let mut checker = Checker {
        root: &SCHEMA,
        problems: Vec::new(),
    };
    checker.check(&SCHEMA["properties"]["view"], view, "view");
    checker.problems
}

struct Checker<'s> {
    root: &'s Value,
    problems: Vec<String>,
}

impl<'s> Checker<'s> {
    fn check(&mut self, schema: &'s Value, value: &Value, path: &str) {
        let schema = self.resolve(schema);
        if let Some(shapes) = schema
            .get("anyOf")
            .or_else(|| schema.get("oneOf"))
            .and_then(Value::as_array)
        {
            return self.check_shapes(shapes, value, path);
        }
        if let Some(expected) = schema.get("type")
            && !has_type(value, expected)
        {
            self.problems.push(format!(
                "{path} should be {}, not {}",
                type_names(expected),
                kind(value)
            ));
            return;
        }
        if let Some(constant) = schema.get("const")
            && value != constant
        {
            self.problems.push(format!("{path} should be {constant}"));
        }
        if let Some(allowed) = schema.get("enum").and_then(Value::as_array)
            && !allowed.contains(value)
        {
            self.problems
                .push(format!("{path} should be one of {}", listed(allowed)));
        }
        match value {
            Value::Object(fields) => {
                let required = schema.get("required").and_then(Value::as_array);
                for name in required.into_iter().flatten().filter_map(Value::as_str) {
                    if !fields.contains_key(name) {
                        self.problems.push(format!("{path} is missing \"{name}\""));
                    }
                }
                let properties = schema.get("properties").and_then(Value::as_object);
                for (name, property) in properties.into_iter().flatten() {
                    if let Some(field) = fields.get(name) {
                        self.check(property, field, &format!("{path}.{name}"));
                    }
                }
            }
            Value::Array(items) => {
                if let Some(item) = schema.get("items") {
                    for (index, value) in items.iter().enumerate() {
                        self.check(item, value, &format!("{path}[{index}]"));
                    }
                }
            }
            _ => {}
        }
    }

    /// A value that can take one of several shapes. A widget names its shape
    /// in `type` and a list source in `kind`, a field every shape fixes, and
    /// is checked as the shape it names. A union with no such field takes a
    /// value any of its shapes takes.
    fn check_shapes(&mut self, shapes: &'s [Value], value: &Value, path: &str) {
        let shapes: Vec<&'s Value> = shapes.iter().map(|shape| self.resolve(shape)).collect();
        let Some(key) = discriminant(&shapes) else {
            let taken = shapes.iter().copied().any(|shape| {
                let mut trial = Checker {
                    root: self.root,
                    problems: Vec::new(),
                };
                trial.check(shape, value, path);
                trial.problems.is_empty()
            });
            if !taken {
                self.problems
                    .push(format!("{path} matches none of the shapes it can take"));
            }
            return;
        };
        let Some(fields) = value.as_object() else {
            self.problems
                .push(format!("{path} should be an object, not {}", kind(value)));
            return;
        };
        let names = || listed(shapes.iter().filter_map(|shape| fixed(shape, key)));
        let Some(named) = fields.get(key) else {
            let names = names();
            self.problems
                .push(format!("{path} is missing \"{key}\", one of {names}"));
            return;
        };
        match shapes
            .iter()
            .copied()
            .find(|shape| fixed(shape, key) == Some(named))
        {
            Some(shape) => self.check(shape, value, path),
            None => {
                let names = names();
                self.problems
                    .push(format!("{path}.{key} should be one of {names}"));
            }
        }
    }

    /// The schema a local `$ref` points at, or the schema itself.
    fn resolve(&self, schema: &'s Value) -> &'s Value {
        schema
            .get("$ref")
            .and_then(Value::as_str)
            .and_then(|reference| reference.strip_prefix('#'))
            .and_then(|pointer| self.root.pointer(pointer))
            .unwrap_or(schema)
    }
}

/// The value a shape fixes its `key` to.
fn fixed<'s>(shape: &'s Value, key: &str) -> Option<&'s Value> {
    shape.get("properties")?.get(key)?.get("const")
}

/// The field every shape of a union fixes to a value of its own.
fn discriminant<'s>(shapes: &[&'s Value]) -> Option<&'s str> {
    let first = shapes.first()?.get("properties")?.as_object()?;
    first
        .keys()
        .find(|key| shapes.iter().all(|shape| fixed(shape, key).is_some()))
        .map(String::as_str)
}

fn has_type(value: &Value, expected: &Value) -> bool {
    match expected {
        Value::String(name) => is_a(value, name),
        Value::Array(names) => names
            .iter()
            .filter_map(Value::as_str)
            .any(|name| is_a(value, name)),
        _ => true,
    }
}

fn is_a(value: &Value, name: &str) -> bool {
    match name {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.as_f64().is_some_and(|number| number.fract() == 0.0),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => true,
    }
}

fn type_names(expected: &Value) -> String {
    let names: Vec<&str> = match expected {
        Value::String(name) => vec![type_name(name)],
        Value::Array(names) => names
            .iter()
            .filter_map(Value::as_str)
            .map(type_name)
            .collect(),
        _ => Vec::new(),
    };
    names.join(" or ")
}

fn type_name(name: &str) -> &str {
    match name {
        "object" => "an object",
        "array" => "an array",
        "string" => "a string",
        "number" => "a number",
        "integer" => "a whole number",
        "boolean" => "true or false",
        other => other,
    }
}

/// What a value is, without what it holds.
fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

fn listed<'v>(values: impl IntoIterator<Item = &'v Value>) -> String {
    values
        .into_iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}
