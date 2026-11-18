use crate::codepointset::{CodePointSet, Interval};
use crate::unicodetables::{
    FOLDS, binary_property_ranges, general_category_property_value_ranges,
    script_extensions_value_ranges, script_value_ranges, string_property_sets,
    unicode_property_binary_from_str, unicode_property_value_general_category_from_str,
    unicode_property_value_script_from_str, unicode_string_property_from_str,
};
use crate::util::SliceHelp;
#[cfg(not(feature = "std"))]
use alloc::vec::Vec;
use core::cmp::Ordering;

// CodePointRange packs a code point and a length together into a u32.
// We currently do not need to store any information about code points in plane 16 (U+100000),
// which are private use, so we only need 20 bits of code point storage;
// the remaining 12 can be the length.
// The length is stored with a bias of -1, so the last codepoint may be obtained by adding the "length" and the first code point.
const CODE_POINT_BITS: u32 = 20;
const LENGTH_BITS: u32 = 32 - CODE_POINT_BITS;

#[derive(Copy, Clone, Debug)]
pub struct CodePointRange(u32);

// This will trigger an error in const functions if $x is false.
macro_rules! const_assert_true {
    ($x:expr $(,)*) => {
        [()][!$x as usize];
    };
}

impl CodePointRange {
    #[inline(always)]
    pub const fn from(start: u32, len: u32) -> Self {
        const_assert_true!(start < (1 << CODE_POINT_BITS));
        const_assert_true!(len > 0 && len <= (1 << LENGTH_BITS));
        const_assert_true!((start + len - 1) < ((1 << CODE_POINT_BITS) - 1));
        CodePointRange((start << LENGTH_BITS) | (len - 1))
    }

    #[inline(always)]
    const fn len_minus_1(self) -> u32 {
        self.0 & ((1 << LENGTH_BITS) - 1)
    }

    // \return the first codepoint in the range.
    #[inline(always)]
    pub const fn first(self) -> u32 {
        self.0 >> LENGTH_BITS
    }

    // \return the last codepoint in the range.
    #[inline(always)]
    pub const fn last(self) -> u32 {
        self.first() + self.len_minus_1()
    }
}

// The "extra" field contains a predicate mask in the low bits and a signed delta amount in the high bits.
// A code point only transforms if its difference from the range base is 0 once masked.
const PREDICATE_MASK_BITS: u32 = 4;

pub(crate) struct FoldRange {
    /// The range of codepoints.
    pub(crate) range: CodePointRange,

    /// Combination of the signed delta amount and predicate mask.
    pub(crate) extra: i32,
}

impl FoldRange {
    #[inline(always)]
    pub const fn from(start: u32, length: u32, delta: i32, modulo: u8) -> Self {
        const_assert_true!(modulo.is_power_of_two());
        let mask = (modulo - 1) as i32;
        const_assert_true!(mask < (1 << PREDICATE_MASK_BITS));
        const_assert_true!(((delta << PREDICATE_MASK_BITS) >> PREDICATE_MASK_BITS) == delta);
        let extra = mask | (delta << PREDICATE_MASK_BITS);
        FoldRange {
            range: CodePointRange::from(start, length),
            extra,
        }
    }
    #[inline(always)]
    fn first(&self) -> u32 {
        self.range.first()
    }

    #[inline(always)]
    fn last(&self) -> u32 {
        self.range.last()
    }

    #[inline(always)]
    fn delta(&self) -> i32 {
        self.extra >> PREDICATE_MASK_BITS
    }

    #[inline(always)]
    fn predicate_mask(&self) -> u32 {
        (self.extra as u32) & ((1 << PREDICATE_MASK_BITS) - 1)
    }

    fn add_delta(&self, cu: u32) -> u32 {
        let cs = (cu as i32) + self.delta();
        core::debug_assert!(0 <= cs && cs <= 0x10FFFF);
        cs as u32
    }

    /// \return the Interval of transformed-to code points.
    fn transformed_to(&self) -> Interval {
        Interval {
            first: self.add_delta(self.first()),
            last: self.add_delta(self.last()),
        }
    }

    /// \return the Interval of transformed-from code points.
    fn transformed_from(&self) -> Interval {
        Interval {
            first: self.first(),
            last: self.last(),
        }
    }

