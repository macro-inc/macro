//! Bounds-checked little-endian reads over record payloads.
//!
//! Every accessor returns `None` past the end of the slice, so record
//! handlers can use `?` and simply skip records that are too short.

/// A byte slice with checked little-endian accessors.
#[derive(Clone, Copy, Debug)]
pub(super) struct Bytes<'a>(pub(super) &'a [u8]);

impl<'a> Bytes<'a> {
    /// Length in bytes.
    pub(super) fn len(&self) -> usize {
        self.0.len()
    }

    /// `len` bytes starting at `at`.
    pub(super) fn slice(&self, at: usize, len: usize) -> Option<&'a [u8]> {
        self.0.get(at..at.checked_add(len)?)
    }

    /// Everything from `at` to the end.
    pub(super) fn tail(&self, at: usize) -> Option<&'a [u8]> {
        self.0.get(at..)
    }

    /// One byte.
    pub(super) fn u8(&self, at: usize) -> Option<u8> {
        self.0.get(at).copied()
    }

    /// Unsigned 16-bit value.
    pub(super) fn u16(&self, at: usize) -> Option<u16> {
        self.slice(at, 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
    }

    /// Signed 16-bit value.
    pub(super) fn i16(&self, at: usize) -> Option<i16> {
        self.u16(at).map(|v| v as i16)
    }

    /// Unsigned 32-bit value.
    pub(super) fn u32(&self, at: usize) -> Option<u32> {
        self.slice(at, 4)
            .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }

    /// Signed 32-bit value.
    pub(super) fn i32(&self, at: usize) -> Option<i32> {
        self.u32(at).map(|v| v as i32)
    }

    /// IEEE single-precision value.
    pub(super) fn f32(&self, at: usize) -> Option<f32> {
        self.u32(at).map(f32::from_bits)
    }
}
