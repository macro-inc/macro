//! `CCITTFaxDecode`: Group 3 one- and two-dimensional and Group 4 fax
//! data (ITU-T T.4 and T.6) to 1-bit rows.
//!
//! Lines are kept as their changing elements (where the color changes,
//! starting white), as the two-dimensional codes are relative to the
//! previous line's.

use crate::error::{AiError, Result};
use std::sync::OnceLock;

/// The decoding parameters.
pub(super) struct Params {
    /// `K`: below zero Group 4, zero Group 3 1-D, above zero mixed.
    pub(super) k: i64,
    pub(super) end_of_line: bool,
    pub(super) byte_align: bool,
    pub(super) columns: usize,
    /// Rows to read (`0`: until the data ends).
    pub(super) rows: usize,
    pub(super) end_of_block: bool,
    pub(super) black_is_1: bool,
}

/// End of line: eleven zeros and a one.
const EOL: u32 = 1;

/// A two-dimensional mode.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Pass,
    Horizontal,
    Vertical(i8),
}

/// Codes: (bits, length, value).
type Code = (u16, u8, u16);

const WHITE: [Code; 104] = [
    (0b00110101, 8, 0),
    (0b000111, 6, 1),
    (0b0111, 4, 2),
    (0b1000, 4, 3),
    (0b1011, 4, 4),
    (0b1100, 4, 5),
    (0b1110, 4, 6),
    (0b1111, 4, 7),
    (0b10011, 5, 8),
    (0b10100, 5, 9),
    (0b00111, 5, 10),
    (0b01000, 5, 11),
    (0b001000, 6, 12),
    (0b000011, 6, 13),
    (0b110100, 6, 14),
    (0b110101, 6, 15),
    (0b101010, 6, 16),
    (0b101011, 6, 17),
    (0b0100111, 7, 18),
    (0b0001100, 7, 19),
    (0b0001000, 7, 20),
    (0b0010111, 7, 21),
    (0b0000011, 7, 22),
    (0b0000100, 7, 23),
    (0b0101000, 7, 24),
    (0b0101011, 7, 25),
    (0b0010011, 7, 26),
    (0b0100100, 7, 27),
    (0b0011000, 7, 28),
    (0b00000010, 8, 29),
    (0b00000011, 8, 30),
    (0b00011010, 8, 31),
    (0b00011011, 8, 32),
    (0b00010010, 8, 33),
    (0b00010011, 8, 34),
    (0b00010100, 8, 35),
    (0b00010101, 8, 36),
    (0b00010110, 8, 37),
    (0b00010111, 8, 38),
    (0b00101000, 8, 39),
    (0b00101001, 8, 40),
    (0b00101010, 8, 41),
    (0b00101011, 8, 42),
    (0b00101100, 8, 43),
    (0b00101101, 8, 44),
    (0b00000100, 8, 45),
    (0b00000101, 8, 46),
    (0b00001010, 8, 47),
    (0b00001011, 8, 48),
    (0b01010010, 8, 49),
    (0b01010011, 8, 50),
    (0b01010100, 8, 51),
    (0b01010101, 8, 52),
    (0b00100100, 8, 53),
    (0b00100101, 8, 54),
    (0b01011000, 8, 55),
    (0b01011001, 8, 56),
    (0b01011010, 8, 57),
    (0b01011011, 8, 58),
    (0b01001010, 8, 59),
    (0b01001011, 8, 60),
    (0b00110010, 8, 61),
    (0b00110011, 8, 62),
    (0b00110100, 8, 63),
    (0b11011, 5, 64),
    (0b10010, 5, 128),
    (0b010111, 6, 192),
    (0b0110111, 7, 256),
    (0b00110110, 8, 320),
    (0b00110111, 8, 384),
    (0b01100100, 8, 448),
    (0b01100101, 8, 512),
    (0b01101000, 8, 576),
    (0b01100111, 8, 640),
    (0b011001100, 9, 704),
    (0b011001101, 9, 768),
    (0b011010010, 9, 832),
    (0b011010011, 9, 896),
    (0b011010100, 9, 960),
    (0b011010101, 9, 1024),
    (0b011010110, 9, 1088),
    (0b011010111, 9, 1152),
    (0b011011000, 9, 1216),
    (0b011011001, 9, 1280),
    (0b011011010, 9, 1344),
    (0b011011011, 9, 1408),
    (0b010011000, 9, 1472),
    (0b010011001, 9, 1536),
    (0b010011010, 9, 1600),
    (0b011000, 6, 1664),
    (0b010011011, 9, 1728),
    (0b00000001000, 11, 1792),
    (0b00000001100, 11, 1856),
    (0b00000001101, 11, 1920),
    (0b000000010010, 12, 1984),
    (0b000000010011, 12, 2048),
    (0b000000010100, 12, 2112),
    (0b000000010101, 12, 2176),
    (0b000000010110, 12, 2240),
    (0b000000010111, 12, 2304),
    (0b000000011100, 12, 2368),
    (0b000000011101, 12, 2432),
    (0b000000011110, 12, 2496),
    (0b000000011111, 12, 2560),
];

