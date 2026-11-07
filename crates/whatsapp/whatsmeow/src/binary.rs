// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! Encoding and decoding documents in WhatsApp's binary XML format.
//!
//! Not ported: `Node.UnmarshalJSON` (no JSON caller yet) and the deprecated
//! `binary/proto` aliases (use [`crate::proto`]).

mod attrs;
mod decoder;
mod encoder;
mod errors;
mod node;
pub mod token;
mod unpack;
mod xml;

pub use attrs::{AttrError, AttrUtility, ErrorList};
pub use errors::{DecodeError, EncodeError};
pub use node::{AttributeValue, Attrs, Node, NodeContent, marshal, unmarshal};
pub use unpack::unpack;
pub use xml::MAX_BYTES_TO_PRINT_AS_HEX;

#[cfg(test)]
mod test;
