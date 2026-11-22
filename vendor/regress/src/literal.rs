//! Support for lowering literals character sequences into sequences of bytes, optionally with case-insensitivity.

use crate::insn::MAX_CHAR_SET_LENGTH;
use crate::ir::Node;
use crate::unicode;
#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Piece {
    // A character which could not be lowered, such as a surrogate.
    // Note that icase is not relevant here.
    Char(u32),
    // A successfully lowered sequence of bytes.
    ByteSequence(Vec<u8>),
    // An ASCII character which was lowered to a set of bytes.
    ByteSet(Vec<u8>),
    // A character which had to be lowered to a set of characters.
    CharSet(Vec<u32>),
}

impl Piece {
    pub fn into_nodes(pieces: Vec<Piece>) -> Vec<Node> {
        pieces.into_iter().map(Node::from).collect()
    }
}

// Support for converting Pieces into Instructions.
impl From<Piece> for Node {
    fn from(piece: Piece) -> Self {
        match piece {
            // Chars that could not be lowered are surorgates, which don't participate in case-insensitivity.
            Piece::Char(c) => Node::Char { c },
            Piece::ByteSequence(bytes) => Node::ByteSequence(bytes),
            Piece::ByteSet(bytes) => Node::ByteSet(bytes),
            Piece::CharSet(chars) => Node::CharSet(chars),
        }
    }
}

// Lower a sequence of code points into a sequence of Pieces.
// This assumes UTF-8 encoding; the whole module is compiled out under the
// `utf16` feature, which must never match against bytes.
pub fn lower_code_point_sequence(cps: &[u32], icase: bool, unicode: bool) -> Vec<Piece> {
    let mut buff = [0; 4];
    let mut pieces = Vec::new();
    for &cp in cps {
        // If we're icase, we may need to unfold this.
        let chars = unicode::expand_code_point(cp, icase, unicode);
        match chars.len() {
            0 => panic!("Char should always unfold to at least itself"),
            1 => {
                if let Some(c) = char::from_u32(chars[0]) {
                    // Encode as UTF-8.
                    let bytes = c.encode_utf8(&mut buff).as_bytes();
                    // Append to the previous piece if it was also bytes.
                    if let Some(Piece::ByteSequence(prev)) = pieces.last_mut() {
                        prev.extend_from_slice(bytes);
                        continue;
                    }
                    pieces.push(Piece::ByteSequence(bytes.to_vec()))
                } else {
                    // Code point was a surrogate, etc.
                    pieces.push(Piece::Char(chars[0]))
                }
            }
            2..=MAX_CHAR_SET_LENGTH => {
                // Form either a CharSet or ByteSet, depending on whether all the chars are ASCII.
                let piece = if chars.iter().all(|&c| c <= 0x7F) {
                    Piece::ByteSet(chars.iter().map(|&c| c as u8).collect())
                } else {
                    Piece::CharSet(chars)
                };
                pieces.push(piece);
            }
            _ => panic!("Unicode case fold exceeded maximum expansion"),
        }
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unicode;

    /// Lower the chars of `s` (as code points).
    fn lower(s: &str, icase: bool, unicode: bool) -> Vec<Piece> {
        let cps: Vec<u32> = s.chars().map(u32::from).collect();
        lower_code_point_sequence(&cps, icase, unicode)
    }

    /// Non-icase lowering: code points pass through verbatim. Single chars are
    /// UTF-8 encoded and coalesced into one ByteSequence, surrogates become a
    /// standalone Piece::Char and break the run, and empty input yields nothing.
    #[test]
    fn non_icase_lowering() {
        assert!(lower("", false, true).is_empty());

        // 'a','b','c' coalesce; 'é' U+00E9 contributes its UTF-8 bytes 0xC3 0xA9.
        assert_eq!(
            lower("abcé", false, true),
            vec![Piece::ByteSequence(vec![b'a', b'b', b'c', 0xC3, 0xA9])]
        );

        // A lone surrogate can't be a `char`; it interrupts the ByteSequence run,
        // and the following char starts a fresh sequence.
        assert_eq!(
            lower_code_point_sequence(&[b'a' as u32, 0xD800, b'b' as u32], false, true),
            &[
                Piece::ByteSequence(vec![b'a']),
                Piece::Char(0xD800),
                Piece::ByteSequence(vec![b'b']),
            ]
        );
    }

    /// Case-insensitive lowering: each code point is unfolded. An all-ASCII
    /// unfold of length >1 becomes a ByteSet (which don't coalesce), an unfold
    /// containing a non-ASCII member becomes a CharSet, and a char with no case
    /// variants stays a plain length-1 ByteSequence.
    #[test]
    fn icase_lowering() {
        assert!(lower("", true, true).is_empty());

        // 'a' -> {A, a}, 'b' -> {B, b}: two separate ByteSets. '!' has no case
        // variants and stays a ByteSequence.
        assert_eq!(
            lower("ab!", true, true),
            &[
                Piece::ByteSet(vec![b'A', b'a']),
                Piece::ByteSet(vec![b'B', b'b']),
                Piece::ByteSequence(vec![b'!']),
            ]
        );

        // 's' unfolds to include U+017F (LATIN SMALL LETTER LONG S), so its
        // non-ASCII unfold lowers to a CharSet preserving unfold order.
        let expected = unicode::unfold_char(b's' as u32);
        assert!(expected.len() > 1 && expected.iter().any(|&c| c > 0x7F));
        assert_eq!(lower("s", true, true), &[Piece::CharSet(expected)]);

        // Without the unicode flag the uppercase-based unfold is used; 'a' still
        // yields {A, a}.
        assert_eq!(lower("a", true, false), &[Piece::ByteSet(vec![b'A', b'a'])]);
    }
}
