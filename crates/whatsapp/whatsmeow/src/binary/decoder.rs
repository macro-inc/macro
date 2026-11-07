// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/decoder.go (MPL-2.0, Copyright (c) Tulir Asokan)

use super::errors::DecodeError;
use super::node::{AttributeValue, Attrs, Node, NodeContent};
use super::token;
use crate::types::{INTEROP_SERVER, Jid, MESSENGER_SERVER, new_ad_jid, new_jid};

pub(super) struct BinaryDecoder<'data> {
    data: &'data [u8],
    index: usize,
}

/// A value Go's `read` returns as `any`.
enum Value {
    Empty,
    Nodes(Vec<Node>),
    Bytes(Vec<u8>),
    String(String),
    Jid(Jid),
}

impl Value {
    fn into_string(self) -> Option<String> {
        match self {
            Value::String(value) => Some(value),
            _ => None,
        }
    }
}

impl<'data> BinaryDecoder<'data> {
    pub(super) fn new(data: &'data [u8]) -> Self {
        Self { data, index: 0 }
    }

    pub(super) fn remaining(&self) -> usize {
        self.data.len() - self.index
    }

    fn check_eos(&self, length: usize) -> Result<(), DecodeError> {
        if self.index + length > self.data.len() {
            return Err(DecodeError::UnexpectedEof);
        }
        Ok(())
    }

    fn read_byte(&mut self) -> Result<u8, DecodeError> {
        self.check_eos(1)?;
        let value = self.data[self.index];
        self.index += 1;
        Ok(value)
    }

    fn read_int_n(&mut self, n: usize) -> Result<usize, DecodeError> {
        self.check_eos(n)?;
        let value = self.data[self.index..self.index + n]
            .iter()
            .fold(0, |accumulator, byte| {
                (accumulator << 8) | usize::from(*byte)
            });
        self.index += n;
        Ok(value)
    }

    fn read_int8(&mut self) -> Result<usize, DecodeError> {
        self.read_int_n(1)
    }

    fn read_int16(&mut self) -> Result<u16, DecodeError> {
        self.check_eos(2)?;
        let value = u16::from_be_bytes([self.data[self.index], self.data[self.index + 1]]);
        self.index += 2;
        Ok(value)
    }

    fn read_int20(&mut self) -> Result<usize, DecodeError> {
        self.check_eos(3)?;
        let value = ((usize::from(self.data[self.index]) & 15) << 16)
            + (usize::from(self.data[self.index + 1]) << 8)
            + usize::from(self.data[self.index + 2]);
        self.index += 3;
        Ok(value)
    }

    fn read_int32(&mut self) -> Result<usize, DecodeError> {
        self.read_int_n(4)
    }

    fn read_packed8(&mut self, tag: u8) -> Result<String, DecodeError> {
        let start_byte = self.read_byte()?;
        let mut build = Vec::with_capacity(usize::from(start_byte & 127) * 2);
        for _ in 0..(start_byte & 127) {
            let current_byte = self.read_byte()?;
            build.push(unpack_byte(tag, (current_byte & 0xf0) >> 4)?);
            build.push(unpack_byte(tag, current_byte & 0x0f)?);
        }
        if start_byte >> 7 != 0 {
            build.pop();
        }
        // Every unpacked byte is ASCII (digits, '-', '.', 'A'-'F' or NUL).
        Ok(build.into_iter().map(char::from).collect())
    }

    fn read_list_size(&mut self, tag: u8) -> Result<usize, DecodeError> {
        match tag {
            token::LIST_EMPTY => Ok(0),
            token::LIST_8 => self.read_int8(),
            token::LIST_16 => self.read_int16().map(usize::from),
            _ => Err(DecodeError::InvalidListSize {
                tag,
                position: self.index,
            }),
        }
    }

    fn read(&mut self, as_string: bool) -> Result<Value, DecodeError> {
        let tag = self.read_byte()?;
        match tag {
            token::LIST_EMPTY => Ok(Value::Empty),
            token::LIST_8 | token::LIST_16 => self.read_list(tag).map(Value::Nodes),
            token::BINARY_8 => {
                let size = self.read_int8()?;
                self.read_bytes_or_string(size, as_string)
            }
            token::BINARY_20 => {
                let size = self.read_int20()?;
                self.read_bytes_or_string(size, as_string)
            }
            token::BINARY_32 => {
                let size = self.read_int32()?;
                self.read_bytes_or_string(size, as_string)
            }
            token::DICTIONARY_0
            | token::DICTIONARY_1
            | token::DICTIONARY_2
            | token::DICTIONARY_3 => {
                let dictionary = usize::from(tag - token::DICTIONARY_0);
                let index = self.read_int8()?;
                token::get_double_token(dictionary, index)
                    .map(|value| Value::String(value.to_owned()))
                    .ok_or(DecodeError::InvalidDoubleToken { dictionary, index })
            }
            token::FB_JID => self.read_fb_jid().map(Value::Jid),
            token::INTEROP_JID => self.read_interop_jid().map(Value::Jid),
            token::JID_PAIR => self.read_jid_pair().map(Value::Jid),
            token::AD_JID => self.read_ad_jid().map(Value::Jid),
            token::NIBBLE_8 | token::HEX_8 => self.read_packed8(tag).map(Value::String),
            _ => match token::SINGLE_BYTE_TOKENS.get(usize::from(tag)) {
                Some(value) => Ok(Value::String((*value).to_owned())),
                None => Err(DecodeError::InvalidToken {
                    tag,
                    position: self.index,
                }),
            },
        }
    }

