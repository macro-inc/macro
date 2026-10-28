//! `ASCIIHexDecode`, `ASCII85Decode`, and `RunLengthDecode` (ISO 32000-1
//! §7.4.2, §7.4.3, §7.4.5).

use super::MAX_OUTPUT;
use crate::pdf::lexer::hex_value;

/// Hexadecimal pairs up to `>`; whitespace and junk skipped, an odd final
/// digit read as if followed by 0.
pub(super) fn hex(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() / 2);
    let mut high: Option<u8> = None;
    for &b in data {
        if b == b'>' {
            break;
        }
        let Some(v) = hex_value(b) else {
            continue;
        };
        match high.take() {
            Some(h) => out.push((h << 4) | v),
            None => high = Some(v),
        }
    }
    if let Some(h) = high {
        out.push(h << 4);
    }
    out
}

/// Base-85 groups of five characters (`!`–`u`) to four bytes, `z` for four
/// zeros, up to `~>`; whitespace and junk skipped, a final partial group of
/// n characters giving n − 1 bytes.
pub(super) fn base85(data: &[u8]) -> Vec<u8> {
    let data = data.strip_prefix(b"<~").unwrap_or(data);
    let mut out = Vec::with_capacity(data.len() / 5 * 4 + 4);
    let mut group: u64 = 0;
    let mut count = 0;
    for &c in data {
        match c {
            b'~' => break,
            b'z' if count == 0 => out.extend_from_slice(&[0; 4]),
            b'!'..=b'u' => {
                group = group * 85 + u64::from(c - b'!');
                count += 1;
                if count == 5 {
                    out.extend_from_slice(&(group as u32).to_be_bytes());
                    group = 0;
                    count = 0;
                }
            }
            // Whitespace and junk.
            _ => {}
        }
    }
    if count > 1 {
        for _ in count..5 {
            group = group * 85 + 84;
        }
        out.extend_from_slice(&(group as u32).to_be_bytes()[..count - 1]);
    }
    out
}

/// Runs: a length byte 0–127 copies that many plus one bytes, 129–255
/// repeats the next byte 257 minus it times, 128 ends the data.
pub(super) fn run_length(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len().saturating_mul(2).min(MAX_OUTPUT));
    let mut i = 0;
    while let Some(&n) = data.get(i) {
        i += 1;
        match n {
            0..=127 => {
                let end = (i + usize::from(n) + 1).min(data.len());
                out.extend_from_slice(&data[i..end]);
                i = end;
            }
            128 => break,
            _ => {
                let Some(&b) = data.get(i) else {
                    break;
                };
                i += 1;
                out.resize(out.len() + 257 - usize::from(n), b);
            }
        }
        if out.len() >= MAX_OUTPUT {
            out.truncate(MAX_OUTPUT);
            break;
        }
    }
    out
}
