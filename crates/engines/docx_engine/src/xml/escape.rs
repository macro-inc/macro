//! Entity decoding and escaping.

/// Decodes the predefined entities and character references in `s`.
/// Attribute values also normalize literal tabs and newlines to spaces, as
/// XML attribute-value normalization requires.
pub(super) fn unescape(s: &str, attribute: bool) -> String {
    if !s.contains('&') && (!attribute || !s.contains(['\t', '\n', '\r'])) {
        return s.to_owned();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find(['&', '\t', '\n', '\r']) {
        out.push_str(&rest[..i]);
        let c = rest.as_bytes()[i];
        if c != b'&' {
            // Only attributes reach here with whitespace to normalize; in text
            // a CR LF pair becomes LF.
            if attribute {
                out.push(' ');
                if c == b'\r' && rest.as_bytes().get(i + 1) == Some(&b'\n') {
                    rest = &rest[i + 2..];
                    continue;
                }
            } else if c == b'\r' {
                out.push('\n');
                if rest.as_bytes().get(i + 1) == Some(&b'\n') {
                    rest = &rest[i + 2..];
                    continue;
                }
            } else {
                out.push(c as char);
            }
            rest = &rest[i + 1..];
            continue;
        }
        let tail = &rest[i..];
        let Some(semi) = tail[..tail.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[i + 1..];
            continue;
        };
        let entity = &tail[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse::<u32>().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[i + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Appends `s` escaped for element content.
pub fn escape_text(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\r' => out.push_str("&#13;"),
            // Characters XML 1.0 cannot carry are dropped.
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n') => {}
            '\u{FFFE}' | '\u{FFFF}' => {}
            _ => out.push(c),
        }
    }
}

/// Appends `s` escaped for a double-quoted attribute value.
pub fn escape_attr(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            c if (c as u32) < 0x20 => {}
            '\u{FFFE}' | '\u{FFFF}' => {}
            _ => out.push(c),
        }
    }
}