const BLACK: [Code; 104] = [
    (0b0000110111, 10, 0),
    (0b010, 3, 1),
    (0b11, 2, 2),
    (0b10, 2, 3),
    (0b011, 3, 4),
    (0b0011, 4, 5),
    (0b0010, 4, 6),
    (0b00011, 5, 7),
    (0b000101, 6, 8),
    (0b000100, 6, 9),
    (0b0000100, 7, 10),
    (0b0000101, 7, 11),
    (0b0000111, 7, 12),
    (0b00000100, 8, 13),
    (0b00000111, 8, 14),
    (0b000011000, 9, 15),
    (0b0000010111, 10, 16),
    (0b0000011000, 10, 17),
    (0b0000001000, 10, 18),
    (0b00001100111, 11, 19),
    (0b00001101000, 11, 20),
    (0b00001101100, 11, 21),
    (0b00000110111, 11, 22),
    (0b00000101000, 11, 23),
    (0b00000010111, 11, 24),
    (0b00000011000, 11, 25),
    (0b000011001010, 12, 26),
    (0b000011001011, 12, 27),
    (0b000011001100, 12, 28),
    (0b000011001101, 12, 29),
    (0b000001101000, 12, 30),
    (0b000001101001, 12, 31),
    (0b000001101010, 12, 32),
    (0b000001101011, 12, 33),
    (0b000011010010, 12, 34),
    (0b000011010011, 12, 35),
    (0b000011010100, 12, 36),
    (0b000011010101, 12, 37),
    (0b000011010110, 12, 38),
    (0b000011010111, 12, 39),
    (0b000001101100, 12, 40),
    (0b000001101101, 12, 41),
    (0b000011011010, 12, 42),
    (0b000011011011, 12, 43),
    (0b000001010100, 12, 44),
    (0b000001010101, 12, 45),
    (0b000001010110, 12, 46),
    (0b000001010111, 12, 47),
    (0b000001100100, 12, 48),
    (0b000001100101, 12, 49),
    (0b000001010010, 12, 50),
    (0b000001010011, 12, 51),
    (0b000000100100, 12, 52),
    (0b000000110111, 12, 53),
    (0b000000111000, 12, 54),
    (0b000000100111, 12, 55),
    (0b000000101000, 12, 56),
    (0b000001011000, 12, 57),
    (0b000001011001, 12, 58),
    (0b000000101011, 12, 59),
    (0b000000101100, 12, 60),
    (0b000001011010, 12, 61),
    (0b000001100110, 12, 62),
    (0b000001100111, 12, 63),
    (0b0000001111, 10, 64),
    (0b000011001000, 12, 128),
    (0b000011001001, 12, 192),
    (0b000001011011, 12, 256),
    (0b000000110011, 12, 320),
    (0b000000110100, 12, 384),
    (0b000000110101, 12, 448),
    (0b0000001101100, 13, 512),
    (0b0000001101101, 13, 576),
    (0b0000001001010, 13, 640),
    (0b0000001001011, 13, 704),
    (0b0000001001100, 13, 768),
    (0b0000001001101, 13, 832),
    (0b0000001110010, 13, 896),
    (0b0000001110011, 13, 960),
    (0b0000001110100, 13, 1024),
    (0b0000001110101, 13, 1088),
    (0b0000001110110, 13, 1152),
    (0b0000001110111, 13, 1216),
    (0b0000001010010, 13, 1280),
    (0b0000001010011, 13, 1344),
    (0b0000001010100, 13, 1408),
    (0b0000001010101, 13, 1472),
    (0b0000001011010, 13, 1536),
    (0b0000001011011, 13, 1600),
    (0b0000001100100, 13, 1664),
    (0b0000001100101, 13, 1728),
    (0b00000001000, 11, 1792),
    (0b00000001100, 11, 1856),
    (0b00000001101, 11, 1920),
    (0b000000010010, 12, 1984),
    (0b000000010011, 12, 2048),
    (0b000000010100, 12, 2112),
    (0b000000010101, 12, 2176),
    (0b000000010110, 12, 2240),
    (0b000000010111, 12, 2304),
    (0b000000011100, 12, 2368),
    (0b000000011101, 12, 2432),
    (0b000000011110, 12, 2496),
    (0b000000011111, 12, 2560),
];

