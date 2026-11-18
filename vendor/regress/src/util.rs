use crate::bytesearch::ByteBitmap;
use crate::codepointset::CODE_POINT_MAX;
use crate::codepointset::Interval;
#[cfg(not(feature = "std"))]
use alloc::vec::Vec;
use core::cmp::Ordering;
use core::ops::{Index, IndexMut};
use core::slice::SliceIndex;

// A macro which expresses either checked or unchecked reachability, depending on prohibit-unsafe.
macro_rules! rs_unreachable {
    () => {{
        if cfg!(feature = "prohibit-unsafe") {
            unreachable!();
        } else {
            unsafe { core::hint::unreachable_unchecked() }
        }
    }};
    ($msg:expr) => {
        if cfg!(feature = "prohibit-unsafe") {
            unreachable!($msg);
        } else {
            unsafe { core::hint::unreachable_unchecked() }
        }
    };
}

/// A trait which performs bounds checking only in debug mode.
pub trait DebugCheckIndex<Idx>: Index<Idx> + IndexMut<Idx> {
    fn iat(&self, index: Idx) -> &Self::Output;
    fn mat(&mut self, index: Idx) -> &mut Self::Output;
}

impl<Idx, T> DebugCheckIndex<Idx> for Vec<T>
where
    Idx: SliceIndex<[T]> + Clone,
{
    #[inline(always)]
    fn iat(&self, idx: Idx) -> &Self::Output {
        debug_assert!(self.get(idx.clone()).is_some(), "Index out of bounds");
        if cfg!(feature = "prohibit-unsafe") {
            self.index(idx)
        } else {
            unsafe { self.get_unchecked(idx) }
        }
    }

    #[inline(always)]
    fn mat(&mut self, idx: Idx) -> &mut Self::Output {
        debug_assert!(self.get(idx.clone()).is_some(), "Index out of bounds");
        if cfg!(feature = "prohibit-unsafe") {
            self.index_mut(idx)
        } else {
            unsafe { self.get_unchecked_mut(idx) }
        }
    }
}

impl<Idx, T> DebugCheckIndex<Idx> for [T]
where
    Idx: SliceIndex<[T]> + Clone,
{
    #[inline(always)]
    fn iat(&self, idx: Idx) -> &Self::Output {
        debug_assert!(self.get(idx.clone()).is_some(), "Index out of bounds");
        if cfg!(feature = "prohibit-unsafe") {
            self.index(idx)
        } else {
            unsafe { self.get_unchecked(idx) }
        }
    }

    #[inline(always)]
    fn mat(&mut self, idx: Idx) -> &mut Self::Output {
        debug_assert!(self.get(idx.clone()).is_some(), "Index out of bounds");
        if cfg!(feature = "prohibit-unsafe") {
            self.index_mut(idx)
        } else {
            unsafe { self.get_unchecked_mut(idx) }
        }
    }
}

// Helper function for matching u32s against chars.
// It would be pleasant if you could pattern-match u32s against chars, but Rust does not allow this.
// Convert a u32 to a char, except if the conversion fails, return the largest char.
// Be careful to not use the result of this conversion except to pattern match against literals.
pub fn to_char_sat(c: u32) -> char {
    char::from_u32(c).unwrap_or(core::char::MAX)
}

/// \return the first byte of a UTF-8 encoded code point.
/// We do not use char because we don't want to deal with failing on surrogates.
#[inline(always)]
pub fn utf8_first_byte(cp: u32) -> u8 {
    debug_assert!(cp <= CODE_POINT_MAX);
    if cp < 0x80 {
        // One byte encoding.
        cp as u8
    } else if cp < 0x800 {
        // Two byte encoding.
        ((cp >> 6) & 0x1F) as u8 | 0b1100_0000
    } else if cp < 0x10000 {
        // Three byte encoding.
        ((cp >> 12) & 0x0F) as u8 | 0b1110_0000
    } else {
        // Four byte encoding.
        ((cp >> 18) & 0x07) as u8 | 0b1111_0000
    }
}

/// Add all of the first bytes of a code point interval to a byte bitmap.
pub fn add_utf8_first_bytes_to_bitmap(interval: Interval, bitmap: &mut ByteBitmap) {
    // Note this is an inclusive interval.
    let Interval { first, last } = interval;
    let ranges = [
        (first, last.min(0x7F)),              // 1 byte range
        (first.max(0x80), last.min(0x7FF)),   // 2 byte range
        (first.max(0x800), last.min(0xFFFF)), // 3 byte range
        (first.max(0x10000), last),           // 4 byte range
    ];
    for (first, last) in ranges.into_iter() {
        if first <= last {
            for byte in utf8_first_byte(first)..=utf8_first_byte(last) {
                bitmap.set(byte);
            }
        }
    }
}

pub trait SliceHelp {
    type Item;

    /// Given that self is sorted according to f, returns the range of indexes
    /// where f indicates equal elements.
    fn equal_range_by<'a, F>(&'a self, f: F) -> core::ops::Range<usize>
    where
        F: FnMut(&'a Self::Item) -> Ordering;
}

impl<T> SliceHelp for [T] {
    type Item = T;
    fn equal_range_by<'a, F>(&'a self, mut f: F) -> core::ops::Range<usize>
    where
        F: FnMut(&'a Self::Item) -> Ordering,
    {
        let left = self
            .binary_search_by(|v| f(v).then(Ordering::Greater))
            .unwrap_err();
        let right = self[left..]
            .binary_search_by(|v| f(v).then(Ordering::Less))
            .unwrap_err()
            + left;
        left..right
    }
}

