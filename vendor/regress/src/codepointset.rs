use crate::util::SliceHelp;
#[cfg(not(feature = "std"))]
use alloc::vec::Vec;
use core::cmp::{self, Ordering};

pub type CodePoint = u32;

/// The maximum (inclusive) code point.
pub const CODE_POINT_MAX: CodePoint = 0x10FFFF;

/// An inclusive range of code points.
/// This is more efficient than InclusiveRange because it does not need to carry
/// around the `Option<bool>`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Interval {
    pub(crate) first: CodePoint,
    pub(crate) last: CodePoint,
}

impl core::fmt::Debug for Interval {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "U+{:04X}-U+{:04X}", self.first, self.last)
    }
}

/// A list of sorted, inclusive, non-empty ranges of code points.
impl Interval {
    pub(crate) const fn new(first: CodePoint, last: CodePoint) -> Interval {
        debug_assert!(first <= last);
        Interval { first, last }
    }

    #[inline(always)]
    pub fn compare(self, cp: u32) -> Ordering {
        if self.first > cp {
            Ordering::Greater
        } else if self.last < cp {
            Ordering::Less
        } else {
            Ordering::Equal
        }
    }

    /// Return whether self is before rhs.
    fn is_before(self, other: Interval) -> bool {
        self.last < other.first
    }

    /// Return whether self is strictly before rhs.
    /// "Strictly" here means there is at least one value after the end of self,
    /// and before the start of rhs. Overlapping *or abutting* intervals are
    /// not considered strictly before.
    fn is_strictly_before(self, rhs: Interval) -> bool {
        self.last + 1 < rhs.first
    }

