// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/attrs.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::fmt;
use std::num::ParseIntError;

use chrono::{DateTime, Utc};

use super::node::{AttributeValue, Attrs, Node};
use crate::types::{EMPTY_JID, Jid};

/// A helper for reading multiple XML attributes and checking for errors
/// afterwards.
///
/// The functions return values directly and collect any decoding errors, which
/// can then be checked after all necessary attributes are read, instead of
/// having to check each attribute for errors separately.
pub struct AttrUtility<'node> {
    /// The attributes being read.
    pub attrs: &'node Attrs,
    /// The errors collected so far.
    pub errors: Vec<AttrError>,
}

/// One failed attribute read.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AttrError {
    /// A required JID attribute was missing.
    #[error("didn't find required JID attribute '{0}'")]
    MissingJid(String),
    /// A required attribute was missing.
    #[error("didn't find required attribute '{0}'")]
    Missing(String),
    /// The attribute had a different type than requested.
    #[error("expected attribute '{key}' to be {expected}, but was {actual}")]
    WrongType {
        /// The attribute key.
        key: String,
        /// The requested type.
        expected: &'static str,
        /// The stored type.
        actual: &'static str,
    },
    /// The attribute wasn't a valid integer.
    #[error("failed to parse int in attribute '{key}': {source}")]
    ParseInt {
        /// The attribute key.
        key: String,
        /// The parse failure.
        source: ParseIntError,
    },
    /// The attribute wasn't a valid unsigned integer.
    #[error("failed to parse uint in attribute '{key}': {source}")]
    ParseUint {
        /// The attribute key.
        key: String,
        /// The parse failure.
        source: ParseIntError,
    },
    /// The attribute wasn't one of the strings Go's `strconv.ParseBool` accepts.
    #[error("failed to parse bool in attribute '{key}': invalid syntax {value:?}")]
    ParseBool {
        /// The attribute key.
        key: String,
        /// The stored value.
        value: String,
    },
}

/// A list of errors that is an error itself.
#[derive(Debug, PartialEq, Eq)]
pub struct ErrorList(pub Vec<AttrError>);

impl fmt::Display for ErrorList {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[")?;
        for (index, error) in self.0.iter().enumerate() {
            if index > 0 {
                formatter.write_str(" ")?;
            }
            write!(formatter, "{error}")?;
        }
        formatter.write_str("]")
    }
}

impl std::error::Error for ErrorList {}

impl Node {
    /// The [`AttrUtility`] for this node.
    pub fn attr_getter(&self) -> AttrUtility<'_> {
        AttrUtility {
            attrs: &self.attrs,
            errors: Vec::new(),
        }
    }
}

fn type_name(value: &AttributeValue) -> &'static str {
    match value {
        AttributeValue::String(_) => "string",
        AttributeValue::Jid(_) => "types.JID",
    }
}

