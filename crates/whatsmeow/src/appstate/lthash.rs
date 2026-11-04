// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/lthash/lthash.go (MPL-2.0, Copyright (c) Tulir Asokan)

//! A summation based hash algorithm that maintains the integrity of a piece
//! of data over a series of mutations. You can add/remove mutations, and it'll
//! return a hash equal to if the same series of mutations was made
//! sequentially.

use std::borrow::Cow;

use crate::util::hkdfutil;

/// An LT hash instance: each item is expanded with HKDF-SHA256 under
/// `hkdf_info` to `hkdf_size` bytes, which are added to or subtracted from the
/// hash as little-endian 16-bit words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LtHash {
    /// The HKDF info string.
    pub hkdf_info: Cow<'static, [u8]>,
    /// How many bytes each item expands to.
    pub hkdf_size: u8,
}

/// The LT hash instance used for verifying the integrity of WhatsApp app
/// state sync patches.
pub const WA_PATCH_INTEGRITY: LtHash = LtHash {
    hkdf_info: Cow::Borrowed(b"WhatsApp Patch Integrity"),
    hkdf_size: 128,
};

/// The base hash can't be combined with the expanded items. Go panics.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("LT hash base of {base_length} bytes doesn't fit {hkdf_size}-byte items of 16-bit words")]
pub struct LtHashLengthError {
    /// The length of the base hash.
    pub base_length: usize,
    /// The length of each expanded item.
    pub hkdf_size: u8,
}

impl LtHash {
    /// Returns a copy of `base` with every `subtract` item subtracted, then
    /// every `add` item added.
    ///
    /// Fails when `base` is odd-length or longer than `hkdf_size`, where Go
    /// panics.
    pub fn subtract_then_add(
        &self,
        base: &[u8],
        subtract: &[impl AsRef<[u8]>],
        add: &[impl AsRef<[u8]>],
    ) -> Result<Vec<u8>, LtHashLengthError> {
        let mut output = base.to_vec();
        self.subtract_then_add_in_place(&mut output, subtract, add)?;
        Ok(output)
    }

    /// Subtracts every `subtract` item from `base`, then adds every `add` item.
    ///
    /// Fails without changing `base` when it is odd-length or longer than
    /// `hkdf_size`, where Go panics.
    pub fn subtract_then_add_in_place(
        &self,
        base: &mut [u8],
        subtract: &[impl AsRef<[u8]>],
        add: &[impl AsRef<[u8]>],
    ) -> Result<(), LtHashLengthError> {
        if !base.len().is_multiple_of(2) || base.len() > usize::from(self.hkdf_size) {
            return Err(LtHashLengthError {
                base_length: base.len(),
                hkdf_size: self.hkdf_size,
            });
        }
        self.multiple_op(base, subtract, true);
        self.multiple_op(base, add, false);
        Ok(())
    }

    fn multiple_op(&self, base: &mut [u8], input: &[impl AsRef<[u8]>], subtract: bool) {
        for item in input {
            perform_pointwise_with_overflow(
                base,
                &hkdfutil::sha256(item.as_ref(), &[], &self.hkdf_info, self.hkdf_size),
                subtract,
            );
        }
    }
}

/// `base` is at most as long as `input` and even-length (checked by the caller).
fn perform_pointwise_with_overflow(base: &mut [u8], input: &[u8], subtract: bool) {
    for (base_word, input_word) in base.chunks_exact_mut(2).zip(input.chunks_exact(2)) {
        let x = u16::from_le_bytes([base_word[0], base_word[1]]);
        let y = u16::from_le_bytes([input_word[0], input_word[1]]);
        let result = if subtract {
            x.wrapping_sub(y)
        } else {
            x.wrapping_add(y)
        };
        base_word.copy_from_slice(&result.to_le_bytes());
    }
}

#[cfg(test)]
mod test;