    fn can_apply(&self, cu: u32) -> bool {
        self.transformed_from().contains(cu)
    }

    fn apply(&self, cu: u32) -> u32 {
        debug_assert!(self.can_apply(cu), "Cannot apply to this code point");
        let offset = cu - self.first();
        if (offset & self.predicate_mask()) == 0 {
            self.add_delta(cu)
        } else {
            cu
        }
    }
}

/// Implements the `Canonicalize` method from the [spec].
///
/// [spec]: https://tc39.es/ecma262/#sec-runtime-semantics-canonicalize-ch
pub(crate) fn fold_code_point(cu: u32, unicode: bool) -> u32 {
    if unicode {
        return fold(cu);
    }
    uppercase(cu)
}

pub fn fold(cu: u32) -> u32 {
    let searched = FOLDS.binary_search_by(|fr| {
        if fr.first() > cu {
            Ordering::Greater
        } else if fr.last() < cu {
            Ordering::Less
        } else {
            Ordering::Equal
        }
    });
    if let Ok(index) = searched {
        let fr: &FoldRange = if cfg!(feature = "prohibit-unsafe") {
            FOLDS.get(index).expect("Invalid index")
        } else {
            unsafe { FOLDS.get_unchecked(index) }
        };
        fr.apply(cu)
    } else {
        cu
    }
}

// Generated from Node 24 / ICU 77, not the Rust toolchain's Unicode tables.
mod legacy {
    include!("legacy_case.rs");
}

fn uppercase(cu: u32) -> u32 {
    legacy::CANONICALIZE
        .binary_search_by_key(&cu, |&(source, _)| source)
        .map_or(cu, |index| legacy::CANONICALIZE[index].1)
}

// Add all folded characters in the given interval to the given code point set.
// This skips characters which fold to themselves.
fn fold_interval(iv: Interval, recv: &mut CodePointSet) {
    let overlaps = FOLDS.equal_range_by(|tr| {
        if tr.first() > iv.last {
            Ordering::Greater
        } else if tr.last() < iv.first {
            Ordering::Less
        } else {
            Ordering::Equal
        }
    });
    for fr in &FOLDS[overlaps] {
        debug_assert!(
            fr.transformed_from().overlaps(iv),
            "Interval does not overlap transform"
        );
        // Find the (inclusive) range of our interval that this transform covers.
        let first_trans = core::cmp::max(fr.first(), iv.first);
        let last_trans = core::cmp::min(fr.last(), iv.last);

        let modulo = fr.predicate_mask() + 1;
        if modulo == 1 {
            // Optimization: when modulo is 1, every character in range gets transformed
            for cu in first_trans..(last_trans + 1) {
                let cs = fr.add_delta(cu);
                if cs != cu {
                    recv.add_one(cs);
                }
            }
        } else {
            // Optimization: walk by modulo amount instead of checking every character
            let offset_start = first_trans - fr.first();
            let start_aligned = first_trans + ((modulo - (offset_start % modulo)) % modulo);

            let mut cu = start_aligned;
            while cu <= last_trans {
                let cs = fr.add_delta(cu);
                recv.add_one(cs);
                cu += modulo;
            }
        }
    }
}

/// Find all characters that fold into the given interval and add them to the given code point set.
/// This skips characters which fold to themselves.
fn unfold_interval(iv: Interval, recv: &mut CodePointSet) {
    // Note: We still need to check all ranges because the relationship between
    // transformed_from and transformed_to intervals can be complex
    for tr in FOLDS.iter() {
        if !iv.overlaps(tr.transformed_to()) {
            continue;
        }

        let modulo = tr.predicate_mask() + 1;
        let first_source = tr.first();
        let last_source = tr.last();

        let mut process_cp = |cp| {
            let tcp = tr.apply(cp);
            if tcp != cp && iv.contains(tcp) {
                recv.add_one(cp);
            }
        };

        if modulo == 1 {
            // Optimization: when modulo is 1, every character in range gets transformed
            for cp in first_source..(last_source + 1) {
                process_cp(cp);
            }
        } else {
            // Walk by modulo amount instead of checking every character
            let mut cp = first_source;
            while cp <= last_source {
                process_cp(cp);
                cp += modulo;
            }
        }
    }
}

