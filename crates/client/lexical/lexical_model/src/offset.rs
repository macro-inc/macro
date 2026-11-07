//! Text offsets measured in JavaScript UTF-16 units.
use crate::Error;
use serde::{Deserialize, Serialize};
use std::ops::{Add, Range, Sub};
/// A UTF-16 code-unit position or length.
#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Utf16Offset(pub u32);
impl Utf16Offset {
    /// Zero units.
    pub const ZERO: Self = Self(0);
    /// Raw code-unit count.
    pub const fn get(self) -> u32 {
        self.0
    }
    /// Checked addition.
    pub fn checked_add(self, other: Self) -> Option<Self> {
        self.0.checked_add(other.0).map(Self)
    }
    /// Difference clamped to zero.
    pub fn saturating_sub(self, other: Self) -> Self {
        Self(self.0.saturating_sub(other.0))
    }
}
impl Add for Utf16Offset {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self(self.0.saturating_add(rhs.0))
    }
}
impl Sub for Utf16Offset {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        self.saturating_sub(rhs)
    }
}
/// A child index inside an element.
#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct ChildIndex(pub u32);
/// UTF-8 storage with cached UTF-16 length and an ASCII fast path.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct TextBuffer {
    text: String,
    utf16_len: Utf16Offset,
    is_ascii: bool,
}
impl TextBuffer {
    /// Cache metadata for text.
    pub fn new(text: impl Into<String>) -> Self {
        let text = text.into();
        let utf16_len = Utf16Offset(u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX));
        let is_ascii = text.is_ascii();
        Self {
            text,
            utf16_len,
            is_ascii,
        }
    }
    /// Borrow the underlying text.
    pub fn as_str(&self) -> &str {
        &self.text
    }
    /// Cached length in code units.
    pub fn utf16_len(&self) -> Utf16Offset {
        self.utf16_len
    }
    /// Convert a valid scalar boundary; reject split surrogates and out-of-bounds positions.
    pub fn byte_offset(&self, offset: Utf16Offset) -> Result<usize, Error> {
        if offset > self.utf16_len {
            return Err(Error::Utf16OffsetOutOfRange(offset));
        }
        if self.is_ascii {
            return Ok(offset.0 as usize);
        }
        let mut units = 0;
        for (byte, ch) in self.text.char_indices() {
            if units == offset.0 {
                return Ok(byte);
            }
            units += ch.len_utf16() as u32;
            if units > offset.0 {
                return Err(Error::Utf16OffsetSplitsSurrogatePair(offset));
            }
        }
        Ok(self.text.len())
    }
    /// Clamp bounds like JS slice, preserving valid scalar boundaries.
    pub fn slice(&self, range: Range<Utf16Offset>) -> Result<&str, Error> {
        let start = range.start.min(self.utf16_len);
        let end = range.end.min(self.utf16_len);
        if start >= end {
            return Ok("");
        }
        let start = self.byte_offset(start)?;
        let end = self.byte_offset(end)?;
        self.text
            .get(start..end)
            .ok_or(Error::Utf16OffsetOutOfRange(range.end))
    }
    /// Read a UTF-16 code unit, including either half of a surrogate pair.
    pub fn code_unit_at(&self, offset: Utf16Offset) -> Option<u16> {
        self.text.encode_utf16().nth(offset.0 as usize)
    }
}
#[cfg(test)]
mod test;
