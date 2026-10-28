// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/xml.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::fmt;

use super::node::{Node, NodeContent};

/// Binary content longer than this is printed as a byte count instead of hex.
pub const MAX_BYTES_TO_PRINT_AS_HEX: usize = 128;

/// The XML representation of the node on one line (Go's `Node.String` with
/// `IndentXML` off).
impl fmt::Display for Node {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.xml_string(false))
    }
}

impl Node {
    /// The XML representation of the node with children on their own,
    /// indented lines (Go's `Node.String` with `IndentXML` on).
    pub fn indented_string(&self) -> String {
        self.xml_string(true)
    }

    fn xml_string(&self, indent: bool) -> String {
        let content = self.content_string(indent);
        if content.is_empty() {
            return format!("<{}{}/>", self.tag, self.attribute_string());
        }
        let newline = if content.len() == 1 || !indent {
            ""
        } else {
            "\n"
        };
        format!(
            "<{tag}{attributes}>{newline}{content}{newline}</{tag}>",
            tag = self.tag,
            attributes = self.attribute_string(),
            content = content.join(newline),
        )
    }

    fn attribute_string(&self) -> String {
        if self.attrs.is_empty() {
            return String::new();
        }
        // Go sorts the formatted `key="value"` strings, with an empty first
        // entry that turns into the leading space.
        let mut attributes: Vec<String> = std::iter::once(String::new())
            .chain(
                self.attrs
                    .iter()
                    .map(|(key, value)| format!("{key}=\"{value}\"")),
            )
            .collect();
        attributes.sort();
        attributes.join(" ")
    }

    fn content_string(&self, indent: bool) -> Vec<String> {
        let mut split = Vec::new();
        match &self.content {
            Some(NodeContent::Nodes(children)) => {
                for child in children {
                    split.extend(child.xml_string(indent).split('\n').map(str::to_owned));
                }
            }
            Some(NodeContent::Bytes(bytes)) => {
                if let Some(text) = printable(bytes) {
                    if indent {
                        split.extend(text.split('\n').map(str::to_owned));
                    } else {
                        split.push(text.replace('\n', "\\n"));
                    }
                } else if bytes.len() > MAX_BYTES_TO_PRINT_AS_HEX {
                    split.push(format!("<!-- {} bytes -->", bytes.len()));
                } else if !indent {
                    split.push(hex::encode(bytes));
                } else {
                    let hex_data = hex::encode(bytes);
                    split.extend(
                        hex_data
                            .as_bytes()
                            .chunks(80)
                            .map(|line| String::from_utf8_lossy(line).into_owned()),
                    );
                }
            }
            Some(NodeContent::String(text)) => push_text(&mut split, text, indent),
            Some(NodeContent::Jid(jid)) => push_text(&mut split, &jid.to_string(), indent),
            None => {}
        }
        if split.len() > 1 && indent {
            for line in &mut split {
                line.insert_str(0, "  ");
            }
        }
        split
    }
}

fn push_text(split: &mut Vec<String>, text: &str, indent: bool) {
    if indent {
        split.extend(text.split('\n').map(str::to_owned));
    } else {
        split.push(text.replace('\n', "\\n"));
    }
}

/// The bytes as a string when they are valid UTF-8 made of printable
/// characters only.
///
/// Go uses `unicode.IsPrint` (letters, marks, numbers, punctuation, symbols
/// and the ASCII space). Rust's standard library has no general-category
/// lookup, so this approximates it: no control characters and no whitespace
/// other than the ASCII space. It only affects debug output.
fn printable(data: &[u8]) -> Option<&str> {
    let text = std::str::from_utf8(data).ok()?;
    text.chars()
        .all(|char| char == ' ' || !(char.is_control() || char.is_whitespace()))
        .then_some(text)
        .filter(|text| !text.is_empty())
}