/// \return all the characters which fold to c's fold.
/// This is a linear search across all ranges.
/// The result always contains c.
pub fn unfold_char(c: u32) -> Vec<u32> {
    let mut res = vec![c];
    let fcp = fold(c);
    if fcp != c {
        res.push(fcp);
    }
    // TODO: optimize ASCII case.
    for tr in FOLDS.iter() {
        if !tr.transformed_to().contains(fcp) {
            continue;
        }
        for cp in tr.transformed_from().codepoints() {
            // TODO: this can be optimized.
            let tcp = tr.apply(cp);
            if tcp == fcp {
                res.push(cp);
            }
        }
    }
    res.sort_unstable();
    res.dedup();
    res
}

pub(crate) fn unfold_uppercase_char(c: u32) -> Vec<u32> {
    let mut res = vec![c];
    let fcp = uppercase(c);
    if fcp != c {
        res.push(fcp);
    }
    for &(source, canonical) in legacy::CANONICALIZE {
        if canonical == fcp {
            res.push(source);
        }
    }
    res.sort_unstable();
    res.dedup();
    res
}

/// Expand `c` into the code points a literal `c` matches: just `c` itself when
/// `!icase`, otherwise the unicode (full) or legacy (uppercase) unfold set.
pub(crate) fn expand_code_point(c: u32, icase: bool, unicode: bool) -> Vec<u32> {
    if !icase {
        vec![c]
    } else if unicode {
        unfold_char(c)
    } else {
        unfold_uppercase_char(c)
    }
}

// Fold every character in \p input, then find all the prefolds.
pub fn add_icase_code_points(mut input: CodePointSet) -> CodePointSet {
    let mut folded = input.clone();
    for iv in input.intervals() {
        fold_interval(*iv, &mut folded)
    }

    // Reuse input storage.
    input.clone_from(&folded);
    for iv in folded.intervals() {
        unfold_interval(*iv, &mut input);
    }
    input
}

/// Close a legacy character class over ECMAScript Canonicalize equivalence.
pub(crate) fn add_legacy_icase_code_points(mut input: CodePointSet) -> CodePointSet {
    let mut folded = input.clone();
    for &(source, canonical) in legacy::CANONICALIZE {
        if input.contains(source) {
            folded.add_one(canonical);
        }
    }
    for &(source, canonical) in legacy::CANONICALIZE {
        if folded.contains(canonical) {
            input.add_one(source);
        }
    }
    input.add_set(folded);
    input
}

pub(crate) fn add_icase_code_points_for_mode(input: CodePointSet, unicode: bool) -> CodePointSet {
    if unicode {
        add_icase_code_points(input)
    } else {
        add_legacy_icase_code_points(input)
    }
}

pub(crate) enum PropertyEscapeKind {
    CharacterClass(&'static [Interval]),
    StringSet(&'static [&'static [u32]]),
}

#[derive(Debug, Copy, Clone)]
pub(crate) enum UnicodePropertyName {
    GeneralCategory,
    Script,
    ScriptExtensions,
}

pub(crate) fn unicode_property_name_from_str(s: &str) -> Option<UnicodePropertyName> {
    use UnicodePropertyName::*;

    match s {
        "General_Category" | "gc" => Some(GeneralCategory),
        "Script" | "sc" => Some(Script),
        "Script_Extensions" | "scx" => Some(ScriptExtensions),
        _ => None,
    }
}

