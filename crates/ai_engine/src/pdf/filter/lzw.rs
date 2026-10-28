//! `LZWDecode` (ISO 32000-1 §7.4.4): 9- to 12-bit codes, most significant
//! bit first, widening a code early when `EarlyChange` is set.

use super::MAX_OUTPUT;

const CLEAR: usize = 256;
const END: usize = 257;
const FIRST_CODE: usize = 258;
const MAX_CODES: usize = 4096;

/// Decodes LZW data, stopping at the end-of-data code, an invalid code, or
/// the end of the input.
pub(super) fn decode(data: &[u8], early: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len().saturating_mul(2).min(MAX_OUTPUT));
    // Entries as ranges of `out`: an entry is the previous code's string
    // plus the first byte of the next, which `out` holds contiguously.
    let mut table: Vec<(usize, usize)> = Vec::with_capacity(MAX_CODES - FIRST_CODE);
    let mut width = 9u32;
    let mut bits: u32 = 0;
    let mut nbits = 0u32;
    let mut prev: Option<(usize, usize)> = None;
    let mut input = data.iter();
    loop {
        while nbits < width {
            let Some(&b) = input.next() else {
                return out;
            };
            bits = (bits << 8) | u32::from(b);
            nbits += 8;
        }
        nbits -= width;
        let code = ((bits >> nbits) & ((1 << width) - 1)) as usize;
        bits &= (1 << nbits) - 1;
        if code == CLEAR {
            table.clear();
            width = 9;
            prev = None;
            continue;
        }
        if code == END {
            break;
        }
        let start = out.len();
        let len = if code < CLEAR {
            out.push(code as u8);
            1
        } else if let Some(&(s, l)) = table.get(code - FIRST_CODE) {
            out.extend_from_within(s..s + l);
            l
        } else if code - FIRST_CODE == table.len()
            && let Some((s, l)) = prev
        {
            // The code being defined: the previous string and its first byte.
            out.extend_from_within(s..s + l);
            out.push(out[s]);
            l + 1
        } else {
            break;
        };
        if let Some((s, l)) = prev
            && FIRST_CODE + table.len() < MAX_CODES
        {
            table.push((s, l + 1));
        }
        prev = Some((start, len));
        if FIRST_CODE + table.len() + usize::from(early) >= 1 << width && width < 12 {
            width += 1;
        }
        if out.len() >= MAX_OUTPUT {
            out.truncate(MAX_OUTPUT);
            break;
        }
    }
    out
}