// Given a byte \p b, keep its low \p mask bits, and then shift left by \p shift.
const fn mask_shift(b: u8, mask: u8, shift: u8) -> u32 {
    let masked = b & ((1 << mask) - 1);
    (masked as u32) << (shift as u32)
}

// Number of significant bits in a utf8 continuation byte.
const UTF8_CONT_SIGBITS: u8 = 6;

/// \return true if \p b is a UTF8 continutation byte.
#[inline(always)]
pub fn is_utf8_continuation(b: u8) -> bool {
    (b & 0b1100_0000) == 0b1000_0000
}

// Construct a code point from a list of bytes.
#[inline(always)]
pub fn utf8_w2(b0: u8, b1: u8) -> u32 {
    debug_assert!(!is_utf8_continuation(b0) && is_utf8_continuation(b1));
    debug_assert!(b0 >> 5 == 0b110);
    mask_shift(b0, 5, UTF8_CONT_SIGBITS) | mask_shift(b1, UTF8_CONT_SIGBITS, 0)
}

#[inline(always)]
pub fn utf8_w3(b0: u8, b1: u8, b2: u8) -> u32 {
    debug_assert!(
        !is_utf8_continuation(b0) && is_utf8_continuation(b1) && is_utf8_continuation(b2)
    );
    debug_assert!(b0 >> 4 == 0b1110);
    mask_shift(b0, 4, 2 * UTF8_CONT_SIGBITS)
        | mask_shift(b1, UTF8_CONT_SIGBITS, UTF8_CONT_SIGBITS)
        | mask_shift(b2, UTF8_CONT_SIGBITS, 0)
}

#[inline(always)]
pub fn utf8_w4(b0: u8, b1: u8, b2: u8, b3: u8) -> u32 {
    debug_assert!(
        !is_utf8_continuation(b0)
            && is_utf8_continuation(b1)
            && is_utf8_continuation(b2)
            && is_utf8_continuation(b3)
    );
    debug_assert!(b0 >> 3 == 0b11110);
    mask_shift(b0, 3, 3 * UTF8_CONT_SIGBITS)
        | mask_shift(b1, UTF8_CONT_SIGBITS, 2 * UTF8_CONT_SIGBITS)
        | mask_shift(b2, UTF8_CONT_SIGBITS, UTF8_CONT_SIGBITS)
        | mask_shift(b3, UTF8_CONT_SIGBITS, 0)
}

#[cfg(test)]
mod tests {
    use super::{ByteBitmap, Interval, SliceHelp, add_utf8_first_bytes_to_bitmap, utf8_first_byte};

    #[test]
    fn ranges() {
        let vals = [0, 1, 2, 3, 4, 4, 4, 7, 8, 9, 9];
        let fast_er = |needle: usize| vals.equal_range_by(|v| v.cmp(&needle));
        let slow_er = |needle: usize| {
            let mut left = 0;
            while left < vals.len() && vals[left] < needle {
                left += 1
            }
            let mut right = left;
            while right < vals.len() && vals[right] == needle {
                right += 1
            }
            left..right
        };

        for i in 0..10 {
            assert_eq!(fast_er(i), slow_er(i))
        }
    }

    #[test]
    fn utf8() {
        for &cp in &[
            0x0,
            0x7,
            0xFF,
            0x80,
            0xABC,
            0x7FF,
            0x800,
            0x801,
            0xFFFF,
            0x10000,
            0x10001,
            0x1FFFF,
            super::CODE_POINT_MAX - 1,
            super::CODE_POINT_MAX,
        ] {
            use super::{utf8_w2, utf8_w3, utf8_w4};
            let mut buff = [0; 4];
            let s = core::char::from_u32(cp).unwrap().encode_utf8(&mut buff);
            let bytes = s.as_bytes();
            assert_eq!(bytes[0], utf8_first_byte(cp));

            match bytes.len() {
                1 => assert_eq!(bytes[0] as u32, cp),
                2 => assert_eq!(utf8_w2(bytes[0], bytes[1]), cp),
                3 => assert_eq!(utf8_w3(bytes[0], bytes[1], bytes[2]), cp),
                4 => assert_eq!(utf8_w4(bytes[0], bytes[1], bytes[2], bytes[3]), cp),
                _ => panic!("Unexpected utf8 sequence length"),
            }
        }
    }

    #[test]
    fn test_add_utf8_first_bytes_to_bitmap() {
        let locs = [
            0, 1, 2, 3, 17, 25, 34, 99, 127, 128, 150, 255, 256, 257, 511, 512, 513, 0x7FF, 0x800,
            0x905, 0xA123, 0xFF0F, 0xFFFF, 0x10000, 0x10001, 0x1FFFF, 0x20001, 0x2FFF7, 0x50001,
            0x100000, 0x10FFFE, 0x10FFFF,
        ];
        for (idx, &first) in locs.iter().enumerate() {
            let mut expected = ByteBitmap::default();
            for &last in locs[idx..].iter() {
                assert!(first <= last);
                for cp in first..=last {
                    expected.set(utf8_first_byte(cp));
                }
                let mut bitmap = ByteBitmap::default();
                add_utf8_first_bytes_to_bitmap(Interval { first, last }, &mut bitmap);
                assert_eq!(bitmap, expected);
            }
        }
    }
}
