//! Serialize a workflow to YAML. A serde serializer builds an ordered tree,
//! then [`emit`] writes it in one fixed style, so the same workflow always
//! renders the same bytes:
//!
//! - block mappings and sequences, two-space indent, `- ` items indented
//!   under their key;
//! - strings plain when YAML reads them back unchanged, single-quoted
//!   otherwise, `|` block scalars when they span lines, double-quoted only
//!   for text a block scalar can't carry (control characters, a leading
//!   space or blank first line);
//! - `{}` / `[]` for empty collections and `null` for unit values.

use std::fmt::Write;

use serde::ser::{self, Serialize};

use crate::error::{Error, Result};

/// Render `value` as a YAML document.
pub fn to_string<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    let node = value.serialize(NodeSerializer)?;
    let mut out = String::new();
    match &node {
        Node::Map(entries) if !entries.is_empty() => emit_entries(&mut out, entries, 0, false),
        Node::Seq(items) if !items.is_empty() => emit_items(&mut out, items, 0),
        scalar => {
            emit_scalar(&mut out, scalar, 0);
            out.push('\n');
        }
    }
    Ok(out)
}

/// The serialized value: what YAML can represent, with mapping order kept.
#[derive(Debug, Clone, PartialEq)]
enum Node {
    Null,
    Bool(bool),
    Int(i128),
    Float(f64),
    Str(String),
    Seq(Vec<Node>),
    Map(Vec<(String, Node)>),
}

fn emit_entries(out: &mut String, entries: &[(String, Node)], indent: usize, first_inline: bool) {
    for (index, (key, value)) in entries.iter().enumerate() {
        if index > 0 || !first_inline {
            push_indent(out, indent);
        }
        emit_key(out, key);
        out.push(':');
        emit_child(out, value, indent);
    }
}

fn emit_items(out: &mut String, items: &[Node], indent: usize) {
    for item in items {
        push_indent(out, indent);
        out.push('-');
        match item {
            Node::Map(entries) if !entries.is_empty() => {
                out.push(' ');
                emit_entries(out, entries, indent + 2, true);
            }
            Node::Seq(nested) if !nested.is_empty() => {
                out.push('\n');
                emit_items(out, nested, indent + 2);
            }
            scalar => {
                out.push(' ');
                emit_scalar(out, scalar, indent + 2);
                out.push('\n');
            }
        }
    }
}

/// The value after `key:`, whose own content sits at `indent + 2`.
fn emit_child(out: &mut String, value: &Node, indent: usize) {
    match value {
        Node::Map(entries) if !entries.is_empty() => {
            out.push('\n');
            emit_entries(out, entries, indent + 2, false);
        }
        Node::Seq(items) if !items.is_empty() => {
            out.push('\n');
            emit_items(out, items, indent + 2);
        }
        scalar => {
            out.push(' ');
            emit_scalar(out, scalar, indent + 2);
            out.push('\n');
        }
    }
}

/// Write a scalar or empty collection. A block scalar's lines go at
/// `content_indent`.
fn emit_scalar(out: &mut String, value: &Node, content_indent: usize) {
    match value {
        Node::Null => out.push_str("null"),
        Node::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Node::Int(value) => {
            let _ = write!(out, "{value}");
        }
        Node::Float(value) => {
            let _ = write!(out, "{value:?}");
        }
        Node::Str(text) => emit_string(out, text, content_indent),
        Node::Seq(_) => out.push_str("[]"),
        Node::Map(_) => out.push_str("{}"),
    }
}

fn emit_key(out: &mut String, key: &str) {
    // `on` is a YAML 1.1 boolean, but every GitHub workflow spells the
    // trigger key bare and GitHub reads it as a string.
    if key == "on" || is_plain_safe(key) {
        out.push_str(key);
    } else {
        emit_quoted(out, key);
    }
}

fn emit_string(out: &mut String, text: &str, content_indent: usize) {
    if text.contains('\n') && fits_block_scalar(text) {
        emit_block(out, text, content_indent);
    } else if is_plain_safe(text) {
        out.push_str(text);
    } else {
        emit_quoted(out, text);
    }
}