/// Bits a run table is indexed by (the longest code).
const RUN_BITS: u32 = 13;

/// A lookup by the next 13 bits: (code length, run); length 0 is no code.
fn table(codes: &[Code]) -> Vec<(u8, u16)> {
    let mut t = vec![(0u8, 0u16); 1 << RUN_BITS];
    for &(bits, len, run) in codes {
        let shift = RUN_BITS - u32::from(len);
        let start = usize::from(bits) << shift;
        t[start..start + (1 << shift)].fill((len, run));
    }
    t
}

fn white_table() -> &'static [(u8, u16)] {
    static T: OnceLock<Vec<(u8, u16)>> = OnceLock::new();
    T.get_or_init(|| table(&WHITE))
}

fn black_table() -> &'static [(u8, u16)] {
    static T: OnceLock<Vec<(u8, u16)>> = OnceLock::new();
    T.get_or_init(|| table(&BLACK))
}

/// Reads bits, most significant first; zeros past the end.
struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn peek(&self, n: u32) -> u32 {
        let mut v = 0u32;
        for i in 0..n as usize {
            let bit = self
                .data
                .get((self.at + i) / 8)
                .map_or(0, |b| (b >> (7 - (self.at + i) % 8)) & 1);
            v = (v << 1) | u32::from(bit);
        }
        v
    }

    fn skip(&mut self, n: u32) {
        self.at += n as usize;
    }

    fn done(&self) -> bool {
        self.at >= self.data.len() * 8
    }

    fn align(&mut self) {
        self.at = self.at.div_ceil(8) * 8;
    }

    /// Skips an end of line if one is next (after fill zeros when
    /// `fill`); whether one was.
    fn eol(&mut self, fill: bool) -> bool {
        let start = self.at;
        if fill {
            while self.peek(12) == 0 && !self.done() {
                self.skip(1);
            }
        }
        if self.peek(12) == EOL {
            self.skip(12);
            true
        } else {
            self.at = start;
            false
        }
    }

    /// Moves to the next end of line; whether there is one.
    fn resync(&mut self) -> bool {
        while !self.done() {
            if self.peek(12) == EOL {
                return true;
            }
            self.skip(1);
        }
        false
    }

    /// A run's length: makeup codes then a terminating code.
    fn run(&mut self, black: bool, columns: usize) -> Option<usize> {
        let table = if black { black_table() } else { white_table() };
        let mut total = 0usize;
        loop {
            if self.done() {
                return None;
            }
            let (len, run) = table[self.peek(RUN_BITS) as usize];
            if len == 0 {
                return None;
            }
            self.skip(u32::from(len));
            total += usize::from(run);
            if run < 64 {
                return Some(total);
            }
            if total > columns + 2560 {
                return None;
            }
        }
    }

    fn mode(&mut self) -> Option<Mode> {
        let bits = self.peek(7);
        let (len, mode) = if bits >> 6 == 1 {
            (1, Mode::Vertical(0))
        } else if bits >> 4 == 0b011 {
            (3, Mode::Vertical(1))
        } else if bits >> 4 == 0b010 {
            (3, Mode::Vertical(-1))
        } else if bits >> 4 == 0b001 {
            (3, Mode::Horizontal)
        } else if bits >> 3 == 0b0001 {
            (4, Mode::Pass)
        } else if bits >> 1 == 0b000011 {
            (6, Mode::Vertical(2))
        } else if bits >> 1 == 0b000010 {
            (6, Mode::Vertical(-2))
        } else if bits == 0b0000011 {
            (7, Mode::Vertical(3))
        } else if bits == 0b0000010 {
            (7, Mode::Vertical(-3))
        } else {
            // An extension, an end of line, or damage.
            return None;
        };
        self.skip(len);
        Some(mode)
    }
}

