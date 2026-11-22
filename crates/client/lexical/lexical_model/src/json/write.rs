//! JavaScript JSON encoding into a shared output buffer.
use crate::*;
use serde_json::Value;
mod node;

pub(super) fn editor_state(state: &EditorState) -> Result<String, Error> {
    let mut output = String::with_capacity(state.node_count().saturating_mul(192).max(256));
    output.push_str("{\"root\":");
    node::write(state.view(), NodeKey::ROOT, &mut output)?;
    output.push('}');
    Ok(output)
}

pub(super) fn value(value: &Value) -> String {
    let capacity = value
        .as_str()
        .map_or(256, |text| text.len().saturating_add(2));
    let mut output = String::with_capacity(capacity);
    write_value(value, &mut output);
    output
}

fn string(text: &str, output: &mut String) {
    output.push('"');
    let mut start = 0;
    for next in memchr::memchr2_iter(b'"', b'\\', text.as_bytes()) {
        control_characters(&text[start..next], output);
        output.push('\\');
        output.push(char::from(text.as_bytes()[next]));
        start = next + 1;
    }
    control_characters(&text[start..], output);
    output.push('"');
}

fn control_characters(text: &str, output: &mut String) {
    let mut start = 0;
    for (next, byte) in text.bytes().enumerate() {
        if byte >= 0x20 {
            continue;
        }
        // Escape locations are ASCII, so both slice boundaries are UTF-8 boundaries.
        output.push_str(&text[start..next]);
        match byte {
            b'\x08' => output.push_str("\\b"),
            b'\x0c' => output.push_str("\\f"),
            b'\n' => output.push_str("\\n"),
            b'\r' => output.push_str("\\r"),
            b'\t' => output.push_str("\\t"),
            byte => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                output.push_str("\\u00");
                output.push(char::from(HEX[usize::from(byte >> 4)]));
                output.push(char::from(HEX[usize::from(byte & 15)]));
            }
        }
        start = next + 1;
    }
    output.push_str(&text[start..]);
}

fn array_index(key: &str) -> Option<u32> {
    let bytes = key.as_bytes();
    if bytes.is_empty() || bytes.len() > 10 || (bytes[0] == b'0' && bytes.len() > 1) {
        return None;
    }
    let mut number = 0_u32;
    for byte in bytes {
        if !byte.is_ascii_digit() {
            return None;
        }
        number = number
            .checked_mul(10)?
            .checked_add(u32::from(*byte - b'0'))?;
    }
    (number != u32::MAX).then_some(number)
}

fn fields(object: &SerializedNode) -> impl Iterator<Item = (&str, &Value)> {
    let mut indexed: smallvec::SmallVec<[(u32, &str, &Value); 4]> = object
        .iter()
        .filter_map(|(key, value)| array_index(key).map(|index| (index, key.as_str(), value)))
        .collect();
    indexed.sort_unstable_by_key(|(index, _, _)| *index);
    indexed
        .into_iter()
        .map(|(_, key, value)| (key, value))
        .chain(
            object
                .iter()
                .filter(|(key, _)| array_index(key).is_none())
                .map(|(key, value)| (key.as_str(), value)),
        )
}

fn write_value(value: &Value, output: &mut String) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => match value.as_f64() {
            Some(number) => output.push_str(ryu_js::Buffer::new().format(number)),
            None => output.push_str("null"),
        },
        Value::String(value) => string(value, output),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                write_value(value, output);
            }
            output.push(']');
        }
        Value::Object(object) => {
            output.push('{');
            for (index, (key, value)) in fields(object).enumerate() {
                if index != 0 {
                    output.push(',');
                }
                string(key, output);
                output.push(':');
                write_value(value, output);
            }
            output.push('}');
        }
    }
}

#[cfg(test)]
mod test;
