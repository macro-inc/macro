//! The one piece of SQL sugar: `column HAS value`, a membership test on a
//! multi-valued (JSON array) column. Everything else is plain SQLite.
//!
//! `guests.people HAS 'usr_1'` rewrites to
//! `EXISTS (SELECT 1 FROM json_each(guests.people) WHERE json_each.value = 'usr_1')`.
//! The rewrite is textual and skips string literals, quoted identifiers, and
//! comments, so `'a HAS b'` inside quotes is left alone.

#[cfg(test)]
mod test;

/// Rewrite every `HAS` predicate in `sql`.
pub fn desugar(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 64);
    let bytes = sql.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(end) = opaque_span_end(bytes, i) {
            out.push_str(&sql[i..end]);
            i = end;
            continue;
        }
        // The left operand must still sit verbatim at the end of the output;
        // it does not when it was the right operand of a rewrite just made
        // (`a HAS b HAS c`), which is not a valid predicate anyway.
        if let Some((lhs, rhs, end)) = match_has(sql, i)
            && out.ends_with(lhs)
        {
            // Remove the already-emitted left operand and emit the rewrite.
            let cut = out.len() - lhs.len();
            out.truncate(cut);
            // JSON arrays hold display strings, so a bare number must compare
            // as text (`tags HAS 5` → `'5'`); strings and parameters pass
            // through unchanged.
            let rhs = if rhs
                .trim_start_matches('-')
                .starts_with(|c: char| c.is_ascii_digit())
            {
                format!("CAST({rhs} AS TEXT)")
            } else {
                rhs.to_string()
            };
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

/// End of the string literal, quoted identifier, or comment starting at `i`,
/// if one does — content the rewrite must copy untouched.
fn opaque_span_end(bytes: &[u8], i: usize) -> Option<usize> {
    match bytes[i] {
        quote @ (b'\'' | b'"') => {
            let mut k = i + 1;
            while k < bytes.len() {
                if bytes[k] == quote {
                    if bytes.get(k + 1) == Some(&quote) {
                        k += 2;
                        continue;
                    }
                    return Some(k + 1);
                }
                k += 1;
            }
            Some(bytes.len())
        }
        b'-' if bytes.get(i + 1) == Some(&b'-') => Some(
            bytes[i..]
                .iter()
                .position(|&b| b == b'\n')
                .map_or(bytes.len(), |newline| i + newline + 1),
        ),
        b'/' if bytes.get(i + 1) == Some(&b'*') => Some(
            bytes[i + 2..]
                .windows(2)
                .position(|w| w == b"*/")
                .map_or(bytes.len(), |close| i + 2 + close + 2),
        ),
        _ => None,
    }
}

/// SQL keywords that can precede an identifier; never the left operand of `HAS`.
const KEYWORDS: &[&str] = &[
    "HAS",
    "ALL",
    "AND",
    "AS",
    "ASC",
    "BETWEEN",
    "BY",
    "CASE",
    "COLLATE",
    "CROSS",
    "DELETE",
    "DESC",
    "DISTINCT",
    "ELSE",
    "END",
    "ESCAPE",
    "EXCEPT",
    "EXISTS",
    "FROM",
    "GROUP",
    "HAVING",
    "IN",
    "INNER",
    "INSERT",
    "INTERSECT",
    "INTO",
    "IS",
    "JOIN",
    "LEFT",
    "LIKE",
    "LIMIT",
    "NATURAL",
    "NOT",
    "NULL",
    "OFFSET",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "OVER",
    "PARTITION",
    "RECURSIVE",
    "RETURNING",
    "SELECT",
    "SET",
    "THEN",
    "UNION",
    "UPDATE",
    "USING",
    "VALUES",
    "WHEN",
    "WHERE",
    "WITH",
];

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
    // Compare bytes: `j + 3` may fall inside a multi-byte character.
    if j + 3 > bytes.len() || !bytes[j..j + 3].eq_ignore_ascii_case(b"has") {
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
    // `SELECT has FROM t`, `AS has`, `GROUP BY has`: a column named `has`
    // after a keyword is not a predicate.
    if KEYWORDS.iter().any(|k| k.eq_ignore_ascii_case(lhs)) {
        return None;
    }
    // Right operand: a string literal, a quoted identifier, a parameter, a
    // number, or an identifier chain (which may embed quoted segments).
    let mut k = after;
    while k < bytes.len() && bytes[k].is_ascii_whitespace() {
        k += 1;
    }
    if k >= bytes.len() {
        return None;
    }
    let rhs_start = k;
    if sql[k..].starts_with("--") || sql[k..].starts_with("/*") {
        return None;
    }
    // An unterminated quote means the statement is already broken; leave it
    // for SQLite to report rather than rewriting inside the literal.
    let scan_quoted = |mut k: usize, quote: u8| -> Option<usize> {
        k += 1;
        while k < bytes.len() {
            if bytes[k] == quote {
                if k + 1 < bytes.len() && bytes[k + 1] == quote {
                    k += 2;
                    continue;
                }
                return Some(k + 1);
            }
            k += 1;
        }
        None
    };
    match bytes[k] {
        b'\'' | b'"' => k = scan_quoted(k, bytes[k])?,
        b'?' | b':' | b'@' | b'$' => {
            k += 1;
            while k < bytes.len() && (bytes[k].is_ascii_alphanumeric() || bytes[k] == b'_') {
                k += 1;
            }
        }
        b'-' | b'0'..=b'9' => {
            k += 1;
            while k < bytes.len()
                && (bytes[k].is_ascii_digit()
                    || bytes[k] == b'.'
                    || bytes[k] == b'e'
                    || bytes[k] == b'E')
            {
                k += 1;
            }
        }
        _ => {
            while k < bytes.len() {
                if bytes[k] == b'"' {
                    k = scan_quoted(k, b'"')?;
                } else if bytes[k].is_ascii_alphanumeric() || bytes[k] == b'_' || bytes[k] == b'.' {
                    k += 1;
                } else {
                    break;
                }
            }
        }
    }
    if k == rhs_start {
        return None;
    }
    Some((lhs, &sql[rhs_start..k], k))
}
