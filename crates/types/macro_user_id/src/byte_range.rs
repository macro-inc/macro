use std::ops::Range;

use nom::Offset;

#[derive(Debug, Clone, Copy)]
pub(crate) struct ByteRange {
    start: usize,
    end: usize,
}

impl ByteRange {
    /// given an input super_str and an input sub_str
    /// return the bytes range of the sub_str inside of the super str
    pub fn new_from(super_str: &str, sub_str: &str) -> Self {
        let len = sub_str.len();
        let start = super_str.offset(sub_str);
        ByteRange {
            start,
            end: start + len,
        }
    }
}

impl ByteRange {
    pub fn range(&self) -> Range<usize> {
        self.start..self.end
    }
}
