use crate::codepointset::Interval;

// Character classes like \d or \S.

/// Construct an interval from an inclusive range of char.
const fn r(first: char, last: char) -> Interval {
    Interval {
        first: first as u32,
        last: last as u32,
    }
}

/// Construct an interval from a single char.
const fn r1(c: char) -> Interval {
    Interval {
        first: c as u32,
        last: c as u32,
    }
}

// Note all of these are sorted.

/// ES9 21.2.2.6.1.
pub const WORD_CHARS: [Interval; 4] = [r('0', '9'), r('A', 'Z'), r1('_'), r('a', 'z')];

/// ES9 21.2.2.12
pub const DIGITS: [Interval; 1] = [r('0', '9')];

/// [`ES13 12.2 White Space`][spec]
///
/// [spec]: https://262.ecma-international.org/13.0/#prod-WhiteSpace
pub const WHITESPACE: [Interval; 9] = [
    // U+0009 - Character Tabulation - <TAB>
    // U+000B - Line Tabulation      - <VT>
    // U+000C - Form Feed (FF)       - <FF>
    r('\u{0009}', '\u{000C}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+0020 - Space - <SP>
    r1('\u{0020}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+00A0 - No-Break Space - <NBSP>
    r1('\u{00A0}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+1680 - Ogham Space Mark
    r1('\u{1680}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+2000 - En Quad
    // U+2001 - Em Quad
    // U+2002 - En Space
    // U+2003 - Em Space
    // U+2004 - Three-Per-Em Space
    // U+2005 - Four-Per-Em Space
    // U+2006 - Six-Per-Em Space
    // U+2007 - Figure Space
    // U+2008 - Punctuation Space
    // U+2009 - Thin Space
    // U+200A - Hair Space
    r('\u{2000}', '\u{200A}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+202F - Narrow No-Break Space - <NNBSP>
    r1('\u{202F}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+205F - Medium Mathematical Space - <MMSP>
    r1('\u{205F}'),
    // From unicode “Space_Separator” (`Zs`) category:
    //
    // U+3000 - Ideographic Space
    r1('\u{3000}'),
    // U+FEFF - ZERO WIDTH NO-BREAK SPACE - <ZWNBSP>
    r1('\u{FEFF}'),
];

/// ES9 11.3
pub const LINE_TERMINATOR: [Interval; 3] =
    [r1('\u{000A}'), r1('\u{000D}'), r('\u{2028}', '\u{2029}')];