/// `|` keeps one trailing newline, `|-` none, `|+` all of them.
fn emit_block(out: &mut String, text: &str, content_indent: usize) {
    let trailing = text.len() - text.trim_end_matches('\n').len();
    out.push_str(match trailing {
        0 => "|-",
        1 => "|",
        _ => "|+",
    });
    out.push('\n');

    let body = text.strip_suffix('\n').unwrap_or(text);
    for line in body.split('\n') {
        if !line.is_empty() {
            push_indent(out, content_indent);
            out.push_str(line);
        }
        out.push('\n');
    }
    // The newline ending the last line is written by the caller.
    out.pop();
}

/// A literal block scalar can't start with a space or a blank line (its
/// indentation would be misread) and can't carry control characters.
fn fits_block_scalar(text: &str) -> bool {
    !text.starts_with([' ', '\n'])
        && text
            .chars()
            .all(|c| c == '\n' || c == '\t' || !c.is_control())
}

fn emit_quoted(out: &mut String, text: &str) {
    if text.chars().any(|c| c.is_control()) {
        emit_double_quoted(out, text);
        return;
    }
    out.push('\'');
    out.push_str(&text.replace('\'', "''"));
    out.push('\'');
}

fn emit_double_quoted(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Whether `text` reads back as this same string when written unquoted, under
/// both YAML 1.1 (booleans like `yes`/`on`) and 1.2.
fn is_plain_safe(text: &str) -> bool {
    let Some(first) = text.chars().next() else {
        return false;
    };

    let has_unsafe_edge = text.trim() != text
        || "?:,[]{}#&*!|>'\"%@`".contains(first)
        || (first == '-' && (text.len() == 1 || text[1..].starts_with(' ')))
        || text.ends_with(':');
    let has_unsafe_inner =
        text.contains(": ") || text.contains(" #") || text.chars().any(|c| c.is_control());

    !has_unsafe_edge && !has_unsafe_inner && !is_reserved(text) && !looks_numeric(text)
}

fn is_reserved(text: &str) -> bool {
    matches!(
        text.to_ascii_lowercase().as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "y" | "n" | "null" | "~"
    )
}

/// Conservatively: anything a YAML reader might take for a number, date or
/// time (`20`, `1e3`, `0x1f`, `2026-01-01`, `12:30`, `.inf`).
fn looks_numeric(text: &str) -> bool {
    let first = text.chars().next().unwrap_or(' ');
    let starts_like_number = first.is_ascii_digit()
        || ((first == '+' || first == '-' || first == '.')
            && text[1..].starts_with(|c: char| c.is_ascii_digit() || c == '.' || c == 'i'));
    let number_chars = text
        .chars()
        .all(|c| c.is_ascii_hexdigit() || "xXoO._:+-".contains(c));
    let special = matches!(
        text.to_ascii_lowercase().as_str(),
        ".inf" | "-.inf" | "+.inf" | ".nan"
    );

    special || (starts_like_number && number_chars)
}

fn push_indent(out: &mut String, indent: usize) {
    out.extend(std::iter::repeat_n(' ', indent));
}

/// Builds a [`Node`] from any `Serialize` value.
struct NodeSerializer;

impl ser::Serializer for NodeSerializer {
    type Ok = Node;
    type Error = Error;
    type SerializeSeq = SeqBuilder;
    type SerializeTuple = SeqBuilder;
    type SerializeTupleStruct = SeqBuilder;
    type SerializeTupleVariant = VariantBuilder<SeqBuilder>;
    type SerializeMap = MapBuilder;
    type SerializeStruct = MapBuilder;
    type SerializeStructVariant = VariantBuilder<MapBuilder>;

    fn serialize_bool(self, value: bool) -> Result<Node> {
        Ok(Node::Bool(value))
    }

    fn serialize_i8(self, value: i8) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_i16(self, value: i16) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_i32(self, value: i32) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_i64(self, value: i64) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_u8(self, value: u8) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_u16(self, value: u16) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_u32(self, value: u32) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_u64(self, value: u64) -> Result<Node> {
        Ok(Node::Int(value.into()))
    }

    fn serialize_f32(self, value: f32) -> Result<Node> {
        Ok(Node::Float(value.into()))
    }

    fn serialize_f64(self, value: f64) -> Result<Node> {
        Ok(Node::Float(value))
    }

    fn serialize_char(self, value: char) -> Result<Node> {
        Ok(Node::Str(value.to_string()))
    }

    fn serialize_str(self, value: &str) -> Result<Node> {
        Ok(Node::Str(value.to_string()))
    }

    fn serialize_bytes(self, _value: &[u8]) -> Result<Node> {
        Err(Error::Unsupported("bytes"))
    }

    fn serialize_none(self) -> Result<Node> {
        Ok(Node::Null)
    }

    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Node> {
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<Node> {
        Ok(Node::Null)
    }

    fn serialize_unit_struct(self, _name: &'static str) -> Result<Node> {
        Ok(Node::Null)
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
    ) -> Result<Node> {
        Ok(Node::Str(variant.to_string()))
    }

    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<Node> {
        value.serialize(self)
    }

    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<Node> {
        Ok(Node::Map(vec![(
            variant.to_string(),
            value.serialize(NodeSerializer)?,
        )]))
    }

    fn serialize_seq(self, len: Option<usize>) -> Result<SeqBuilder> {
        Ok(SeqBuilder(Vec::with_capacity(len.unwrap_or(0))))
    }

    fn serialize_tuple(self, len: usize) -> Result<SeqBuilder> {
        self.serialize_seq(Some(len))
    }

    fn serialize_tuple_struct(self, _name: &'static str, len: usize) -> Result<SeqBuilder> {
        self.serialize_seq(Some(len))
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<VariantBuilder<SeqBuilder>> {
        Ok(VariantBuilder {
            variant,
            inner: SeqBuilder(Vec::with_capacity(len)),
        })
    }

    fn serialize_map(self, len: Option<usize>) -> Result<MapBuilder> {
        Ok(MapBuilder {
            entries: Vec::with_capacity(len.unwrap_or(0)),
            pending_key: None,
        })
    }

    fn serialize_struct(self, _name: &'static str, len: usize) -> Result<MapBuilder> {
        self.serialize_map(Some(len))
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<VariantBuilder<MapBuilder>> {
        Ok(VariantBuilder {
            variant,
            inner: self.serialize_map(Some(len))?,
        })
    }
}

struct SeqBuilder(Vec<Node>);

impl SeqBuilder {
    fn push<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        self.0.push(value.serialize(NodeSerializer)?);
        Ok(())
    }
}

impl ser::SerializeSeq for SeqBuilder {
    type Ok = Node;
    type Error = Error;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        self.push(value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Seq(self.0))
    }
}

impl ser::SerializeTuple for SeqBuilder {
    type Ok = Node;
    type Error = Error;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        self.push(value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Seq(self.0))
    }
}

impl ser::SerializeTupleStruct for SeqBuilder {
    type Ok = Node;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        self.push(value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Seq(self.0))
    }
}

