//! Fractional positions: strings that sort in stack order, with room for a
//! new one between any two, so concurrent moves and inserts merge. Keys
//! never end in the smallest digit, which keeps room below every key.

/// Digits of a position, in sort order.
const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

fn digit(c: u8) -> usize {
    DIGITS.iter().position(|&d| d == c).unwrap_or(0)
}

/// Evenly spread positions for a stack of `n` items.
pub fn spread(n: usize) -> Vec<String> {
    let base = DIGITS.len();
    let span = base.pow(4);
    let step = (span / (n + 1)).max(1);
    (1..=n)
        .map(|k| {
            let mut v = (k * step).min(span - 1);
            if v % base == 0 {
                v += 1;
            }
            let mut out = [b'0'; 4];
            for d in out.iter_mut().rev() {
                *d = DIGITS[v % base];
                v /= base;
            }
            String::from_utf8(out.to_vec()).expect("ASCII digits")
        })
        .collect()
}

fn midpoint(a: &[u8], b: Option<&[u8]>, depth: usize) -> Vec<u8> {
    if depth > 128 {
        return vec![DIGITS[DIGITS.len() / 2]];
    }
    if let Some(b) = b {
        // A common prefix stays.
        let mut n = 0;
        while n < b.len() && a.get(n).copied().unwrap_or(DIGITS[0]) == b[n] {
            n += 1;
        }
        if n > 0 {
            let mut out = b[..n].to_vec();
            out.extend(midpoint(
                a.get(n..).unwrap_or(&[]),
                Some(&b[n..]),
                depth + 1,
            ));
            return out;
        }
    }
    let da = a.first().map_or(0, |&c| digit(c));
    let db = b
        .and_then(|b| b.first())
        .map_or(DIGITS.len(), |&c| digit(c));
    if db > da + 1 {
        return vec![DIGITS[(da + db).div_ceil(2)]];
    }
    // The first digits are consecutive.
    match b {
        Some(b) if b.len() > 1 => b[..1].to_vec(),
        _ => {
            let mut out = vec![DIGITS[da]];
            out.extend(midpoint(a.get(1..).unwrap_or(&[]), None, depth + 1));
            out
        }
    }
}

/// A position strictly between `a` and `b` (either may be absent: the
/// bottom or top of the stack). With `a >= b` (keys that collide after a
/// merge), returns a key just above `a`.
pub fn between(a: Option<&str>, b: Option<&str>) -> String {
    let a = a.unwrap_or("");
    let b = b.filter(|b| a < *b);
    let out = midpoint(a.as_bytes(), b.map(str::as_bytes), 0);
    String::from_utf8(out).expect("ASCII digits")
}

#[cfg(test)]
mod test;
