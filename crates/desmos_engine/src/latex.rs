//! Rewrite common Desmos / LaTeX surface syntax into the engine's plain math.

/// Map `\sin`, `\frac{a}{b}`, `\pi`, `x^{2}`, … onto the Pratt parser's input.
pub fn normalize_latex(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            let cmd = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
            match cmd {
                "left" | "right" | "," | ";" | ":" | "!" | "quad" | "qquad" => {}
                "cdot" | "times" | "ast" => out.push('*'),
                "pi" => out.push_str("pi"),
                "theta" => out.push_str("theta"),
                "infty" | "infinity" => out.push_str("Infinity"),
                "frac" => {
                    let num = take_group(bytes, &mut i);
                    let den = take_group(bytes, &mut i);
                    out.push_str("((");
                    out.push_str(&normalize_latex(&num));
                    out.push_str(")/(");
                    out.push_str(&normalize_latex(&den));
                    out.push_str("))");
                }
                "sqrt" => {
                    let inner = take_group(bytes, &mut i);
                    out.push_str("sqrt(");
                    out.push_str(&normalize_latex(&inner));
                    out.push(')');
                }
                "abs" => {
                    let inner = take_group(bytes, &mut i);
                    out.push('|');
                    out.push_str(&normalize_latex(&inner));
                    out.push('|');
                }
                "{" => out.push('{'),
                "}" => out.push('}'),
                other if !other.is_empty() => out.push_str(other),
                _ => {}
            }
            continue;
        }
        if bytes[i] == b'^' && bytes.get(i + 1) == Some(&b'{') {
            i += 1;
            let inner = take_group(bytes, &mut i);
            out.push_str("^(");
            out.push_str(&normalize_latex(&inner));
            out.push(')');
            continue;
        }
        if bytes[i] == b'_' && bytes.get(i + 1) == Some(&b'{') {
            i += 1;
            let inner = take_group(bytes, &mut i);
            out.push('_');
            out.push_str(&inner);
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn take_group(bytes: &[u8], i: &mut usize) -> String {
    skip_ws(bytes, i);
    if bytes.get(*i) != Some(&b'{') {
        if let Some(&c) = bytes.get(*i) {
            *i += 1;
            return (c as char).to_string();
        }
        return String::new();
    }
    *i += 1;
    let start = *i;
    let mut depth = 1;
    while *i < bytes.len() && depth > 0 {
        match bytes[*i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        *i += 1;
    }
    let end = if depth == 0 { *i - 1 } else { *i };
    String::from_utf8_lossy(&bytes[start..end]).into_owned()
}

fn skip_ws(bytes: &[u8], i: &mut usize) {
    while bytes.get(*i).is_some_and(|c| c.is_ascii_whitespace()) {
        *i += 1;
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn frac_and_trig() {
        assert_eq!(
            normalize_latex(r"\sin(\pi)+\frac{1}{2}"),
            "sin(pi)+((1)/(2))"
        );
        assert_eq!(normalize_latex(r"x^{2}"), "x^(2)");
        assert_eq!(normalize_latex(r"\sqrt{x+1}"), "sqrt(x+1)");
    }
}