    fn read_jid_pair(&mut self) -> Result<Jid, DecodeError> {
        let user = self.read(true)?;
        let server = self.read(true)?;
        let Value::String(server) = server else {
            return Err(DecodeError::InvalidJidType("missing JID server".to_owned()));
        };
        match user {
            Value::Empty => Ok(new_jid("", &server)),
            Value::String(user) => Ok(new_jid(&user, &server)),
            _ => Err(DecodeError::InvalidJidType(
                "JID user is not a string".to_owned(),
            )),
        }
    }

    fn read_interop_jid(&mut self) -> Result<Jid, DecodeError> {
        let user = self.read_jid_user()?;
        let device = self.read_int16()?;
        let integrator = self.read_int16()?;
        let server = self.read(true)?.into_string();
        if server.as_deref() != Some(INTEROP_SERVER) {
            return Err(DecodeError::InvalidJidType(format!(
                "expected {INTEROP_SERVER:?}, got {server:?}"
            )));
        }
        Ok(Jid {
            user,
            raw_agent: 0,
            device,
            integrator,
            server: INTEROP_SERVER.to_owned(),
        })
    }

    fn read_fb_jid(&mut self) -> Result<Jid, DecodeError> {
        let user = self.read_jid_user()?;
        let device = self.read_int16()?;
        let server = self.read(true)?.into_string();
        if server.as_deref() != Some(MESSENGER_SERVER) {
            return Err(DecodeError::InvalidJidType(format!(
                "expected {MESSENGER_SERVER:?}, got {server:?}"
            )));
        }
        Ok(Jid {
            user,
            raw_agent: 0,
            device,
            integrator: 0,
            server: MESSENGER_SERVER.to_owned(),
        })
    }

    fn read_ad_jid(&mut self) -> Result<Jid, DecodeError> {
        let agent = self.read_byte()?;
        let device = self.read_byte()?;
        let user = self.read_jid_user()?;
        Ok(new_ad_jid(&user, agent, device))
    }

    /// Go asserts `user.(string)` and panics on anything else.
    fn read_jid_user(&mut self) -> Result<String, DecodeError> {
        self.read(true)?
            .into_string()
            .ok_or_else(|| DecodeError::InvalidJidType("JID user is not a string".to_owned()))
    }

    fn read_attributes(&mut self, n: usize) -> Result<Attrs, DecodeError> {
        let mut attributes = Attrs::new();
        for _ in 0..n {
            let Value::String(key) = self.read(true)? else {
                return Err(DecodeError::NonStringKey {
                    position: self.index,
                });
            };
            match self.read(true)? {
                Value::String(value) => {
                    attributes.insert(key, AttributeValue::String(value));
                }
                Value::Jid(jid) => {
                    attributes.insert(key, AttributeValue::Jid(jid));
                }
                // Go stores nil, which reads back like a missing attribute.
                Value::Empty => {}
                Value::Nodes(_) | Value::Bytes(_) => {
                    return Err(DecodeError::InvalidAttributeValue {
                        key,
                        position: self.index,
                    });
                }
            }
        }
        Ok(attributes)
    }

    fn read_list(&mut self, tag: u8) -> Result<Vec<Node>, DecodeError> {
        let size = self.read_list_size(tag)?;
        let mut nodes = Vec::with_capacity(size.min(self.remaining()));
        for _ in 0..size {
            nodes.push(self.read_node()?);
        }
        Ok(nodes)
    }

    pub(super) fn read_node(&mut self) -> Result<Node, DecodeError> {
        let size = self.read_byte()?;
        let list_size = self.read_list_size(size)?;

        let tag = self.read(true)?.into_string().unwrap_or_default();
        if list_size == 0 || tag.is_empty() {
            return Err(DecodeError::InvalidNode);
        }

        let attrs = self.read_attributes((list_size - 1) >> 1)?;
        if list_size % 2 == 1 {
            return Ok(Node {
                tag,
                attrs,
                content: None,
            });
        }

        let content = match self.read(false)? {
            Value::Empty => None,
            Value::Nodes(nodes) => Some(NodeContent::Nodes(nodes)),
            Value::Bytes(bytes) => Some(NodeContent::Bytes(bytes)),
            Value::String(value) => Some(NodeContent::String(value)),
            Value::Jid(jid) => Some(NodeContent::Jid(jid)),
        };
        Ok(Node {
            tag,
            attrs,
            content,
        })
    }

    fn read_bytes_or_string(
        &mut self,
        length: usize,
        as_string: bool,
    ) -> Result<Value, DecodeError> {
        let data = self.read_raw(length)?;
        if as_string {
            // Go converts arbitrary bytes to a string without validation.
            Ok(Value::String(String::from_utf8_lossy(data).into_owned()))
        } else {
            Ok(Value::Bytes(data.to_vec()))
        }
    }

    fn read_raw(&mut self, length: usize) -> Result<&'data [u8], DecodeError> {
        self.check_eos(length)?;
        let value = &self.data[self.index..self.index + length];
        self.index += length;
        Ok(value)
    }
}

fn unpack_byte(tag: u8, value: u8) -> Result<u8, DecodeError> {
    let unpacked = if tag == token::NIBBLE_8 {
        unpack_nibble(value)
    } else {
        unpack_hex(value)
    };
    unpacked.ok_or(DecodeError::InvalidPackedValue { tag, value })
}

fn unpack_nibble(value: u8) -> Option<u8> {
    match value {
        0..=9 => Some(b'0' + value),
        10 => Some(b'-'),
        11 => Some(b'.'),
        15 => Some(0),
        _ => None,
    }
}

fn unpack_hex(value: u8) -> Option<u8> {
    match value {
        0..=9 => Some(b'0' + value),
        10..=15 => Some(b'A' + value - 10),
        _ => None,
    }
}
