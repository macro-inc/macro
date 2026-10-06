//! Bidirectional text: embedding levels from the Unicode Bidirectional
//! Algorithm (UAX #9) and the visual order of a line.
//!
//! A paragraph's direction comes from `w:bidi`; Word marks runs typed
//! right to left with `w:rtl`, and their spaces and punctuation then read
//! right to left where the algorithm would otherwise fall back to the
//! paragraph's direction. Explicit embedding and isolate characters are
//! not interpreted (Word documents express direction through properties).

/// Bidirectional character types (UAX #9 Table 4), without the explicit
/// formatting types.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    /// Left to right.
    L,
    /// Right to left (Hebrew).
    R,
    /// Arabic letter.
    Al,
    /// European number.
    En,
    /// European number separator (`+`, `-`).
    Es,
    /// European number terminator (`#`, `$`, `%`...).
    Et,
    /// Arabic number.
    An,
    /// Common number separator (`,`, `.`, `/`, `:`).
    Cs,
    /// Non-spacing mark.
    Nsm,
    /// Boundary neutral (zero-width and control characters).
    Bn,
    /// Paragraph separator.
    B,
    /// Segment separator (tab).
    S,
    /// Whitespace.
    Ws,
    /// Other neutral.
    On,
}

/// The bidirectional type of a character.
pub fn class(c: char) -> Class {
    use Class::*;
    let u = c as u32;
    match u {
        0x0030..=0x0039
        | 0x00B2
        | 0x00B3
        | 0x00B9
        | 0x06F0..=0x06F9
        | 0x2070
        | 0x2074..=0x2079
        | 0x2080..=0x2089
        | 0x2488..=0x249B
        | 0xFF10..=0xFF19 => En,
        0x002B | 0x002D | 0x207A | 0x207B | 0x208A | 0x208B | 0x2212 | 0xFB29 | 0xFE62 | 0xFE63
        | 0xFF0B | 0xFF0D => Es,
        0x0023..=0x0025
        | 0x00A2..=0x00A5
        | 0x00B0
        | 0x00B1
        | 0x0609
        | 0x060A
        | 0x066A
        | 0x09F2
        | 0x09F3
        | 0x0E3F
        | 0x17DB
        | 0x2030..=0x2034
        | 0x20A0..=0x20CF
        | 0x212E
        | 0x2213
        | 0xFE5F
        | 0xFE69
        | 0xFE6A
        | 0xFF03..=0xFF05
        | 0xFFE0
        | 0xFFE1
        | 0xFFE5
        | 0xFFE6 => Et,
        0x0600..=0x0605 | 0x0660..=0x0669 | 0x066B | 0x066C | 0x06DD | 0x0890 | 0x0891 | 0x08E2 => {
            An
        }
        0x002C | 0x002E | 0x002F | 0x003A | 0x00A0 | 0x060C | 0x202F | 0x2044 | 0xFE50 | 0xFE52
        | 0xFE55 | 0xFF0C | 0xFF0E | 0xFF0F | 0xFF1A => Cs,
        0x0009 | 0x000B | 0x001F => S,
        0x000A | 0x000D | 0x001C..=0x001E | 0x0085 | 0x2029 => B,
        0x000C | 0x0020 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x205F | 0x3000 => Ws,
        0x0000..=0x0008
        | 0x000E..=0x001B
        | 0x007F..=0x0084
        | 0x0086..=0x009F
        | 0x00AD
        | 0x180E
        | 0x200B..=0x200D
        | 0x202A..=0x202E
        | 0x2060..=0x2069
        | 0x206A..=0x206F
        | 0xFEFF => Bn,
        0x200E => L,
        0x200F => R,
        0x061C => Al,
        // Combining marks.
        0x0300..=0x036F
        | 0x0483..=0x0489
        | 0x0591..=0x05BD
        | 0x05BF
        | 0x05C1
        | 0x05C2
        | 0x05C4
        | 0x05C5
        | 0x05C7
        | 0x0610..=0x061A
        | 0x064B..=0x065F
        | 0x0670
        | 0x06D6..=0x06DC
        | 0x06DF..=0x06E4
        | 0x06E7
        | 0x06E8
        | 0x06EA..=0x06ED
        | 0x0711
        | 0x0730..=0x074A
        | 0x07A6..=0x07B0
        | 0x07EB..=0x07F3
        | 0x0816..=0x0819
        | 0x081B..=0x0823
        | 0x0825..=0x0827
        | 0x0829..=0x082D
        | 0x0859..=0x085B
        | 0x08D3..=0x08E1
        | 0x08E3..=0x0902
        | 0x1AB0..=0x1AFF
        | 0x1DC0..=0x1DFF
        | 0x20D0..=0x20F0
        | 0xFB1E
        | 0xFE00..=0xFE0F
        | 0xFE20..=0xFE2F => Nsm,
        // Hebrew, Samaritan, Mandaic, NKo and other right-to-left scripts.
        0x0590..=0x05FF
        | 0x07C0..=0x085F
        | 0xFB1D..=0xFB4F
        | 0x10800..=0x10FFF
        | 0x1E800..=0x1EDFF => R,
        // Arabic, Syriac, Thaana and their presentation forms.
        0x0600..=0x07BF
        | 0x0860..=0x08FF
        | 0xFB50..=0xFD3D
        | 0xFD40..=0xFDFF
        | 0xFE70..=0xFEFE
        | 0x1EE00..=0x1EEFF => Al,
        // ASCII and Latin-1 punctuation and symbols.
        0x0021
        | 0x0022
        | 0x0026..=0x002A
        | 0x003B..=0x0040
        | 0x005B..=0x0060
        | 0x007B..=0x007E
        | 0x00A1
        | 0x00A6..=0x00A9
        | 0x00AB
        | 0x00AC
        | 0x00AE
        | 0x00AF
        | 0x00B4
        | 0x00B6..=0x00B8
        | 0x00BB..=0x00BF
        | 0x00D7
        | 0x00F7 => On,
        // General punctuation, symbols, arrows, math, shapes and CJK
        // punctuation (letter-like symbols aside).
        0x2010..=0x2027
        | 0x2035..=0x2043
        | 0x2045..=0x205E
        | 0x2190..=0x2211
        | 0x2214..=0x2335
        | 0x237B..=0x2394
        | 0x2396..=0x2487
        | 0x24EA..=0x26AB
        | 0x26AD..=0x27FF
        | 0x2900..=0x2B73
        | 0x3001..=0x3004
        | 0x3008..=0x3020
        | 0xFD3E
        | 0xFD3F
        | 0xFE10..=0xFE19
        | 0xFE30..=0xFE4F
        | 0xFE51
        | 0xFE54
        | 0xFE56..=0xFE5E
        | 0xFE60
        | 0xFE61
        | 0xFE64..=0xFE68
        | 0xFE6B
        | 0xFF01
        | 0xFF02
        | 0xFF06..=0xFF0A
        | 0xFF1B..=0xFF20
        | 0xFF3B..=0xFF40
        | 0xFF5B..=0xFF65
        | 0xFFE2..=0xFFE4
        | 0xFFE8..=0xFFEE => On,
        _ => L,
    }
}