pub(crate) fn unicode_property_from_str(
    s: &str,
    name: Option<UnicodePropertyName>,
    unicode_sets: bool,
) -> Option<PropertyEscapeKind> {
    match name {
        Some(UnicodePropertyName::GeneralCategory) => Some(PropertyEscapeKind::CharacterClass(
            general_category_property_value_ranges(
                &unicode_property_value_general_category_from_str(s)?,
            ),
        )),
        Some(UnicodePropertyName::Script) => Some(PropertyEscapeKind::CharacterClass(
            script_value_ranges(&unicode_property_value_script_from_str(s)?),
        )),
        Some(UnicodePropertyName::ScriptExtensions) => Some(PropertyEscapeKind::CharacterClass(
            script_extensions_value_ranges(&unicode_property_value_script_from_str(s)?),
        )),
        None => {
            if let Some(value) = unicode_property_binary_from_str(s) {
                return Some(PropertyEscapeKind::CharacterClass(binary_property_ranges(
                    &value,
                )));
            }
            if unicode_sets && let Some(value) = unicode_string_property_from_str(s) {
                return Some(PropertyEscapeKind::StringSet(string_property_sets(&value)));
            }
            Some(PropertyEscapeKind::CharacterClass(
                general_category_property_value_ranges(
                    &unicode_property_value_general_category_from_str(s)?,
                ),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(feature = "std"))]
    use hashbrown::HashMap;
    #[cfg(feature = "std")]
    use std::collections::HashMap;

    // Map from folded char to the chars that folded to it.
    // If an entry is missing, it means either nothing folds to the char,
    // or it folds exclusively to itself; this can be determined by comparing
    // the char to its fold.
    fn get_unfold_map() -> HashMap<u32, Vec<u32>> {
        let mut unfold_map: HashMap<u32, Vec<u32>> = HashMap::new();
        for c in 0..=0x10FFFF {
            let fc = fold(c);
            if fc != c {
                unfold_map.entry(fc).or_default().push(c);
            }
        }

        // We neglected self-folds - add them now, but only for entries
        // where something else folds to it, else our map would be quite large.
        // Also sort them all.
        for (&k, v) in unfold_map.iter_mut() {
            assert_eq!(k, fold(k), "folds should be idempotent");
            v.push(k);
            v.sort_unstable();
        }
        unfold_map
    }

    #[test]
    fn test_folds() {
        for c in 0..0x41 {
            assert_eq!(fold(c), c);
        }
        for c in 0x41..=0x5A {
            assert_eq!(fold(c), c + 0x20);
        }
        assert_eq!(fold(0xB5), 0x3BC);
        assert_eq!(fold(0xC0), 0xE0);

        assert_eq!(fold(0x1B8), 0x1B9);
        assert_eq!(fold(0x1B9), 0x1B9);
        assert_eq!(fold(0x1BA), 0x1BA);
        assert_eq!(fold(0x1BB), 0x1BB);
        assert_eq!(fold(0x1BC), 0x1BD);
        assert_eq!(fold(0x1BD), 0x1BD);

        for c in 0x1F8..0x21F {
            if c % 2 == 0 {
                assert_eq!(fold(c), c + 1);
            } else {
                assert_eq!(fold(c), c);
            }
        }

        assert_eq!(fold(0x37F), 0x3F3);
        assert_eq!(fold(0x380), 0x380);
        assert_eq!(fold(0x16E40), 0x16E60);
        assert_eq!(fold(0x16E41), 0x16E61);
        assert_eq!(fold(0x16E42), 0x16E62);
        assert_eq!(fold(0x1E900), 0x1E922);
        assert_eq!(fold(0x1E901), 0x1E923);
        for c in 0xF0000..=0x10FFFF {
            assert_eq!(fold(c), c);
        }
    }

    #[test]
    fn test_fold_idempotent() {
        for c in 0..=0x10FFFF {
            let fc = fold(c);
            let ffc = fold(fc);
            assert_eq!(ffc, fc);
        }
    }

    #[test]
    fn test_unfolds_refold() {
        for c in 0..=0x10FFFF {
            let fc = fold(c);
            let unfolds = unfold_char(c);
            for uc in unfolds {
                assert_eq!(fold(uc), fc);
            }
        }
    }

    #[test]
    fn test_unfold_chars() {
        let unfold_map = get_unfold_map();
        for c in 0..=0x10FFFF {
            let mut unfolded = unfold_char(c);
            unfolded.sort_unstable();
            let fc = fold(c);
            if let Some(expected) = unfold_map.get(&fc) {
                // Explicit list of unfolds.
                assert_eq!(&unfolded, expected);
            } else {
                // No entry in our testing unfold map: that means that either the
                // character folds to itself and nothing else does, or the character
                // folds to a different character - but that different character
                // should fold to itself (folding is idempotent) so we should always
                // have multiple characters in that case. Therefore we expect this
                // character's unfolds to be itself exclusively.
                assert_eq!(&unfolded, &[c]);
            }
        }
    }

    #[test]
    fn test_add_icase_code_points() {
        let unfold_map = get_unfold_map();
        let locs = [
            0x0, 0x42, 0x100, 0xdeba, 0x11419, 0x278f8, 0x2e000, 0x35df7, 0x462d6, 0x4bc29,
            0x4f4c0, 0x58a9b, 0x5bafc, 0x62383, 0x66d60, 0x6974a, 0x77628, 0x87804, 0x9262b,
            0x931e4, 0xaa08c, 0xad7a8, 0xca6b0, 0xcce27, 0xcd897, 0xcf5e7, 0xe2802, 0xe561b,
            0xe5f43, 0xf4339, 0xfb78c, 0xfc5ee, 0x104fa9, 0x10e402, 0x10e6cf, 0x10FFFF,
        ];
        for (idx, &first) in locs.iter().enumerate() {
            // Keep a running set of the unfolded code points we expect to be in the
            // range [first, last].
            let mut expected = CodePointSet::default();
            let mut from = first;
            for &last in &locs[idx..] {
                // Add both folded and unfolded characters to expected.
                for c in from..=last {
                    let fc = fold(c);
                    if let Some(unfolded) = unfold_map.get(&fc) {
                        // Some nontrival set of characters fold to fc.
                        for &ufc in unfolded {
                            expected.add_one(ufc);
                        }
                    } else {
                        // Only fc folds to fc.
                        expected.add_one(fc);
                    }
                }
                let mut input = CodePointSet::new();
                input.add(Interval { first, last });
                let folded = add_icase_code_points(input);
                assert_eq!(folded, expected);
                from = last;
            }
        }
    }

    #[test]
    fn test_fold_interval() {
        let locs = [
            0, 0x894, 0x59ac, 0xfa64, 0x10980, 0x12159, 0x16b8d, 0x1aaa2, 0x1f973, 0x1fcd4,
            0x20c35, 0x23d8a, 0x276af, 0x2c6b8, 0x2fb25, 0x30b9b, 0x338ad, 0x35ab3, 0x38d37,
            0x3bfa7, 0x3fba6, 0x404c9, 0x44572, 0x480c9, 0x4b5c4, 0x4f371, 0x5a9fa, 0x5ad6c,
            0x5e395, 0x5f103, 0x5fa98, 0x617fa, 0x6500e, 0x68890, 0x6a3fc, 0x6eab3, 0x704a6,
            0x70c22, 0x72efb, 0x737cc, 0x76796, 0x79da8, 0x7a450, 0x7b023, 0x7cc5c, 0x82027,
            0x84ef4, 0x8ac66, 0x8b898, 0x8bd1a, 0x95841, 0x98a48, 0x9e6cd, 0xa035a, 0xa41fb,
            0xa50e3, 0xa6387, 0xa7ba1, 0xaad9a, 0xabed8, 0xacc88, 0xb2737, 0xb31b1, 0xb6daf,
            0xb7ff4, 0xba2b4, 0xbde4f, 0xbe38b, 0xbe7a5, 0xc4eb2, 0xc5670, 0xc7703, 0xc995d,
            0xccb72, 0xcdfe3, 0xcfc99, 0xd09eb, 0xd2773, 0xd357d, 0xd6696, 0xd9aec, 0xdc3fa,
            0xdc8ae, 0xdc9d5, 0xde31d, 0xe2edb, 0xe652b, 0xe92d5, 0xebf2d, 0xee335, 0xef45f,
            0xf4280, 0xf74b1, 0xf9ac4, 0xfafca, 0x10208d, 0x107d63, 0x10821e, 0x108818, 0x10911f,
            0x10b6fd, 0x10FFFF,
        ];
        for (idx, &first) in locs.iter().enumerate() {
            // Keep a running set of the folded code points we expect to be in the
            // range [first, last].
            let mut expected = CodePointSet::default();
            let mut from = first;
            for &last in &locs[idx..] {
                // Add characters to expected which do not fold to themselves.
                for c in from..=last {
                    let fc = fold(c);
                    if fc != c {
                        expected.add_one(fc);
                    }
                }
                let mut cps = CodePointSet::default();
                fold_interval(Interval { first, last }, &mut cps);
                assert_eq!(cps.intervals(), expected.intervals());

                from = last;
            }
        }
    }
}