/// The line being decoded, as changing elements: `changes[i]` ends run `i`
/// (white runs at even `i`).
struct Line {
    changes: Vec<usize>,
    /// The run being written.
    at: usize,
    columns: usize,
}

impl Line {
    fn start(&mut self) {
        self.changes.clear();
        self.changes.push(0);
        self.at = 0;
    }

    fn end(&self) -> usize {
        self.changes[self.at]
    }

    /// Extends the runs to `a1`, starting a run when the color changes.
    fn add(&mut self, a1: usize, black: bool) {
        if a1 > self.end() {
            let a1 = a1.min(self.columns);
            if (self.at & 1 == 1) != black {
                self.at += 1;
                if self.changes.len() <= self.at {
                    self.changes.push(0);
                }
            }
            self.changes[self.at] = a1;
        }
    }

    /// Like [`Line::add`], also moving back when `a1` is left of the end.
    fn add_back(&mut self, a1: i64, black: bool) {
        let a1 = usize::try_from(a1).unwrap_or(0);
        if a1 > self.end() {
            self.add(a1, black);
        } else if a1 < self.end() {
            while self.at > 0 && a1 < self.changes[self.at - 1] {
                self.at -= 1;
            }
            self.changes[self.at] = a1;
        }
    }

    /// The finished line's changes (through `at`), ending at `columns`.
    fn changes(&self) -> &[usize] {
        &self.changes[..=self.at]
    }
}

