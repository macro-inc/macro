// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/encoder.go (MPL-2.0, Copyright (c) Tulir Asokan)

use super::errors::EncodeError;
use super::node::{AttributeValue, Attrs, Node, NodeContent};
use super::token;
use crate::types::{
    DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, HOSTED_LID_SERVER, HOSTED_SERVER, INTEROP_SERVER, Jid,
    MESSENGER_SERVER,
};

const TAG_SIZE: usize = 1;
const MAX_INT32: usize = 0x7fff_ffff;

pub(super) struct BinaryEncoder {
    data: Vec<u8>,
}

/// A value Go's `write(data any)` accepts.
enum Writable<'value> {
    Jid(&'value Jid),
    String(&'value str),
    Bytes(&'value [u8]),
    Nodes(&'value [Node]),
}

impl BinaryEncoder {
    pub(super) fn new() -> Self {
        Self { data: vec![0] }
    }

    pub(super) fn get_data(self) -> Vec<u8> {
        self.data
    }

    fn push_byte(&mut self, value: u8) {
        self.data.push(value);
    }

    fn push_bytes(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
    }

    fn push_int20(&mut self, value: u32) {
        let [_, high, middle, low] = value.to_be_bytes();
        self.push_bytes(&[high & 0x0f, middle, low]);
    }

    fn push_int8(&mut self, value: u8) {
        self.push_byte(value);
    }

    fn push_int16(&mut self, value: u16) {
        self.push_bytes(&value.to_be_bytes());
    }

    fn push_int32(&mut self, value: u32) {
        self.push_bytes(&value.to_be_bytes());
    }

    fn push_string(&mut self, value: &str) {
        self.push_bytes(value.as_bytes());
    }

    fn write_byte_length(&mut self, length: usize) -> Result<(), EncodeError> {
        if let Ok(short) = u8::try_from(length) {
            self.push_byte(token::BINARY_8);
            self.push_int8(short);
        } else if length < (1 << 20) {
            self.push_byte(token::BINARY_20);
            self.push_int20(
                u32::try_from(length).map_err(|_| EncodeError::LengthTooLarge(length))?,
            );
        } else if length < MAX_INT32 {
            self.push_byte(token::BINARY_32);
            self.push_int32(
                u32::try_from(length).map_err(|_| EncodeError::LengthTooLarge(length))?,
            );
        } else {
            return Err(EncodeError::LengthTooLarge(length));
        }
        Ok(())
    }

    pub(super) fn write_node(&mut self, node: &Node) -> Result<(), EncodeError> {
        if node.tag == "0" {
            self.push_byte(token::LIST_8);
            self.push_byte(token::LIST_EMPTY);
            return Ok(());
        }

        let has_content = usize::from(node.content.is_some());
        self.write_list_start(2 * count_attributes(&node.attrs) + TAG_SIZE + has_content)?;
        self.write_string(&node.tag)?;
        self.write_attributes(&node.attrs)?;
        match &node.content {
            Some(NodeContent::Nodes(nodes)) => self.write(Writable::Nodes(nodes)),
            Some(NodeContent::Bytes(bytes)) => self.write(Writable::Bytes(bytes)),
            Some(NodeContent::String(value)) => self.write(Writable::String(value)),
            Some(NodeContent::Jid(jid)) => self.write(Writable::Jid(jid)),
            None => Ok(()),
        }
    }

    fn write(&mut self, data: Writable<'_>) -> Result<(), EncodeError> {
        match data {
            Writable::Jid(jid) => self.write_jid(jid),
            Writable::String(value) => self.write_string(value),
            Writable::Bytes(bytes) => self.write_bytes(bytes),
            Writable::Nodes(nodes) => {
                self.write_list_start(nodes.len())?;
                for node in nodes {
                    self.write_node(node)?;
                }
                Ok(())
            }
        }
    }

    fn write_string(&mut self, data: &str) -> Result<(), EncodeError> {
        if let Some(token_index) = token::index_of_single_token(data) {
            self.push_byte(token_index);
        } else if let Some((dictionary_index, token_index)) =
            token::index_of_double_byte_token(data)
        {
            self.push_byte(token::DICTIONARY_0 + dictionary_index);
            self.push_byte(token_index);
        } else if validate_nibble(data) {
            self.write_packed_bytes(data, token::NIBBLE_8);
        } else if validate_hex(data) {
            self.write_packed_bytes(data, token::HEX_8);
        } else {
            self.write_string_raw(data)?;
        }
        Ok(())
    }

    fn write_bytes(&mut self, value: &[u8]) -> Result<(), EncodeError> {
        self.write_byte_length(value.len())?;
        self.push_bytes(value);
        Ok(())
    }

    fn write_string_raw(&mut self, value: &str) -> Result<(), EncodeError> {
        self.write_byte_length(value.len())?;
        self.push_string(value);
        Ok(())
    }

    fn write_jid(&mut self, jid: &Jid) -> Result<(), EncodeError> {
        let server = jid.server.as_str();
        if ((server == DEFAULT_USER_SERVER || server == HIDDEN_USER_SERVER) && jid.device > 0)
            || server == HOSTED_SERVER
            || server == HOSTED_LID_SERVER
        {
            self.push_byte(token::AD_JID);
            self.push_byte(jid.actual_agent());
            self.push_byte(
                u8::try_from(jid.device).map_err(|_| EncodeError::DeviceOutOfRange(jid.device))?,
            );
            self.write_string(&jid.user)?;
        } else if server == MESSENGER_SERVER {
            self.push_byte(token::FB_JID);
            self.write(Writable::String(&jid.user))?;
            self.push_int16(jid.device);
            self.write(Writable::String(server))?;
        } else if server == INTEROP_SERVER {
            self.push_byte(token::INTEROP_JID);
            self.write(Writable::String(&jid.user))?;
            self.push_int16(jid.device);
            self.push_int16(jid.integrator);
            self.write(Writable::String(server))?;
        } else {
            self.push_byte(token::JID_PAIR);
            if jid.user.is_empty() {
                self.push_byte(token::LIST_EMPTY);
            } else {
                self.write(Writable::String(&jid.user))?;
            }
            self.write(Writable::String(server))?;
        }
        Ok(())
    }

    fn write_attributes(&mut self, attributes: &Attrs) -> Result<(), EncodeError> {
        for (key, value) in attributes {
            if value.is_empty_string() {
                continue;
            }
            self.write_string(key)?;
            match value {
                AttributeValue::String(value) => self.write(Writable::String(value))?,
                AttributeValue::Jid(jid) => self.write(Writable::Jid(jid))?,
            }
        }
        Ok(())
    }

    fn write_list_start(&mut self, list_size: usize) -> Result<(), EncodeError> {
        if list_size == 0 {
            self.push_byte(token::LIST_EMPTY);
        } else if let Ok(short) = u8::try_from(list_size) {
            self.push_byte(token::LIST_8);
            self.push_int8(short);
        } else {
            self.push_byte(token::LIST_16);
            self.push_int16(
                u16::try_from(list_size).map_err(|_| EncodeError::ListTooLarge(list_size))?,
            );
        }
        Ok(())
    }

    /// Packs a string that [`validate_nibble`] or [`validate_hex`] accepted,
    /// so it is at most [`token::PACKED_MAX`] bytes of known characters.
    fn write_packed_bytes(&mut self, value: &str, data_type: u8) {
        let packer = if data_type == token::NIBBLE_8 {
            pack_nibble
        } else {
            pack_hex
        };
        self.push_byte(data_type);

        let bytes = value.as_bytes();
        // PACKED_MAX (127) halved and rounded up fits in the low seven bits.
        let mut rounded_length = u8::try_from(bytes.len().div_ceil(2)).unwrap_or(u8::MAX);
        if !bytes.len().is_multiple_of(2) {
            rounded_length |= 128;
        }
        self.push_byte(rounded_length);
        let mut pairs = bytes.chunks_exact(2);
        for pair in pairs.by_ref() {
            self.push_byte(pack_byte_pair(packer, pair[0], pair[1]));
        }
        if let [last] = pairs.remainder() {
            self.push_byte(pack_byte_pair(packer, *last, 0));
        }
    }
}

fn count_attributes(attributes: &Attrs) -> usize {
    attributes
        .values()
        .filter(|value| !value.is_empty_string())
        .count()
}

fn pack_byte_pair(packer: fn(u8) -> u8, part1: u8, part2: u8) -> u8 {
    (packer(part1) << 4) | packer(part2)
}

fn validate_nibble(value: &str) -> bool {
    value.len() <= token::PACKED_MAX
        && value
            .bytes()
            .all(|char| char.is_ascii_digit() || char == b'-' || char == b'.')
}

/// Only called with characters [`validate_nibble`] accepted, or the 0 padding.
fn pack_nibble(value: u8) -> u8 {
    match value {
        b'-' => 10,
        b'.' => 11,
        0 => 15,
        _ => value - b'0',
    }
}

fn validate_hex(value: &str) -> bool {
    value.len() <= token::PACKED_MAX
        && value
            .bytes()
            .all(|char| char.is_ascii_digit() || (b'A'..=b'F').contains(&char))
}

/// Only called with characters [`validate_hex`] accepted, or the 0 padding.
fn pack_hex(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'A'..=b'F' => 10 + value - b'A',
        _ => 15,
    }
}