/// The glyph a character shows at a right-to-left level (paired brackets
/// and other mirrored characters), if it changes.
pub fn mirror(c: char) -> Option<char> {
    const PAIRS: &[(char, char)] = &[
        ('(', ')'),
        ('<', '>'),
        ('[', ']'),
        ('{', '}'),
        ('\u{00AB}', '\u{00BB}'),
        ('\u{2039}', '\u{203A}'),
        ('\u{2045}', '\u{2046}'),
        ('\u{207D}', '\u{207E}'),
        ('\u{208D}', '\u{208E}'),
        ('\u{2208}', '\u{220B}'),
        ('\u{2264}', '\u{2265}'),
        ('\u{226A}', '\u{226B}'),
        ('\u{2282}', '\u{2283}'),
        ('\u{2286}', '\u{2287}'),
        ('\u{2329}', '\u{232A}'),
        ('\u{27E8}', '\u{27E9}'),
        ('\u{27E6}', '\u{27E7}'),
        ('\u{3008}', '\u{3009}'),
        ('\u{300A}', '\u{300B}'),
        ('\u{300C}', '\u{300D}'),
        ('\u{300E}', '\u{300F}'),
        ('\u{3010}', '\u{3011}'),
        ('\u{3014}', '\u{3015}'),
        ('\u{FF08}', '\u{FF09}'),
        ('\u{FF3B}', '\u{FF3D}'),
        ('\u{FF5B}', '\u{FF5D}'),
    ];
    PAIRS.iter().find_map(|&(a, b)| {
        if c == a {
            Some(b)
        } else if c == b {
            Some(a)
        } else {
            None
        }
    })
}

/// Whether text of these types needs bidirectional processing in a
/// paragraph of the given direction.
pub fn needed(classes: &[Class], rtl_paragraph: bool) -> bool {
    rtl_paragraph
        || classes
            .iter()
            .any(|c| matches!(c, Class::R | Class::Al | Class::An))
}

/// Strong direction for neutral resolution: L, R (numbers count as R).
fn strong(c: Class) -> Option<bool> {
    match c {
        Class::L => Some(false),
        Class::R | Class::Al | Class::En | Class::An => Some(true),
        _ => None,
    }
}

