//! The one piece of SQL sugar: `column HAS value`, a membership test on a
//! multi-valued (JSON array) column. Everything else is plain SQLite.
//!
//! `guests.people HAS 'usr_1'` rewrites to
//! `EXISTS (SELECT 1 FROM json_each(guests.people) WHERE json_each.value = 'usr_1')`.
//! The rewrite is textual and skips string literals, so `'a HAS b'` inside
//! quotes is left alone.

#[cfg(test)]
mod test;

/// Rewrite every `HAS` predicate in `sql`.
pub fn desugar(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 64);
    let bytes = sql.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Copy string literals verbatim.
        if bytes[i] == b'\'' {
            let start = i;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\'' {
                    if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push_str(&sql[start..i]);
            continue;
        }
        if let Some((lhs, rhs, end)) = match_has(sql, i) {
            // Remove the already-emitted left operand and emit the rewrite.
            let cut = out.len() - lhs.len();
            out.truncate(cut);
            out.push_str(&format!(
                "EXISTS (SELECT 1 FROM json_each({lhs}) WHERE json_each.value = {rhs})"
            ));
            i = end;
            continue;
        }
        let ch = sql[i..].chars().next().expect("in bounds");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_ident_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'.' || c == b'"'
}

/// If a `HAS` keyword starts at `i` (preceded by an identifier already
/// emitted), return the left operand, right operand text, and the index just
/// past the right operand.
fn match_has(sql: &str, i: usize) -> Option<(&str, &str, usize)> {
    let bytes = sql.as_bytes();
    // We must be at whitespace followed by HAS followed by whitespace.
    if !bytes[i].is_ascii_whitespace() {
        return None;
    }
    let mut j = i;
    while j < bytes.len() && bytes[j].is_ascii_whitespace() {
        j += 1;
    }
    if j + 3 > bytes.len() || !sql[j..j + 3].eq_ignore_ascii_case("has") {
        return None;
    }
    let after = j + 3;
    if after >= bytes.len() || !bytes[after].is_ascii_whitespace() {
        return None;
    }
    // Left operand: identifier chain ending at i; a quoted identifier may
    // contain anything, so jump to its opening quote as one unit.
    let mut start = i;
    loop {
        if start > 0 && bytes[start - 1] == b'"' {
            match sql[..start - 1].rfind('"') {
                Some(open) => start = open,
                None => break,
            }
        } else if start > 0 && is_ident_char(bytes[start - 1]) {
            start -= 1;
        } else {
            break;
        }
    }
    if start == i {
        return None;
    }
    let lhs = &sql[start..i];
    // Right operand: a string literal, a parameter, or an identifier/number.
    let mut k = after;
    while k < bytes.len() && bytes[k].is_ascii_whitespace() {
        k += 1;
    }
    if k >= bytes.len() {
        return None;
    }
    let rhs_start = k;
    if bytes[k] == b'\'' {
        k += 1;
        while k < bytes.len() {
            if bytes[k] == b'\'' {
                if k + 1 < bytes.len() && bytes[k + 1] == b'\'' {
                    k += 2;
                    continue;
                }
                k += 1;
                break;
            }
            k += 1;
        }
    } else {
        while k < bytes.len()
            && (is_ident_char(bytes[k]) || bytes[k] == b'?' || bytes[k] == b':' || bytes[k] == b'-')
        {
            k += 1;
        }
    }
    if k == rhs_start {
        return None;
    }
    Some((lhs, &sql[rhs_start..k], k))
}