struct MapBuilder {
    entries: Vec<(String, Node)>,
    pending_key: Option<String>,
}

impl MapBuilder {
    fn insert<T: Serialize + ?Sized>(&mut self, key: String, value: &T) -> Result<()> {
        self.entries.push((key, value.serialize(NodeSerializer)?));
        Ok(())
    }
}

/// Mapping keys must be scalars; they render as their string form.
fn key_string(key: Node) -> Result<String> {
    match key {
        Node::Str(text) => Ok(text),
        Node::Bool(value) => Ok(value.to_string()),
        Node::Int(value) => Ok(value.to_string()),
        _ => Err(Error::Unsupported("non-scalar mapping key")),
    }
}

impl ser::SerializeMap for MapBuilder {
    type Ok = Node;
    type Error = Error;

    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<()> {
        self.pending_key = Some(key_string(key.serialize(NodeSerializer)?)?);
        Ok(())
    }

    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        let key = self
            .pending_key
            .take()
            .ok_or(Error::Unsupported("map value without a key"))?;
        self.insert(key, value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Map(self.entries))
    }
}

impl ser::SerializeStruct for MapBuilder {
    type Ok = Node;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<()> {
        self.insert(key.to_string(), value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Map(self.entries))
    }
}

/// An enum variant with data: `{variant: <data>}`.
struct VariantBuilder<Inner> {
    variant: &'static str,
    inner: Inner,
}

impl ser::SerializeTupleVariant for VariantBuilder<SeqBuilder> {
    type Ok = Node;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        self.inner.push(value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Map(vec![(
            self.variant.to_string(),
            Node::Seq(self.inner.0),
        )]))
    }
}

impl ser::SerializeStructVariant for VariantBuilder<MapBuilder> {
    type Ok = Node;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<()> {
        self.inner.insert(key.to_string(), value)
    }

    fn end(self) -> Result<Node> {
        Ok(Node::Map(vec![(
            self.variant.to_string(),
            Node::Map(self.inner.entries),
        )]))
    }
}

#[cfg(test)]
mod test;
