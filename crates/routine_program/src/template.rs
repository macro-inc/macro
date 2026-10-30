//! `{{…}}` placeholders in tool arguments.
//!
//! A placeholder names a path into the run's context: `trigger.<path>` reads
//! the triggering item and `steps.<id>.<path>` reads an earlier tool step's
//! output. Path segments are object keys or array indexes, e.g.
//! `{{trigger.email.from.email}}` or `{{trigger.email.to.0.name}}`.
//!
//! A string that is exactly one placeholder becomes the referenced JSON value
//! (null when absent), so ids, numbers and lists keep their type. Placeholders
//! inside longer text are replaced by the value's text (nothing when absent).

use serde_json::{Map, Value};

use crate::model::StepId;

#[cfg(test)]
mod test;

const OPEN: &str = "{{";
const CLOSE: &str = "}}";

/// What a placeholder reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reference {
    /// A path into the triggering item.
    Trigger(Vec<String>),
    /// A path into an earlier tool step's output.
    Step {
        /// The tool step's id.
        id: StepId,
        /// The path inside its output.
        path: Vec<String>,
    },
}

/// A placeholder that cannot be read.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TemplateError {
    /// `{{` without a matching `}}`.
    #[error("a `{{{{` placeholder in \"{0}\" is not closed with `}}}}`")]
    Unclosed(String),
    /// Not `trigger.<path>` or `steps.<id>.<path>`.
    #[error(
        "`{{{{{0}}}}}` is not a placeholder; use `{{{{trigger.<path>}}}}` or `{{{{steps.<id>.<path>}}}}`"
    )]
    Unknown(String),
}

/// Every placeholder in `value`'s strings, in order.
pub fn references(value: &Value) -> Result<Vec<Reference>, TemplateError> {
    let mut found = Vec::new();
    collect(value, &mut found)?;
    Ok(found)
}

fn collect(value: &Value, found: &mut Vec<Reference>) -> Result<(), TemplateError> {
    match value {
        Value::String(text) => {
            for part in parse(text)? {
                if let Part::Placeholder(reference) = part {
                    found.push(reference);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect(item, found)?;
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect(item, found)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Replace every placeholder in `arguments` with its value from `context`
/// (`{"trigger": …, "steps": {"<id>": …}}`). Call [`references`] first:
/// rendering keeps unreadable placeholders as written.
pub fn render(arguments: &Map<String, Value>, context: &Value) -> Map<String, Value> {
    arguments
        .iter()
        .map(|(key, value)| (key.clone(), render_value(value, context)))
        .collect()
}

fn render_value(value: &Value, context: &Value) -> Value {
    match value {
        Value::String(text) => render_text(text, context),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| render_value(item, context))
                .collect(),
        ),
        Value::Object(map) => Value::Object(render(map, context)),
        other => other.clone(),
    }
}

fn render_text(text: &str, context: &Value) -> Value {
    let Ok(parts) = parse(text) else {
        return Value::String(text.to_owned());
    };
    if let [Part::Placeholder(reference)] = parts.as_slice() {
        return lookup(reference, context).cloned().unwrap_or(Value::Null);
    }
    let mut rendered = String::new();
    for part in parts {
        match part {
            Part::Text(text) => rendered.push_str(text),
            Part::Placeholder(reference) => match lookup(&reference, context) {
                None | Some(Value::Null) => {}
                Some(Value::String(text)) => rendered.push_str(text),
                Some(other) => rendered.push_str(&other.to_string()),
            },
        }
    }
    Value::String(rendered)
}

fn lookup<'a>(reference: &Reference, context: &'a Value) -> Option<&'a Value> {
    let (root, path) = match reference {
        Reference::Trigger(path) => (context.get("trigger")?, path),
        Reference::Step { id, path } => (context.get("steps")?.get(id.as_str())?, path),
    };
    path.iter().try_fold(root, |value, segment| match value {
        Value::Object(map) => map.get(segment),
        Value::Array(items) => segment.parse::<usize>().ok().and_then(|i| items.get(i)),
        _ => None,
    })
}

enum Part<'a> {
    Text(&'a str),
    Placeholder(Reference),
}

fn parse(text: &str) -> Result<Vec<Part<'_>>, TemplateError> {
    let mut parts = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        if start > 0 {
            parts.push(Part::Text(&rest[..start]));
        }
        let after = &rest[start + OPEN.len()..];
        let end = after
            .find(CLOSE)
            .ok_or_else(|| TemplateError::Unclosed(text.to_owned()))?;
        parts.push(Part::Placeholder(reference(after[..end].trim())?));
        rest = &after[end + CLOSE.len()..];
    }
    if !rest.is_empty() {
        parts.push(Part::Text(rest));
    }
    Ok(parts)
}

fn reference(inner: &str) -> Result<Reference, TemplateError> {
    let unknown = || TemplateError::Unknown(inner.to_owned());
    let segments: Vec<String> = inner.split('.').map(str::to_owned).collect();
    let valid_segment = |segment: &String| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    if !segments.iter().all(valid_segment) {
        return Err(unknown());
    }
    match segments.split_first() {
        Some((root, path)) if root == "trigger" => Ok(Reference::Trigger(path.to_vec())),
        Some((root, path)) if root == "steps" => {
            let (id, path) = path.split_first().ok_or_else(unknown)?;
            let id = StepId::try_from(id.clone()).map_err(|_| unknown())?;
            Ok(Reference::Step {
                id,
                path: path.to_vec(),
            })
        }
        _ => Err(unknown()),
    }
}