/// Decodes fax data to rows of `columns` 1-bit pixels padded to whole
/// bytes (0 for black unless `BlackIs1`); the rows read.
pub(super) fn decode(data: &[u8], p: &Params, max_rows: usize) -> Result<(usize, Vec<u8>)> {
    let columns = p.columns;
    if columns == 0 || columns > super::MAX_SIDE as usize {
        return Err(AiError::corrupt("CCITT: bad Columns"));
    }
    let mut out = Vec::new();
    let mut reader = Reader { data, at: 0 };
    let mut line = Line {
        changes: vec![columns],
        at: 0,
        columns,
    };
    let mut reference: Vec<usize> = Vec::new();
    let mut rows = 0;
    // A leading end of line, and the first line's tag.
    reader.eol(true);
    let mut two_d = p.k < 0;
    if p.k > 0 {
        two_d = reader.peek(1) == 0;
        reader.skip(1);
    }
    let limit = if p.rows > 0 {
        p.rows.min(max_rows)
    } else {
        max_rows
    };
    while rows < limit && !reader.done() {
        if p.byte_align && p.k < 0 {
            reader.align();
        }
        let ok = if two_d {
            reference.clear();
            reference.extend_from_slice(line.changes());
            reference.retain(|&c| c < columns);
            reference.extend([columns, columns]);
            decode_2d(&mut reader, &mut line, &reference)
        } else {
            decode_1d(&mut reader, &mut line)
        };
        if !ok {
            // Damage, or the end of the data. With end-of-line codes, the
            // line is finished in white and decoding resumes at the next
            // one; otherwise the rows read are kept.
            if !p.end_of_line || !reader.resync() {
                break;
            }
            line.add(columns, false);
        }
        emit(&line, columns, p.black_is_1, &mut out);
        rows += 1;
        // An end of line (after fill zeros) may follow; an end of block (two
        // or six of them in a row) ends the data. Byte-aligned Group 3 lines
        // pad up to their end of line (which then ends on a byte boundary)
        // or, without one, up to the next byte.
        let mut got_eol = reader.eol(true);
        if !got_eol && p.byte_align && p.k >= 0 {
            reader.align();
            got_eol = reader.eol(true);
        }
        if got_eol && p.end_of_block {
            let save = reader.at;
            if p.k > 0 {
                reader.skip(1);
            }
            if reader.eol(false) {
                break;
            }
            reader.at = save;
        }
        if p.k > 0 {
            two_d = reader.peek(1) == 0;
            reader.skip(1);
        }
    }
    Ok((rows, out))
}

fn decode_1d(reader: &mut Reader<'_>, line: &mut Line) -> bool {
    line.start();
    let mut black = false;
    while line.end() < line.columns {
        let Some(run) = reader.run(black, line.columns) else {
            return false;
        };
        line.add(line.end() + run, black);
        black = !black;
    }
    true
}

fn decode_2d(reader: &mut Reader<'_>, line: &mut Line, reference: &[usize]) -> bool {
    let columns = line.columns;
    let r = |i: usize| reference.get(i).copied().unwrap_or(columns);
    line.start();
    let mut black = false;
    let mut b = 0usize;
    while line.end() < columns {
        let Some(mode) = reader.mode() else {
            return false;
        };
        match mode {
            Mode::Pass => {
                line.add(r(b + 1), black);
                if r(b + 1) < columns {
                    b += 2;
                }
            }
            Mode::Horizontal => {
                let first = reader.run(black, columns);
                let second = reader.run(!black, columns);
                let (Some(first), Some(second)) = (first, second) else {
                    return false;
                };
                line.add(line.end() + first, black);
                if line.end() < columns {
                    line.add(line.end() + second, !black);
                }
                while r(b) <= line.end() && r(b) < columns {
                    b += 2;
                }
            }
            Mode::Vertical(d) => {
                let a1 = r(b) as i64 + i64::from(d);
                if d >= 0 {
                    line.add(usize::try_from(a1).unwrap_or(0), black);
                } else {
                    line.add_back(a1, black);
                }
                black = !black;
                if line.end() < columns {
                    if d < 0 && b > 0 {
                        b -= 1;
                    } else {
                        b += 1;
                    }
                    while r(b) <= line.end() && r(b) < columns {
                        b += 2;
                    }
                }
            }
        }
    }
    true
}

/// Appends a line's pixels: white runs then black, alternating.
fn emit(line: &Line, columns: usize, black_is_1: bool, out: &mut Vec<u8>) {
    let start = out.len();
    let row_bytes = columns.div_ceil(8);
    // White pixels' bit.
    let white = !black_is_1;
    out.resize(start + row_bytes, if white { 0xff } else { 0 });
    let row = &mut out[start..];
    let mut x = 0;
    for (i, &end) in line.changes().iter().enumerate() {
        let end = end.min(columns);
        if i % 2 == 1 {
            for px in x..end {
                let bit = 0x80 >> (px % 8);
                if white {
                    row[px / 8] &= !bit;
                } else {
                    row[px / 8] |= bit;
                }
            }
        }
        x = x.max(end);
    }
    // Padding bits past the last column are left as written.
}
