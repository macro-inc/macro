// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/errors.go (MPL-2.0, Copyright (c) Tulir Asokan)

/// Errors returned by the binary XML decoder.
///
/// Go has sentinel errors (`ErrInvalidType`, `ErrInvalidJIDType`,
/// `ErrInvalidNode`, `ErrInvalidToken`, `ErrNonStringKey`) wrapped with
/// formatted context; each wrapping is a variant here. Inputs on which the Go
/// decoder panics (failed type assertions) are errors too.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DecodeError {
    /// The input ended in the middle of a value (Go's `io.EOF`).
    #[error("unexpected end of binary XML data")]
    UnexpectedEof,
    /// A byte that isn't a known token or type tag.
    #[error("invalid token with tag {tag} at position {position}")]
    InvalidToken {
        /// The tag byte.
        tag: u8,
        /// The decoder position after reading it.
        position: usize,
    },
    /// A double-byte token index outside the dictionaries.
    #[error("index out of double byte token bounds {dictionary}-{index}")]
    InvalidDoubleToken {
        /// The dictionary number.
        dictionary: usize,
        /// The token index in the dictionary.
        index: usize,
    },
    /// A list size with a tag that isn't a list tag.
    #[error("readListSize with unknown tag {tag} at position {position}")]
    InvalidListSize {
        /// The tag byte.
        tag: u8,
        /// The decoder position.
        position: usize,
    },
    /// A nibble or hex packed value that isn't valid for its packing.
    #[error("invalid packed value {value} for tag {tag}")]
    InvalidPackedValue {
        /// The packing tag ([`super::token::NIBBLE_8`] or [`super::token::HEX_8`]).
        tag: u8,
        /// The four-bit value.
        value: u8,
    },
    /// A JID with a missing or wrongly typed part.
    #[error("invalid JID type: {0}")]
    InvalidJidType(String),
    /// A node with no tag or an empty list header.
    #[error("invalid node")]
    InvalidNode,
    /// An attribute key that decoded to something other than a string.
    #[error("non-string key at position {position}")]
    NonStringKey {
        /// The decoder position.
        position: usize,
    },
    /// An attribute value that is a list of nodes or raw bytes, which the port
    /// can't store as an attribute.
    #[error("unsupported attribute value type for {key:?} at position {position}")]
    InvalidAttributeValue {
        /// The attribute key.
        key: String,
        /// The decoder position.
        position: usize,
    },
    /// Data after the end of the root node.
    #[error("{0} leftover bytes after decoding")]
    LeftoverBytes(usize),
    /// [`super::unpack`] got no data at all.
    #[error("no data to unpack")]
    EmptyPayload,
    /// [`super::unpack`] couldn't inflate the zlib payload.
    #[error("failed to decompress zlib payload: {0}")]
    Decompress(String),
}

/// Errors returned by the binary XML encoder. Go panics in these cases.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EncodeError {
    /// Binary data at or over `math.MaxInt32` bytes.
    #[error("length is too large: {0}")]
    LengthTooLarge(usize),
    /// A list with more entries than a two-byte length can hold. Go silently
    /// truncates the length.
    #[error("list is too large: {0}")]
    ListTooLarge(usize),
    /// An AD JID device number that doesn't fit the one-byte device field. Go
    /// silently truncates it.
    #[error("device {0} doesn't fit in an AD JID")]
    DeviceOutOfRange(u16),
}
