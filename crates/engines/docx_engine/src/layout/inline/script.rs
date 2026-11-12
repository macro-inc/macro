//! Character classes for inline layout: scripts that take their own fonts
//! and the places lines may break besides spaces.

/// East Asian (CJK) text: ideographs, kana, hangul and their punctuation.
pub(super) fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x11FF | 0x2E80..=0x2FDF | 0x3000..=0x30FF | 0x3100..=0x31FF
        | 0x3200..=0x4DBF | 0x4E00..=0x9FFF | 0xA960..=0xA97F | 0xAC00..=0xD7FF
        | 0xF900..=0xFAFF | 0xFE30..=0xFE4F | 0xFF00..=0xFFEF | 0x20000..=0x2FA1F)
}

/// Complex-script text (right-to-left and South and South-East Asian
/// scripts), set in a run's complex-script font.
pub(super) fn is_complex(c: char) -> bool {
    matches!(c as u32,
        0x0590..=0x08FF | 0x0900..=0x0DFF | 0x0E00..=0x0EFF | 0x0F00..=0x0FFF
        | 0x1000..=0x109F | 0x1780..=0x17FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF)
}

/// East Asian punctuation that may not start a line (kinsoku).
fn no_line_start(c: char) -> bool {
    matches!(
        c,
        '\u{3001}'
            | '\u{3002}'
            | '\u{FF0C}'
            | '\u{FF0E}'
            | '\u{FF1A}'
            | '\u{FF1B}'
            | '\u{FF01}'
            | '\u{FF1F}'
            | '\u{FF09}'
            | '\u{FF3D}'
            | '\u{FF5D}'
            | '\u{300D}'
            | '\u{300F}'
            | '\u{3009}'
            | '\u{300B}'
            | '\u{3011}'
            | '\u{3015}'
            | '\u{3017}'
            | '\u{3019}'
            | '\u{301B}'
            | '\u{2019}'
            | '\u{201D}'
            | '\u{30FC}'
            | '\u{3005}'
            | '\u{309D}'
            | '\u{309E}'
            | '\u{30FD}'
            | '\u{30FE}'
            | '\u{FF65}'
    )
}

/// East Asian punctuation that may not end a line (kinsoku).
fn no_line_end(c: char) -> bool {
    matches!(
        c,
        '\u{FF08}'
            | '\u{FF3B}'
            | '\u{FF5B}'
            | '\u{300C}'
            | '\u{300E}'
            | '\u{3008}'
            | '\u{300A}'
            | '\u{3010}'
            | '\u{3014}'
            | '\u{3016}'
            | '\u{3018}'
            | '\u{301A}'
            | '\u{2018}'
            | '\u{201C}'
    )
}

/// Characters after which a line may break besides spaces.
pub(super) fn breaks_after(c: char, next: Option<char>) -> bool {
    // Joiners glue their neighbours together.
    let joiner = |c: char| matches!(c, '\u{200D}' | '\u{2060}' | '\u{FEFF}');
    if joiner(c) || next.is_some_and(joiner) {
        return false;
    }
    match c {
        '-' | '\u{2010}' | '\u{2012}' | '\u{2013}' | '\u{2014}' => {
            next.is_some_and(|n| !n.is_ascii_digit() && !n.is_whitespace())
        }
        '\u{200B}' => true,
        c if no_line_end(c) => false,
        _ if next.is_some_and(no_line_start) => false,
        c if is_cjk(c) => true,
        _ => next.is_some_and(is_cjk),
    }
}