/// Resolves the embedding level of each character of a paragraph:
/// `classes` from [`class`], `rtl_runs[i]` when the character's run is
/// marked right to left, `base` the paragraph level (0 or 1). As in Word,
/// a separator in a right-to-left run does not join the numbers around
/// it: `78/265` reads as two numbers, right to left.
pub fn levels(classes: &[Class], rtl_runs: &[bool], base: u8) -> Vec<u8> {
    use Class::*;
    let n = classes.len();
    let sos = if base % 2 == 1 { R } else { L };
    let mut t: Vec<Class> = classes.to_vec();
    // W1: marks (and boundary neutrals) take the type before them.
    let mut prev = sos;
    for c in t.iter_mut() {
        if matches!(*c, Nsm | Bn) {
            *c = prev;
        }
        prev = *c;
    }
    // W2: European numbers after Arabic letters are Arabic numbers.
    let mut last_strong = sos;
    for c in t.iter_mut() {
        match *c {
            L | R | Al => last_strong = *c,
            En if last_strong == Al => *c = An,
            _ => {}
        }
    }
    // W3.
    for c in t.iter_mut() {
        if *c == Al {
            *c = R;
        }
    }
    // W4: a single separator between two numbers of a kind joins them.
    for i in 1..n.saturating_sub(1) {
        if rtl_runs.get(i).copied().unwrap_or(false) {
            continue;
        }
        let (a, b) = (t[i - 1], t[i + 1]);
        match t[i] {
            Es if a == En && b == En => t[i] = En,
            Cs if a == En && b == En => t[i] = En,
            Cs if a == An && b == An => t[i] = An,
            _ => {}
        }
    }
    // W5: terminators next to European numbers are part of them.
    let mut i = 0;
    while i < n {
        if t[i] != Et {
            i += 1;
            continue;
        }
        let start = i;
        while i < n && t[i] == Et {
            i += 1;
        }
        let touches = (start > 0 && t[start - 1] == En) || (i < n && t[i] == En);
        if touches {
            for c in &mut t[start..i] {
                *c = En;
            }
        }
    }
    // W6: other separators and terminators are neutral.
    for c in t.iter_mut() {
        if matches!(*c, Es | Et | Cs) {
            *c = On;
        }
    }
    // W7: European numbers in left-to-right text are left to right.
    let mut last_strong = sos;
    for c in t.iter_mut() {
        match *c {
            L | R => last_strong = *c,
            En if last_strong == L => *c = L,
            _ => {}
        }
    }
    // N1, N2: neutrals between text of one direction take it; others the
    // paragraph's (right to left in runs marked so).
    let mut i = 0;
    while i < n {
        if !matches!(t[i], B | S | Ws | On) {
            i += 1;
            continue;
        }
        let start = i;
        while i < n && matches!(t[i], B | S | Ws | On) {
            i += 1;
        }
        let before = (0..start)
            .rev()
            .find_map(|k| strong(t[k]))
            .unwrap_or(base % 2 == 1);
        let after = (i..n).find_map(|k| strong(t[k])).unwrap_or(base % 2 == 1);
        for (k, c) in t.iter_mut().enumerate().take(i).skip(start) {
            let rtl = if before == after {
                before
            } else {
                base % 2 == 1 || rtl_runs.get(k).copied().unwrap_or(false)
            };
            *c = if rtl { R } else { L };
        }
    }
    // I1, I2.
    let mut out: Vec<u8> = t
        .iter()
        .map(|c| match (base % 2 == 1, c) {
            (false, R) => base + 1,
            (false, An | En) => base + 2,
            (true, L | En | An) => base + 1,
            _ => base,
        })
        .collect();
    // L1: tabs and the whitespace before them (and at the paragraph's end)
    // are at the paragraph's level.
    let mut reset = true;
    for k in (0..n).rev() {
        match classes[k] {
            S | B => {
                out[k] = base;
                reset = true;
            }
            Ws | Bn if reset => out[k] = base,
            _ => reset = false,
        }
    }
    out
}

/// Puts one line in visual order. `x` and `adv` give the line's clusters
/// in logical order as laid out left to right; `levels` their embedding
/// levels. Every run at or above each level, from the highest down to 1,
/// is mirrored within its extent; a right-to-left paragraph's whole line
/// is mirrored within `area` (the text area), so the paragraph's start
/// lands on its right.
pub fn reorder(x: &mut [f32], adv: &[f32], levels: &[u8], base: u8, area: (f32, f32)) {
    let n = x.len().min(adv.len()).min(levels.len());
    let Some(&max) = levels[..n].iter().max() else {
        return;
    };
    let mut order: Vec<usize> = (0..n).collect();
    let mut lowest = 1;
    if base % 2 == 1 {
        for i in 0..n {
            x[i] = area.0 + area.1 - (x[i] + adv[i]);
        }
        order.reverse();
        lowest = 2;
    }
    for level in (lowest..=max).rev() {
        let mut k = 0;
        while k < n {
            if levels[order[k]] < level {
                k += 1;
                continue;
            }
            let start = k;
            while k < n && levels[order[k]] >= level {
                k += 1;
            }
            let run = &order[start..k];
            let left = run.iter().map(|&i| x[i]).fold(f32::INFINITY, f32::min);
            let right = run
                .iter()
                .map(|&i| x[i] + adv[i])
                .fold(f32::NEG_INFINITY, f32::max);
            for &i in run {
                x[i] = left + right - (x[i] + adv[i]);
            }
            order[start..k].reverse();
        }
    }
}

#[cfg(test)]
mod test;