impl AttrUtility<'_> {
    /// The JID under the given key, if present and a JID. A missing attribute
    /// is an error only when `require` is set; a non-JID value always is.
    pub fn get_jid(&mut self, key: &str, require: bool) -> Option<Jid> {
        match self.attrs.get(key) {
            None => {
                if require {
                    self.errors.push(AttrError::MissingJid(key.to_owned()));
                }
                None
            }
            Some(AttributeValue::Jid(jid)) => Some(jid.clone()),
            Some(other) => {
                self.errors.push(AttrError::WrongType {
                    key: key.to_owned(),
                    expected: "JID",
                    actual: type_name(other),
                });
                None
            }
        }
    }

    /// The JID under the given key. A missing attribute isn't an error.
    pub fn optional_jid(&mut self, key: &str) -> Option<Jid> {
        self.get_jid(key, false)
    }

    /// The JID under the given key, or an empty JID. A missing attribute isn't
    /// an error.
    pub fn optional_jid_or_empty(&mut self, key: &str) -> Jid {
        self.get_jid(key, false)
            .unwrap_or_else(|| EMPTY_JID.clone())
    }

    /// The JID under the given key. If there's no valid JID under the key, an
    /// error is stored and an empty JID is returned.
    pub fn jid(&mut self, key: &str) -> Jid {
        self.get_jid(key, true).unwrap_or_default()
    }

    /// The string under the given key, if present and a string. A missing
    /// attribute is an error only when `require` is set.
    pub fn get_string(&mut self, key: &str, require: bool) -> Option<String> {
        match self.attrs.get(key) {
            None => {
                if require {
                    self.errors.push(AttrError::Missing(key.to_owned()));
                }
                None
            }
            Some(AttributeValue::String(value)) => Some(value.clone()),
            Some(other) => {
                self.errors.push(AttrError::WrongType {
                    key: key.to_owned(),
                    expected: "string",
                    actual: type_name(other),
                });
                None
            }
        }
    }

    /// The base-10 integer under the given key.
    pub fn get_int64(&mut self, key: &str, require: bool) -> Option<i64> {
        let value = self.get_string(key, require)?;
        value
            .parse()
            .map_err(|source| {
                self.errors.push(AttrError::ParseInt {
                    key: key.to_owned(),
                    source,
                })
            })
            .ok()
    }

    /// The base-10 unsigned integer under the given key. Unlike Rust's parser,
    /// Go's `strconv.ParseUint` rejects a leading `+`.
    pub fn get_uint64(&mut self, key: &str, require: bool) -> Option<u64> {
        let value = self.get_string(key, require)?;
        let digits = if value.starts_with('+') { "" } else { &value };
        digits
            .parse()
            .map_err(|source| {
                self.errors.push(AttrError::ParseUint {
                    key: key.to_owned(),
                    source,
                })
            })
            .ok()
    }

    /// The boolean under the given key, in any form Go's `strconv.ParseBool`
    /// accepts.
    pub fn get_bool(&mut self, key: &str, require: bool) -> Option<bool> {
        let value = self.get_string(key, require)?;
        match value.as_str() {
            "1" | "t" | "T" | "TRUE" | "true" | "True" => Some(true),
            "0" | "f" | "F" | "FALSE" | "false" | "False" => Some(false),
            _ => {
                self.errors.push(AttrError::ParseBool {
                    key: key.to_owned(),
                    value,
                });
                None
            }
        }
    }

    /// The Unix timestamp in seconds under the given key; `None` when it is
    /// missing, invalid, or 0 (Go returns the zero `time.Time` for 0).
    pub fn get_unix_time(&mut self, key: &str, require: bool) -> Option<DateTime<Utc>> {
        let seconds = self.get_int64(key, require)?;
        if seconds == 0 {
            return None;
        }
        DateTime::from_timestamp(seconds, 0)
    }

    /// The Unix timestamp in milliseconds under the given key, like
    /// [`AttrUtility::get_unix_time`].
    pub fn get_unix_milli(&mut self, key: &str, require: bool) -> Option<DateTime<Utc>> {
        let milliseconds = self.get_int64(key, require)?;
        if milliseconds == 0 {
            return None;
        }
        DateTime::from_timestamp_millis(milliseconds)
    }

    /// The string under the given key, or an empty string.
    pub fn optional_string(&mut self, key: &str) -> String {
        self.get_string(key, false).unwrap_or_default()
    }

    /// The string under the given key. If there's no valid string under the
    /// key, an error is stored and an empty string is returned.
    pub fn string(&mut self, key: &str) -> String {
        self.get_string(key, true).unwrap_or_default()
    }

    /// The integer under the given key, or 0.
    pub fn optional_int(&mut self, key: &str) -> i64 {
        self.get_int64(key, false).unwrap_or_default()
    }

    /// The integer under the given key, storing an error if it is missing.
    pub fn int(&mut self, key: &str) -> i64 {
        self.get_int64(key, true).unwrap_or_default()
    }

    /// Same as [`AttrUtility::int`]; Go distinguishes `int` and `int64`.
    pub fn int64(&mut self, key: &str) -> i64 {
        self.get_int64(key, true).unwrap_or_default()
    }

    /// The unsigned integer under the given key, storing an error if it is missing.
    pub fn uint64(&mut self, key: &str) -> u64 {
        self.get_uint64(key, true).unwrap_or_default()
    }

    /// The boolean under the given key, or false.
    pub fn optional_bool(&mut self, key: &str) -> bool {
        self.get_bool(key, false).unwrap_or_default()
    }

    /// The boolean under the given key, storing an error if it is missing.
    pub fn bool(&mut self, key: &str) -> bool {
        self.get_bool(key, true).unwrap_or_default()
    }

    /// The Unix time under the given key; `None` when missing, invalid, or 0.
    pub fn optional_unix_time(&mut self, key: &str) -> Option<DateTime<Utc>> {
        self.get_unix_time(key, false)
    }

    /// Like [`AttrUtility::optional_unix_time`], storing an error if it is missing.
    pub fn unix_time(&mut self, key: &str) -> Option<DateTime<Utc>> {
        self.get_unix_time(key, true)
    }

    /// The Unix millisecond time under the given key; `None` when missing,
    /// invalid, or 0.
    pub fn optional_unix_milli(&mut self, key: &str) -> Option<DateTime<Utc>> {
        self.get_unix_milli(key, false)
    }

    /// Like [`AttrUtility::optional_unix_milli`], storing an error if it is missing.
    pub fn unix_milli(&mut self, key: &str) -> Option<DateTime<Utc>> {
        self.get_unix_milli(key, true)
    }

    /// Whether no errors were stored.
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }

    /// The stored errors as one error, if there are any.
    pub fn error(self) -> Result<(), ErrorList> {
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(ErrorList(self.errors))
        }
    }
}