    /// Compare two intervals.
    /// Overlapping *or abutting* intervals are considered equal.
    fn mergecmp(self, rhs: Interval) -> cmp::Ordering {
        if self.is_strictly_before(rhs) {
            Ordering::Less
        } else if rhs.is_strictly_before(self) {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    }

    /// Return whether self is mergeable with rhs.
    fn mergeable(self, rhs: Interval) -> bool {
        self.mergecmp(rhs) == Ordering::Equal
    }

    /// Return whether self contains a code point \p cp.
    pub fn contains(self, cp: CodePoint) -> bool {
        self.first <= cp && cp <= self.last
    }

    /// Return whether self overlaps 'other'.
    /// Overlaps means that we share at least one code point with 'other'.
    pub fn overlaps(self, other: Interval) -> bool {
        !self.is_before(other) && !other.is_before(self)
    }

    /// Return the interval of codepoints.
    pub fn codepoints(self) -> core::ops::Range<u32> {
        debug_assert!(self.last + 1 > self.last, "Overflow");
        self.first..(self.last + 1)
    }

    /// Return the number of contained code points.
    pub fn count_codepoints(self) -> usize {
        (self.last - self.first + 1) as usize
    }
}

pub(crate) fn interval_contains(interval: &[Interval], cp: u32) -> bool {
    interval.binary_search_by(|iv| iv.compare(cp)).is_ok()
}

/// Merge two intervals, which must be overlapping or abutting.
fn merge_intervals(x: Interval, y: &Interval) -> Interval {
    debug_assert!(x.mergeable(*y), "Ranges not mergeable");
    Interval {
        first: core::cmp::min(x.first, y.first),
        last: core::cmp::max(x.last, y.last),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CodePointSet {
    ivs: Vec<Interval>,
}

/// A set of code points stored via as disjoint, non-abutting, sorted intervals.
impl CodePointSet {
    pub fn new() -> CodePointSet {
        CodePointSet { ivs: Vec::new() }
    }

    pub(crate) fn clear(&mut self) {
        self.ivs.clear();
    }

    // Return true if the set is empty.
    pub(crate) fn is_empty(&self) -> bool {
        self.ivs.is_empty()
    }

    // Return true if we contain all code points.
    pub(crate) fn contains_all_codepoints(&self) -> bool {
        self.ivs.len() == 1 && self.ivs[0] == Interval::new(0, CODE_POINT_MAX)
    }

    pub(crate) fn contains(&self, cp: u32) -> bool {
        interval_contains(&self.ivs, cp)
    }

    #[inline]
    fn assert_is_well_formed(&self) {
        if cfg!(debug_assertions) {
            for iv in &self.ivs {
                debug_assert!(iv.last <= CODE_POINT_MAX);
                debug_assert!(iv.first <= iv.last);
            }
            for w in self.ivs.windows(2) {
                debug_assert!(w[0].is_strictly_before(w[1]));
            }
        }
    }

    /// Construct from sorted, disjoint intervals. Note these are not allowed to
    /// even abut.
    pub fn from_sorted_disjoint_intervals(ivs: Vec<Interval>) -> CodePointSet {
        let res = CodePointSet { ivs };
        res.assert_is_well_formed();
        res
    }

    /// Add an interval of code points to the set.
    pub fn add(&mut self, new_iv: Interval) {
        // Find the mergeable subarray, that is, the range of intervals that intersect
        // or abut new_iv.
        let mergeable = self.ivs.equal_range_by(|iv| iv.mergecmp(new_iv));

        // Check our work.
        if cfg!(debug_assertions) {
            debug_assert!(new_iv.first <= new_iv.last);
            for (idx, iv) in self.ivs.iter().enumerate() {
                if idx < mergeable.start {
                    debug_assert!(iv.is_strictly_before(new_iv));
                } else if idx >= mergeable.end {
                    debug_assert!(new_iv.is_strictly_before(*iv));
                } else {
                    debug_assert!(iv.mergeable(new_iv) && new_iv.mergeable(*iv));
                }
            }
        }

        // Merge all the overlapping intervals (possibly none), and then replace the
        // range. Tests show that drain(), which modifies the vector, is not effectively
        // optimized, so try to avoid it in the cases of a new entry or replacing an existing
        // entry.
        match mergeable.end - mergeable.start {
            0 => {
                // New entry.
                self.ivs.insert(mergeable.start, new_iv);
            }
            1 => {
                // Replace a single entry.
                let entry = &mut self.ivs[mergeable.start];
                *entry = Interval {
                    first: cmp::min(entry.first, new_iv.first),
                    last: cmp::max(entry.last, new_iv.last),
                };
            }
            _ => {
                // Replace range of entries.
                let merged_iv: Interval = self.ivs[mergeable.clone()]
                    .iter()
                    .fold(new_iv, merge_intervals);
                self.ivs[mergeable.start] = merged_iv;
                self.ivs.drain(mergeable.start + 1..mergeable.end);
            }
        }
        self.assert_is_well_formed();
    }

    /// Add a single code point to the set.
    #[inline]
    pub fn add_one(&mut self, cp: CodePoint) {
        self.add(Interval {
            first: cp,
            last: cp,
        })
    }

    /// Add another code point set.
    pub fn add_set(&mut self, mut rhs: CodePointSet) {
        // Prefer to add to the set with more intervals.
        if self.ivs.len() < rhs.ivs.len() {
            core::mem::swap(self, &mut rhs);
        }
        for iv in rhs.intervals() {
            self.add(*iv)
        }
    }

    /// \return the intervals
    pub fn intervals(&self) -> &[Interval] {
        self.ivs.as_slice()
    }

    /// \return the number of intervals that would be produced by inverting.
    pub fn inverted_interval_count(&self) -> usize {
        let mut result = 0;
        let mut start: CodePoint = 0;
        for iv in &self.ivs {
            if start < iv.first {
                result += 1;
            }
            start = iv.last + 1;
        }
        if start <= CODE_POINT_MAX {
            result += 1;
        }
        result
    }

    /// \return an inverted set: a set containing every code point NOT in the
    /// receiver.
    #[must_use]
    pub fn inverted(&self) -> CodePointSet {
        // The intervals we collect.
        let mut inverted_ivs = Vec::new();

        // The first code point *not* in the previous interval.
        let mut start: CodePoint = 0;
        for iv in &self.ivs {
            if start < iv.first {
                inverted_ivs.push(Interval {
                    first: start,
                    last: iv.first - 1,
                })
            }
            start = iv.last + 1;
        }
        if start <= CODE_POINT_MAX {
            inverted_ivs.push(Interval {
                first: start,
                last: CODE_POINT_MAX,
            })
        }
        CodePointSet::from_sorted_disjoint_intervals(inverted_ivs)
    }

    /// Remove the the given intervals from the set.
    ///
    /// Invariants: The intervals must be sorted and disjoint.
    pub(crate) fn remove(&mut self, intervals: &[Interval]) {
        let mut result = Vec::new();
        let mut remove_iter = intervals.iter().peekable();
        let mut current_remove = remove_iter.next();

        for iv in &mut self.ivs {
            while let Some(remove_iv) = current_remove {
                if remove_iv.last < iv.first {
                    current_remove = remove_iter.next();
                } else if remove_iv.first > iv.last {
                    result.push(*iv);
                    break;
                } else {
                    if remove_iv.first > iv.first {
                        result.push(Interval {
                            first: iv.first,
                            last: remove_iv.first - 1,
                        });
                    }
                    if remove_iv.last < iv.last {
                        iv.first = remove_iv.last + 1;
                        current_remove = remove_iter.next();
                    } else {
                        break;
                    }
                }
            }
            if current_remove.is_none() {
                result.push(*iv);
            }
        }

        self.ivs = result;
    }

    /// Intersect the set with the given intervals.
    pub(crate) fn intersect(&mut self, intervals: &[Interval]) {
        let mut new_ivs = Vec::new();
        for iv in intervals {
            for self_iv in self.intervals() {
                if iv.overlaps(*self_iv) {
                    new_ivs.push(Interval {
                        first: cmp::max(iv.first, self_iv.first),
                        last: cmp::min(iv.last, self_iv.last),
                    });
                }
            }
        }
        self.ivs = new_ivs;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iv(first: u32, last: u32) -> Interval {
        Interval { first, last }
    }

    #[test]
    fn test_is_before() {
        let a = iv(0, 9);
        let b = iv(10, 19);
        assert!(a.is_before(b));
        assert!(!b.is_before(a));
    }

    #[test]
    fn test_is_strictly_before() {
        let a = iv(0, 9);
        let b = iv(10, 19);
        let c = iv(11, 19);
        assert!(!a.is_strictly_before(b));
        assert!(a.is_strictly_before(c));
        assert!(!b.is_strictly_before(a));
        assert!(!b.is_strictly_before(c));
    }

    #[test]
    fn test_mergecmp() {
        let a = iv(0, 9);
        let b = iv(10, 19);
        let c = iv(9, 18);
        assert_eq!(a.mergecmp(b), Ordering::Equal);
        assert_eq!(b.mergecmp(a), Ordering::Equal);
        assert_eq!(a.mergecmp(c), Ordering::Equal);
        assert_eq!(c.mergecmp(a), Ordering::Equal);

        let d = iv(11, 19);
        assert_eq!(a.mergecmp(d), Ordering::Less);
        assert_eq!(d.mergecmp(a), Ordering::Greater);
        assert_eq!(b.mergecmp(d), Ordering::Equal);
        assert_eq!(d.mergecmp(b), Ordering::Equal);
        assert_eq!(c.mergecmp(d), Ordering::Equal);
        assert_eq!(d.mergecmp(c), Ordering::Equal);

        let e = iv(100, 109);
        assert_eq!(a.mergecmp(e), Ordering::Less);
        assert_eq!(e.mergecmp(a), Ordering::Greater);
    }

    #[test]
    fn test_mergeable() {
        let a = iv(0, 9);
        let b = iv(9, 19);
        assert!(a.mergeable(a));
        assert!(a.mergeable(b));
        assert!(b.mergeable(b));
    }

    #[test]
    fn test_contains() {
        let a = iv(0, 9);
        assert!(a.contains(0));
        assert!(a.contains(9));
        assert!(!a.contains(10));
    }

    #[test]
    fn test_overlaps() {
        let a = iv(0, 9);
        let b = iv(5, 14);
        let c = iv(10, 19);
        assert!(a.overlaps(b));
        assert!(!a.overlaps(c));
    }

    #[test]
    fn test_codepoints() {
        let a = iv(0, 9);
        assert_eq!(a.codepoints(), 0..10);
    }

    #[test]
    fn test_count_codepoints() {
        assert_eq!(iv(0, 9).count_codepoints(), 10);
        assert_eq!(iv(0, 0).count_codepoints(), 1);
        assert_eq!(
            iv(0, CODE_POINT_MAX).count_codepoints(),
            (CODE_POINT_MAX + 1) as usize
        );
    }

    #[test]
    fn test_add() {
        let mut set = CodePointSet::new();
        set.add(iv(10, 20));
        set.add(iv(30, 40));
        set.add(iv(15, 35));
        assert_eq!(set.intervals(), &[iv(10, 40)]);
    }

    #[test]
    fn test_add_one() {
        let mut set = CodePointSet::new();
        set.add_one(10);
        set.add_one(20);
        set.add_one(15);
        assert_eq!(set.intervals(), &[iv(10, 10), iv(15, 15), iv(20, 20)]);
    }

    #[test]
    fn test_add_set() {
        let mut set1 = CodePointSet::new();
        set1.add(iv(10, 20));
        set1.add(iv(30, 40));
        let mut set2 = CodePointSet::new();
        set2.add(iv(15, 25));
        set2.add(iv(35, 45));
        set1.add_set(set2);
        assert_eq!(set1.intervals(), &[iv(10, 25), iv(30, 45)]);
    }

    #[test]
    fn test_inverted() {
        let mut set = CodePointSet::new();
        set.add(iv(10, 20));
        set.add(iv(30, 40));
        let inverted_set = set.inverted();
        assert_eq!(
            inverted_set.intervals(),
            &[iv(0, 9), iv(21, 29), iv(41, CODE_POINT_MAX)]
        );
        let set_again = inverted_set.inverted();
        assert_eq!(set_again.intervals(), set.intervals());

        assert_eq!(
            set.inverted_interval_count(),
            inverted_set.intervals().len()
        );
        assert_eq!(
            inverted_set.inverted_interval_count(),
            set.intervals().len()
        );
    }

    #[test]
    fn test_adds_torture() {
        let mut set = CodePointSet::new();
        set.add(iv(1, 3));
        assert_eq!(&set.intervals(), &[iv(1, 3)]);
        set.add(iv(0, 0));
        assert_eq!(&set.intervals(), &[iv(0, 3)]);
        set.add(iv(3, 5));
        assert_eq!(&set.intervals(), &[iv(0, 5)]);
        set.add(iv(6, 10));
        assert_eq!(&set.intervals(), &[iv(0, 10)]);
        set.add(iv(15, 15));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(15, 15)]);
        set.add(iv(12, 14));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(12, 15)]);
        set.add(iv(16, 20));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(12, 20)]);
        set.add(iv(21, 22));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(12, 22)]);
        set.add(iv(23, 23));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(12, 23)]);
        set.add(iv(100, 200));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(12, 23), iv(100, 200)]);
        set.add(iv(201, 250));
        assert_eq!(&set.intervals(), &[iv(0, 10), iv(12, 23), iv(100, 250)]);
        set.add(iv(0, 0x10ffff));
        assert_eq!(&set.intervals(), &[iv(0, 0x10ffff)]);
    }
}
