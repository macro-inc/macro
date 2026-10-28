//! Advance widths of fonts no bundled face matches width for width.
//!
//! Tahoma is drawn with Liberation Sans, whose letters are as wide on
//! average but not one by one (Tahoma's capitals are narrower, its spaces
//! and `t`, `f` and `r` wider), so lines of Tahoma would break elsewhere
//! than in Word. These tables hold the originals' advances, in thousandths
//! of an em, for the characters documents use most (read from Word's PDF
//! exports of documents set in Tahoma); other characters keep the
//! substitute's advance.

/// A font whose advances are known here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Widths {
    /// Tahoma (also Word's "MS Shell Dlg 2").
    Tahoma,
    /// Tahoma Bold.
    TahomaBold,
}

/// Thousandths of an em per em.
const MILLI: f32 = 1000.0;

/// Tahoma's advances, sorted by character.
#[rustfmt::skip]
const TAHOMA: &[(char, u16)] = &[
    (' ', 313), ('#', 728), ('%', 977), ('\'', 211), ('(', 383), (')', 383), ('+', 728),
    (',', 303), ('-', 363), ('.', 303), ('/', 382), ('0', 546), ('1', 546), ('2', 546),
    ('3', 546), ('4', 546), ('5', 546), ('6', 546), ('7', 546), ('8', 546), ('9', 546),
    (':', 354), (';', 354), ('?', 474), ('@', 909), ('A', 600), ('B', 589), ('C', 601),
    ('D', 678), ('E', 561), ('F', 521), ('G', 667), ('H', 675), ('I', 373), ('J', 417),
    ('K', 588), ('L', 498), ('M', 771), ('N', 667), ('O', 708), ('P', 551), ('Q', 708),
    ('R', 621), ('S', 557), ('T', 584), ('U', 656), ('V', 597), ('W', 902), ('Y', 576),
    ('a', 525), ('b', 553), ('c', 461), ('d', 553), ('e', 526), ('f', 318), ('g', 553),
    ('h', 558), ('i', 229), ('j', 282), ('k', 498), ('l', 229), ('m', 840), ('n', 558),
    ('o', 543), ('p', 553), ('q', 553), ('r', 360), ('s', 446), ('t', 334), ('u', 558),
    ('v', 498), ('w', 742), ('x', 495), ('y', 498), ('\u{00A9}', 929), ('\u{2013}', 546),
    ('\u{2018}', 211), ('\u{2019}', 211),
];

/// Tahoma Bold's advances, sorted by character.
#[rustfmt::skip]
const TAHOMA_BOLD: &[(char, u16)] = &[
    (' ', 293), ('(', 454), (')', 454), (',', 313), ('-', 431), ('.', 313), ('/', 577),
    ('0', 637), ('1', 637), ('2', 637), ('3', 637), ('4', 637), ('5', 637), ('6', 637),
    ('7', 637), ('8', 637), ('9', 637), (':', 363), ('?', 566), ('@', 920), ('A', 685),
    ('B', 686), ('C', 667), ('D', 757), ('E', 615), ('F', 581), ('G', 745), ('H', 764),
    ('I', 483), ('J', 500), ('L', 572), ('M', 893), ('N', 771), ('O', 770), ('P', 657),
    ('R', 726), ('S', 633), ('T', 612), ('W', 1028), ('a', 599), ('b', 632), ('c', 527),
    ('d', 629), ('e', 594), ('f', 382), ('g', 629), ('h', 640), ('i', 302), ('j', 363),
    ('k', 603), ('l', 302), ('m', 954), ('n', 640), ('o', 617), ('p', 629), ('q', 629),
    ('r', 434), ('s', 515), ('t', 416), ('u', 640), ('v', 579), ('w', 890), ('x', 604),
    ('y', 576), ('\u{2013}', 637), ('\u{2018}', 275), ('\u{2019}', 275),
];

impl Widths {
    /// The table for a family (lowercase) in a weight, if there is one.
    pub fn for_family(family: &str, bold: bool) -> Option<Self> {
        match (family, bold) {
            ("tahoma" | "ms shell dlg 2", false) => Some(Widths::Tahoma),
            ("tahoma" | "ms shell dlg 2", true) => Some(Widths::TahomaBold),
            _ => None,
        }
    }

    /// The advance of `ch` in em, when known.
    pub fn advance(self, ch: char) -> Option<f32> {
        let table = match self {
            Widths::Tahoma => TAHOMA,
            Widths::TahomaBold => TAHOMA_BOLD,
        };
        table
            .binary_search_by_key(&ch, |&(c, _)| c)
            .ok()
            .map(|i| f32::from(table[i].1) / MILLI)
    }
}
