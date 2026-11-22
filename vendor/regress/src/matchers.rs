use crate::cursor::Direction;
use crate::indexing::{ElementType, InputIndexer};
use crate::types::BracketContents;
use crate::unicodetables::nonascii_folds_to_ascii_word_char;
use crate::{cursor, unicode};

pub trait CharProperties {
    type Element: ElementType;

    /// Case-fold an element.
    fn fold(c: Self::Element, unicode: bool) -> Self::Element;

    /// \return whether this is a word char.
    /// ES9 21.2.2.6.2.
    fn is_word_char(c: Self::Element) -> bool {
        let c = c.as_u32();
        'a' as u32 <= c && c <= 'z' as u32
            || 'A' as u32 <= c && c <= 'Z' as u32
            || '0' as u32 <= c && c <= '9' as u32
            || c == '_' as u32
    }

    /// \return whether this is a word char in Unicode case-insensitive mode.
    /// This includes ASCII word chars and any character that folds to an ASCII word char.
    fn is_word_char_unicode_icase(c: Self::Element) -> bool {
        Self::is_word_char(c) || nonascii_folds_to_ascii_word_char(c.as_u32())
    }

    /// ES9 11.3
    fn is_line_terminator(c: Self::Element) -> bool {
        matches!(c.as_u32(), 0x000A | 0x000D | 0x2028 | 0x2029)
    }

    /// \return whether the bracket \p bc matches the given character \p c,
    /// respecting case. Respects 'invert'.
    #[inline(always)]
    fn bracket(bc: &BracketContents, cp: Self::Element) -> bool {
        let cp = cp.into();
        if bc.cps.contains(cp) {
            return !bc.invert;
        }
        bc.invert
    }
}

pub struct UTF8CharProperties {}

impl CharProperties for UTF8CharProperties {
    type Element = char;

    fn fold(c: Self::Element, unicode: bool) -> Self::Element {
        char::from_u32(unicode::fold_code_point(c.into(), unicode)).unwrap_or(c)
    }
}

pub struct ASCIICharProperties {}
impl CharProperties for ASCIICharProperties {
    type Element = u8;

    fn fold(c: Self::Element, unicode: bool) -> Self::Element {
        if unicode {
            c.to_ascii_lowercase()
        } else {
            c.to_ascii_uppercase()
        }
    }
}

#[cfg(feature = "utf16")]
pub struct Utf16CharProperties {}

#[cfg(feature = "utf16")]
impl CharProperties for Utf16CharProperties {
    type Element = u32;

    fn fold(c: Self::Element, unicode: bool) -> Self::Element {
        unicode::fold_code_point(c, unicode)
    }
}

/// Check whether the \p orig_range within \p cursor matches position \p pos.
pub fn backref<Input: InputIndexer, Dir: Direction>(
    input: &Input,
    dir: Dir,
    orig_range: core::ops::Range<Input::Position>,
    pos: &mut Input::Position,
) -> bool {
    input.subrange_eq(dir, pos, orig_range)
}

pub fn backref_icase<Input: InputIndexer, Dir: Direction>(
    input: &Input,
    dir: Dir,
    orig_range: core::ops::Range<Input::Position>,
    pos: &mut Input::Position,
) -> bool {
    let ref_input = input.subinput(orig_range);
    let mut ref_pos = if Dir::FORWARD {
        ref_input.left_end()
    } else {
        ref_input.right_end()
    };
    while let Some(c1) = cursor::next(&ref_input, dir, &mut ref_pos) {
        let mut matched = false;
        if let Some(c2) = cursor::next(input, dir, pos) {
            matched = input.fold_equals(c1, c2)
        }
        if !matched {
            return false;
        }
    }
    true
}
